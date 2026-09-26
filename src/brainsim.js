// Puente entre la app y la simulacion del connectome (que corre en un Web Worker).
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));

export class BrainSim {
  constructor(base, cellIdx) {
    this.ready = false;
    this.state = null;
    this.listeners = [];
    this.worker = new Worker(new URL('./brainsim.worker.js', import.meta.url), { type: 'module' });
    this.worker.onmessage = (e) => {
      const m = e.data;
      if (m.type === 'ready') { this.ready = true; this.meta = m.meta; }
      if (m.type === 'state') {
        // MN9 tiene pocas neuronas y dispara poco: su tasa se suaviza (tau 0,5 s biologico)
        const a = 1 - Math.exp(-(m.bioTime - (this.state?.bioTime ?? m.bioTime)) / 500);
        this.mn9 += a * (m.rates.MN9 - this.mn9);
        this.state = m;
        for (const fn of this.listeners) fn(m);
      }
      if (m.type === 'error') this.error = m.message;
    };
    this.worker.onerror = (e) => { this.error = e.message || 'error en el worker'; };
    this.worker.postMessage({ type: 'init', base, cellIdx });
    this.pendingLoom = 0;
    this.mn9 = 0;
  }

  onState(fn) { this.listeners.push(fn); }

  /** Estimulo de amenaza: pulso de looming (ms de tiempo biologico). */
  loom(ms = 200) { this.pendingLoom = ms; }

  /** Traduce el estado de la mosca a tasas de disparo de neuronas sensoriales reales y farmacologia. */
  send(sim, brain, world, app) {
    if (!this.ready) return;
    const s = sim.sensed, act = sim.state === 'act' ? sim.activity : null;
    const sleeping = act === 'cama' && !sim.insomnia;
    const k = sleeping ? 0.2 : 1; // durmiendo: respuesta sensorial atenuada
    const flow = clamp(sim.speed / 20), turn = clamp(sim.turnRate / 6, -1, 1);
    const reels = act === 'reels' ? world.reels.motion : 0;
    const eEth = brain.E('etanol'), eNic = brain.E('nicotina'), eCoc = brain.E('cocaina');
    const inputs = {
      sugarL: k * (act === 'comida' ? 80 : act === 'bar' ? 40 : 0),
      sugarR: k * (act === 'comida' ? 80 : act === 'bar' ? 40 : 0),
      odorL: k * 40 * clamp(s.olfL * 1.5), odorR: k * 40 * clamp(s.olfR * 1.5),
      lightL: k * (8 + 25 * clamp(s.visL)), lightR: k * (8 + 25 * clamp(s.visR)),
      // flujo optico por direccion: caminar = adelante->atras en ambos ojos (T4a/T5a); girar a la izquierda =
      // atras->adelante en el ojo izquierdo (T4b/T5b) y adelante->atras en el derecho; reels = scroll vertical (T4c/T5c)
      ftbL: k * (2 + 12 * flow + 8 * Math.max(0, -turn)), ftbR: k * (2 + 12 * flow + 8 * Math.max(0, turn)),
      btfL: k * 8 * Math.max(0, turn), btfR: k * 8 * Math.max(0, -turn),
      upL: k * 15 * reels, upR: k * 15 * reels,
      pamCurrent: 9 * clamp(eCoc * 1.2),     // cocaina: DA sostenida -> dopaminergicas PAM activas
      dfbCurrent: sleeping ? 9 : 0,           // sueño: neuronas dFB (FB6) que lo promueven
    };
    const gains = {
      ach: (1 + 0.6 * clamp(eNic)) * (1 - 0.2 * clamp(eEth)), // nicotina: agonista nicotinico; etanol: menos excitacion
      gaba: 1 + 1.0 * clamp(eEth),                             // etanol potencia GABA
      glu: 1,
    };
    const key = JSON.stringify(gains);
    const msg = { type: 'inputs', inputs, speed: app.speed, paused: app.paused || sim.dead };
    if (key !== this.lastGains) { msg.gains = gains; this.lastGains = key; }
    if (this.pendingLoom) { msg.loom = this.pendingLoom; this.pendingLoom = 0; }
    this.worker.postMessage(msg);
  }

  /** Salidas motoras reales (tasas en Hz de la ultima ventana). */
  get out() { return this.state?.rates ?? null; }
}
