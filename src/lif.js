// Simulacion LIF del connectome completo (MaleCNS v1.0), orientada a eventos, en la CPU.
// Es la alternativa cuando el navegador no ofrece WebGPU; la version principal es lif_gpu.js (dt 0,1 ms, sin poda).
// Parametros de Shiu et al. (Nature 2024): tau_m 20 ms, V_rest = V_reset = -52 mV, V_th = -45 mV,
// refractario 2,2 ms, retardo sinaptico 1,8 ms, tau_syn 5 ms (peso sinaptico: ver PARAMS).
// Se agrega adaptacion de frecuencia (corriente que crece con cada disparo y decae con tau_a), ausente en el
// LIF puro: sin ella algunos circuitos (p. ej. neuronas locales del lobulo antenal) quedan disparando a la
// frecuencia maxima indefinidamente, algo que las neuronas reales no hacen. Tambien depresion sinaptica de
// corto plazo (Tsodyks-Markram, por neurona presinaptica): el uso sostenido agota los recursos y la sinapsis
// transmite menos, lo que corta reverberaciones; a tasas normales casi no cambia la transmision.
// Solo se integran las neuronas activas (con potencial, conductancia o adaptacion distintos de cero),
// lo que permite correr las 165.122 neuronas en tiempo real en la CPU.

// wSyn: 0,275 mV de Shiu escalado por la densidad sinaptica: el MaleCNS registra ~1,73 veces mas
// sinapsis de entrada por neurona que FlyWire (sobre el que se calibro el modelo) -> 0,16 mV, y +12 %
// para compensar la depresion de corto plazo a tasas bajas -> 0,18 mV.
// Validacion (1 s): azucar (LB3) -> MN9 activo; looming (LPLC2/LC4) -> Giant Fiber > 300 Hz; olor -> PN ~13 Hz
// y celulas de Kenyon escasas (~15 % activas); sin actividad autosostenida al retirar el estimulo.
// dt de 1 ms (Shiu usa 0,1 ms): estable con tau de 5 y 20 ms y permite correr en tiempo real en la CPU; la
// integracion de Euler con este paso agranda ~12 % el potencial postsinaptico respecto de dt 0,1 ms.
export const PARAMS = { dt: 1, tauM: 20, tauS: 5, vTh: 7, tRef: 2.2, delay: 1.8, wSyn: 0.18, aInc: 2, tauA: 200, U: 0.1, tauRec: 150 };

/** Muestra de una distribucion de Poisson de media lam. */
function poisson(lam) {
  if (lam <= 0) return 0;
  if (lam > 30) return Math.max(0, Math.round(lam + Math.sqrt(lam) * Math.sqrt(-2 * Math.log(1 - Math.random())) * Math.cos(2 * Math.PI * Math.random())));
  const L = Math.exp(-lam);
  let k = 0, p = 1;
  do { k++; p *= Math.random(); } while (p > L);
  return k - 1;
}

export class LIF {
  /** buf: ArrayBuffer de assets/connectome.bin */
  constructor(buf, params = {}) {
    this.p = { ...PARAMS, ...params };
    const h = new Uint32Array(buf, 0, 3);
    const N = (this.N = h[0]), E = (this.E = h[1]);
    this.nSoma = h[2];
    let o = 12;
    this.indptr = new Uint32Array(buf, o, N + 1); o += (N + 1) * 4;
    this.indices = new Uint32Array(buf, o, E); o += E * 4;
    this.w = new Int16Array(buf, o, E); o += E * 2;
    this.nt = new Uint8Array(buf, o, N);

    const p = this.p;
    this.u = new Float32Array(N);          // potencial sobre el reposo (mV)
    this.g = new Float32Array(N);          // conductancia sinaptica (mV)
    this.ad = new Float32Array(N);         // corriente de adaptacion (mV)
    this.res = new Float32Array(N).fill(1); // recursos sinapticos disponibles (depresion de corto plazo)
    this.lastSpike = new Float32Array(N).fill(-1e9);
    this.refr = new Uint8Array(N);         // pasos refractarios restantes
    this.isActive = new Uint8Array(N);
    this.active = new Int32Array(N);
    this.nActive = 0;
    this.trace = new Uint8Array(N);        // traza visual: 255 al disparar, decae
    this.count = new Uint16Array(N);       // disparos desde la ultima lectura
    this.decayM = p.dt / p.tauM;
    this.decayS = Math.exp(-p.dt / p.tauS);
    this.decayA = Math.exp(-p.dt / p.tauA);
    this.refSteps = Math.round(p.tRef / p.dt);
    this.delaySteps = Math.max(1, Math.round(p.delay / p.dt));
    this.ringN = this.delaySteps + 1;
    this.ring = Array.from({ length: this.ringN }, () => new Int32Array(8192));
    this.ringF = Array.from({ length: this.ringN }, () => new Float32Array(8192)); // factor de liberacion de cada disparo
    this.ringLen = new Int32Array(this.ringN);
    this.slot = 0;
    // ganancia por neurona presinaptica (farmacologia): 1 = normal
    this.preGain = new Float32Array(N).fill(1);
    this.drives = [];                      // [{ idx: Int32Array, rate (Hz) }] entradas de Poisson forzadas
    this.tonic = [];                       // [{ idx, current (mV) }] corriente tonica
    this.time = 0;
    this.spikesTotal = 0;
  }

  activate(i) { if (!this.isActive[i]) { this.isActive[i] = 1; this.active[this.nActive++] = i; } }

  spike(i) {
    this.u[i] = 0;
    this.ad[i] += this.p.aInc;
    this.refr[i] = this.refSteps;
    this.trace[i] = 255;
    if (this.count[i] < 65535) this.count[i]++;
    this.spikesTotal++;
    // depresion: recuperar recursos desde el ultimo disparo y consumir una fraccion U
    const p = this.p;
    const r = 1 - (1 - this.res[i]) * Math.exp(-(this.time - this.lastSpike[i]) / p.tauRec);
    this.res[i] = r * (1 - p.U);
    this.lastSpike[i] = this.time;
    const s = (this.slot + this.delaySteps) % this.ringN;
    let buf = this.ring[s], bf = this.ringF[s];
    if (this.ringLen[s] >= buf.length) {
      const nb = new Int32Array(buf.length * 2); nb.set(buf); this.ring[s] = buf = nb;
      const nf = new Float32Array(bf.length * 2); nf.set(bf); this.ringF[s] = bf = nf;
    }
    bf[this.ringLen[s]] = r;
    buf[this.ringLen[s]++] = i;
    this.activate(i);
  }

  /** Farmacologia: ganancia de las sinapsis segun el transmisor de la neurona presinaptica. */
  setGains({ ach = 1, gaba = 1, glu = 1 } = {}) {
    const g = this.preGain, nt = this.nt;
    for (let i = 0; i < this.N; i++) g[i] = nt[i] === 0 ? ach : nt[i] === 2 ? gaba : nt[i] === 1 ? glu : 1;
  }

  step() {
    const { u, g, ad, refr, indptr, indices, w, preGain } = this;
    const wSyn = this.p.wSyn;
    // 1) entregar los disparos que cumplen su retardo
    const list = this.ring[this.slot], rel = this.ringF[this.slot], len = this.ringLen[this.slot];
    for (let s = 0; s < len; s++) {
      const pre = list[s], k1 = indptr[pre + 1], gain = wSyn * preGain[pre] * rel[s];
      for (let k = indptr[pre]; k < k1; k++) {
        const post = indices[k];
        g[post] += gain * w[k];
        if (!this.isActive[post]) this.activate(post);
      }
    }
    this.ringLen[this.slot] = 0;
    // 2) entradas sensoriales: disparos de Poisson forzados
    const dt = this.p.dt;
    // (equivalente a sortear cada neurona: se sortea cuantas disparan y se eligen al azar)
    for (const d of this.drives) {
      if (d.rate <= 0 || !d.idx.length) continue;
      let k = poisson(d.idx.length * d.rate * dt * 1e-3);
      while (k-- > 0) { const i = d.idx[(Math.random() * d.idx.length) | 0]; if (!refr[i]) this.spike(i); }
    }
    for (const t of this.tonic) {
      if (t.current <= 0) continue;
      for (let j = 0; j < t.idx.length; j++) { const i = t.idx[j]; g[i] = Math.max(g[i], t.current); this.activate(i); }
    }
    // 3) integrar solo las activas
    const dm = this.decayM, ds = this.decayS, da = this.decayA, vTh = this.p.vTh;
    let n = 0;
    const act = this.active;
    for (let a = 0; a < this.nActive; a++) {
      const i = act[a];
      if (refr[i]) { refr[i]--; g[i] *= ds; ad[i] *= da; act[n++] = i; continue; }
      const ui = u[i] + dm * (g[i] - ad[i] - u[i]);
      g[i] *= ds;
      ad[i] *= da;
      if (ui >= vTh) { u[i] = ui; this.spike(i); act[n++] = i; continue; }
      u[i] = ui;
      if (ui < 0.2 && ui > -0.2 && g[i] < 0.2 && g[i] > -0.2 && ad[i] < 0.2) { this.isActive[i] = 0; u[i] = 0; g[i] = 0; ad[i] = 0; } // despreciable frente a 7 mV
      else act[n++] = i;
    }
    // (las activadas durante el bucle se agregaron al final y ya se recorrieron: la lista queda compacta)
    this.nActive = n;
    this.slot = (this.slot + 1) % this.ringN;
    this.time += dt;
  }

  /** Avanza ms de tiempo biologico. */
  run(ms) { const steps = Math.round(ms / this.p.dt); for (let s = 0; s < steps; s++) this.step(); }

  /** Tasa media (Hz) de un grupo desde la ultima lectura de ese grupo; windowMs = tiempo transcurrido. */
  rate(idx, windowMs) {
    let c = 0;
    for (let j = 0; j < idx.length; j++) c += this.count[idx[j]];
    return idx.length ? (c / idx.length) * (1000 / windowMs) : 0;
  }

  resetCounts() { this.count.fill(0); }

  decayTrace(k = 24) { const t = this.trace; for (let i = 0; i < t.length; i++) if (t[i]) t[i] = t[i] > k ? t[i] - k : 0; }
}
