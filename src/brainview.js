// Panel del cerebro: nube de somas del MaleCNS v1.0 (sistema nervioso central completo) + circuito de 70 neuronas.
// Anatomia y conectividad son datos reales; la actividad la maneja el modelo fenomenologico.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const fmt = (n) => n.toLocaleString('es');

const CLASS_COLORS = { optic: 0x5fa8c8, central: 0x9fb4cc, descending: 0xffffff, ascending: 0x9c8fd0, sensory: 0x7fb08f, motor: 0xe0c070, vnc: 0x6fb89a };
const SIGN_COLORS = { 1: 0xff4d4d, '-1': 0x4da3ff, 0: 0xffb340 };

export const GROUPS = {
  GRN: 'GRN azúcar', ORN: 'ORN olfato', PN: 'PN antenal', T4T5: 'T4/T5 movimiento', LPLC2: 'LPLC2 looming',
  KC: 'Kenyon (KC)', PAM: 'PAM · DA recompensa', PPL1: 'PPL1 · DA castigo', MBON: 'MBON', dFB: 'dFB (FB6) sueño', DN: 'descendentes',
};

function glowTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.25, 'rgba(255,255,255,0.85)');
  gr.addColorStop(0.5, 'rgba(255,255,255,0.25)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

export class BrainView {
  static async load(canvas, base = 'assets/') {
    const [bin, meta] = await Promise.all([
      fetch(base + 'brain_points.bin').then(r => r.arrayBuffer()),
      fetch(base + 'brain_circuit.json').then(r => r.json()),
    ]);
    return new BrainView(canvas, bin, meta);
  }

  constructor(canvas, bin, meta) {
    this.meta = meta;
    this.canvas = canvas;
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.setPixelRatio(devicePixelRatio);
    renderer.setClearColor(0x05070a, 1);
    this.renderer = renderer;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(32, 1.5, 10, 6000);
    this.camera.position.set(1150, 600, 1550);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.enablePan = false;
    this.controls.minDistance = 600;
    this.controls.maxDistance = 3200;
    this.controls.autoRotate = true;
    this.controls.autoRotateSpeed = 0.35;
    this.root = new THREE.Group();
    this.scene.add(this.root);

    // Nube de somas: cada punto sabe su region, su neurotransmisor y su hemisferio
    const n = new Uint32Array(bin, 0, 1)[0];
    const q = new Int16Array(bin, 4, n * 3);
    const cls = new Uint8Array(bin, 4 + n * 6, n);
    const reg = new Uint8Array(bin, 4 + n * 7, n);
    const nt = new Uint8Array(bin, 4 + n * 8, n);
    const side = new Uint8Array(bin, 4 + n * 9, n);
    const pos = new Float32Array(n * 3), col = new Float32Array(n * 3);
    const aReg = new Float32Array(n), aNt = new Float32Array(n), aSide = new Float32Array(n), aRand = new Float32Array(n);
    const palette = meta.classes.map(([k]) => new THREE.Color(CLASS_COLORS[k] ?? 0x445566));
    for (let i = 0; i < n; i++) {
      pos[i * 3] = q[i * 3] / 10; pos[i * 3 + 1] = -q[i * 3 + 1] / 10; pos[i * 3 + 2] = -q[i * 3 + 2] / 10;
      const c = palette[cls[i]];
      const j = 0.75 + Math.random() * 0.5;
      col[i * 3] = c.r * j; col[i * 3 + 1] = c.g * j; col[i * 3 + 2] = c.b * j;
      aReg[i] = reg[i]; aNt[i] = nt[i]; aSide[i] = side[i]; aRand[i] = Math.random();
    }
    const pg = new THREE.BufferGeometry();
    pg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    pg.setAttribute('color', new THREE.BufferAttribute(col, 3));
    pg.setAttribute('aReg', new THREE.BufferAttribute(aReg, 1));
    pg.setAttribute('aNt', new THREE.BufferAttribute(aNt, 1));
    pg.setAttribute('aSide', new THREE.BufferAttribute(aSide, 1));
    pg.setAttribute('aRand', new THREE.BufferAttribute(aRand, 1));
    this.actAttr = new THREE.BufferAttribute(new Uint8Array(n), 1, true);
    this.actAttr.setUsage(THREE.DynamicDrawUsage);
    pg.setAttribute('aAct', this.actAttr);
    this.uniforms = {
      uTime: { value: 0 }, uPR: { value: Math.min(devicePixelRatio, 2) },
      uVis: { value: 0 }, uOrnL: { value: 0 }, uOrnR: { value: 0 }, uKC: { value: 0 }, uDA: { value: 0 },
      uSleep: { value: 0 }, uDN: { value: 0 }, uMBON: { value: 0 }, uWalk: { value: 0 }, uEth: { value: 0 }, uNic: { value: 0 }, uCoc: { value: 0 },
    };
    this.cloud = new THREE.Points(pg, new THREE.ShaderMaterial({
      uniforms: this.uniforms, vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
      vertexShader: /* glsl */`
        attribute float aNt, aAct;
        uniform float uPR;
        varying vec3 vColor;
        void main() {
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          // color del disparo segun el neurotransmisor de la neurona
          vec3 hot = aNt == 0.0 ? vec3(1.0, 0.72, 0.42)      // acetilcolina
                   : aNt == 1.0 ? vec3(0.35, 0.95, 0.8)      // glutamato
                   : aNt == 2.0 ? vec3(0.7, 0.45, 1.0)       // GABA
                   : aNt == 3.0 ? vec3(1.0, 0.6, 0.12)       // dopamina
                   : aNt == 6.0 ? vec3(0.45, 0.7, 1.0)       // histamina
                   : vec3(0.85);
          float a = aAct;                                    // traza de disparo real (0..1)
          vColor = color * 0.07 + hot * a * 1.1;
          gl_PointSize = (1.2 + 3.4 * a) * uPR;
        }`,
      fragmentShader: /* glsl */`
        varying vec3 vColor;
        void main() {
          vec2 c = gl_PointCoord - 0.5;
          if (dot(c, c) > 0.25) discard;
          gl_FragColor = vec4(vColor, 1.0);
        }`,
    }));
    this.root.add(this.cloud);

    // Circuito
    const tex = glowTexture();
    this.cells = meta.cells.map((c, i) => {
      const p = new THREE.Vector3(c.pos[0], -c.pos[1], -c.pos[2]);
      const color = new THREE.Color(SIGN_COLORS[c.sign]);
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false }));
      sprite.position.copy(p);
      this.root.add(sprite);
      return { ...c, i, p, color, sprite, rate: 0, flash: 0, jitter: 1 };
    });
    const maxSyn = Math.max(...meta.edges.map(e => e[2]));
    this.edges = meta.edges.map(([a, b, syn, sign]) => ({ a, b, syn, sign, w: 0.25 + 0.75 * Math.sqrt(syn / maxSyn) }));
    const ep = new Float32Array(this.edges.length * 6);
    this.edges.forEach((e, k) => {
      this.cells[e.a].p.toArray(ep, k * 6);
      this.cells[e.b].p.toArray(ep, k * 6 + 3);
    });
    const eg = new THREE.BufferGeometry();
    eg.setAttribute('position', new THREE.BufferAttribute(ep, 3));
    this.edgeColors = new THREE.BufferAttribute(new Float32Array(this.edges.length * 6), 3);
    eg.setAttribute('color', this.edgeColors);
    this.lines = new THREE.LineSegments(eg, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false }));
    this.root.add(this.lines);

    // Pulsos que viajan por las aristas
    this.maxPulses = 260;
    this.pulses = [];
    const pp = new Float32Array(this.maxPulses * 3), pc = new Float32Array(this.maxPulses * 3);
    const pgeo = new THREE.BufferGeometry();
    pgeo.setAttribute('position', new THREE.BufferAttribute(pp, 3));
    pgeo.setAttribute('color', new THREE.BufferAttribute(pc, 3));
    this.pulsePoints = new THREE.Points(pgeo, new THREE.PointsMaterial({
      size: 3.2, sizeAttenuation: false, vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false,
    }));
    this.root.add(this.pulsePoints);
    this.outEdges = this.cells.map(() => []);
    this.edges.forEach((e, k) => this.outEdges[e.a].push(k));

    this.resize();
    addEventListener('resize', () => this.resize());
  }

  resize() {
    const w = this.canvas.clientWidth || 400, h = this.canvas.clientHeight || 260;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  /** Estado global para la nube: vis, ornL, ornR, kc, da, sleep, dn, mbon, eth, nic, coc (0..1). */
  setState(st) {
    const u = this.uniforms;
    const map = { vis: 'uVis', ornL: 'uOrnL', ornR: 'uOrnR', kc: 'uKC', da: 'uDA', sleep: 'uSleep', dn: 'uDN', mbon: 'uMBON', walk: 'uWalk', eth: 'uEth', nic: 'uNic', coc: 'uCoc' };
    for (const [k, name] of Object.entries(map)) {
      const target = Math.min(1, Math.max(0, st[k] ?? 0));
      u[name].value += (target - u[name].value) * 0.15;
    }
  }

  /** Traza de disparos real de la simulacion (una entrada por soma, 0..255). */
  setTrace(trace) {
    if (trace.length !== this.actAttr.array.length) return;
    this.actAttr.array.set(trace);
    this.actAttr.needsUpdate = true;
  }

  /** drive(cell) -> actividad objetivo 0..1 de cada neurona del circuito. */
  update(dt, drive) {
    this.uniforms.uTime.value += dt;
    const tmp = new THREE.Vector3();
    for (const c of this.cells) {
      const target = clamp(drive(c) * c.jitter);
      c.rate += (target - c.rate) * Math.min(1, dt * 6);
      if (Math.random() < c.rate * c.rate * 18 * dt + 0.01 * dt) {
        c.flash = 1;
        for (const k of this.outEdges[c.i]) {
          if (this.pulses.length >= this.maxPulses) break;
          if (Math.random() < 0.6) this.pulses.push({ k, t: 0 });
        }
      }
      c.flash = Math.max(0, c.flash - dt * 5);
      const s = 6 + c.rate * 30 + c.flash * 18;
      c.sprite.scale.set(s, s, 1);
      c.sprite.material.opacity = 0.1 + 0.7 * Math.max(c.rate, c.flash);
    }
    const col = this.edgeColors.array;
    const ec = new THREE.Color();
    this.edges.forEach((e, k) => {
      const pre = this.cells[e.a];
      ec.copy(pre.color).multiplyScalar((0.02 + 0.7 * pre.rate + 0.5 * pre.flash) * e.w);
      ec.toArray(col, k * 6); ec.toArray(col, k * 6 + 3);
    });
    this.edgeColors.needsUpdate = true;

    const pp = this.pulsePoints.geometry.attributes.position, pc = this.pulsePoints.geometry.attributes.color;
    this.pulses = this.pulses.filter(p => (p.t += dt * 2.2) < 1);
    for (let i = 0; i < this.maxPulses; i++) {
      const p = this.pulses[i];
      if (!p) { pp.setXYZ(i, 0, 0, 0); pc.setXYZ(i, 0, 0, 0); continue; }
      const e = this.edges[p.k];
      tmp.lerpVectors(this.cells[e.a].p, this.cells[e.b].p, p.t);
      pp.setXYZ(i, tmp.x, tmp.y, tmp.z);
      const c = this.cells[e.a].color, f = 1 - p.t * 0.6;
      pc.setXYZ(i, c.r * f + 0.3, c.g * f + 0.3, c.b * f + 0.3);
    }
    pp.needsUpdate = true; pc.needsUpdate = true;

    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }

  /** Actividad media por grupo (para las barras). */
  groupRates() {
    const acc = {};
    for (const c of this.cells) {
      acc[c.group] ??= [0, 0];
      acc[c.group][0] += c.rate; acc[c.group][1]++;
    }
    return Object.fromEntries(Object.entries(acc).map(([g, [s, n]]) => [g, s / n]));
  }
}
