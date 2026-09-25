// Panel del cerebro: nube de somas de FlyWire (FAFB v783) + circuito real de 70 neuronas.
// Anatomia y conectividad son datos reales; la actividad la maneja el modelo fenomenologico.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const fmt = (n) => n.toLocaleString('es');

const CLASS_COLORS = { optic: 0x5fa8c8, central: 0x9fb4cc, descending: 0xffffff, ascending: 0x9c8fd0, sensory: 0x7fb08f, motor: 0xe0c070 };
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
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.setClearColor(0x05070a, 1);
    this.renderer = renderer;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(32, 1.5, 10, 6000);
    this.camera.position.set(0, 30, 1040);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.enablePan = false;
    this.controls.minDistance = 600;
    this.controls.maxDistance = 2600;
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
    this.uniforms = {
      uTime: { value: 0 }, uPR: { value: Math.min(devicePixelRatio, 2) },
      uVis: { value: 0 }, uOrnL: { value: 0 }, uOrnR: { value: 0 }, uKC: { value: 0 }, uDA: { value: 0 },
      uSleep: { value: 0 }, uDN: { value: 0 }, uMBON: { value: 0 }, uEth: { value: 0 }, uNic: { value: 0 }, uCoc: { value: 0 },
    };
    this.cloud = new THREE.Points(pg, new THREE.ShaderMaterial({
      uniforms: this.uniforms, vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
      vertexShader: /* glsl */`
        attribute float aReg, aNt, aSide, aRand;
        uniform float uTime, uPR, uVis, uOrnL, uOrnR, uKC, uDA, uSleep, uDN, uMBON, uEth, uNic, uCoc;
        varying vec3 vColor;
        float hash(float x) { return fract(sin(x) * 43758.5453); }
        void main() {
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          float sed = (1.0 - 0.6 * uEth) * (1.0 - 0.75 * uSleep); // sedacion por etanol y sueño
          vec3 add = vec3(0.0);
          float a = 0.0, k;
          // Actividad por region
          if (aReg == 1.0) {                          // lobulo optico: ondas de flujo optico
            float w = 0.5 + 0.5 * sin(position.x * 0.03 + position.y * 0.01 - uTime * 7.0 + aRand * 1.2);
            k = uVis * smoothstep(0.7, 1.0, w) * sed; add += vec3(0.35, 0.8, 1.0) * k * 0.8; a = max(a, k * 0.8);
          } else if (aReg == 2.0) {                   // celulas de Kenyon: codigo disperso; blanco de la dopamina
            k = step(hash(aRand * 91.7 + floor(uTime * 5.0 + aRand * 4.0)), uKC * 0.5) * sed;
            add += vec3(0.75, 0.55, 1.0) * k; a = max(a, k);
            float dk = uCoc * (0.55 + 0.45 * sin(uTime * 4.0 + aRand * 20.0));
            add += vec3(1.0, 0.62, 0.18) * dk * 1.4; a = max(a, dk);
          } else if (aReg == 3.0) {                   // dopaminergicas (PAM/PPL): dopamina, sostenida por cocaina
            k = clamp(uDA + uCoc * 1.5, 0.0, 1.0) * (0.75 + 0.25 * sin(uTime * 6.0 + aRand * 30.0));
            add += vec3(1.0, 0.62, 0.18) * k * 3.0; a = max(a, k * 1.6);
          } else if (aReg == 4.0) {                   // lobulo antenal: lado de la antena que capta el olor
            k = (aSide < 0.5 ? uOrnL : aSide < 1.5 ? uOrnR : 0.5 * (uOrnL + uOrnR)) * sed;
            add += vec3(0.5, 1.0, 0.45) * k; a = max(a, k);
          } else if (aReg == 5.0) {                   // complejo central: sueño (dFB); tambien recibe dopamina
            k = uSleep * (0.7 + 0.3 * sin(uTime * 1.5 + aRand * 6.0)); add += vec3(0.45, 0.55, 1.0) * k * 2.4; a = max(a, k * 1.3);
            float dk = uCoc * 0.7 * (0.6 + 0.4 * sin(uTime * 4.0 + aRand * 20.0));
            add += vec3(1.0, 0.62, 0.18) * dk * 1.4; a = max(a, dk);
          } else if (aReg == 6.0) {                   // descendentes: salida motora / escape
            k = uDN; add += vec3(1.0) * k; a = max(a, k);
          } else if (aReg == 7.0) {                   // MBON: ansia / valor
            k = uMBON; add += vec3(1.0, 0.8, 0.4) * k; a = max(a, k);
          }
          // Farmacologia por neurotransmisor
          float flick = 0.5 + 0.5 * sin(uTime * 9.0 + aRand * 60.0);
          if (aNt == 0.0) {                           // colinergicas: receptores nicotinicos
            k = uNic * flick * step(0.82, aRand); add += vec3(1.0, 0.5, 0.2) * k * 0.6; a = max(a, k * 0.6);
          } else if (aNt == 2.0) {                    // GABAergicas: potenciadas por etanol
            k = uEth * (0.6 + 0.4 * flick) * step(0.45, aRand); add += vec3(0.7, 0.4, 1.0) * k * 0.55; a = max(a, k * 0.6);
          } else if (aNt == 3.0) {                    // dopamina predicha: bloqueo del transportador
            k = uCoc * (0.7 + 0.3 * flick); add += vec3(1.0, 0.62, 0.18) * k * 1.1; a = max(a, k);
          }
          vColor = color * 0.07 * sed + add * 0.5;
          gl_PointSize = (1.2 + 3.2 * clamp(a, 0.0, 1.6)) * uPR;
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
      return { ...c, i, p, color, sprite, rate: 0, flash: 0, jitter: 0.75 + Math.random() * 0.5 };
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
    const map = { vis: 'uVis', ornL: 'uOrnL', ornR: 'uOrnR', kc: 'uKC', da: 'uDA', sleep: 'uSleep', dn: 'uDN', mbon: 'uMBON', eth: 'uEth', nic: 'uNic', coc: 'uCoc' };
    for (const [k, name] of Object.entries(map)) {
      const target = Math.min(1, Math.max(0, st[k] ?? 0));
      u[name].value += (target - u[name].value) * 0.15;
    }
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
