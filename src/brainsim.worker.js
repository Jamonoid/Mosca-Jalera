// Hilo aparte que corre la simulacion LIF del connectome completo en tiempo biologico.
// Recibe tasas de entrada sensoriales y farmacologia; devuelve tasas de salida y la traza visual.
// Usa la GPU (WebGPU, dt 0,1 ms, todas las neuronas en cada paso); si el navegador no la ofrece, la CPU (dt 1 ms).
import { LIF } from './lif.js';
import { LIFGPU } from './lif_gpu.js';

let sim = null, G = null, cells = [];
let inputs = {}, speed = 1, running = true;
let lastWall = 0, bioDebt = 0, lastPost = 0, bioSincePost = 0, busy = false;
const drive = {};  // nombre -> entrada de Poisson registrada en sim.drives
let loomUntil = 0;

const I = (a) => Int32Array.from(a);

self.onmessage = async (e) => {
  const m = e.data;
  if (m.type === 'init') {
    const [buf, groups] = await Promise.all([
      fetch(m.base + 'connectome.bin').then(r => r.arrayBuffer()),
      fetch(m.base + 'connectome_groups.json').then(r => r.json()),
    ]);
    G = groups;
    cells = Int32Array.from(m.cellIdx);
    try { sim = await LIFGPU.create(buf); }
    catch (err) { console.warn('connectome en CPU:', err.message); sim = new LIF(buf); }
    const backend = sim.gpu ? 'gpu' : 'cpu';
    const In = G.inputs;
    for (const [name, idx] of [['sugarL', In.sugar.L], ['sugarR', In.sugar.R], ['odorL', In.odor.L], ['odorR', In.odor.R],
      ['lightL', In.light.L], ['lightR', In.light.R],
      ['ftbL', In.motionFtb.L], ['ftbR', In.motionFtb.R], ['btfL', In.motionBtf.L], ['btfR', In.motionBtf.R],
      ['upL', In.motionUp.L], ['upR', In.motionUp.R],
      ['loomL', In.loom.L], ['loomR', In.loom.R]]) {
      drive[name] = { idx: I(idx), rate: 0 };
      sim.drives.push(drive[name]);
    }
    drive.pam = { idx: I(In.PAM), current: 0 };
    drive.dfb = { idx: I(In.dFB), current: 0 };
    sim.tonic.push(drive.pam, drive.dfb);
    G.I = {
      GF_L: I(G.outputs.GF.L), GF_R: I(G.outputs.GF.R), DNa01_L: I(G.outputs.DNa01.L), DNa01_R: I(G.outputs.DNa01.R),
      DNa02_L: I(G.outputs.DNa02.L), DNa02_R: I(G.outputs.DNa02.R), MDN: I(G.outputs.MDN), MN9: I(G.outputs.MN9),
      ...Object.fromEntries(Object.entries(G.pops).map(([k, v]) => [k, I(v)])),
      GRN_in: I([...In.sugar.L, ...In.sugar.R]), ORN_L: I(In.odor.L), ORN_R: I(In.odor.R),
      light_L: I(In.light.L), light_R: I(In.light.R), loom: I([...In.loom.L, ...In.loom.R]),
    };
    lastWall = performance.now(); lastPost = lastWall;
    self.postMessage({ type: 'ready', meta: { ...G.meta, nSoma: sim.nSoma, backend, dt: sim.p.dt } });
    setInterval(tick, 8);
    return;
  }
  if (m.type === 'inputs') {
    inputs = m.inputs;
    speed = m.speed;
    running = !m.paused;
    if (m.gains) sim?.setGains(m.gains);
    if (m.loom) loomUntil = (sim?.time ?? 0) + m.loom; // pulso de looming (ms de tiempo biologico)
  }
};

function applyInputs() {
  for (const k of ['sugarL', 'sugarR', 'odorL', 'odorR', 'lightL', 'lightR', 'ftbL', 'ftbR', 'btfL', 'btfR', 'upL', 'upR']) drive[k].rate = inputs[k] || 0;
  const loom = sim.time < loomUntil ? 200 : 0;
  drive.loomL.rate = loom + (inputs.loomL || 0);
  drive.loomR.rate = loom + (inputs.loomR || 0);
  drive.pam.current = inputs.pamCurrent || 0;
  drive.dfb.current = inputs.dfbCurrent || 0;
}

async function tick() {
  if (!sim || busy) return;
  busy = true;
  try { await advance(); }
  catch (err) { running = false; self.postMessage({ type: 'error', message: err.message }); }
  busy = false;
}

async function advance() {
  const now = performance.now();
  const wallMs = Math.min(100, now - lastWall);
  lastWall = now;
  if (running) bioDebt = Math.min(bioDebt + wallMs * speed, 200); // no acumular mas de 200 ms de atraso
  applyInputs();
  if (sim.gpu) {
    // envios cortos (<= 8 bloques, ~14 ms biologicos) para que el renderizado se intercale en la GPU;
    // los disparos se leen solo al publicar el estado
    while (bioDebt >= sim.blockMs) {
      const n = Math.min(8, Math.floor(bioDebt / sim.blockMs));
      sim.submit(n);
      bioDebt -= n * sim.blockMs; bioSincePost += n * sim.blockMs;
    }
  } else {
    const t0 = performance.now(), dt = sim.p.dt;
    while (bioDebt >= dt && performance.now() - t0 < 7) { sim.step(); bioDebt -= dt; bioSincePost += dt; }
  }
  const t = performance.now();
  if (t - lastPost >= 33 && bioSincePost > 0) {
    if (sim.gpu) await sim.readCounts();
    post(performance.now());
  }
}

function post(now) {
  const win = bioSincePost, r = (idx) => sim.rate(idx, win);
  const out = {};
  for (const k of Object.keys(G.I)) out[k] = r(G.I[k]);
  const cellRates = new Float32Array(cells.length);
  for (let j = 0; j < cells.length; j++) cellRates[j] = cells[j] >= 0 ? sim.count[cells[j]] * 1000 / win : 0;
  let firing = 0;
  for (let i = 0; i < sim.N; i++) if (sim.count[i]) firing++;
  sim.resetCounts();
  sim.decayTrace(Math.max(1, Math.round(win * 2.5)));
  const trace = sim.trace.slice(0, sim.nSoma);
  const wallWin = now - lastPost;
  self.postMessage({ type: 'state', rates: out, cellRates, trace, bioTime: sim.time, bioRatio: win / wallWin, firing },
    [trace.buffer, cellRates.buffer]);
  lastPost = now;
  bioSincePost = 0;
}
