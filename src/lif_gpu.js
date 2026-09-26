// Simulacion LIF del connectome completo (MaleCNS v1.0) en la GPU (WebGPU).
// Mismo modelo que lif.js pero sin aproximaciones de rendimiento: dt de 0,1 ms como Shiu et al. (Nature 2024),
// todas las neuronas se integran en cada paso (sin poda de inactivas) y las entradas sensoriales son
// procesos de Poisson independientes por neurona.
// Como el retardo sinaptico (1,8 ms = 18 pasos) es menor que el periodo refractario (2,2 ms), cada neurona
// dispara a lo sumo una vez por bloque de 18 pasos y ningun disparo llega dentro del mismo bloque: se integran
// 18 pasos por neurona de una vez y luego se reparten los disparos del bloque a su destino, 18 pasos despues.
import { PARAMS as CPU_PARAMS } from './lif.js';

// wSyn: 0,275 mV de Shiu escalado por la densidad sinaptica del MaleCNS (~1,73 veces la de FlyWire, sobre el
// que se calibro el modelo) -> 0,16 mV, y +12 % para compensar la depresion de corto plazo -> 0,18 mV.
export const PARAMS = { ...CPU_PARAMS, dt: 0.1, wSyn: 0.18 };

const PROP_WG = 1024; // grupos fijos que se reparten los disparos del bloque (sin despacho indirecto)
const SCALE = 65536; // punto fijo para sumar entradas con atomicos (WebGPU no tiene atomicos de float)

const COMMON = /* wgsl */`
struct Params { N: u32, B: u32, refSteps: u32, pad0: u32,
  dm: f32, ds: f32, da: f32, vTh: f32, aInc: f32, U: f32, rtau: f32, pscale: f32, wScale: f32, invScale: f32 };
struct Neuron { u: f32, g: f32, ad: f32, res: f32, last: i32, refr: u32, rng: u32, pad: u32 };
struct Spike { id: u32, rel: f32 };
@group(0) @binding(0) var<uniform> P: Params;
`;

const NEURONS = COMMON + /* wgsl */`
@group(0) @binding(1) var<storage, read_write> inbox: array<i32>;
@group(0) @binding(2) var<storage, read_write> neu: array<Neuron>;
@group(0) @binding(3) var<storage, read> inp: array<vec2<f32>>;   // (tasa de Poisson en Hz, corriente tonica en mV)
@group(0) @binding(4) var<storage, read_write> spikes: array<Spike>;
@group(0) @binding(5) var<storage, read_write> ctrl: array<atomic<u32>>; // 0 disparos del bloque, 1 copia, 2 bloque
@group(0) @binding(6) var<storage, read_write> cnt: array<u32>;

fn rand(s: ptr<function, u32>) -> f32 {
  let st = *s * 747796405u + 2891336453u;
  *s = st;
  var w = ((st >> ((st >> 28u) + 4u)) ^ st) * 277803737u;
  w = (w >> 22u) ^ w;
  return f32(w >> 8u) * (1.0 / 16777216.0);
}

fn fire(n: ptr<function, Neuron>, i: u32, j: u32, step: i32) {
  (*n).u = 0.0;
  (*n).ad += P.aInc;
  (*n).refr = P.refSteps;
  // depresion de corto plazo (Tsodyks-Markram): recuperar recursos desde el ultimo disparo y consumir U
  let r = 1.0 - (1.0 - (*n).res) * exp(-f32(step - (*n).last) * P.rtau);
  (*n).res = r * (1.0 - P.U);
  (*n).last = step;
  let s = atomicAdd(&ctrl[0], 1u);
  spikes[s] = Spike(i | (j << 18u), r);
}

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  if (i >= P.N) { return; }
  var n = neu[i];
  let x = inp[i];
  let pSpk = x.x * P.pscale;
  let step0 = i32(atomicLoad(&ctrl[2]) * P.B);
  var c = 0u;
  for (var j = 0u; j < P.B; j++) {
    let k = j * P.N + i;
    let a = inbox[k];
    if (a != 0) { n.g += f32(a) * P.invScale; inbox[k] = 0; }
    if (pSpk > 0.0 && n.refr == 0u && rand(&n.rng) < pSpk) { fire(&n, i, j, step0 + i32(j)); c++; }
    if (x.y > 0.0) { n.g = max(n.g, x.y); }
    if (n.refr > 0u) { n.refr -= 1u; n.g *= P.ds; n.ad *= P.da; continue; }
    n.u += P.dm * (n.g - n.ad - n.u);
    n.g *= P.ds;
    n.ad *= P.da;
    if (n.u >= P.vTh) { fire(&n, i, j, step0 + i32(j)); c++; }
  }
  neu[i] = n;
  if (c > 0u) { cnt[i] += c; }
}
`;

const ARGS = /* wgsl */`
@group(0) @binding(0) var<storage, read_write> ctrl: array<atomic<u32>>;
@compute @workgroup_size(1)
fn main() {
  atomicStore(&ctrl[1], atomicExchange(&ctrl[0], 0u));
  atomicAdd(&ctrl[2], 1u);
}
`;

const PROPAGATE = COMMON + /* wgsl */`
@group(0) @binding(1) var<storage, read_write> inbox: array<atomic<i32>>;
@group(0) @binding(2) var<storage, read> indptr: array<u32>;
@group(0) @binding(3) var<storage, read> indices: array<u32>;
@group(0) @binding(4) var<storage, read> w: array<i32>;
@group(0) @binding(5) var<storage, read> gain: array<f32>;
@group(0) @binding(6) var<storage, read> spikes: array<Spike>;
@group(0) @binding(7) var<storage, read> ctrl: array<u32>;
@compute @workgroup_size(64)
fn main(@builtin(workgroup_id) wg: vec3<u32>, @builtin(local_invocation_id) lid: vec3<u32>, @builtin(num_workgroups) nwg: vec3<u32>) {
  let count = ctrl[1];
  for (var s = wg.x; s < count; s += nwg.x) {
    let sp = spikes[s];
    let pre = sp.id & 0x3FFFFu;
    let base = (sp.id >> 18u) * P.N;   // el disparo del paso j llega en el paso j del bloque siguiente
    let gg = P.wScale * gain[pre] * sp.rel;
    let k1 = indptr[pre + 1u];
    for (var k = indptr[pre] + lid.x; k < k1; k += 64u) {
      atomicAdd(&inbox[base + indices[k]], i32(round(gg * f32(w[k]))));
    }
  }
}
`;

export class LIFGPU {
  static async create(buf, params = {}) {
    if (!self.navigator?.gpu) throw new Error('WebGPU no disponible');
    const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
    if (!adapter) throw new Error('sin adaptador WebGPU');
    const L = adapter.limits;
    const device = await adapter.requestDevice({
      requiredLimits: { maxStorageBufferBindingSize: L.maxStorageBufferBindingSize, maxBufferSize: L.maxBufferSize },
    });
    return new LIFGPU(device, buf, params, adapter.info);
  }

  constructor(device, buf, params, info) {
    this.device = device;
    this.gpu = true;
    this.adapterInfo = info;
    const p = (this.p = { ...PARAMS, ...params });
    const h = new Uint32Array(buf, 0, 3);
    const N = (this.N = h[0]), E = (this.E = h[1]);
    this.nSoma = h[2];
    let o = 12;
    const indptr = new Uint32Array(buf, o, N + 1); o += (N + 1) * 4;
    const indices = new Uint32Array(buf, o, E); o += E * 4;
    const w16 = new Int16Array(buf, o, E); o += E * 2;
    this.nt = new Uint8Array(buf, o, N).slice();

    this.B = Math.max(1, Math.round(p.delay / p.dt));   // pasos por bloque = retardo
    this.refSteps = Math.round(p.tRef / p.dt);
    if (this.refSteps < this.B) throw new Error('el refractario debe ser >= retardo');
    if (N >= 1 << 18) throw new Error('demasiadas neuronas para el empaquetado de disparos');
    this.blockMs = this.B * p.dt;

    const S = GPUBufferUsage.STORAGE, D = GPUBufferUsage.COPY_DST, C = GPUBufferUsage.COPY_SRC;
    const mk = (data, usage = S) => {
      const b = device.createBuffer({ size: Math.max(16, Math.ceil(data.byteLength / 4) * 4), usage: usage | D, mappedAtCreation: true });
      new Uint8Array(b.getMappedRange()).set(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
      b.unmap();
      return b;
    };
    const empty = (size, usage = S) => device.createBuffer({ size, usage: usage | D });

    // estado inicial: reposo, recursos completos, sin disparos previos
    const neu = new ArrayBuffer(N * 32), nf = new Float32Array(neu), ni = new Int32Array(neu), nu = new Uint32Array(neu);
    for (let i = 0; i < N; i++) {
      nf[i * 8 + 3] = 1;                 // res
      ni[i * 8 + 4] = -(1 << 30);        // last
      nu[i * 8 + 6] = (Math.random() * 4294967296) >>> 0 || 1; // rng
    }
    const params32 = new ArrayBuffer(64), pu = new Uint32Array(params32), pf = new Float32Array(params32);
    pu[0] = N; pu[1] = this.B; pu[2] = this.refSteps;
    pf.set([p.dt / p.tauM, Math.exp(-p.dt / p.tauS), Math.exp(-p.dt / p.tauA), p.vTh, p.aInc, p.U, p.dt / p.tauRec,
      p.dt * 1e-3, p.wSyn * SCALE, 1 / SCALE], 4);

    this.bufs = {
      params: mk(new Uint8Array(params32), GPUBufferUsage.UNIFORM),
      inbox: empty(this.B * N * 4),
      neu: mk(new Uint8Array(neu)),
      inp: empty(N * 8),
      spikes: empty(N * 8),
      ctrl: empty(16),
      cnt: empty(N * 4, S | C),
      indptr: mk(indptr),
      indices: mk(indices),
      w: mk(Int32Array.from(w16)),
      gain: mk(new Float32Array(N).fill(1)),
    };
    this.staging = device.createBuffer({ size: N * 4, usage: GPUBufferUsage.MAP_READ | D });

    const pipe = (code) => device.createComputePipeline({ layout: 'auto', compute: { module: device.createShaderModule({ code }), entryPoint: 'main' } });
    const bg = (pl, list) => device.createBindGroup({ layout: pl.getBindGroupLayout(0), entries: list.map((b, i) => ({ binding: i, resource: { buffer: this.bufs[b] } })) });
    this.pNeu = pipe(NEURONS); this.gNeu = bg(this.pNeu, ['params', 'inbox', 'neu', 'inp', 'spikes', 'ctrl', 'cnt']);
    this.pArgs = pipe(ARGS); this.gArgs = bg(this.pArgs, ['ctrl']);
    this.pProp = pipe(PROPAGATE); this.gProp = bg(this.pProp, ['params', 'inbox', 'indptr', 'indices', 'w', 'gain', 'spikes', 'ctrl']);
    this.nWg = Math.ceil(N / 256);

    this.inp = new Float32Array(N * 2);
    this.inpKey = '';
    this.drives = [];                      // [{ idx: Int32Array, rate (Hz) }] entradas de Poisson
    this.tonic = [];                       // [{ idx, current (mV) }] corriente tonica
    this.trace = new Uint8Array(N);
    this.count = new Uint32Array(N);
    this.time = 0;
    this.spikesTotal = 0;
    this.nActive = N;                      // se integran todas
  }

  /** Farmacologia: ganancia de las sinapsis segun el transmisor de la neurona presinaptica. */
  setGains({ ach = 1, gaba = 1, glu = 1 } = {}) {
    const g = new Float32Array(this.N), nt = this.nt;
    for (let i = 0; i < this.N; i++) g[i] = nt[i] === 0 ? ach : nt[i] === 2 ? gaba : nt[i] === 1 ? glu : 1;
    this.device.queue.writeBuffer(this.bufs.gain, 0, g);
  }

  syncInputs() {
    let key = '';
    for (const d of this.drives) key += d.rate + ',';
    for (const t of this.tonic) key += t.current + ';';
    if (key === this.inpKey) return;
    this.inpKey = key;
    const x = this.inp.fill(0);
    for (const d of this.drives) if (d.rate > 0) for (let j = 0; j < d.idx.length; j++) x[d.idx[j] * 2] += d.rate;
    for (const t of this.tonic) if (t.current > 0) for (let j = 0; j < t.idx.length; j++) { const k = t.idx[j] * 2 + 1; x[k] = Math.max(x[k], t.current); }
    this.device.queue.writeBuffer(this.bufs.inp, 0, x);
  }

  /** Encola n bloques (n * blockMs de tiempo biologico) sin esperar a la GPU. */
  submit(n) {
    this.syncInputs();
    const enc = this.device.createCommandEncoder();
    const pass = enc.beginComputePass();
    for (let k = 0; k < n; k++) {
      pass.setPipeline(this.pNeu); pass.setBindGroup(0, this.gNeu); pass.dispatchWorkgroups(this.nWg);
      pass.setPipeline(this.pArgs); pass.setBindGroup(0, this.gArgs); pass.dispatchWorkgroups(1);
      pass.setPipeline(this.pProp); pass.setBindGroup(0, this.gProp); pass.dispatchWorkgroups(PROP_WG);
    }
    pass.end();
    this.device.queue.submit([enc.finish()]);
    this.time += n * this.blockMs;
  }

  /** Espera la GPU y acumula en count/trace los disparos desde la ultima lectura. */
  async readCounts() {
    const dev = this.device, enc = dev.createCommandEncoder();
    enc.copyBufferToBuffer(this.bufs.cnt, 0, this.staging, 0, this.N * 4);
    enc.clearBuffer(this.bufs.cnt);
    dev.queue.submit([enc.finish()]);
    await this.staging.mapAsync(GPUMapMode.READ);
    const c = new Uint32Array(this.staging.getMappedRange());
    const count = this.count, trace = this.trace;
    let tot = 0;
    for (let i = 0; i < c.length; i++) { const v = c[i]; if (v) { count[i] += v; trace[i] = 255; tot += v; } }
    this.staging.unmap();
    this.spikesTotal += tot;
  }

  async runBlocks(n) { this.submit(n); await this.readCounts(); }

  /** Avanza al menos ms de tiempo biologico (en bloques enteros). */
  async run(ms) {
    let blocks = Math.ceil(ms / this.blockMs);
    while (blocks > 0) { const k = Math.min(blocks, 200); await this.runBlocks(k); blocks -= k; }
  }

  rate(idx, windowMs) {
    let c = 0;
    for (let j = 0; j < idx.length; j++) c += this.count[idx[j]];
    return idx.length ? (c / idx.length) * (1000 / windowMs) : 0;
  }

  resetCounts() { this.count.fill(0); }

  decayTrace(k = 24) { const t = this.trace; for (let i = 0; i < t.length; i++) if (t[i]) t[i] = t[i] > k ? t[i] - k : 0; }
}
