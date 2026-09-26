// Controlador de la mosca: lazo sensoriomotor cerrado.
// No hay destinos fijos: cada estacion emite una señal (olor o luz) que la mosca capta con
// sensores bilaterales. El cerebro pondera cada señal segun su motivacion y la diferencia
// izquierda-derecha se convierte en giro (DNa01/DNa02). Encima hay ruido motor, sacadas,
// busqueda en zigzag al perder la pluma, pausas, vuelos cortos y seguimiento del borde.
import * as THREE from 'three';
import { SUBSTANCES, VICES, DRUG_OF } from './brain.js';

const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const rand = (a, b) => a + Math.random() * (b - a);
const randn = () => Math.sqrt(-2 * Math.log(1 - Math.random())) * Math.cos(2 * Math.PI * Math.random());
const angDiff = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));
const f2 = (x) => x.toFixed(2);
const TABLE_R = 104;

export const ACT = {
  bar: { verbo: 'Consumiendo etanol' },
  cigarro: { verbo: 'Fumando' },
  coca: { verbo: 'Aspirando cocaína' },
  slots: { verbo: 'Apostando' },
  reels: { verbo: 'Viendo reels' },
  comida: { verbo: 'Alimentándose' },
  cama: { verbo: 'Durmiendo' },
};

// Señal que emite cada estacion. olf: pluma de olor turbulenta; vis: luz (alcance largo).
export const CUES = {
  bar: { kind: 'olf', sigma: 34, label: 'olor a fermento' },
  comida: { kind: 'olf', sigma: 34, label: 'olor a fruta' },
  cigarro: { kind: 'olf', sigma: 30, label: 'humo' },
  coca: { kind: 'vis', sigma: 30, label: 'brillo del espejo' },
  slots: { kind: 'vis', sigma: 60, label: 'luces' },
  reels: { kind: 'vis', sigma: 60, label: 'pantalla' },
  cama: { kind: 'vis', sigma: 40, label: 'penumbra' },
};

// Categorias del etograma (presupuesto de tiempo)
export const ETHO = [
  ['comida', 'Alimentación', '#ffe45c'], ['cama', 'Sueño', '#8fa8ff'], ['bar', 'Etanol', '#ffb040'],
  ['cigarro', 'Nicotina', '#ff6a2a'], ['coca', 'Cocaína', '#bfe4ff'], ['slots', 'Apuestas', '#ff3df0'],
  ['reels', 'Reels', '#3df0ff'], ['acicalar', 'Pausa / acicalamiento', '#9a95b5'],
  ['desplazamiento', 'Marcha / vuelo', '#56536a'], ['incapacitada', 'Incapacitada', '#ff5a7a'],
];

const ANTENNA = 2.2;     // separacion lateral de los sensores (exagerada respecto a la escala real)
const STEER_GAIN = 4.5;  // rad/s de giro maximo por señal
const CONTRAST0 = 0.03;  // contraste bilateral que satura la respuesta (adaptacion de ganancia)

export class FlySim {
  constructor({ fly, brain, world, sfx }) {
    Object.assign(this, { fly, brain, world, sfx });
    this.enabled = {};
    for (const id of world.stations.keys()) this.enabled[id] = true;
    this.potency = { etanol: 1, nicotina: 1, cocaina: 1 };
    this.listeners = [];
    this.subject = 0;
    this.phase = {};
    for (const id of world.stations.keys()) this.phase[id] = Math.random() * 10;
    world.reels.onReelEnd = () => this.onReelEnd();
    world.reels.onPayoff = (m) => this.onReelPayoff(m);
    this.reset();
  }

  reset() {
    this.brain.reset();
    this.brain.stats.time = Object.fromEntries(ETHO.map(([k]) => [k, 0]));
    this.subject++;
    this.records = [];
    this._recT = 0;
    this.state = 'free';
    this.activity = null;
    this.rehab = 0;
    this.pos = new THREE.Vector3(rand(-10, 10), 0, rand(-10, 10));
    this.heading = rand(0, Math.PI * 2);
    this.speed = 0;
    this.turnRate = 0;
    this.noiseW = 0;       // ruido angular (Ornstein-Uhlenbeck)
    this.sacc = 0;         // angulo pendiente de una sacada
    this.walking = true;
    this.boutT = rand(2, 5);
    this.grooming = false;
    this.casting = 0;
    this.whirl = 0;
    this.celebrate = 0;
    this.jump = null;
    this.insomnia = false;
    this.refractory = {};
    this.goal = null;
    this.goalC = 0;
    this.dGoal = 0;
    this.motivation = 0;
    this.weights = {};
    this.sensed = { olfL: 0, olfR: 0, visL: 0, visR: 0, ch: {} };
    this.y = 0;
    this.fly.fall = 0;
    this.world.setFocus(null);
    this.world.reels.watching = false;
    this.fly.root.position.copy(this.pos);
    this.fly.heading = this.heading;
    this.deathMsg = null;
    this.freeSpins = 5; // tiradas de bienvenida: gratis y siempre con premio
    this.emit(`Sujeto #${this.subject} · inicio del registro · 30 fichas`, 'good');
  }

  on(fn) { this.listeners.push(fn); }
  emit(text, kind = 'info') { for (const fn of this.listeners) fn({ text, kind, t: this.brain.stats.vivo }); }

  get dead() { return this.state === 'dead'; }
  get label() {
    if (this.state === 'dead') return { text: 'Muerta' };
    if (this.state === 'fallen') return { text: 'Pérdida de control postural' };
    if (this.state === 'seizure') return { text: 'Convulsiones' };
    if (this.state === 'jump') return { text: this.jump?.escape ? 'Escape (Giant Fiber)' : 'Vuelo corto' };
    if (this.state === 'act' || this.state === 'align') return { text: ACT[this.activity].verbo };
    if (!this.walking) return { text: this.grooming ? 'Acicalamiento' : 'Pausa' };
    if (this.goal && this.motivation > 0.25 && this.goalC > 0.05) {
      return { text: `Siguiendo ${CUES[this.goal].label}${this.casting > 0.5 ? ' (zigzag)' : ''}` };
    }
    return { text: 'Exploración' };
  }

  /** Señal emoji del estado interno (se muestra sobre la mosca). */
  mood() {
    const b = this.brain;
    if (this.state === 'dead') return '💀';
    if (this.state === 'seizure') return '⚡';
    if (this.state === 'fallen') return '😵';
    if (this.state === 'jump') return '🪽';
    if (this.state === 'act' && this.activity === 'cama' && !this.insomnia) return '💤';
    if (this.celebrate > 0) return '💰';
    if (b.phasic > 0.45) return '✨';
    if (b.abstinencia > 0.5) return '😣';
    if (b.E('cocaina') > 0.5) return '😳';
    if (b.E('etanol') > 0.45) return '🥴';
    if (this.state === 'act' && this.activity === 'reels' && b.brainrot > 0.5) return '🫠';
    if (b.energia < 0.2) return '🍽️';
    if (b.sueno > 0.8) return '🥱';
    if (b.rechazo > 0.4 || b.frustracion > 0.5) return '😞';
    if (b.amor > 0.3) return '💕';
    const v = b.felicidad;
    return v > 0.6 ? '😊' : v > 0.35 ? '🙂' : '😐';
  }

  available() {
    const list = [];
    for (const [id, on] of Object.entries(this.enabled)) {
      if (!on) continue;
      if (this.rehab > 0 && VICES.includes(id)) continue;
      if (id === 'coca' && this.world.coke.amount <= 0) continue;
      list.push(id);
    }
    return list;
  }

  cues() {
    const c = {};
    for (const [id, st] of this.world.stations) c[id] = st.approach.distanceTo(this.pos);
    return c;
  }

  setEnabled(id, on) {
    this.enabled[id] = on;
    this.world.setEnabled(id, on);
    if (!on && this.activity === id && this.state !== 'dead') this.endActivity(false);
    this.emit(`Estación ${this.world.stations.get(id).nombre.toLowerCase()} ${on ? 'disponible' : 'retirada'}`, 'info');
  }

  // ------------------------------------------------------------ intervenciones
  rechazo() {
    const b = this.brain;
    b.rechazo = 1; b.amor = 0; b.frustracion = clamp(b.frustracion + 0.5);
    this.emit('Rechazo sexual · NPF ↓ · preferencia por etanol ↑ (Shohat-Ophir et al., Science 2012)', 'bad');
  }
  cita() {
    const b = this.brain;
    b.amor = 1; b.rechazo = 0; b.reward(0.8);
    b.V.bar *= 0.7;
    this.celebrate = 1.5;
    this.emit('Apareamiento · NPF ↑ · preferencia por etanol ↓ (Shohat-Ophir et al., Science 2012)', 'good');
  }
  darFichas(n) {
    this.brain.fichas += n;
    this.emit(`+${n} fichas`, 'good');
  }
  susto() {
    if (this.state === 'dead') return;
    if (this.brainSim?.ready) {
      this.brainSim.loom(200);
      this.emit('Estímulo de amenaza · looming sobre LPLC2 y LC4 (neuronas reales)', 'info');
      return;
    }
    this.brain.susto = 1;
    const wasFallen = this.state === 'fallen';
    if (this.activity) this.endActivity(false);
    this.takeoff(rand(0, Math.PI * 2), rand(16, 26), true);
    this.sfx.play('zap');
    this.emit(`Estímulo de amenaza · LPLC2 → Giant Fiber (DNp01) → despegue${wasFallen ? ' · recupera la postura' : ''}`, 'info');
  }
  startRehab() {
    this.rehab = 90;
    if (this.activity && VICES.includes(this.activity)) this.endActivity();
    this.emit('Abstinencia forzada · 90 s sin acceso a vicios', 'good');
  }

  takeoff(dir, dist, escape = false) {
    const from = this.pos.clone();
    const to = from.clone().add(new THREE.Vector3(Math.cos(dir) * dist, 0, -Math.sin(dir) * dist));
    if (to.length() > TABLE_R - 6) to.setLength(TABLE_R - 6);
    this.state = 'jump';
    this.jump = { from, to, t: 0, dur: 0.35 + dist / 60, escape, h: 0 };
    this.heading = Math.atan2(-(to.z - from.z), to.x - from.x);
    this.walking = true;
  }

  // ------------------------------------------------------------ bucle
  update(dt) {
    const b = this.brain;
    if (this.state === 'dead') { this.speed = 0; return; }
    const sleeping = this.state === 'act' && this.activity === 'cama' && !this.insomnia;
    b.update(dt, { speedNorm: this.speed / 30, sleeping, watchingReels: this.state === 'act' && this.activity === 'reels' });
    b.stats.time[this.ethoKey()] += dt;
    this.record(dt);
    if (this.rehab > 0) {
      this.rehab -= dt;
      if (this.rehab <= 0) this.emit('Fin de la abstinencia forzada', 'info');
    }
    for (const k in this.refractory) this.refractory[k] = Math.max(0, this.refractory[k] - dt);
    this.celebrate = Math.max(0, this.celebrate - dt);
    if (b.dead) return this.die();

    const eEth = b.E('etanol');
    const coc = b.drug.cocaina;
    if (!['fallen', 'jump', 'seizure'].includes(this.state)) {
      if (eEth > 0.85) {
        if (this.activity) this.endActivity(false);
        this.state = 'fallen';
        b.stats.caidas++;
        this.emit(`Pérdida de control postural · etanol ${f2(eEth)} (cf. inebriómetro, Moore et al., Cell 1998)`, 'bad');
      } else if (coc.nivel > 1.3 * SUBSTANCES.cocaina.toxic * (1 + 0.4 * coc.tol) && Math.random() < dt * 0.12) {
        if (this.activity) this.endActivity(false);
        this.state = 'seizure';
        this.seizureT = 5;
        this.emit(`Convulsiones · cocaína ${f2(coc.nivel)} sobre el umbral tóxico`, 'bad');
      }
    }

    this._senseDt = dt;
    this.sense();
    this.readConnectome(dt);
    switch (this.state) {
      case 'free': this.updateFree(dt); break;
      case 'align': this.updateAlign(dt); break;
      case 'act': this.updateAct(dt); break;
      case 'fallen':
        this.speed = 0; this.turnRate = 0;
        if (eEth < 0.55) { this.state = 'free'; this.walking = false; this.boutT = 1.5; this.emit(`Recupera la postura · etanol ${f2(eEth)}`, 'info'); }
        break;
      case 'seizure':
        this.speed = 0; this.turnRate = 0;
        this.seizureT -= dt;
        if (this.seizureT <= 0) { this.state = 'free'; this.walking = false; this.boutT = 2; }
        break;
      case 'jump': this.updateJump(dt); break;
    }

    const g = this.world.groundAt(this.pos.x, this.pos.z);
    this.y += (g - this.y) * Math.min(1, dt * 12);
    this.fly.root.position.set(this.pos.x, this.y + (this.jump ? this.jump.h : 0), this.pos.z);
    this.fly.heading = this.heading;
  }

  /** Salidas del connectome: Giant Fiber (escape), MDN (retroceso). El giro y la probóscide se leen donde se usan. */
  readConnectome(dt) {
    const o = this.brainSim?.out;
    this.gfCool = Math.max(0, (this.gfCool || 0) - dt);
    if (!o) return;
    if ((o.GF_L > 60 || o.GF_R > 60) && this.gfCool <= 0 && ['free', 'act', 'align', 'fallen'].includes(this.state)) {
      this.gfCool = 2;
      this.brain.susto = 1;
      const wasFallen = this.state === 'fallen';
      if (this.activity) this.endActivity(false);
      // despega alejandose del lado con mas actividad de la Giant Fiber
      const away = this.heading + (o.GF_L > o.GF_R ? -1 : 1) * rand(0.6, 1.4) + Math.PI;
      this.takeoff(away, rand(16, 26), true);
      this.sfx.play('zap');
      this.emit(`Giant Fiber (DNp01) dispara ${Math.round(Math.max(o.GF_L, o.GF_R))} Hz → despegue de escape${wasFallen ? ' · recupera la postura' : ''}`, 'info');
    }
    this.mdnBack = o.MDN > 40 ? Math.min(1, (o.MDN - 40) / 60) : 0;
  }

  ethoKey() {
    switch (this.state) {
      case 'fallen': case 'seizure': return 'incapacitada';
      case 'jump': case 'align': return 'desplazamiento';
      case 'act': return this.activity;
      case 'free': return this.walking ? 'desplazamiento' : 'acicalar';
      default: return 'acicalar';
    }
  }

  record(dt) {
    this._recT += dt;
    if (this._recT < 1) return;
    this._recT -= 1;
    const b = this.brain, s = this.sensed;
    if (this.records.length > 36000) this.records.shift();
    this.records.push({
      t: +b.stats.vivo.toFixed(1), estado: this.state, actividad: this.activity || '', objetivo: this.goal || '',
      x: this.pos.x, z: this.pos.z, velocidad: this.speed, giro: this.turnRate,
      olor_izq: s.olfL, olor_der: s.olfR, luz_izq: s.visL, luz_der: s.visR, motivacion: this.motivation,
      salud: b.salud, energia: b.energia, sueno: b.sueno, valencia: b.felicidad, dopamina: b.dopamina, da_fasica: b.phasic,
      sensibilidad_da: b.sens, etanol: b.E('etanol'), tol_etanol: b.drug.etanol.tol, nicotina: b.E('nicotina'),
      tol_nicotina: b.drug.nicotina.tol, cocaina: b.E('cocaina'), tol_cocaina: b.drug.cocaina.tol,
      abstinencia: b.abstinencia, brainrot: b.brainrot, fichas: b.fichas,
      V_bar: b.V.bar, V_cigarro: b.V.cigarro, V_coca: b.V.coca, V_slots: b.V.slots, V_reels: b.V.reels, V_comida: b.V.comida,
      sens_etanol: b.profile.etanol, sens_nicotina: b.profile.nicotina, sens_cocaina: b.profile.cocaina,
      riesgo_toxico: Math.max(b.toxicity('etanol'), b.toxicity('nicotina'), b.toxicity('cocaina')), aversion: b.profile.aversion,
      tasa_aprendizaje: b.profile.aprendizaje, novedad: b.profile.novedad, actividad: b.profile.actividad, lateralidad: b.profile.lateralidad,
    });
  }

  // ------------------------------------------------------------ sentidos
  /** Muestrea cada señal con dos sensores laterales (antenas / ojos). */
  sense() {
    const t = this.brain.stats.vivo, h = this.heading;
    const fx = Math.cos(h), fz = -Math.sin(h), lx = -Math.sin(h), lz = -Math.cos(h);
    const hx = this.pos.x + fx * 1.5, hz = this.pos.z + fz * 1.5;
    const L = [hx + lx * ANTENNA, hz + lz * ANTENNA], R = [hx - lx * ANTENNA, hz - lz * ANTENNA];
    const s = this.sensed;
    s.olfL = s.olfR = s.visL = s.visR = 0;
    for (const [id, st] of this.world.stations) {
      if (!this.enabled[id]) { s.ch[id] = { L: 0, R: 0, C: 0, contrast: 0 }; continue; }
      const cue = CUES[id], src = st.approach;
      const conc = ([x, z]) => {
        const d = Math.hypot(x - src.x, z - src.z);
        let c = 1 / (1 + (d / cue.sigma) ** 2);
        if (id === 'coca' && this.world.coke.amount <= 0) c *= 0.15;
        return c * (1 + 0.03 * randn());
      };
      // Intermitencia: la pluma llega a rachas, igual a ambas antenas (no altera el contraste)
      let gate = 1;
      if (cue.kind === 'olf') {
        const p = this.phase[id];
        gate = clamp(0.25 + 0.9 * (0.5 + 0.5 * Math.sin(t * 2.3 + p) * Math.sin(t * 0.7 + 2 * p)));
      } else if (id === 'slots') gate = 0.8 + 0.2 * Math.sin(t * 9);
      const cl = Math.max(0, conc(L)) * gate, cr = Math.max(0, conc(R)) * gate;
      const prev = s.ch[id];
      const raw = (cl - cr) / (cl + cr + 0.005);
      const k = Math.min(1, (this._senseDt || 0.05) / 0.25);
      const contrast = prev ? prev.contrast + (raw - prev.contrast) * k : raw;
      s.ch[id] = { L: cl, R: cr, C: (cl + cr) / 2, contrast };
      if (cue.kind === 'olf') { s.olfL += cl; s.olfR += cr; } else { s.visL += cl; s.visR += cr; }
    }
  }

  /** Motivacion hacia cada señal: utilidades del cerebro afiladas con softmax. */
  motivate() {
    const b = this.brain;
    const avail = this.available().filter(id => !(this.refractory[id] > 0));
    if (!avail.length) { this.weights = {}; this.motivation = 0; return null; }
    const U = b.utilities(avail, this.cues());
    const keys = Object.keys(U);
    const umax = Math.max(...keys.map(k => U[k]));
    const tau = 0.07 + 0.2 * b.impulsividad;
    let sum = 0;
    const w = {};
    for (const k of keys) { w[k] = Math.exp((U[k] - umax) / tau); sum += w[k]; }
    for (const k of keys) w[k] /= sum;
    this.weights = w;
    this.U = U;
    this.motivation = clamp(umax / 0.7);
    return keys.reduce((a, k) => (w[k] > (w[a] ?? -1) ? k : a), keys[0]);
  }

  // ------------------------------------------------------------ locomocion libre
  locomotionMult() {
    const b = this.brain;
    const eEth = b.E('etanol'), eCoc = b.E('cocaina'), eNic = b.E('nicotina');
    let m = 1;
    m *= eEth < 0.35 ? 1 + 0.9 * eEth : 1.3 - 0.9 * clamp((eEth - 0.35) / 0.5); // hiperactividad -> sedacion
    m *= 1 + 1.1 * clamp(eCoc, 0, 0.9) + 0.35 * clamp(eNic, 0, 0.7);
    m *= 0.45 + 0.55 * clamp(b.energia * 1.6);
    m *= 1 - 0.5 * b.W('cocaina');
    m *= 1 + 0.8 * b.susto;
    return m * b.profile.actividad;
  }

  updateFree(dt) {
    const b = this.brain;
    const eEth = b.E('etanol'), eCoc = b.E('cocaina');
    let goal = this.motivate();
    // histeresis: mantener el objetivo actual salvo que otro lo supere con claridad
    if (this.goal && goal !== this.goal && this.weights[this.goal] !== undefined && this.weights[goal] - this.weights[this.goal] < 0.2) goal = this.goal;
    if (goal !== this.goal) {
      this.goal = goal;
      this.world.setFocus(goal && this.motivation > 0.25 ? goal : null);
    }
    const s = this.sensed;
    const gC = goal ? s.ch[goal].C : 0;
    this.dGoal += ((gC - this.goalC) / Math.max(dt, 1e-3) - this.dGoal) * Math.min(1, dt * 2);
    this.goalC = gC;

    // Bouts de marcha y pausas
    this.boutT -= dt;
    if (this.boutT <= 0) {
      if (this.walking) {
        this.walking = false;
        this.grooming = Math.random() < 0.45 + 0.4 * clamp(eCoc * 1.5);
        this.boutT = rand(0.35, 1.3) * (1 + 3 * b.sueno * b.sueno) * (1 - 0.5 * clamp(eCoc));
      } else {
        this.walking = true;
        this.grooming = false;
        this.boutT = rand(2, 7) * (0.6 + this.motivation) * (1 + clamp(eCoc));
        if (Math.random() < 0.5) this.sacc = rand(0.5, 1.6) * (Math.random() < 0.5 ? -1 : 1);
      }
    }
    // Dormirse donde esta si la presion de sueño es extrema
    if (!this.walking && b.sueno > 0.96 && b.E('cocaina') < 0.45) {
      this.activity = 'cama'; this.state = 'act'; this.actT = 0; this.insomnia = false; this.sessionR = 0;
      b.stats.siestas++;
      this.emit('Se duerme fuera de la cama · presión de sueño extrema', 'info');
      return;
    }

    // Consumir si esta junto a la opcion mas motivante
    if (goal) {
      const st = this.world.stations.get(goal);
      const d = st.approach.distanceTo(new THREE.Vector3(this.pos.x, 0, this.pos.z));
      const best = this.U[goal] >= Math.max(...Object.values(this.U)) - 0.1;
      if (d < 4.5 && best && this.U[goal] > 0.1) { this.engage(goal); return; }
    }

    // --- Giro: suma ponderada de contrastes bilaterales (DNa01/DNa02) ---
    let steer = 0;
    const gainK = STEER_GAIN * (1 - 0.45 * clamp(eEth * 1.2)) * (0.3 + 0.7 * this.motivation);
    for (const [id, w] of Object.entries(this.weights)) {
      const c = s.ch[id];
      if (!c || c.C < 0.02) continue;
      steer += gainK * w * Math.tanh(c.contrast / CONTRAST0) * clamp(c.C / 0.08);
    }
    // Busqueda en zigzag si la señal del objetivo cae (se perdio la pluma)
    const losing = goal && this.walking && this.dGoal < -0.002 && this.motivation > 0.3;
    this.casting = clamp(this.casting + (losing ? dt * 1.5 : -dt * 0.8));
    // Sacadas: giros bruscos espontaneos, mas frecuentes al buscar o explorar
    const saccRate = 0.15 + 1.4 * this.casting + 0.35 * (1 - this.motivation) + 0.6 * eEth;
    if (this.walking && Math.abs(this.sacc) < 0.05 && Math.random() < saccRate * dt) {
      const toward = goal ? Math.sign(s.ch[goal].L - s.ch[goal].R) || 1 : (Math.random() < 0.5 ? -1 : 1);
      const dir = Math.random() < 0.7 ? toward : -toward;
      this.sacc = dir * rand(0.4, 1.4) * (1 + this.casting * 0.5);
    }
    let saccW = 0;
    if (Math.abs(this.sacc) > 0.02) {
      saccW = Math.sign(this.sacc) * 14;
      const step = Math.min(Math.abs(this.sacc), 14 * dt);
      this.sacc -= Math.sign(this.sacc) * step;
    }
    // Ruido motor (Ornstein-Uhlenbeck), mayor con etanol
    const sigmaN = 1.3 * (1 - 0.5 * this.motivation) * (1 + 2 * eEth);
    this.noiseW += (-this.noiseW / 0.6) * dt + sigmaN * Math.sqrt(dt) * randn();
    // Borde de la mesa: girar hacia adentro siguiendo la pared
    let wall = 0;
    const r = Math.hypot(this.pos.x, this.pos.z);
    if (r > TABLE_R - 14) {
      const inward = Math.atan2(this.pos.z, -this.pos.x); // rumbo hacia el centro
      const tang = [inward + Math.PI / 2, inward - Math.PI / 2];
      const tgt = Math.abs(angDiff(tang[0], this.heading)) < Math.abs(angDiff(tang[1], this.heading)) ? tang[0] : tang[1];
      const k = clamp((r - (TABLE_R - 14)) / 10);
      wall = 5 * k * angDiff(k > 0.8 ? inward : tgt, this.heading);
    }
    // Obstaculos al frente
    let obst = 0;
    const fx = Math.cos(this.heading), fz = -Math.sin(this.heading);
    for (const o of this.world.obstacles) {
      if (o.id === goal || (o.id && !this.enabled[o.id])) continue;
      const dx = o.x - this.pos.x, dz = o.z - this.pos.z;
      const d = Math.hypot(dx, dz) - o.r;
      if (d > 7) continue;
      const ahead = (dx * fx + dz * fz) / (Math.hypot(dx, dz) || 1);
      if (ahead < 0.1) continue;
      const cross = fx * dz - fz * dx; // >0: obstaculo a la derecha
      obst += (cross > 0 ? 1 : -1) * 6 * clamp(1 - d / 7) * ahead;
    }
    // Cocaina: giros estereotipados
    if (this.whirl <= 0 && eCoc > 0.55 && this.walking && Math.random() < dt * 0.2) {
      this.whirl = rand(1, 2.2);
      b.stats.giros++;
      if (b.stats.giros % 3 === 1) this.emit(`Giros estereotipados · cocaína ${f2(eCoc)} (McClung & Hirsh, Curr Biol 1998)`, 'bad');
    }
    let whirlW = 0;
    if (this.whirl > 0) { this.whirl -= dt; whirlW = 8; }

    const o = this.brainSim?.out;
    const dnL = o ? o.DNa01_L + o.DNa02_L : 0, dnR = o ? o.DNa01_R + o.DNa02_R : 0;
    const dnSteer = o ? 3 * (dnL - dnR) / (dnL + dnR + 6) : 0; // DNa01/DNa02 del lado del giro
    this.dnSteer = dnSteer;
    const omega = this.walking
      ? clamp(steer + dnSteer + this.noiseW + saccW + wall + obst + whirlW + b.profile.lateralidad, -14, 14)
      : clamp(saccW * 0.3 + this.noiseW * 0.15, -2, 2);
    this.heading += omega * dt;
    this.turnRate = omega;

    const vTarget = this.walking ? 19 * this.locomotionMult() * (0.6 + 0.4 * this.motivation) * (whirlW ? 0.6 : 1) : 0;
    this.speed += (vTarget - this.speed) * Math.min(1, dt * 8);
    const back = this.mdnBack ? -0.6 * this.mdnBack : 1; // MDN: marcha hacia atras
    this.pos.x += Math.cos(this.heading) * this.speed * back * dt;
    this.pos.z += -Math.sin(this.heading) * this.speed * back * dt;
    const rr = Math.hypot(this.pos.x, this.pos.z);
    if (rr > TABLE_R) this.pos.multiplyScalar(TABLE_R / rr);
    for (const o of this.world.obstacles) {
      if (o.id && !this.enabled[o.id]) continue;
      const dx = this.pos.x - o.x, dz = this.pos.z - o.z, d = Math.hypot(dx, dz);
      if (d < o.r + 1 && d > 1e-3) { this.pos.x = o.x + dx / d * (o.r + 1); this.pos.z = o.z + dz / d * (o.r + 1); }
    }

    // Vuelos cortos espontaneos (mas con estimulantes o si la señal esta lejos)
    const far = goal ? clamp(1 - this.goalC / 0.25) : 0.5;
    if (this.walking && Math.random() < dt * 0.03 * (1 + 3 * eCoc + 2 * b.susto) * (0.5 + far) * (1 - clamp(eEth * 1.5))) {
      let dir = this.heading + rand(-0.8, 0.8);
      if (goal && this.motivation > 0.4) {
        const st = this.world.stations.get(goal);
        dir = Math.atan2(-(st.approach.z - this.pos.z), st.approach.x - this.pos.x) + rand(-0.4, 0.4);
      }
      this.takeoff(dir, rand(20, 45));
    }
  }

  engage(id) {
    const st = this.world.stations.get(id);
    this.activity = id;
    this.target = st.approach.clone();
    this.lookAt = st.look.clone();
    this.sessionR = 0;
    this.actT = 0;
    this.acc = 0;
    this.spin = null;
    this.reelCount = 0;
    this.spins = 0; this.wins = 0; this.nears = 0; this.chips0 = this.brain.fichas;
    this.state = 'align';
    this.world.setFocus(id);
  }

  endActivity(learn = true) {
    const a = this.activity;
    if (!a) return;
    if (learn) this.brain.learn(a, this.sessionR);
    if (a === 'reels') this.world.reels.watching = false;
    if (a === 'slots' && this.spins > 0) {
      const net = this.brain.fichas - this.chips0;
      this.emit(`Tragamonedas · sesión · ${this.spins} tiradas · ${this.wins} premios · ${this.nears} casi-aciertos · balance ${net >= 0 ? '+' : ''}${net}`, 'vice');
    }
    this.refractory[a] = rand(8, 14); // habituacion a la señal recien consumida
    this.activity = null;
    this.spin = null;
    this.state = 'free';
    this.walking = true;
    this.grooming = false;
    this.boutT = rand(1.5, 4);
    this.sacc = rand(1.8, 3) * (Math.random() < 0.5 ? -1 : 1); // darse vuelta y alejarse
    this.goal = null;
    this.world.setFocus(null);
  }

  updateAlign(dt) {
    this.speed = 0;
    const to = this.lookAt.clone().sub(this.pos);
    const diff = angDiff(Math.atan2(-to.z, to.x), this.heading);
    this.heading += clamp(diff, -9 * dt, 9 * dt);
    this.turnRate = clamp(diff, -9, 9);
    this.pos.lerp(new THREE.Vector3(this.target.x, 0, this.target.z), Math.min(1, dt * 7));
    if (Math.abs(diff) < 0.08) { this.state = 'act'; this.actT = 0; this.acc = 0; this.beginAct(); }
  }

  updateJump(dt) {
    const j = this.jump;
    j.t += dt;
    const k = clamp(j.t / j.dur);
    this.pos.lerpVectors(j.from, j.to, k);
    j.h = Math.sin(k * Math.PI) * (j.escape ? 12 : 9);
    this.speed = 0;
    this.turnRate = 0;
    if (k >= 1) { this.jump = null; this.state = 'free'; this.walking = false; this.boutT = rand(0.25, 0.7); }
  }

  // ------------------------------------------------------------ actividades
  beginAct() {
    const b = this.brain, a = this.activity;
    if (a === 'bar' || a === 'cigarro' || a === 'coca') {
      this.checkT = 1.2; this.bumps = 0; this.nextBump = 0.7; this.warned = false;
    }
    if (a === 'cama') {
      this.insomnia = b.E('cocaina') > 0.45 || b.E('nicotina') > 0.9;
      if (this.insomnia) {
        this.emit(`Sueño bloqueado por estimulante · cocaína ${f2(b.E('cocaina'))}`, 'bad');
        this.actDur = 2.5;
      } else { this.actDur = Infinity; b.stats.siestas++; }
    }
    if (a === 'reels') {
      this.world.reels.watching = true;
      this.reelStart = b.stats.vivo;
    }
  }

  relief(s, dt) { return this.brain.W(s) * 0.4 * dt; }

  /** ¿Deja de consumir ahora? Saciedad, malestar (etanol, nicotina), otras necesidades y ansia. */
  stopRoll() {
    const b = this.brain, a = this.activity, drug = DRUG_OF[a];
    const sat = b.satiety(drug);
    const bitter = drug === 'nicotina' ? 0.4 * clamp(b.E(drug) - 0.4) : 0; // la nicotina es amarga (neuronas Gr66a)
    const aversive = b.aversionWeight(a) * (b.malaise(drug) + bitter);
    const need = Math.max(0, (1 - b.energia) - 0.75) * 2 + Math.max(0, b.sueno - 0.85) * 2;
    const p = clamp(0.55 * sat ** 3 + 1.1 * aversive + need - 0.35 * b.W(drug) - 0.25 * b.addiction(a), 0.02, 0.95);
    if (Math.random() >= p) {
      if (!this.warned && b.malaise(drug) > 0.5) {
        this.warned = true;
        this.emit(`Sigue consumiendo con malestar (${Math.round(100 * b.toxicity(drug))} % del umbral tóxico) · búsqueda resistente a la aversión (Kaun et al., Nat Neurosci 2011)`, 'bad');
      }
      return false;
    }
    const parts = { saciedad: 0.55 * sat ** 3, aversion: 1.1 * aversive, necesidad: need };
    this.stopReason = Object.entries(parts).sort((x, y) => y[1] - x[1])[0][0];
    return true;
  }

  /** Consumo continuo (etanol, nicotina): evalua cada 0,5 s si seguir. */
  consumeCheck(dt) {
    this.checkT -= dt;
    if (this.actT > 40) { this.stopReason = 'necesidad'; return true; }
    if (this.checkT > 0) return false;
    this.checkT = 0.5;
    return this.stopRoll();
  }

  stopText() {
    const b = this.brain, drug = DRUG_OF[this.activity];
    switch (this.stopReason) {
      case 'aversion': return `se detiene por malestar (${Math.round(100 * b.toxicity(drug))} % del umbral tóxico)`;
      case 'necesidad': return 'se detiene por hambre o sueño';
      case 'agotada': return 'se acabó la línea';
      default: return drug === 'cocaina' ? 'se detiene al saciar la dopamina' : 'se detiene por saciedad';
    }
  }

  updateAct(dt) {
    const b = this.brain, a = this.activity;
    this.actT += dt;
    this.speed = 0;
    this.turnRate = 0;
    switch (a) {
      case 'bar': {
        b.dose('etanol', 0.07 * this.potency.etanol * dt);
        b.energia = clamp(b.energia + 0.003 * dt); // el jugo fermentado aporta pocas calorias
        this.sessionR += b.reward(0.1 * dt) + this.relief('etanol', dt);
        this.acc += dt;
        if (this.acc > 1.3) { this.acc = 0; this.sfx.play('gulp'); }
        if (this.consumeCheck(dt)) {
          b.stats.shots++;
          this.emit(`Etanol · ${this.stopText()} · ${Math.round(this.actT)} s · efecto ${f2(b.E('etanol'))} · tolerancia ${f2(b.drug.etanol.tol)}`, 'vice');
          this.endActivity();
        }
        break;
      }
      case 'cigarro': {
        b.dose('nicotina', 0.085 * this.potency.nicotina * dt);
        this.sessionR += b.reward(0.09 * dt) + this.relief('nicotina', dt);
        this.world.smoke.boost = Math.min(1.5, this.world.smoke.boost + dt * 2);
        this.acc += dt;
        if (this.acc > 1.6) {
          this.acc = 0;
          this.sfx.play(b.drug.nicotina.tol < 0.25 && Math.random() < 0.5 ? 'cough' : 'inhale');
        }
        if (this.consumeCheck(dt)) {
          b.stats.cigarros++;
          this.emit(`Nicotina · ${this.stopText()} · ${Math.round(this.actT)} s · efecto ${f2(b.E('nicotina'))} · tolerancia ${f2(b.drug.nicotina.tol)}`, 'vice');
          this.endActivity();
        }
        break;
      }
      case 'coca': {
        // Cada aspirada es una decision: antes de la siguiente evalua la dopamina (saciedad)
        if (this.actT >= this.nextBump) {
          const empty = this.world.coke.amount <= 0;
          if (this.bumps > 0 && (empty || this.stopRoll())) {
            if (empty) this.stopReason = 'agotada';
            b.stats.lineas++;
            this.emit(`Cocaína · ${this.stopText()} · ${this.bumps} aspirada${this.bumps > 1 ? 's' : ''} · DA ${f2(b.dopamina)} · sensibilidad DA ${f2(b.sens)}`, 'vice');
            if (empty) this.emit('Cocaína agotada · reposición en 15 s', 'info');
            this.endActivity();
            break;
          }
          this.bumps++;
          this.nextBump += 1.0;
          b.dose('cocaina', 0.3 * this.potency.cocaina);
          this.sessionR += b.reward(0.5) + b.W('cocaina') * 0.5;
          this.world.coke.consume(0.12);
          this.sfx.play('snort');
        }
        break;
      }
      case 'slots': this.updateSlots(dt); break;
      case 'reels': {
        b.brainrot = clamp(b.brainrot + 0.004 * dt * (1 - b.brainrot * 0.5));
        b.stats.tiempoReels += dt;
        this.world.reels.attention = 1 - 0.55 * b.brainrot;
        break;
      }
      case 'comida': {
        const hunger = 1 - b.energia;
        const pe = this.brainSim?.out ? 0.3 + 0.7 * clamp(this.brainSim.mn9 / 3) : 1; // MN9 (Hz): extension de probóscide
        b.energia = clamp(b.energia + 0.09 * pe * dt);
        this.sessionR += b.reward((0.06 + 0.2 * hunger) * dt);
        this.acc += dt;
        if (this.acc > 1.5) { this.acc = 0; this.sfx.play('munch'); }
        if (b.energia >= 0.97 || this.actT > 15) { // saciedad: buche lleno
          b.stats.comidas++;
          this.emit(`Alimentación · energía ${f2(b.energia)}`, 'good');
          this.endActivity();
        }
        break;
      }
      case 'cama': {
        if (this.insomnia) { if (this.actT > this.actDur) this.endActivity(false); break; }
        if (b.E('cocaina') > 0.5) { this.emit('Despertar abrupto por estimulante', 'bad'); this.endActivity(false); break; }
        if (b.sueno < 0.04) { this.emit(`Fin del episodio de sueño · ${Math.round(this.actT)} s`, 'good'); this.endActivity(false); }
        break;
      }
    }
  }

  updateSlots(dt) {
    const b = this.brain, slots = this.world.slots;
    if (!this.spin) {
      this.acc -= dt;
      if (this.acc > 0) return;
      const free = this.freeSpins > 0;
      if (b.fichas <= 0 && !free) {
        b.frustracion = clamp(b.frustracion + 0.4);
        this.emit('Tragamonedas · sin fichas · frustración ↑', 'bad');
        this.endActivity();
        return;
      }
      const bet = free ? 1 : Math.min(b.fichas, 1 + Math.round(b.impulsividad * 4 + b.lossChase * 2));
      if (!free) { b.fichas -= bet; b.stats.fichasPerdidas += bet; }
      b.stats.tiradas++;
      this.spins++;
      let force = null;
      if (free) {
        if (this.freeSpins === 5) this.emit('Tragamonedas · 5 tiradas de bienvenida sin costo', 'info');
        this.freeSpins--;
        const r = Math.random();
        force = r < 0.1 ? 'jackpot' : r < 0.55 ? 'triple' : 'pair';
        if (this.freeSpins === 0) this.pendingBetsMsg = true;
      }
      this.spin = slots.spin(bet, { force });
      slots.press();
      this.sfx.play('spin');
      return;
    }
    if (!this.spin.done) return;
    const s = this.spin;
    this.spin = null;
    b.fichas += s.payout;
    b.stats.fichasGanadas += s.payout;
    let r = 0.02;
    if (s.kind === 'jackpot') {
      r = 1.5; b.stats.jackpots++; b.lossChase = 0; this.celebrate = 3; this.wins++;
      this.world.coinBurst(40); this.sfx.play('jackpot');
      this.emit(`Tragamonedas · jackpot 7-7-7 · +${s.payout} fichas`, 'win');
    } else if (s.kind === 'triple' || s.kind === 'pair') {
      r = s.kind === 'triple' ? 0.7 : 0.3;
      this.wins++;
      b.lossChase = Math.max(0, b.lossChase - 0.3);
      this.celebrate = 1.5; this.world.coinBurst(s.kind === 'triple' ? 18 : 6); this.sfx.play('win');
      if (s.kind === 'triple') this.emit(`Tragamonedas · triple · +${s.payout} fichas`, 'win');
    } else if (s.kind === 'near') {
      r = 0.35; // casi-acierto: respuesta de recompensa sin premio
      this.nears++;
      b.lossChase = clamp(b.lossChase + 0.12, 0, 2);
      this.sfx.play('near');
    } else {
      b.lossChase = clamp(b.lossChase + 0.05 * s.bet, 0, 2);
      this.sfx.play('lose');
    }
    // Dopamina por error de prediccion: un premio inesperado (valor aprendido bajo) da un pico mayor
    const surprise = s.kind !== 'lose' ? 1 + (1 - clamp(b.V.slots / 1.2)) : 1;
    this.sessionR += b.reward(r * surprise);
    if (this.pendingBetsMsg) { this.pendingBetsMsg = false; this.emit('Tragamonedas · fin de la bienvenida · comienzan las apuestas', 'info'); }
    const h = 1 - b.energia;
    const pCont = this.freeSpins > 0 ? 1 : clamp(0.3 + 0.45 * b.V.slots + 0.3 * b.lossChase + (s.kind === 'near' ? 0.25 : 0) + (s.payout > 0 ? 0.25 : 0) + 0.2 * b.impulsividad
      - (h > 0.7 ? 0.5 : 0) - (b.sueno > 0.85 ? 0.4 : 0) - 0.3 * b.abstinencia, 0.05, 0.93);
    this.acc = 0.5;
    if (b.fichas > 0 && Math.random() > pCont) this.endActivity();
  }

  onReelPayoff(m) {
    if (this.activity !== 'reels' || this.state !== 'act') return;
    const b = this.brain;
    // la recompensa de un clip satura por debajo de un premio de la tragamonedas (x5 = 0.7)
    const eff = b.reward(0.35 * Math.tanh(m / 0.45));
    this.sessionR += eff * 0.35;
    b.brainrot = clamp(b.brainrot + 0.008 * m);
  }

  onReelEnd() {
    if (this.activity !== 'reels' || this.state !== 'act') return;
    const b = this.brain;
    b.stats.reels++;
    this.reelCount++;
    this.sfx.play('swipe');
    const watchT = b.stats.vivo - this.reelStart;
    const urg = Math.max(0, (1 - b.energia) - 0.6) * 1.6 + Math.max(0, b.sueno - 0.8) * 1.6 + Math.max(0, b.abstinencia - 0.4);
    const pLeave = clamp(0.3 * Math.exp(-watchT / 30) + 0.6 * urg - 0.15 * b.brainrot, 0.02, 0.9);
    if (Math.random() < pLeave) this.endActivity();
  }

  die() {
    this.state = 'dead';
    this.speed = 0;
    this.turnRate = 0;
    this.world.reels.watching = false;
    this.world.setFocus(null);
    this.deathMsg = this.brain.deathCause();
    this.sfx.play('death');
    const t = this.brain.stats.vivo;
    this.emit(`Muerte · ${this.deathMsg} · t = ${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`, 'bad');
  }

  // ------------------------------------------------------------ salida motora para la animacion
  motor() {
    const b = this.brain;
    const eEth = b.E('etanol'), eCoc = b.E('cocaina'), eNic = b.E('nicotina');
    const act = this.state === 'act' ? this.activity : null;
    const dead = this.state === 'dead';
    const free = this.state === 'free';
    return {
      speed: free && this.walking ? this.speed : 0,
      tremor: dead ? 0 : clamp(Math.max(eNic - 0.55, b.W('etanol') * 0.9, b.W('nicotina') * 0.5, this.state === 'seizure' ? 1 : 0, b.susto * 0.3, eCoc > 0.9 ? 0.5 : 0)),
      wings: dead ? 0 : this.state === 'jump' ? 1 : this.celebrate > 0 ? 0.8 : (eCoc > 0.7 && Math.sin(b.stats.vivo * 1.3) > 0.7 ? 0.5 : 0),
      spread: this.celebrate > 0 ? 0.6 : 0,
      proboscis: (act === 'bar' || act === 'comida') ? (this.brainSim?.out ? clamp(this.brainSim.mn9 / 3) : 0.6 + 0.4 * Math.max(0, Math.sin(this.actT * 4)))
        : act === 'coca' ? (Math.abs(this.actT - 0.8) < 0.35 || Math.abs(this.actT - 1.8) < 0.35 ? 1 : 0.2) : 0,
      fall: dead || this.state === 'fallen' ? 1 : 0,
      sway: dead ? 0 : clamp(eEth * 1.4),
      groom: dead ? 0 : (free && !this.walking && this.grooming ? 1 : 0),
      curl: dead ? 1 : act === 'cama' && !this.insomnia ? 0.7 : 0,
      flail: this.state === 'fallen' ? 0.8 : this.state === 'seizure' ? 1 : 0,
      look: act === 'reels' ? Math.sin(b.stats.vivo * 1.7) * 0.18 * (0.5 + this.world.reels.motion) : act === 'slots' ? -0.1 : clamp(this.turnRate * 0.05, -0.3, 0.3),
    };
  }
}
