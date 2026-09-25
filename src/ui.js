// Interfaz: modo dios, estado del sujeto, panel del cerebro, registro y señal de estado sobre la mosca.
import * as THREE from 'three';
import { ETHO, CUES } from './sim.js';
import { GROUPS } from './brainview.js';

const $ = (s) => document.querySelector(s);
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const fmtTime = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

const BARS = [
  ['salud', 'Salud', '#ff4d6d'],
  ['energia', 'Energía', '#ffd166'],
  ['sueno', 'Presión de sueño', '#8fa8ff'],
  ['felicidad', 'Valencia', '#7affc1'],
  ['dopamina', 'Dopamina', '#ff4fd8'],
  ['brainrot', 'Brainrot', '#29e6ff'],
  ['riesgo', 'Riesgo tóxico', '#ff8a4d'],
];
const SUBS = [['etanol', 'Etanol'], ['nicotina', 'Nicotina'], ['cocaina', 'Cocaína']];
const SERIES = [['da', 'dopamina', '#ff4fd8', 1.5], ['etanol', 'etanol', '#ffb040', 1.2], ['nicotina', 'nicotina', '#ff6a2a', 1.2], ['cocaina', 'cocaína', '#9fdcff', 1.2]];

const INPUT_ROWS = [['GRN', 'dulce · GRN'], ['ORN_L', 'olor izq · ORN'], ['ORN_R', 'olor der · ORN'], ['VIS_L', 'luz izq'], ['VIS_R', 'luz der'],
  ['T4T5', 'visual · T4/T5'], ['LPLC2', 'looming · LPLC2'],
  ['etanol', 'etanol'], ['nicotina', 'nicotina'], ['cocaina', 'cocaína']];
const POP_ROWS = [['PN', 'PN antenal'], ['KC', 'Kenyon'], ['PAM', 'PAM · DA+'], ['PPL1', 'PPL1 · DA−'], ['MBON', 'MBON'], ['dFB', 'dFB · sueño']];
const OUT_ROWS = [['speed', 'marcha'], ['turn', 'giro'], ['proboscis', 'probóscide'], ['escape', 'escape']];

export class UI {
  constructor({ sim, brain, world, sfx, fly, camera, app, brainView }) {
    Object.assign(this, { sim, brain, world, sfx, fly, camera, app, brainView });
    this.acc = 0;
    this.drive = {};
    this.buildGod();
    this.buildSubject();
    this.buildBrainPanel();
    this.bindTop();
    sim.on(e => this.log(e));
    this.moodEl = $('#mood');
  }

  // ------------------------------------------------------------ modo dios
  buildGod() {
    const wrap = $('#stationToggles');
    wrap.innerHTML = '';
    for (const st of this.world.stations.values()) {
      const b = document.createElement('button');
      b.className = 'toggle on';
      b.dataset.id = st.id;
      b.innerHTML = `<span></span>${st.nombre}`;
      b.style.setProperty('--c', '#' + new THREE.Color(st.color).getHexString());
      b.onclick = () => { this.sfx.unlock(); this.sfx.play('click'); this.sim.setEnabled(st.id, !this.sim.enabled[st.id]); this.refreshToggles(); };
      wrap.appendChild(b);
    }
    for (const [key] of SUBS) {
      const input = $(`#p_${key}`), out = $(`#v_${key}`);
      input.oninput = () => { this.sim.potency[key] = +input.value; out.textContent = `×${(+input.value).toFixed(1)}`; };
    }
    document.querySelectorAll('[data-act]').forEach(btn => {
      btn.onclick = () => {
        this.sfx.unlock(); this.sfx.play('click');
        const s = this.sim;
        switch (btn.dataset.act) {
          case 'rechazo': s.rechazo(); break;
          case 'cita': s.cita(); break;
          case 'fichas': s.darFichas(25); break;
          case 'susto': s.susto(); break;
          case 'rehab': s.startRehab(); break;
          case 'reset': this.newSubject(); break;
        }
      };
    });
  }

  refreshToggles() {
    document.querySelectorAll('#stationToggles .toggle').forEach(b => b.classList.toggle('on', !!this.sim.enabled[b.dataset.id]));
  }

  // ------------------------------------------------------------ sujeto
  buildSubject() {
    $('#bars').innerHTML = BARS.map(([k, label, col]) => `
      <div class="row"><span class="lbl">${label}</span><div class="bar" style="--c:${col}"><div class="fill" id="b_${k}"></div></div><span class="num" id="n_${k}"></span></div>`).join('');
    $('#subs').innerHTML = SUBS.map(([k, label]) => `
      <div class="row sub" id="s_${k}"><span class="lbl">${label}</span>
        <div class="bar"><div class="fill"></div><div class="tol" title="tolerancia"></div></div>
        <span class="wd" title="abstinencia">abst.</span></div>`).join('');
    $('#ethoLegend').innerHTML = ETHO.map(([k, label, col]) => `<span id="el_${k}"><i style="background:${col}"></i>${label} <b></b></span>`).join('');
    $('#ethoBar').innerHTML = ETHO.map(([k, , col]) => `<div id="eb_${k}" style="background:${col}"></div>`).join('');
    $('#csvBtn').onclick = () => this.exportCSV();
  }

  exportCSV() {
    const rows = this.sim.records;
    if (!rows.length) return;
    const keys = Object.keys(rows[0]);
    const cell = (v) => typeof v === 'number' ? (Number.isInteger(v) ? v : v.toFixed(4)) : `"${String(v).replace(/"/g, '""')}"`;
    const csv = [keys.join(','), ...rows.map(r => keys.map(k => cell(r[k])).join(','))].join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.download = `drosophila_sujeto_${this.sim.subject}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  // ------------------------------------------------------------ panel del cerebro
  buildBrainPanel() {
    const m = this.brainView.meta;
    $('#brainMeta').innerHTML = `<b>${m.dataset}</b> · ${m.neurons.toLocaleString('es')} neuronas · ${m.somata.toLocaleString('es')} somas<br>`
      + `circuito de ${m.cells.length} células · ${m.edges.length} aristas · ${m.synapses.toLocaleString('es')} sinapsis`;
    const counts = {};
    for (const c of m.cells) counts[c.group] = (counts[c.group] || 0) + 1;
    const row = (id, label, signed = false) => `
      <div class="nrow"><span>${label}</span><div class="nbar${signed ? ' signed' : ''}" id="nb_${id}"><i></i></div></div>`;
    $('#nIn').innerHTML = INPUT_ROWS.map(([k, l]) => row('in_' + k, l)).join('');
    $('#nPop').innerHTML = POP_ROWS.map(([k, l]) => row('pop_' + k, `${l} <small>${counts[k] || 0}</small>`)).join('');
    $('#nSel').innerHTML = [...this.world.stations.values()].map(st => row('sel_' + st.id, st.nombre.toLowerCase())).join('');
    this.dnCells = this.brainView.cells.filter(c => c.group === 'DN').sort((a, b) => a.type.localeCompare(b.type) || a.side.localeCompare(b.side));
    $('#nDnTitle').textContent = `${this.dnCells.length} descendentes`;
    $('#nDn').innerHTML = this.dnCells.map(c => row('dn_' + c.i, `${c.type} ${c.side ? c.side[0].toUpperCase() : ''}`, true)).join('');
    $('#nOut').innerHTML = OUT_ROWS.map(([k, l]) => row('out_' + k, l, k === 'turn')).join('');
    $('#seriesLegend').innerHTML = SERIES.map(([, l, col]) => `<span><i style="background:${col}"></i>${l}</span>`).join('');
    const cv = $('#seriesCanvas');
    const dpr = Math.min(devicePixelRatio, 2);
    this.sw = cv.clientWidth || 390; this.sh = 92;
    cv.width = this.sw * dpr; cv.height = this.sh * dpr; cv.style.height = this.sh + 'px';
    this.sctx = cv.getContext('2d');
    this.sctx.scale(dpr, dpr);
  }

  /** Actividad objetivo de cada poblacion segun el estado del modelo. */
  computeDrive() {
    const s = this.sim, b = this.brain, reels = this.world.reels;
    const act = s.state === 'act' ? s.activity : null;
    const dead = s.state === 'dead';
    const sn = s.sensed;
    const watching = act === 'reels';
    const turn = clamp(s.turnRate / 5, -1, 1);
    const m = s.motor();
    const d = {
      GRN: act === 'comida' ? 0.9 : act === 'bar' ? 0.45 : 0.03,
      ORN_L: clamp(0.04 + sn.olfL * 0.9), ORN_R: clamp(0.04 + sn.olfR * 0.9),
      VIS_L: clamp(sn.visL * 0.7), VIS_R: clamp(sn.visR * 0.7),
      T4T5: watching ? 0.3 + 0.7 * reels.motion : 0.05 + clamp(s.speed / 15) * 0.6 + Math.abs(turn) * 0.3,
      LPLC2: s.state === 'jump' ? 1 : b.susto * 0.8 + (watching && reels.motion > 0.9 ? 0.2 : 0),
      PAM: clamp(b.phasic * 1.1 + 0.2 * b.tonic),
      PPL1: clamp(b.abstinencia + b.frustracion * 0.6 + b.rechazo * 0.4 + Math.max(0, 0.5 - b.energia) * 0.6),
      MBON: s.state === 'free' ? s.motivation : 0.3 + 0.5 * clamp(b.phasic),
      dFB: b.sueno,
      etanol: clamp(b.E('etanol') / 1.2), nicotina: clamp(b.E('nicotina') / 1.2), cocaina: clamp(b.E('cocaina') / 1.2),
      escape: s.state === 'jump' ? 1 : b.susto * 0.7,
      speed: clamp(s.speed / 20), turn, proboscis: m.proboscis,
    };
    d.ORN = (d.ORN_L + d.ORN_R) / 2;
    d.PN = clamp(0.1 + 0.9 * d.ORN);
    d.KC = clamp(0.08 + 0.5 * Math.max(d.PN, d.GRN * 0.6, d.T4T5 * 0.3));
    if (dead) for (const k in d) d[k] = 0;
    this.drive = d;
    return d;
  }

  /** Estado que colorea la nube de somas por region y neurotransmisor. */
  cloudState() {
    const s = this.sim, b = this.brain, d = this.drive;
    if (s.state === 'dead') return {};
    const watching = s.state === 'act' && s.activity === 'reels';
    const sleeping = s.state === 'act' && s.activity === 'cama' && !s.insomnia;
    return {
      vis: watching ? d.T4T5 : d.T4T5 * 0.45,
      ornL: d.ORN_L * 1.2, ornR: d.ORN_R * 1.2, kc: d.KC,
      da: b.phasic * 1.3 + 0.08, sleep: sleeping ? 1 : b.sueno * 0.45,
      dn: Math.max(d.escape, d.speed * 0.45), mbon: d.MBON,
      eth: b.E('etanol'), nic: b.E('nicotina'), coc: b.E('cocaina'),
    };
  }

  /** Texto de los efectos que se ven en la nube. */
  cloudEffects() {
    const s = this.sim, b = this.brain, fx = [];
    if (s.state === 'dead') return ['sin actividad'];
    if (b.E('cocaina') > 0.15) fx.push(['#ffb340', 'cocaína: bloqueo del transportador de dopamina → DA sostenida']);
    if (b.E('nicotina') > 0.15) fx.push(['#ff8040', 'nicotina: agonista de receptores nicotínicos → colinérgicas']);
    if (b.E('etanol') > 0.15) fx.push(['#b366ff', 'etanol: potencia GABA → sedación general']);
    if (b.phasic > 0.3) fx.push(['#ffb340', 'recompensa: pico en dopaminérgicas PAM']);
    if (s.state === 'act' && s.activity === 'reels') fx.push(['#5fd0ff', 'reels: flujo óptico en lóbulos ópticos (T4/T5)']);
    if (s.state === 'act' && s.activity === 'cama' && !s.insomnia) fx.push(['#8fa8ff', 'sueño: complejo central (dFB)']);
    if (s.state === 'jump') fx.push(['#ffffff', 'escape: LPLC2 → Giant Fiber → descendentes']);
    if (Math.max(this.drive.ORN_L, this.drive.ORN_R) > 0.35) fx.push(['#80ff70', `olor: lóbulo antenal ${this.drive.ORN_L > this.drive.ORN_R ? 'izquierdo' : 'derecho'}`]);
    return fx.length ? fx : [['#6f8196', 'actividad basal']];
  }

  cellDrive(c) {
    const d = this.drive;
    if (c.group === 'ORN') return c.side === 'left' ? d.ORN_L : d.ORN_R;
    if (c.group !== 'DN') return d[c.group] ?? 0;
    if (c.type === 'DNp01') return d.escape;
    if (c.type === 'DNa01' || c.type === 'DNa02') {
      const ipsi = c.side === 'left' ? Math.max(0, d.turn) : Math.max(0, -d.turn);
      return 0.06 + 0.85 * ipsi + 0.25 * d.speed;
    }
    if (c.type === 'MDN') return 0.03 + (this.sim.state === 'fallen' ? 0.3 : 0);
    return 0.05;
  }

  bindTop() {
    document.querySelectorAll('[data-speed]').forEach(b => {
      b.onclick = () => { this.sfx.unlock(); this.app.setSpeed(+b.dataset.speed); this.refreshTop(); };
    });
    $('#camBtn').onclick = () => { this.app.toggleCam(); this.refreshTop(); };
    $('#fxBtn').onclick = () => { this.app.fx = !this.app.fx; this.refreshTop(); };
    $('#sndBtn').onclick = () => { this.sfx.unlock(); this.sfx.enabled = !this.sfx.enabled; this.refreshTop(); };
    $('#helpBtn').onclick = () => $('#help').showModal();
    $('#helpClose').onclick = () => $('#help').close();
    $('#leftTab').onclick = () => { document.body.classList.remove('show-right'); document.body.classList.toggle('show-left'); };
    $('#rightTab').onclick = () => { document.body.classList.remove('show-left'); document.body.classList.toggle('show-right'); };
    $('#reviveBtn').onclick = () => this.newSubject();
    this.refreshTop();
  }

  refreshTop() {
    document.querySelectorAll('[data-speed]').forEach(b => b.classList.toggle('on', +b.dataset.speed === this.app.speed));
    $('#camBtn').textContent = this.app.camMode === 'follow' ? 'Cámara: sujeto' : 'Cámara: arena';
    $('#fxBtn').classList.toggle('on', this.app.fx);
    $('#sndBtn').textContent = this.sfx.enabled ? 'Sonido: sí' : 'Sonido: no';
  }

  newSubject() {
    $('#death').hidden = true;
    this.deathShown = false;
    this.sim.reset();
    this.refreshToggles();
  }

  log({ text, kind, t }) {
    const list = $('#log');
    const el = document.createElement('div');
    el.className = `entry ${kind}`;
    el.innerHTML = `<time>${fmtTime(t)}</time><span></span>`;
    el.querySelector('span').textContent = text;
    list.prepend(el);
    while (list.children.length > 6) list.lastChild.remove();
  }

  // ------------------------------------------------------------ actualizacion por cuadro
  update(dt) {
    this.computeDrive();
    this.brainView.setState(this.cloudState());
    this.brainView.update(dt, (c) => this.cellDrive(c));
    this.updateMood();
    this.acc += dt;
    if (this.acc < 0.1) return;
    this.acc = 0;
    this.updateSubject();
    this.updateNeuralBars();
    this.drawSeries();
    if (this.sim.dead && !this.deathShown) this.showDeath();
  }

  updateSubject() {
    const b = this.brain, s = this.sim;
    const vals = { salud: b.salud, energia: b.energia, sueno: b.sueno, felicidad: b.felicidad, dopamina: clamp(b.dopamina / 1.5), brainrot: b.brainrot,
      riesgo: clamp(Math.max(b.toxicity('etanol'), b.toxicity('nicotina'), b.toxicity('cocaina'))) };
    for (const [k] of BARS) {
      $(`#b_${k}`).style.width = `${Math.round(vals[k] * 100)}%`;
      $(`#n_${k}`).textContent = vals[k].toFixed(2);
    }
    for (const [k] of SUBS) {
      const row = $(`#s_${k}`);
      row.querySelector('.fill').style.width = `${Math.round(clamp(b.E(k) / 1.2) * 100)}%`;
      row.querySelector('.tol').style.left = `${Math.round(clamp(b.drug[k].tol / 1.2) * 100)}%`;
      row.querySelector('.wd').classList.toggle('on', b.W(k) > 0.25);
    }
    const lab = s.label;
    $('#stDot').style.background = this.stateColor();
    const p = b.profile;
    $('#profile').innerHTML = `perfil · sensibilidad EtOH <b>×${p.etanol.toFixed(1)}</b> Nic <b>×${p.nicotina.toFixed(1)}</b> Coc <b>×${p.cocaina.toFixed(1)}</b><br>`
      + `aprendizaje <b>${p.aprendizaje.toFixed(2)}</b> · novedad <b>${p.novedad.toFixed(2)}</b> · aversión <b>×${p.aversion.toFixed(2)}</b> · actividad <b>×${p.actividad.toFixed(2)}</b> · giro <b>${p.lateralidad >= 0 ? 'izq' : 'der'} ${Math.abs(p.lateralidad).toFixed(2)}</b>`;
    $('#stText').textContent = lab.text;
    const extra = [`sujeto #${s.subject}`, `t ${fmtTime(b.stats.vivo)}`];
    if (s.rehab > 0) extra.push(`abstinencia forzada ${Math.ceil(s.rehab)} s`);
    if (b.rechazo > 0.2) extra.push('NPF ↓');
    if (b.amor > 0.2) extra.push('NPF ↑');
    $('#stSub').textContent = extra.join(' · ');
    $('#fichas').textContent = b.fichas;
    const net = b.stats.fichasGanadas - b.stats.fichasPerdidas;
    const bal = $('#balance');
    bal.textContent = `${net >= 0 ? '+' : ''}${net}`;
    bal.className = net >= 0 ? 'pos' : 'neg';
    const total = Object.values(b.stats.time).reduce((a, x) => a + x, 0) || 1;
    for (const [k] of ETHO) {
      const p = b.stats.time[k] / total;
      $(`#eb_${k}`).style.width = `${p * 100}%`;
      const el = $(`#el_${k}`);
      el.querySelector('b').textContent = `${Math.round(p * 100)}%`;
      el.classList.toggle('zero', p < 0.005);
    }
    const st = b.stats;
    $('#statsGrid').innerHTML = [
      ['Consumos de etanol', st.shots], ['Cigarros', st.cigarros], ['Líneas de cocaína', st.lineas], ['Giros estereotipados', st.giros],
      ['Tiradas', st.tiradas], ['Fichas apostadas / ganadas', `${st.fichasPerdidas} / ${st.fichasGanadas}`], ['Jackpots', st.jackpots],
      ['Reels vistos', st.reels], ['Tiempo en reels', fmtTime(st.tiempoReels)], ['Comidas', st.comidas], ['Episodios de sueño', st.siestas],
      ['Caídas', st.caidas],
    ].map(([k, v]) => `<div><span>${k}</span><b>${v}</b></div>`).join('');
  }

  /** Color del punto de estado: verde normal, azul sueño, ambar intoxicada, rojo critico. */
  stateColor() {
    const s = this.sim, b = this.brain;
    if (s.state === 'dead') return '#666';
    if (s.state === 'fallen' || s.state === 'seizure' || b.salud < 0.3) return '#ff5a7a';
    if (s.state === 'act' && s.activity === 'cama' && !s.insomnia) return '#8fa8ff';
    if (b.abstinencia > 0.5) return '#ff8a4d';
    if (Math.max(b.E('etanol'), b.E('nicotina'), b.E('cocaina')) > 0.45) return '#ffc640';
    return '#7affc1';
  }

  setBar(id, v, signed = false) {
    const el = document.getElementById('nb_' + id);
    if (!el) return;
    const i = el.firstChild;
    if (signed) {
      const x = clamp(v, -1, 1);
      i.style.left = x >= 0 ? '50%' : `${50 + x * 50}%`;
      i.style.width = `${Math.abs(x) * 50}%`;
      i.className = x >= 0 ? 'pos' : 'neg';
    } else {
      i.style.width = `${clamp(v) * 100}%`;
    }
  }

  updateNeuralBars() {
    const d = this.drive, rates = this.brainView.groupRates();
    for (const [k] of INPUT_ROWS) this.setBar('in_' + k, rates[k] ?? d[k]);
    for (const [k] of POP_ROWS) this.setBar('pop_' + k, rates[k] ?? d[k]);
    const w = this.sim.state === 'free' ? this.sim.weights : {};
    for (const id of this.world.stations.keys()) {
      this.setBar('sel_' + id, (w[id] ?? 0) * this.sim.motivation);
      document.getElementById('nb_sel_' + id)?.parentElement.classList.toggle('goal', this.sim.state === 'free' && this.sim.goal === id);
    }
    for (const c of this.dnCells) this.setBar('dn_' + c.i, (c.rate - 0.15) / 0.85, true);
    for (const [k] of OUT_ROWS) this.setBar('out_' + k, d[k], k === 'turn');
    const b = this.brain;
    const fxHtml = this.cloudEffects().map(f => Array.isArray(f) ? `<span style="--c:${f[0]}">${f[1]}</span>` : `<span>${f}</span>`).join('');
    const fxEl = $('#brainFx');
    if (fxEl.innerHTML !== fxHtml) fxEl.innerHTML = fxHtml;
    $('#rwPhasic').textContent = b.phasic.toFixed(2);
    const rpe = $('#rwRPE');
    rpe.textContent = `${b.lastRPE >= 0 ? '+' : ''}${b.lastRPE.toFixed(2)}`;
    rpe.className = b.lastRPE >= 0 ? 'pos' : 'neg';
    $('#rwSens').textContent = b.sens.toFixed(2);
  }

  drawSeries() {
    const g = this.sctx, W = this.sw, H = this.sh, h = this.brain.hist;
    g.clearRect(0, 0, W, H);
    g.strokeStyle = 'rgba(255,255,255,0.07)'; g.lineWidth = 1;
    for (let k = 1; k < 4; k++) { const y = (H * k) / 4; g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); }
    for (const [key, , col, scale] of SERIES) {
      const arr = h[key];
      g.strokeStyle = col; g.lineWidth = key === 'da' ? 1.8 : 1.3;
      g.beginPath();
      arr.forEach((v, i) => {
        const x = (i / (arr.length - 1)) * W, y = H - 2 - clamp(v / scale) * (H - 4);
        i ? g.lineTo(x, y) : g.moveTo(x, y);
      });
      g.stroke();
    }
  }

  updateMood() {
    const el = this.moodEl, s = this.sim;
    const p = this.fly.root.position.clone();
    p.y += 2.8;
    p.project(this.camera);
    if (p.z > 1 || Math.abs(p.x) > 1.1 || Math.abs(p.y) > 1.1) { el.classList.remove('show'); return; }
    el.style.transform = `translate(${(p.x * 0.5 + 0.5) * innerWidth}px, ${(-p.y * 0.5 + 0.5) * innerHeight}px) translate(-50%, -100%)`;
    const e = s.mood();
    if (el.textContent !== e) el.textContent = e;
    el.classList.add('show');
  }

  showDeath() {
    this.deathShown = true;
    const st = this.brain.stats;
    $('#deathCause').textContent = this.sim.deathMsg;
    $('#deathStats').innerHTML = [
      `Supervivencia <b>${fmtTime(st.vivo)}</b>`,
      `<b>${st.shots}</b> consumos de etanol · <b>${st.cigarros}</b> cigarros · <b>${st.lineas}</b> líneas`,
      `<b>${st.tiradas}</b> tiradas · apostó <b>${st.fichasPerdidas}</b> · ganó <b>${st.fichasGanadas}</b>`,
      `<b>${st.reels}</b> reels · ${fmtTime(st.tiempoReels)} de exposición`,
    ].map(x => `<li>${x}</li>`).join('');
    setTimeout(() => { if (this.deathShown) $('#death').hidden = false; }, 1800);
  }
}
