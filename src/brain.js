// Modelo fenomenologico de la mosca: homeostasis, farmacocinetica, dopamina, aprendizaje y decision.
// Inspirado en circuitos de Drosophila (cuerpo fungiforme, dopaminergicas PAM/PPL1, NPF, dFB);
// no simula el connectome neurona a neurona.

const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const randn = () => Math.sqrt(-2 * Math.log(1 - Math.random())) * Math.cos(2 * Math.PI * Math.random());
const lognorm = (sd) => Math.exp(randn() * sd);

export const SUBSTANCES = {
  etanol:   { halfLife: 40, tolGain: 0.012, tolDecay: 0.0012, toxic: 1.5 },
  nicotina: { halfLife: 22, tolGain: 0.014, tolDecay: 0.0018, toxic: 1.6 },
  cocaina:  { halfLife: 14, tolGain: 0.022, tolDecay: 0.0018, toxic: 1.25 },
};

export const VICES = ['bar', 'cigarro', 'coca', 'slots', 'reels'];
export const DRUG_OF = { bar: 'etanol', cigarro: 'nicotina', coca: 'cocaina' };
// Saciedad: etanol y nicotina por efecto; cocaina por dopamina, que el animal dosifica para
// mantener cerca de un punto de saciedad (Wise et al. 1995; Tsibulsky & Norman 1999)
export const SATIETY = { etanol: 0.55, nicotina: 0.6 };
export const DA_SATIETY = 1.1;

export const DEATH_CAUSES = {
  etanol: 'Intoxicación etílica aguda',
  cocaina: 'Sobredosis de cocaína',
  nicotina: 'Toxicidad por nicotina',
  hambre: 'Inanición',
  sueno: 'Privación de sueño',
};

const HIST_N = 240; // muestras cada 0,5 s -> 2 min

export class Brain {
  constructor() { this.reset(); }

  reset() {
    // Perfil individual: cada sujeto difiere, como moscas de una misma linea (individualidad)
    this.profile = {
      etanol: lognorm(0.3), nicotina: lognorm(0.3), cocaina: lognorm(0.3), // sensibilidad farmacologica
      aprendizaje: clamp(0.3 * lognorm(0.35), 0.1, 0.6),                  // tasa de aprendizaje (MBON)
      novedad: clamp(0.35 * lognorm(0.4), 0.1, 0.8),                      // busqueda de novedad
      actividad: lognorm(0.15),                                            // nivel locomotor
      lateralidad: randn() * 0.35,                                         // sesgo de giro, rad/s (+ = izquierda)
      aversion: clamp(lognorm(0.4), 0.3, 2),                               // sensibilidad a señales aversivas (amargo, malestar)
    };
    this.energia = 0.8;   // 1 = llena
    this.sueno = 0.1;     // presion de sueno
    this.salud = 1;
    this.fichas = 30;
    this.drug = {};
    for (const s of Object.keys(SUBSTANCES)) this.drug[s] = { nivel: 0, tol: 0 };
    this.phasic = 0;      // dopamina fasica (picos de recompensa)
    this.sens = 1;        // sensibilidad dopaminergica (baja con el abuso)
    this.chronic = 0;
    this.brainrot = 0;
    this.rechazo = 0;     // NPF bajo tras un rechazo -> mas ganas de alcohol
    this.amor = 0;        // NPF alto tras aparearse
    this.lossChase = 0;   // "recuperar lo perdido" en las tragamonedas
    this.frustracion = 0;
    this.susto = 0;       // octopamina tras el escape
    // Valor aprendido de cada actividad (salida del cuerpo fungiforme, MBON)
    this.V = { bar: 0.3, cigarro: 0.25, coca: 0.25, slots: 0.3, reels: 0.35, comida: 0.5, cama: 0.3, pasear: 0.15 };
    this.dmg = { etanol: 0, cocaina: 0, nicotina: 0, hambre: 0, sueno: 0 };
    // Novedad: bonificacion de exploracion para lo que aun no probo (desaparece al probarlo)
    this.novelty = { bar: 1, cigarro: 1, coca: 1, slots: 1, reels: 1 };
    this.hist = { da: [], etanol: [], nicotina: [], cocaina: [] };
    for (const k in this.hist) this.hist[k] = new Array(HIST_N).fill(k === 'da' ? 0.2 : 0);
    this._histT = 0;
    this.lastRPE = 0;
    this.stats = {
      vivo: 0, shots: 0, cigarros: 0, lineas: 0, giros: 0, fichasPerdidas: 0, fichasGanadas: 0,
      reels: 0, tiempoReels: 0, comidas: 0, siestas: 0, jackpots: 0, caidas: 0, tiradas: 0,
    };
  }

  /** Efecto percibido (la tolerancia lo reduce). */
  E(s) { const d = this.drug[s]; return (d.nivel * this.profile[s]) / (1 + 1.5 * d.tol); }
  /** Abstinencia: tolerancia alta con nivel bajo. */
  W(s) { const d = this.drug[s]; return clamp(d.tol * 1.6 - d.nivel * 1.3); }
  dose(s, amount) { this.drug[s].nivel += amount; }
  /** Nivel respecto del umbral toxico (1 = empieza el daño). */
  toxicity(s) { const d = this.drug[s]; return d.nivel / (SUBSTANCES[s].toxic * (1 + 0.4 * d.tol)); }
  /** Señal interoceptiva de malestar (etanol, nicotina): crece al acercarse al umbral toxico. */
  malaise(s) { return s === 'cocaina' ? 0 : clamp((this.toxicity(s) - 0.5) / 0.5); }
  /** Saciedad de 0 a 1. Cocaina: dopamina respecto del punto de saciedad; con la sensibilidad
   *  dopaminergica reducida cuesta mas llegar (escalada). */
  satiety(s) { return s === 'cocaina' ? clamp(this.dopamina / DA_SATIETY) : clamp(this.E(s) / SATIETY[s]); }
  /** Grado de adiccion: valor aprendido alto y dopamina desensibilizada. */
  addiction(a) { return clamp((this.V[a] - 0.5) / 1.0) * 0.6 + clamp((1 - this.sens) / 0.55) * 0.4; }
  /** Peso de las señales aversivas: sensibilidad individual, debilitada por la adiccion
   *  (busqueda resistente a la aversion; Kaun et al., Nat Neurosci 2011). */
  aversionWeight(a) { return this.profile.aversion * (1 - 0.75 * this.addiction(a)); }

  /** Pico de dopamina; devuelve el placer efectivo (escalado por la sensibilidad). */
  reward(r) {
    const eff = r * this.sens;
    this.phasic = Math.min(1.5, this.phasic + eff);
    return eff;
  }

  get tonic() {
    return 0.18 + 0.25 * this.E('etanol') + 0.3 * this.E('nicotina') + 0.9 * this.E('cocaina') + 0.15 * this.amor;
  }
  get dopamina() { return clamp((this.tonic + this.phasic) * this.sens, 0, 2); }
  get abstinencia() { return Math.max(this.W('etanol'), this.W('nicotina'), this.W('cocaina')); }
  get felicidad() {
    return clamp(0.2 + this.dopamina * 0.75 - this.abstinencia * 0.6 - (1 - this.energia) * 0.35
      - this.rechazo * 0.35 - this.frustracion * 0.3 - (this.sueno > 0.8 ? 0.2 : 0));
  }
  get impulsividad() {
    return clamp(this.E('cocaina') * 0.6 + this.brainrot * 0.4 + this.E('etanol') * 0.35 + this.abstinencia * 0.3);
  }

  update(dt, ctx) {
    const st = this.stats;
    st.vivo += dt;
    for (const [s, p] of Object.entries(SUBSTANCES)) {
      const d = this.drug[s];
      d.nivel *= Math.pow(0.5, dt / p.halfLife);
      d.tol = clamp(d.tol + (d.nivel * p.tolGain - d.tol * p.tolDecay) * dt, 0, 1.5);
    }
    this.phasic *= Math.exp(-dt / 1.6);

    // Abuso cronico -> menos receptores -> todo da menos placer
    this.chronic += (Math.max(0, this.tonic - 0.35) - this.chronic) * dt / 60;
    const sensTarget = 1 - 0.55 * clamp(this.chronic * 1.6);
    this.sens += (sensTarget - this.sens) * dt / (sensTarget < this.sens ? 30 : 90);

    const eEth = this.E('etanol');
    this.energia = clamp(this.energia - (0.0018 + 0.0022 * (ctx.speedNorm || 0) + 0.0015 * this.E('cocaina')) * dt);
    if (ctx.sleeping) this.sueno = clamp(this.sueno - 0.05 * dt);
    else this.sueno = clamp(this.sueno + (0.0026 + 0.003 * eEth) * dt);

    this.rechazo = clamp(this.rechazo - dt / 150);
    this.amor = clamp(this.amor - dt / 100);
    this.lossChase = clamp(this.lossChase - dt / 80, 0, 2);
    this.frustracion = clamp(this.frustracion - dt / 40);
    this.susto = clamp(this.susto - dt / 6);
    if (!ctx.watchingReels) this.brainrot = clamp(this.brainrot - 0.0015 * dt);

    // Dano: toxicidad por nivel absoluto; la tolerancia protege un poco
    let dmg = 0;
    for (const [s, p] of Object.entries(SUBSTANCES)) {
      const d = this.drug[s];
      const over = d.nivel - p.toxic * (1 + 0.4 * d.tol);
      if (over > 0) {
        const k = s === 'cocaina' ? 0.03 : 0.02;
        const x = Math.min(over * k, 0.012) * dt; // atenuado: una sobredosis tarda en matar
        this.dmg[s] += x; dmg += x;
      }
    }
    if (this.energia < 0.04) { const x = 0.007 * dt; this.dmg.hambre += x; dmg += x; }
    if (this.sueno > 0.97) { const x = 0.006 * dt; this.dmg.sueno += x; dmg += x; }
    this.salud = clamp(this.salud - dmg);
    if (dmg === 0 && this.energia > 0.25 && this.abstinencia < 0.3) {
      this.salud = clamp(this.salud + (ctx.sleeping ? 0.01 : 0.002) * dt);
    }

    this._histT += dt;
    if (this._histT > 0.5) {
      this._histT = 0;
      const h = this.hist;
      h.da.push(this.dopamina); h.etanol.push(this.E('etanol')); h.nicotina.push(this.E('nicotina')); h.cocaina.push(this.E('cocaina'));
      for (const k in h) h[k].shift();
    }
  }

  get dead() { return this.salud <= 0; }

  deathCause() {
    let best = 'hambre', v = -1;
    for (const [k, x] of Object.entries(this.dmg)) if (x > v) { v = x; best = k; }
    return DEATH_CAUSES[best];
  }

  /** Utilidad de cada opcion disponible. cues: {actividad: distancia} para las senales cercanas. */
  utilities(available, cues = {}) {
    const V = this.V;
    const eEth = this.E('etanol'), eNic = this.E('nicotina'), eCoc = this.E('cocaina');
    const h = 1 - this.energia;
    const cue = a => (cues[a] !== undefined && cues[a] < 35 ? 0.15 * V[a] : 0);
    const bored = Math.max(0, 0.4 - this.dopamina);
    const curious = (a) => this.profile.novedad * (this.novelty[a] || 0) * (1 - h);
    // Umbral de saciedad: con la droga ya alta, baja la autoadministracion (Tsibulsky & Norman 1999)
    const sated = (s) => 1 - 0.85 * this.satiety(s);
    // Malestar y salud deteriorada frenan el acercamiento a etanol y nicotina, salvo que la adiccion los ignore
    const aversive = (a) => 1 - clamp(this.aversionWeight(a) * (1.2 * this.malaise(DRUG_OF[a]) + 0.8 * Math.max(0, 0.7 - this.salud)));
    const U = {};
    for (const a of available) {
      switch (a) {
        case 'comida':
          // inanicion: el hambre se impone a casi todo, salvo la supresion del apetito por estimulantes
          U[a] = (1.8 * h * h + 0.3 * h + 0.2 * V.comida + 8 * Math.max(0, h - 0.7)) * (1 - 0.75 * clamp(eCoc * 1.3) - 0.3 * clamp(eNic)); break;
        case 'cama':
          U[a] = (1.6 * this.sueno * this.sueno + 0.5 * Math.max(0, eEth - 0.4)) * (1 - 0.85 * clamp(eCoc * 1.3)) * (1 - 0.4 * clamp(eNic)); break;
        case 'bar':
          U[a] = (V.bar * (1 + 1.8 * this.W('etanol')) + 0.6 * this.rechazo - 0.3 * this.amor) * sated('etanol') * aversive(a) + cue(a) + curious(a); break;
        case 'cigarro':
          U[a] = (V.cigarro * (1 + 1.8 * this.W('nicotina')) + 0.15 * eEth) * sated('nicotina') * aversive(a) * (1 - 0.5 * clamp(this.aversionWeight(a))) + cue(a) + curious(a); break; // amarga: rechazo innato
        case 'coca':
          U[a] = (V.coca * (1 + 1.8 * this.W('cocaina')) + 0.2 * eEth) * sated('cocaina') + cue(a) + curious(a); break;
        case 'slots':
          U[a] = this.fichas > 0 ? V.slots * (1 + this.lossChase) + 0.15 * eEth + cue(a) + curious(a) : 0; break;
        case 'reels':
          U[a] = V.reels + 0.35 * this.brainrot + 0.4 * bored + 0.15 * this.abstinencia + cue(a) + curious(a); break;
        case 'pasear':
          U[a] = V.pasear + 0.3 * clamp(eCoc) + 0.2 * this.susto; break;
      }
    }
    return U;
  }

  choose(available, cues) {
    const U = this.utilities(available, cues);
    const tau = 0.1 + 0.2 * this.impulsividad;
    const keys = Object.keys(U);
    const max = Math.max(...keys.map(k => U[k]));
    const w = keys.map(k => Math.exp((U[k] - max) / tau));
    let r = Math.random() * w.reduce((a, b) => a + b, 0);
    for (let i = 0; i < keys.length; i++) { r -= w[i]; if (r <= 0) return keys[i]; }
    return keys[keys.length - 1];
  }

  /** Actualiza el valor aprendido (error de prediccion de recompensa). */
  learn(activity, R) {
    if (activity in this.novelty) this.novelty[activity] = 0;
    if (!(activity in this.V) || activity === 'cama') return;
    const target = clamp(R, 0, 1.6);
    this.lastRPE = target - this.V[activity]; // error de prediccion de recompensa
    this.V[activity] += this.profile.aprendizaje * this.lastRPE;
  }
}
