// "Fly Vegas": mesa de casino con estaciones de vicios. Todo procedural (sin assets externos).
// Unidades: mm (la mosca mide ~3). Y arriba. Cada estacion mira hacia el centro con su +Z local.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { slotOutcome } from './slots.js';

const V3 = THREE.Vector3;
const TAU = Math.PI * 2;
export const EMOJI_FONT = '"Segoe UI Emoji","Apple Color Emoji","Noto Color Emoji",sans-serif';
const TABLE_R = 115;
const STATION_R = 68;

function canvasTex(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  if (draw) draw(g, w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  t.userData.ctx = g;
  return t;
}

function glow(color, intensity = 2) {
  return new THREE.MeshStandardMaterial({ color: 0x000000, emissive: color, emissiveIntensity: intensity, roughness: 0.4 });
}

function radialSprite(inner = 'rgba(255,255,255,1)', outer = 'rgba(255,255,255,0)') {
  return canvasTex(64, 64, (g) => {
    const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, inner); gr.addColorStop(1, outer);
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  });
}

const rand = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const mod = (a, n) => ((a % n) + n) % n;

function shadowAll(obj, cast = true, receive = true) {
  obj.traverse(o => { if (o.isMesh) { o.castShadow = cast; o.receiveShadow = receive; } });
  return obj;
}

// ---------------------------------------------------------------- Tragamonedas
const SYMBOLS = ['🍒', '🍋', '🔔', '🍌', '💎', '🪰', '7️⃣'];

export class SlotMachine {
  constructor() {
    this.reels = [0, 1, 2].map(() => ({ pos: Math.floor(Math.random() * 7), final: 0, stop: 0, spinning: false }));
    this.tex = canvasTex(512, 256);
    this.t = 0;
    this.current = null;
    this.flash = 0;
    this.msg = '';
    this.draw();
  }

  spin(bet, opts = {}) {
    const { res, kind, mult } = slotOutcome(opts);
    const suspense = res[0] === res[1] ? 0.7 : 0;
    this.reels.forEach((reel, i) => {
      reel.spinning = true;
      reel.final = res[i];
      reel.stop = 0.7 + 0.35 * i + (i === 2 ? suspense : 0);
    });
    this.t = 0;
    this.flash = 0;
    this.msg = '';
    this.current = { bet, res, kind, mult, payout: bet * mult, done: false };
    return this.current;
  }

  update(dt) {
    if (this.current && !this.current.done) {
      this.t += dt;
      let all = true;
      for (const reel of this.reels) {
        if (!reel.spinning) continue;
        if (this.t >= reel.stop) {
          reel.spinning = false;
          reel.pos = reel.final;
        } else {
          reel.pos += dt * 16;
          all = false;
        }
      }
      if (all) {
        this.current.done = true;
        const k = this.current.kind;
        this.msg = k === 'jackpot' ? 'JACKPOT!!' : k === 'triple' ? `WIN x${this.current.mult}` : k === 'pair' ? 'WIN x2' : k === 'near' ? '¡CASI!' : '';
        this.flash = this.msg ? 2.5 : 0;
      }
    }
    this.flash = Math.max(0, this.flash - dt);
  }

  /** Dibuja como maximo a 30 fps segun el tiempo real (independiente de la velocidad de simulacion). */
  render(realDt) {
    this._acc = (this._acc || 0) + realDt;
    if (this._acc > 1 / 30) { this._acc = 0; this.draw(); }
  }

  draw() {
    const g = this.tex.userData.ctx, W = 512, H = 256;
    const bg = g.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, '#2a0033'); bg.addColorStop(1, '#0a0010');
    g.fillStyle = bg; g.fillRect(0, 0, W, H);
    const rowH = 84, winW = 142, gap = 17, top = 20, winH = H - 40;
    g.font = `64px ${EMOJI_FONT}`;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    this.reels.forEach((reel, i) => {
      const x = gap + i * (winW + gap);
      const wg = g.createLinearGradient(0, top, 0, top + winH);
      wg.addColorStop(0, '#8d8d9a'); wg.addColorStop(0.5, '#ffffff'); wg.addColorStop(1, '#8d8d9a');
      g.save();
      g.beginPath(); g.roundRect(x, top, winW, winH, 14); g.fillStyle = wg; g.fill(); g.clip();
      const base = Math.floor(reel.pos), frac = reel.pos - base;
      const cy = top + winH / 2;
      for (let k = -2; k <= 2; k++) {
        const y = cy + (k - frac) * rowH;
        g.globalAlpha = reel.spinning ? 0.75 : 1;
        g.fillText(SYMBOLS[mod(base + k, 7)], x + winW / 2, y + 4);
      }
      g.restore();
    });
    g.globalAlpha = 1;
    g.strokeStyle = 'rgba(255,40,80,0.9)'; g.lineWidth = 4;
    g.beginPath(); g.moveTo(6, H / 2); g.lineTo(W - 6, H / 2); g.stroke();
    if (this.flash > 0 && Math.floor(this.flash * 6) % 2 === 0) {
      g.font = '800 64px Rubik, system-ui, sans-serif';
      g.lineWidth = 10; g.strokeStyle = '#000';
      g.fillStyle = this.msg === '¡CASI!' ? '#ffb000' : '#ffe600';
      g.shadowColor = '#ff2bd6'; g.shadowBlur = 24;
      g.strokeText(this.msg, W / 2, H / 2); g.fillText(this.msg, W / 2, H / 2);
      g.shadowBlur = 0;
    }
    this.tex.needsUpdate = true;
  }
}

// ---------------------------------------------------------------- Reels
// Clips de alta saliencia, sin texto: cortes rapidos, color saturado, flujo optico y un "payoff".
// Cada clip declara su energia de movimiento (estimulo para T4/T5) y emite recompensas en sus
// momentos de resolucion (explosion, corte, aplastamiento...). La viralidad escala esas recompensas
// con una distribucion de cola pesada: la mayoria de clips rinde poco y unos pocos rinden mucho.
const RW = 288, RH = 600;
const clamp01 = (x) => Math.min(1, Math.max(0, x));
const hsl = (h, s = 90, l = 60, a = 1) => `hsla(${mod(h, 360)},${s}%,${l}%,${a})`;

function burst(list, x, y, n, hue, speed = 220, size = 4) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * TAU, v = speed * (0.25 + Math.random());
    list.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: rand(0.5, 1.2), h: hue + rand(-35, 35), s: size * rand(0.5, 1.4) });
  }
}
function stepParticles(list, dt, grav = 500) {
  for (const p of list) { p.life -= dt; p.vy += grav * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 0.99; }
  for (let i = list.length - 1; i >= 0; i--) if (list[i].life <= 0) list.splice(i, 1);
}
function drawParticles(c, list, l = 62) {
  c.globalCompositeOperation = 'lighter';
  for (const p of list) {
    c.globalAlpha = clamp01(p.life * 1.5);
    c.fillStyle = hsl(p.h, 95, l);
    c.beginPath(); c.arc(p.x, p.y, p.s, 0, TAU); c.fill();
  }
  c.globalAlpha = 1;
  c.globalCompositeOperation = 'source-over';
}
function flashRect(c, w, h, k, col = '255,255,255') {
  if (k > 0) { c.fillStyle = `rgba(${col},${Math.min(0.75, k)})`; c.fillRect(0, 0, w, h); }
}

// Bola que rebota dentro de un aro, crece con cada rebote y estalla
function clipBounce(w, h, emit) {
  const R = Math.min(w, h) * 0.42, cx = w / 2, cy = h * 0.5;
  const pay = rand(2.2, 3.2);
  const s = { x: cx + rand(-15, 15), y: cy - R * 0.5, vx: rand(-220, 220), vy: 0, r: 7, hue: rand(0, 360), hits: [], trail: [], parts: [], boom: false, flash: 0 };
  return {
    motion: 0.55, hue: s.hue, dur: pay + 1.0,
    update(dt, t) {
      if (!s.boom) {
        s.r = 7 + (R * 0.8 - 7) * Math.pow(Math.min(1, t / pay), 1.7);
        for (let k = 0; k < 4; k++) {
          const d = dt / 4;
          s.vy += 1100 * d; s.x += s.vx * d; s.y += s.vy * d;
          const dx = s.x - cx, dy = s.y - cy, dist = Math.hypot(dx, dy) || 1;
          if (dist + s.r > R) {
            const nx = dx / dist, ny = dy / dist;
            s.x = cx + nx * (R - s.r); s.y = cy + ny * (R - s.r);
            const dot = s.vx * nx + s.vy * ny;
            if (dot > 0) {
              s.vx = (s.vx - 2 * dot * nx) * 1.02; s.vy = (s.vy - 2 * dot * ny) * 1.02;
              const sp = Math.hypot(s.vx, s.vy);
              if (sp < 520) { s.vx *= 520 / sp; s.vy *= 520 / sp; }
              if (sp > 1100) { s.vx *= 1100 / sp; s.vy *= 1100 / sp; }
              s.hue += 29; s.flash = 0.35;
              s.hits.push({ x: cx + nx * R, y: cy + ny * R, h: s.hue });
              if (s.hits.length > 48) s.hits.shift();
              burst(s.parts, cx + nx * R, cy + ny * R, 7, s.hue, 140, 2.2);
              emit(0.015);
            }
          }
        }
        s.trail.push({ x: s.x, y: s.y, r: s.r, h: s.hue });
        if (s.trail.length > 12) s.trail.shift();
        if (t >= pay) { s.boom = true; burst(s.parts, s.x, s.y, 140, s.hue, 460, 4.5); s.flash = 1.6; emit(0.6); }
      }
      s.flash = Math.max(0, s.flash - dt * 3);
      stepParticles(s.parts, dt, 250);
    },
    draw(c) {
      const bg = c.createRadialGradient(cx, cy, 10, cx, cy, h * 0.7);
      bg.addColorStop(0, hsl(s.hue + 180, 60, 10)); bg.addColorStop(1, '#030206');
      c.fillStyle = bg; c.fillRect(0, 0, w, h);
      c.lineWidth = 6; c.strokeStyle = hsl(s.hue, 100, 62);
      c.shadowColor = hsl(s.hue); c.shadowBlur = 20;
      c.beginPath(); c.arc(cx, cy, R, 0, TAU); c.stroke();
      c.shadowBlur = 0;
      if (!s.boom) {
        c.lineWidth = 1.3;
        c.globalCompositeOperation = 'lighter';
        for (const p of s.hits) { c.strokeStyle = hsl(p.h, 95, 60, 0.5); c.beginPath(); c.moveTo(p.x, p.y); c.lineTo(s.x, s.y); c.stroke(); }
        s.trail.forEach((p, i) => { c.globalAlpha = (i / s.trail.length) * 0.4; c.fillStyle = hsl(p.h, 95, 55); c.beginPath(); c.arc(p.x, p.y, p.r, 0, TAU); c.fill(); });
        c.globalAlpha = 1;
        c.globalCompositeOperation = 'source-over';
        const gr = c.createRadialGradient(s.x - s.r * 0.35, s.y - s.r * 0.35, 1, s.x, s.y, s.r);
        gr.addColorStop(0, '#fff'); gr.addColorStop(0.3, hsl(s.hue, 100, 66)); gr.addColorStop(1, hsl(s.hue + 50, 90, 32));
        c.fillStyle = gr; c.beginPath(); c.arc(s.x, s.y, s.r, 0, TAU); c.fill();
      }
      drawParticles(c, s.parts);
      flashRect(c, w, h, s.flash * 0.45);
    },
  };
}

// Arena cinetica en capas cortada en rebanadas
function clipSand(w, h, emit) {
  const pal = ['#ff7eb6', '#ffd166', '#7af0c1', '#78b8ff', '#c38bff', '#ff9e6b', '#f5f06a'].sort(() => Math.random() - 0.5);
  const bw = w * 0.74, bh = h * 0.36, x0 = (w - bw) / 2, yb = h * 0.7, y0 = yb - bh;
  const layers = 6, sw = bw / 8, period = rand(0.5, 0.62), cuts = 5;
  const grain = Array.from({ length: 420 }, () => [Math.random(), Math.random(), Math.random() < 0.5]);
  const s = { right: x0 + bw, done: 0, slices: [], crumbs: [], shake: 0 };
  const dur = period * cuts + 0.9;
  const band = (c, x, y, ww, flip = false) => {
    for (let i = 0; i < layers; i++) {
      c.fillStyle = pal[(flip ? layers - 1 - i : i) % pal.length];
      c.fillRect(x, y + (i * bh) / layers, ww, bh / layers + 0.5);
    }
  };
  return {
    motion: 0.3, hue: 320, dur,
    update(dt, t) {
      const k = Math.floor(t / period);
      if (k > s.done && s.done < cuts) {
        s.done++;
        const last = s.done === cuts;
        s.slices.push({ x: s.right - sw, w: sw, rot: 0, vr: 0, fade: 1 });
        for (let i = 0; i < 26; i++) {
          const layer = Math.floor(Math.random() * layers);
          s.crumbs.push({ x: s.right - sw * 0.5 + rand(-4, 4), y: y0 + (layer + 0.5) * bh / layers, vx: rand(20, 140), vy: rand(-120, 20), life: rand(0.6, 1.2), c: pal[layer % pal.length], s: rand(1.5, 3.5) });
        }
        s.right -= sw;
        s.shake = last ? 0.25 : 0.08;
        emit(last ? 0.45 : 0.1);
      }
      for (const sl of s.slices) {
        sl.vr += 7 * dt; sl.rot = Math.min(Math.PI / 2, sl.rot + sl.vr * dt);
        if (sl.rot >= Math.PI / 2) sl.fade -= dt * 0.8;
      }
      s.slices = s.slices.filter(sl => sl.fade > 0);
      for (const p of s.crumbs) { p.life -= dt; p.vy += 600 * dt; p.x += p.vx * dt; p.y = Math.min(yb, p.y + p.vy * dt); }
      s.crumbs = s.crumbs.filter(p => p.life > 0);
      s.shake = Math.max(0, s.shake - dt);
      s.t = t;
    },
    draw(c) {
      const g = c.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, '#fbe9ff'); g.addColorStop(1, '#d8c7f0');
      c.fillStyle = g; c.fillRect(0, 0, w, h);
      c.save();
      if (s.shake > 0) c.translate(rand(-3, 3) * s.shake * 10, rand(-3, 3) * s.shake * 10);
      c.fillStyle = 'rgba(80,40,120,0.18)';
      c.beginPath(); c.ellipse(w / 2, yb + 6, bw * 0.62, 16, 0, 0, TAU); c.fill();
      band(c, x0, y0, s.right - x0);
      c.fillStyle = 'rgba(60,20,60,0.25)';
      for (const [gx, gy, dark] of grain) {
        const x = x0 + gx * bw;
        if (x > s.right) continue;
        c.fillStyle = dark ? 'rgba(60,20,70,0.22)' : 'rgba(255,255,255,0.5)';
        c.fillRect(x, y0 + gy * bh, 1.4, 1.4);
      }
      c.fillStyle = 'rgba(255,255,255,0.35)'; c.fillRect(x0, y0, s.right - x0, 3);
      for (const sl of s.slices) {
        c.save(); c.globalAlpha = clamp01(sl.fade);
        c.translate(sl.x + sl.w, yb); c.rotate(sl.rot);
        band(c, -sl.w, -bh, sl.w);
        c.fillStyle = 'rgba(255,255,255,0.25)'; c.fillRect(-sl.w, -bh, 3, bh);
        c.restore();
      }
      for (const p of s.crumbs) { c.fillStyle = p.c; c.fillRect(p.x, p.y, p.s, p.s); }
      // Cuchillo
      const ph = ((s.t || 0) % period) / period;
      const down = ph < 0.7 ? Math.sin((ph / 0.7) * Math.PI / 2) : 1 - (ph - 0.7) / 0.3;
      const ky = y0 - 110 + down * (bh + 110), kx = s.right - sw;
      if (s.done < cuts) {
        const kg = c.createLinearGradient(kx - 4, 0, kx + 4, 0);
        kg.addColorStop(0, '#9aa3b5'); kg.addColorStop(0.5, '#ffffff'); kg.addColorStop(1, '#7b8496');
        c.fillStyle = kg; c.fillRect(kx - 3, ky - 150, 6, 150);
        c.fillStyle = '#2b2233'; c.fillRect(kx - 6, ky - 200, 12, 52);
      }
      c.restore();
    },
  };
}

// Corredor infinito en perspectiva (el clasico de pantalla dividida)
function clipRunner(w, h, emit) {
  const vpX = w / 2, vpY = h * 0.3, baseY = h * 1.05, K = 2.4;
  const s = { z: 0, x: 0, lane: 0, speed: 15, coins: [], sparks: [], got: 0, hue: rand(0, 360), flash: 0 };
  for (let i = 0; i < 10; i++) s.coins.push({ lane: Math.floor(rand(-1, 2)), z: 5 + i * 2.4 });
  const proj = (x, z) => { const f = K / (Math.max(z, -1.8) + K); return [vpX + x * f * w * 0.3, vpY + (baseY - vpY) * f, f]; };
  return {
    motion: 0.9, hue: s.hue, dur: rand(3.5, 5),
    update(dt) {
      s.speed += dt * 2;
      s.z += s.speed * dt;
      const next = s.coins.filter(c => c.z > 0.5).sort((a, b) => a.z - b.z)[0];
      if (next && next.z < 6) s.lane = next.lane;
      s.x += (s.lane - s.x) * Math.min(1, dt * 12);
      for (const c of s.coins) {
        c.z -= s.speed * dt;
        if (!c.got && c.z < 0.4 && Math.abs(c.lane - s.x) < 0.5) {
          c.got = true; s.got++;
          const [px, py] = proj(s.x, 0.3);
          burst(s.sparks, px, py - 30, 12, 48, 180, 2.5);
          emit(s.got % 5 === 0 ? 0.25 : 0.03);
          if (s.got % 5 === 0) s.flash = 0.8;
        }
        if (c.z < -2) { c.z += 24; c.lane = Math.floor(rand(-1, 2)); c.got = false; }
      }
      stepParticles(s.sparks, dt, 400);
      s.flash = Math.max(0, s.flash - dt * 3);
    },
    draw(c) {
      const sky = c.createLinearGradient(0, 0, 0, vpY);
      sky.addColorStop(0, hsl(s.hue + 200, 80, 22)); sky.addColorStop(1, hsl(s.hue + 320, 90, 55));
      c.fillStyle = sky; c.fillRect(0, 0, w, vpY + 1);
      c.fillStyle = hsl(s.hue + 250, 40, 12); c.fillRect(0, vpY, w, h - vpY);
      // Edificios laterales
      for (let i = 0; i < 14; i++) {
        const z = i * 2 - (s.z % 2);
        for (const side of [-1, 1]) {
          const [x1, y1, f] = proj(side * 2.6, z), [x2] = proj(side * 4.2, z);
          const bh = (60 + ((i * 37) % 50)) * f * 3;
          c.fillStyle = hsl(s.hue + i * 23 + (side > 0 ? 40 : 0), 70, 30 + f * 20);
          c.fillRect(Math.min(x1, x2), y1 - bh, Math.abs(x2 - x1) + 1, bh);
        }
      }
      // Via
      const [lx0, ly0] = proj(-1.6, 30), [rx0] = proj(1.6, 30), [lx1, ly1] = proj(-1.6, -1.5), [rx1] = proj(1.6, -1.5);
      c.fillStyle = '#2a2233';
      c.beginPath(); c.moveTo(lx0, ly0); c.lineTo(rx0, ly0); c.lineTo(rx1, ly1); c.lineTo(lx1, ly1); c.fill();
      for (let i = 0; i < 24; i++) {
        const z = i * 1.2 - (s.z % 1.2);
        const [ax, ay, f] = proj(-1.6, z), [bx] = proj(1.6, z);
        c.fillStyle = `rgba(150,110,80,${0.25 + f * 0.4})`;
        c.fillRect(ax, ay, bx - ax, Math.max(1, f * 7));
      }
      c.strokeStyle = hsl(s.hue + 180, 100, 65); c.lineWidth = 2;
      for (const x of [-1.6, -0.5, 0.5, 1.6]) {
        const [ax, ay] = proj(x, 30), [bx, by] = proj(x, -1.5);
        c.beginPath(); c.moveTo(ax, ay); c.lineTo(bx, by); c.stroke();
      }
      // Monedas
      for (const cn of [...s.coins].sort((a, b) => b.z - a.z)) {
        if (cn.got || cn.z < -1) continue;
        const [x, y, f] = proj(cn.lane, cn.z);
        const r = 13 * f, spin = Math.abs(Math.sin(s.z * 0.8 + cn.z));
        c.fillStyle = '#ffcf33'; c.strokeStyle = '#b8860b'; c.lineWidth = Math.max(1, 2 * f);
        c.beginPath(); c.ellipse(x, y - r * 2.2, Math.max(1, r * spin), r, 0, 0, TAU); c.fill(); c.stroke();
      }
      // Corredor
      const [px, py, pf] = proj(s.x, 0.3);
      const bob = Math.abs(Math.sin(s.z * 1.6)) * 8;
      c.shadowColor = hsl(s.hue + 180); c.shadowBlur = 16;
      c.fillStyle = hsl(s.hue + 180, 95, 60);
      c.beginPath(); c.roundRect(px - 16 * pf, py - 70 * pf - bob, 32 * pf, 62 * pf, 10 * pf); c.fill();
      c.shadowBlur = 0;
      c.fillStyle = '#fff'; c.beginPath(); c.arc(px, py - 78 * pf - bob, 11 * pf, 0, TAU); c.fill();
      // Lineas de velocidad
      c.strokeStyle = 'rgba(255,255,255,0.22)'; c.lineWidth = 1.5;
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * TAU + s.z * 0.37, r0 = 60 + ((s.z * 90 + i * 50) % 220);
        c.beginPath(); c.moveTo(vpX + Math.cos(a) * r0, vpY + Math.sin(a) * r0); c.lineTo(vpX + Math.cos(a) * (r0 + 40), vpY + Math.sin(a) * (r0 + 40)); c.stroke();
      }
      drawParticles(c, s.sparks, 65);
      flashRect(c, w, h, s.flash * 0.4, '255,230,120');
    },
  };
}

// Tunel hipnotico: flujo optico radial con un "drop"
function clipTunnel(w, h, emit) {
  const drop = rand(1.5, 2.4), sides = pick([3, 4, 6, 8]);
  const s = { z: 0, rot: 0, flash: 0, dropped: false, hue: rand(0, 360) };
  return {
    motion: 1, hue: s.hue, dur: drop + rand(1.4, 2),
    update(dt, t) {
      const sp = s.dropped ? 5.5 : 1.6 + t * 0.5;
      s.z += sp * dt; s.rot += (s.dropped ? 2.4 : 0.7) * dt;
      if (!s.dropped && t >= drop) { s.dropped = true; s.flash = 1.4; emit(0.5); }
      s.flash = Math.max(0, s.flash - dt * 2.5);
    },
    draw(c, _w, _h, t) {
      const strobe = s.dropped && Math.floor(t * 12) % 2 === 0;
      c.fillStyle = strobe ? hsl(s.hue + 180, 80, 12) : '#020104';
      c.fillRect(0, 0, w, h);
      const cx = w / 2, cy = h / 2, fr = s.z % 1;
      c.globalCompositeOperation = 'lighter';
      for (let i = 26; i >= 1; i--) {
        const d = i - fr, r = 420 / (d + 0.4);
        if (r > h * 1.3) continue;
        const idx = i + Math.floor(s.z);
        c.strokeStyle = hsl(s.hue + idx * 23, 100, 58, Math.min(1, 1.6 - d / 20));
        c.lineWidth = Math.max(1, 26 / (d + 1));
        c.beginPath();
        for (let k = 0; k <= sides; k++) {
          const a = (k / sides) * TAU + s.rot + d * 0.12;
          const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
          k ? c.lineTo(x, y) : c.moveTo(x, y);
        }
        c.stroke();
      }
      const core = c.createRadialGradient(cx, cy, 0, cx, cy, 70);
      core.addColorStop(0, 'rgba(255,255,255,0.9)'); core.addColorStop(1, 'rgba(255,255,255,0)');
      c.fillStyle = core; c.fillRect(cx - 70, cy - 70, 140, 140);
      c.globalCompositeOperation = 'source-over';
      flashRect(c, w, h, s.flash * 0.5);
    },
  };
}

// Prensa hidraulica sobre una esfera de gelatina
function clipPress(w, h, emit) {
  const crush = rand(1.7, 2.4), yb = h * 0.76, r = Math.min(w * 0.26, h * 0.16), cx = w / 2;
  const s = { hue: rand(0, 360), burst: false, parts: [], shake: 0, flash: 0, plate: h * 0.06 };
  return {
    motion: 0.35, hue: s.hue, dur: crush + 1.2,
    update(dt, t) {
      const k = Math.min(1, t / crush);
      const target = yb - 2 * r * 0.2;
      s.plate = h * 0.06 + (target - h * 0.06) * (k < 0.75 ? k / 0.75 * 0.7 : 0.7 + (k - 0.75) / 0.25 * 0.3);
      if (!s.burst && t >= crush) {
        s.burst = true; s.shake = 0.5; s.flash = 1;
        burst(s.parts, cx, yb - r * 0.3, 130, s.hue, 420, 5);
        emit(0.55);
      }
      if (s.burst) s.plate = yb - 8;
      stepParticles(s.parts, dt, 700);
      for (const p of s.parts) if (p.y > yb) { p.y = yb; p.vy *= -0.2; p.vx *= 0.6; }
      s.shake = Math.max(0, s.shake - dt); s.flash = Math.max(0, s.flash - dt * 3);
    },
    draw(c) {
      const g = c.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, '#1d2230'); g.addColorStop(1, '#0c0e14');
      c.fillStyle = g; c.fillRect(0, 0, w, h);
      c.save();
      if (s.shake > 0) c.translate(rand(-8, 8) * s.shake, rand(-8, 8) * s.shake);
      c.fillStyle = '#39404f'; c.fillRect(cx - 16, 0, 32, s.plate - 34);
      const pg = c.createLinearGradient(0, s.plate - 36, 0, s.plate);
      pg.addColorStop(0, '#c9d1de'); pg.addColorStop(1, '#6f788a');
      c.fillStyle = pg; c.fillRect(w * 0.1, s.plate - 36, w * 0.8, 36);
      for (let i = 0; i < 8; i++) { c.fillStyle = i % 2 ? '#111' : '#ffcc00'; c.fillRect(w * 0.1 + i * w * 0.1, s.plate - 8, w * 0.1, 8); }
      c.fillStyle = '#4a5162'; c.fillRect(w * 0.06, yb, w * 0.88, h - yb);
      if (!s.burst) {
        const hgt = Math.min(2 * r, yb - s.plate), sy = hgt / (2 * r), sx = 1 / Math.sqrt(Math.max(0.2, sy));
        const gy = yb - hgt / 2;
        const gr = c.createRadialGradient(cx - r * 0.4 * sx, gy - r * 0.4 * sy, 2, cx, gy, r * Math.max(sx, sy));
        gr.addColorStop(0, '#ffffff'); gr.addColorStop(0.25, hsl(s.hue, 100, 70, 0.95)); gr.addColorStop(1, hsl(s.hue + 30, 90, 35, 0.95));
        c.fillStyle = gr; c.beginPath(); c.ellipse(cx, gy, r * sx, r * sy, 0, 0, TAU); c.fill();
      } else {
        c.fillStyle = hsl(s.hue, 90, 50, 0.9);
        c.beginPath(); c.ellipse(cx, yb - 3, r * 2.2, 7, 0, 0, TAU); c.fill();
      }
      drawParticles(c, s.parts, 58);
      c.restore();
      flashRect(c, w, h, s.flash * 0.5);
    },
  };
}

// Tablero de Galton: bolas que caen entre clavos y forman una binomial
function clipGalton(w, h, emit) {
  const rows = 10, dx = w / (rows + 3), dy = h * 0.045, top = h * 0.12, cx = w / 2;
  const binY = top + rows * dy + dy, binH = h * 0.92 - binY, stepT = 0.07;
  const s = { balls: [], bins: new Array(rows + 1).fill(0), spawn: 0, gold: rand(1.3, 2.0), goldDone: false, parts: [], hue: rand(0, 360), flash: 0 };
  const dur = rand(3.2, 4.2);
  const addBall = (t0, gold = false) => {
    const path = Array.from({ length: rows }, () => (Math.random() < 0.5 ? -1 : 1));
    s.balls.push({ t0, path, gold, landed: false, bin: (path.reduce((a, b) => a + b, 0) + rows) / 2 });
  };
  const ballPos = (b, t) => {
    const p = (t - b.t0) / stepT;
    if (p < 0) return null;
    if (p >= rows) return { x: cx + b.path.reduce((a, v) => a + v, 0) * dx / 2, y: binY + Math.min(1, (p - rows) * 0.25) * binH, done: p - rows > 4 };
    const i = Math.floor(p), f = p - i;
    let x = cx; for (let k = 0; k < i; k++) x += b.path[k] * dx / 2;
    return { x: x + b.path[i] * dx / 2 * f, y: top + (i + f) * dy - Math.sin(f * Math.PI) * dy * 0.45 };
  };
  return {
    motion: 0.45, hue: s.hue, dur,
    update(dt, t) {
      s.spawn -= dt;
      while (s.spawn <= 0 && t < dur - 1.2) { addBall(t); s.spawn += 0.03; }
      if (!s.goldDone && t >= s.gold) { s.goldDone = true; addBall(t, true); }
      for (const b of s.balls) {
        if (b.landed) continue;
        const p = ballPos(b, t);
        if (p && p.done) {
          b.landed = true; s.bins[b.bin]++;
          if (b.gold) {
            const central = Math.abs(b.bin - rows / 2) <= 1;
            burst(s.parts, p.x, h * 0.9 - s.bins[b.bin] * 5, 60, 48, 300, 3.5);
            s.flash = 0.8; emit(central ? 0.35 : 0.55);
          }
        }
      }
      stepParticles(s.parts, dt, 300);
      s.flash = Math.max(0, s.flash - dt * 2.5);
    },
    draw(c, _w, _h, t) {
      c.fillStyle = '#0b0a18'; c.fillRect(0, 0, w, h);
      c.fillStyle = 'rgba(255,255,255,0.75)';
      for (let i = 0; i < rows; i++) for (let k = 0; k <= i; k++) {
        c.beginPath(); c.arc(cx + (k - i / 2) * dx, top + i * dy + dy * 0.55, 2.2, 0, TAU); c.fill();
      }
      c.strokeStyle = 'rgba(255,255,255,0.2)'; c.lineWidth = 1;
      for (let k = 0; k <= rows + 1; k++) {
        const x = cx + (k - (rows + 1) / 2) * dx;
        c.beginPath(); c.moveTo(x, binY); c.lineTo(x, h * 0.92); c.stroke();
      }
      s.bins.forEach((n, k) => {
        const x = cx + (k - rows / 2) * dx;
        for (let j = 0; j < n; j++) {
          c.fillStyle = hsl(s.hue + k * 18, 90, 60);
          c.beginPath(); c.arc(x, h * 0.92 - 4 - j * 5, 3.2, 0, TAU); c.fill();
        }
      });
      for (const b of s.balls) {
        if (b.landed) continue;
        const p = ballPos(b, t);
        if (!p) continue;
        if (b.gold) {
          c.shadowColor = '#ffd23f'; c.shadowBlur = 16; c.fillStyle = '#ffd23f';
          c.beginPath(); c.arc(p.x, p.y, 6.5, 0, TAU); c.fill(); c.shadowBlur = 0;
        } else {
          c.fillStyle = hsl(s.hue + b.bin * 18, 90, 62);
          c.beginPath(); c.arc(p.x, p.y, 3.2, 0, TAU); c.fill();
        }
      }
      drawParticles(c, s.parts, 60);
      flashRect(c, w, h, s.flash * 0.35, '255,220,120');
    },
  };
}

// Fuegos artificiales a ritmo constante con un climax
function clipFireworks(w, h, emit) {
  const beat = rand(0.3, 0.4), climax = Math.floor(rand(6, 9));
  const s = { parts: [], beats: 0, pulse: 0, hue: rand(0, 360) };
  return {
    motion: 0.5, hue: s.hue, dur: beat * (climax + 2.5),
    update(dt, t) {
      while (t >= (s.beats + 1) * beat) {
        s.beats++;
        const big = s.beats === climax;
        const n = big ? 5 : 1;
        for (let i = 0; i < n; i++) burst(s.parts, rand(0.15, 0.85) * w, rand(0.15, 0.6) * h, big ? 110 : 80, s.hue + s.beats * 47 + i * 70, big ? 420 : 280, big ? 5 : 4);
        s.pulse = big ? 1.5 : 0.7;
        emit(big ? 0.5 : 0.04);
      }
      stepParticles(s.parts, dt, 160);
      s.pulse = Math.max(0, s.pulse - dt * 3);
    },
    draw(c) {
      c.fillStyle = hsl(s.hue + s.beats * 47, 70, 6 + s.pulse * 14);
      c.fillRect(0, 0, w, h);
      c.globalCompositeOperation = 'lighter';
      for (const p of s.parts) {
        c.globalAlpha = clamp01(p.life) * 0.25;
        c.fillStyle = hsl(p.h, 100, 60);
        c.beginPath(); c.arc(p.x, p.y, p.s * 3, 0, TAU); c.fill();
      }
      c.globalAlpha = 1;
      c.globalCompositeOperation = 'source-over';
      drawParticles(c, s.parts, 70);
      flashRect(c, w, h, s.pulse * 0.2);
    },
  };
}

const CLIPS = { bounce: clipBounce, sand: clipSand, runner: clipRunner, tunnel: clipTunnel, press: clipPress, galton: clipGalton, fireworks: clipFireworks };

export class ReelFeed {
  constructor() {
    this.tex = canvasTex(RW, RH);
    this.watching = false;
    this.attention = 1;     // < 1 con brainrot: cortes mas tempranos
    this.onReelEnd = null;
    this.onPayoff = null;
    this.hearts = [];
    this.motion = 0;
    this.color = new THREE.Color();
    this.cur = this.makeReel();
    this.next = null;
    this.swipe = -1;
    this.draw();
  }

  makeReel() {
    const reel = { t: 0, virality: Math.min(2.6, 0.3 + -Math.log(1 - Math.random()) * 0.6), payoffs: 0 };
    reel.likes = Math.floor(rand(200, 4000) * (1 + reel.virality * 6));
    reel.comments = Math.floor(reel.likes / rand(20, 60));
    const emit = (m) => this.payoff(reel, m);
    const types = Object.keys(CLIPS).filter(k => k !== 'runner');
    if (Math.random() < 0.4) {
      reel.kind = [pick(types), 'runner'];
      reel.panes = [
        { y: 0, h: RH / 2, clip: CLIPS[reel.kind[0]](RW, RH / 2, emit) },
        { y: RH / 2, h: RH / 2, clip: clipRunner(RW, RH / 2, emit) },
      ];
    } else {
      reel.kind = [pick(Object.keys(CLIPS))];
      reel.panes = [{ y: 0, h: RH, clip: CLIPS[reel.kind[0]](RW, RH, emit) }];
    }
    reel.dur = Math.max(...reel.panes.map(p => p.clip.dur));
    reel.motion = Math.max(...reel.panes.map(p => p.clip.motion));
    reel.hue = reel.panes[0].clip.hue;
    return reel;
  }

  payoff(reel, m) {
    if (reel !== this.cur) return;
    const v = m * reel.virality;
    reel.payoffs += v;
    reel.likes += Math.floor(v * 9000);
    const n = Math.min(14, Math.round(v * 16));
    for (let i = 0; i < n; i++) {
      this.hearts.push({ x: RW - 34 + rand(-8, 8), y: RH * 0.56, vx: rand(-50, 6), vy: rand(-190, -90), life: rand(0.8, 1.5), s: rand(14, 26) });
    }
    if (this.watching && this.onPayoff) this.onPayoff(v);
  }

  stepReel(reel, dt) {
    reel.t += dt;
    for (const p of reel.panes) p.clip.update(dt, reel.t);
  }

  update(dt) {
    this.stepReel(this.cur, dt);
    if (this.swipe >= 0) {
      this.stepReel(this.next, dt);
      this.swipe += dt / 0.28;
      if (this.swipe >= 1) { this.cur = this.next; this.next = null; this.swipe = -1; }
    } else if (this.cur.t > this.cur.dur * (this.watching ? this.attention : 1.4)) {
      this.swipe = 0;
      this.next = this.makeReel();
      if (this.watching && this.onReelEnd) this.onReelEnd(this.cur);
    }
    for (const hh of this.hearts) { hh.life -= dt; hh.x += hh.vx * dt; hh.y += hh.vy * dt; hh.vx += Math.sin(hh.life * 9) * 30 * dt; }
    this.hearts = this.hearts.filter(hh => hh.life > 0);
    this.motion = this.swipe >= 0 ? 1 : this.cur.motion;
    this.color.setHSL(mod(this.cur.hue, 360) / 360, 0.85, 0.55);
  }

  /** Dibuja como maximo a 30 fps (15 si nadie mira) segun el tiempo real. */
  render(realDt) {
    this._acc = (this._acc || 0) + realDt;
    if (this._acc > 1 / (this.watching ? 30 : 15)) { this._acc = 0; this.draw(); }
  }

  drawReel(g, reel, y0) {
    for (const p of reel.panes) {
      g.save();
      g.translate(0, y0 + p.y);
      g.beginPath(); g.rect(0, 0, RW, p.h); g.clip();
      p.clip.draw(g, RW, p.h, reel.t);
      g.restore();
    }
    if (reel.panes.length > 1) { g.fillStyle = '#000'; g.fillRect(0, y0 + RH / 2 - 1, RW, 2); }
  }

  draw() {
    const g = this.tex.userData.ctx;
    const off = this.swipe >= 0 ? (1 - Math.pow(1 - this.swipe, 3)) * RH : 0;
    this.drawReel(g, this.cur, -off);
    if (this.swipe >= 0) this.drawReel(g, this.next, RH - off);
    const reel = this.swipe >= 0 ? this.next : this.cur;
    // Interfaz de la app: solo iconos y contadores
    const fmt = (n) => (n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'k' : String(n));
    g.textAlign = 'center'; g.textBaseline = 'middle';
    [['❤️', fmt(reel.likes)], ['💬', fmt(reel.comments)], ['↗️', '']].forEach(([ic, n], k) => {
      const y = RH * 0.56 + k * 62;
      g.shadowColor = 'rgba(0,0,0,0.6)'; g.shadowBlur = 6;
      g.font = `28px ${EMOJI_FONT}`; g.fillText(ic, RW - 30, y);
      g.font = 'bold 12px system-ui, sans-serif'; g.fillStyle = '#fff'; g.fillText(n, RW - 30, y + 26);
      g.shadowBlur = 0;
    });
    g.fillStyle = 'rgba(255,255,255,0.9)';
    g.beginPath(); g.arc(28, RH - 58, 13, 0, TAU); g.fill();
    g.fillStyle = 'rgba(255,255,255,0.55)';
    g.beginPath(); g.roundRect(48, RH - 64, 90, 10, 5); g.fill();
    g.beginPath(); g.roundRect(18, RH - 38, 170, 8, 4); g.fill();
    g.font = `22px ${EMOJI_FONT}`;
    for (const hh of this.hearts) { g.globalAlpha = clamp01(hh.life * 1.4); g.font = `${hh.s | 0}px ${EMOJI_FONT}`; g.fillText('❤️', hh.x, hh.y); }
    g.globalAlpha = 1;
    g.fillStyle = 'rgba(255,255,255,0.3)'; g.fillRect(0, RH - 4, RW, 4);
    g.fillStyle = '#fff'; g.fillRect(0, RH - 4, RW * Math.min(1, reel.t / reel.dur), 4);
    this.tex.needsUpdate = true;
  }
}

// ---------------------------------------------------------------- Humo
class Smoke {
  constructor(parent, origin) {
    this.origin = origin;
    this.boost = 0;
    const map = radialSprite('rgba(220,220,230,0.55)', 'rgba(200,200,210,0)');
    this.parts = [];
    for (let i = 0; i < 70; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map, transparent: true, depthWrite: false, opacity: 0, fog: true }));
      s.userData = { life: -1 };
      parent.add(s);
      this.parts.push(s);
    }
    this.acc = 0;
  }
  update(dt) {
    this.acc += dt * (5 + this.boost * 14);
    for (const s of this.parts) {
      const u = s.userData;
      if (u.life < 0 && this.acc >= 1) {
        this.acc -= 1;
        u.life = 0; u.max = rand(4, 7);
        u.v = new V3(rand(-0.6, 0.6), rand(3.5, 6) * (1 + this.boost * 0.5), rand(-0.6, 0.6));
        u.seed = Math.random() * 100;
        s.position.copy(this.origin);
      }
      if (u.life < 0) continue;
      u.life += dt;
      const k = u.life / u.max;
      if (k >= 1) { u.life = -1; s.material.opacity = 0; continue; }
      s.position.addScaledVector(u.v, dt);
      s.position.x += Math.sin(u.life * 1.7 + u.seed) * dt * 1.5;
      s.position.z += Math.cos(u.life * 1.3 + u.seed) * dt * 1.5;
      s.scale.setScalar(1.2 + k * 11);
      s.material.opacity = Math.sin(Math.min(1, k * 3) * Math.PI / 2) * (1 - k) * (0.12 + this.boost * 0.1);
    }
    this.boost = Math.max(0, this.boost - dt * 0.5);
  }
}

// ---------------------------------------------------------------- Estaciones
function buildBar(g) {
  // Vaso de shot opaco con el licor a ras
  const glassMat = new THREE.MeshStandardMaterial({ color: 0xd3dbe1, roughness: 0.3, metalness: 0, side: THREE.DoubleSide });
  const prof = [[0, 0], [3.2, 0], [3.3, 0.3], [3.8, 6.5], [3.4, 6.5], [2.9, 1.2], [0, 1.2]].map(([x, y]) => new THREE.Vector2(x, y));
  const glass = new THREE.Mesh(new THREE.LatheGeometry(prof, 48), glassMat);
  glass.position.set(0, 0, 4);
  const liquid = new THREE.Mesh(new THREE.CylinderGeometry(3.35, 2.95, 4.4, 40), new THREE.MeshStandardMaterial({ color: 0xc97a1c, roughness: 0.3 }));
  liquid.position.set(0, 1.2 + 2.2, 4);
  // Charco derramado: aqui bebe la mosca
  const puddleGeo = new THREE.CircleGeometry(7, 64);
  const p = puddleGeo.attributes.position;
  for (let i = 1; i < p.count; i++) {
    const a = Math.atan2(p.getY(i), p.getX(i));
    const r = 1 + 0.18 * Math.sin(a * 3 + 1) + 0.1 * Math.sin(a * 5 + 2);
    p.setXY(i, p.getX(i) * r, p.getY(i) * r * 0.8);
  }
  const puddle = new THREE.Mesh(puddleGeo, new THREE.MeshStandardMaterial({ color: 0xd88a20, roughness: 0.25, emissive: 0x3a1c00, emissiveIntensity: 0.4, transparent: true, opacity: 0.85 }));
  puddle.rotation.x = -Math.PI / 2;
  puddle.position.set(0, 0.15, 10);
  g.add(shadowAll(glass), liquid, puddle);
  return { height: 10, approach: [0, 15], look: [0, 8], obstacles: [[0, 4, 4.2]], surfaces: [] };
}

function buildCigarette(g, world) {
  // Cenicero opaco al fondo; el cigarro apoya la brasa en el borde y el filtro mira al centro
  const tray = new THREE.Mesh(
    new THREE.LatheGeometry([[0, 0], [9.5, 0], [10, 0.8], [10, 3], [9.2, 3], [8.4, 1.2], [0, 1.2]].map(([x, y]) => new THREE.Vector2(x, y)), 48),
    new THREE.MeshStandardMaterial({ color: 0x3b4650, roughness: 0.4, metalness: 0.1 }),
  );
  tray.position.set(0, 0, -8);
  const ashMat = new THREE.MeshStandardMaterial({ color: 0x77736e, roughness: 1 });
  for (let i = 0; i < 6; i++) {
    const a = new THREE.Mesh(new THREE.SphereGeometry(rand(0.7, 1.4), 10, 8), ashMat);
    a.scale.y = 0.4;
    a.position.set(rand(-5, 5), 1.35, -8 + rand(-5, 3));
    g.add(a);
  }
  const butt = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 0.85, 3.5, 14), new THREE.MeshStandardMaterial({ color: 0xd98a3a, roughness: 0.8 }));
  butt.rotation.set(Math.PI / 2, 0, 0.8); butt.position.set(-3.5, 2, -10);
  g.add(shadowAll(tray, true, true), shadowAll(butt));

  // Cigarro: filtro sobre la mesa (lado del fumador), brasa sobre el cenicero
  const A = new V3(0, 0.75, 9), B = new V3(0, 3.5, -1);
  const dir = B.clone().sub(A); const L = dir.length(); dir.normalize();
  const cig = new THREE.Group();
  const seg = (r, len, y0, mat) => { const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 16), mat); m.position.y = y0 + len / 2; cig.add(m); return m; };
  seg(0.77, 2.8, 0, new THREE.MeshStandardMaterial({ color: 0xd9893f, roughness: 0.85 }));
  seg(0.75, L - 2.8 - 1.4, 2.8, new THREE.MeshStandardMaterial({ color: 0xf4f1ea, roughness: 0.9 }));
  seg(0.7, 1.0, L - 1.4, new THREE.MeshStandardMaterial({ color: 0x8a8580, roughness: 1 }));
  const ember = seg(0.66, 0.4, L - 0.4, glow(0xff4a10, 3));
  cig.position.copy(A);
  cig.quaternion.setFromUnitVectors(new V3(0, 1, 0), dir);
  g.add(shadowAll(cig));
  const smoke = new Smoke(g, B.clone().add(new V3(0, 0.8, 0)));
  const emberLight = new THREE.PointLight(0xff5a1a, 0.6, 8, 2);
  emberLight.position.copy(B).add(new V3(0, 1.5, 0));
  g.add(emberLight);
  world.smoke = smoke;
  return {
    height: 8, approach: [0, 10.6], look: [0, 6], obstacles: [[0, -8, 10.5]], surfaces: [],
    update(dt, t) {
      smoke.update(dt);
      const f = 2.4 + Math.sin(t * 9) * 0.4 + Math.random() * 0.5 + smoke.boost * 3;
      ember.material.emissiveIntensity = f;
      emberLight.intensity = world.stations.get('cigarro')?.enabled === false ? 0 : 0.3 + f * 0.15;
    },
  };
}

function buildCoke(g, world) {
  const frame = new THREE.Mesh(new RoundedBoxGeometry(35, 0.8, 25, 3, 0.4), new THREE.MeshStandardMaterial({ color: 0x8c8f96, metalness: 0.3, roughness: 0.6 }));
  frame.position.set(0, 0.4, 4);
  const mirror = new THREE.Mesh(new THREE.PlaneGeometry(33, 23), new THREE.MeshStandardMaterial({ color: 0x9aa3ad, metalness: 0.5, roughness: 0.22 }));
  mirror.rotation.x = -Math.PI / 2; mirror.position.set(0, 0.9, 4);
  // Linea de polvo con relieve irregular
  const lineGeo = new THREE.BoxGeometry(18, 0.7, 1.8, 48, 1, 4);
  const lp = lineGeo.attributes.position;
  for (let i = 0; i < lp.count; i++) {
    if (lp.getY(i) > 0) lp.setY(i, 0.35 + Math.random() * 0.25 - Math.abs(lp.getZ(i)) * 0.25);
  }
  lineGeo.computeVertexNormals();
  const line = new THREE.Mesh(lineGeo, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, emissive: 0x404a5a, emissiveIntensity: 0.4 }));
  line.geometry.translate(9, 0, 0);
  line.position.set(-9, 1.15, 6.5);
  const cardTex = canvasTex(256, 160, (c) => {
    const gr = c.createLinearGradient(0, 0, 256, 160); gr.addColorStop(0, '#1b1b1f'); gr.addColorStop(1, '#3a3a44');
    c.fillStyle = gr; c.fillRect(0, 0, 256, 160);
    c.fillStyle = '#d8b25a'; c.fillRect(22, 50, 38, 28);
    c.font = '16px monospace'; c.fillText('4000 1234 5678 9012', 22, 110);
  });
  const card = new THREE.Mesh(new RoundedBoxGeometry(17, 0.35, 10.6, 2, 0.15), [0, 1, 2, 3, 4, 5].map(i => i === 2 ? new THREE.MeshStandardMaterial({ map: cardTex, roughness: 0.6, metalness: 0 }) : new THREE.MeshStandardMaterial({ color: 0x222228 })));
  card.position.set(7, 1.05, -3); card.rotation.y = 0.35;
  const billTex = canvasTex(256, 64, (c) => {
    c.fillStyle = '#6f9a6a'; c.fillRect(0, 0, 256, 64);
    c.fillStyle = '#2e4f2c'; c.font = 'bold 40px serif';
    for (let i = 0; i < 6; i++) c.fillText('$100', i * 60 - 20, 48);
  });
  billTex.wrapS = THREE.RepeatWrapping;
  const bill = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.1, 13, 20, 1, true), new THREE.MeshStandardMaterial({ map: billTex, side: THREE.DoubleSide, roughness: 0.8 }));
  bill.rotation.z = Math.PI / 2; bill.rotation.y = -0.3; bill.position.set(-5, 1.95, -4);
  g.add(shadowAll(frame, false, true), mirror, shadowAll(line), shadowAll(card), shadowAll(bill));
  const coke = { amount: 1, refill: 0 };
  coke.consume = (x) => { coke.amount = Math.max(0, coke.amount - x); if (coke.amount < 0.05) { coke.amount = 0; coke.refill = 15; } };
  world.coke = coke;
  return {
    height: 8, approach: [-11.5, 7.2], look: [-7, 6.5], obstacles: [], surfaces: [[0, 4, 17, 12, 0.9]], light: [0xbfe4ff, [0, 24, 6], 1.6],
    update(dt) {
      if (coke.refill > 0) { coke.refill -= dt; if (coke.refill <= 0) coke.amount = 1; }
      line.scale.x += (Math.max(0.001, coke.amount) - line.scale.x) * Math.min(1, dt * 6);
      line.visible = world.stations.get('coca')?.enabled !== false && line.scale.x > 0.01;
    },
  };
}

function buildSlots(g, world) {
  const paint = new THREE.MeshStandardMaterial({ color: 0x7a1422, metalness: 0.15, roughness: 0.55 });
  const gold = new THREE.MeshStandardMaterial({ color: 0xb09050, metalness: 0.5, roughness: 0.5 });
  const cab = new THREE.Mesh(new RoundedBoxGeometry(28, 36, 18, 4, 1.5), paint);
  cab.position.set(0, 18, -8);
  const bezel = new THREE.Mesh(new RoundedBoxGeometry(25, 14, 1.2, 3, 0.5), gold);
  bezel.position.set(0, 24, 1);
  const slot = new SlotMachine();
  world.slots = slot;
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(22, 11), new THREE.MeshBasicMaterial({ map: slot.tex, toneMapped: false }));
  screen.material.color.setScalar(1.25);
  screen.position.set(0, 24, 1.75);
  const signTex = canvasTex(512, 128, (c) => {
    c.fillStyle = '#12001a'; c.fillRect(0, 0, 512, 128);
    c.font = '700 72px Rubik, system-ui, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.letterSpacing = '14px';
    c.shadowColor = '#ff5a8a'; c.shadowBlur = 18; c.fillStyle = '#ffe3ec';
    c.fillText('SLOTS', 263, 68);
  });
  const sign = new THREE.Mesh(new RoundedBoxGeometry(30, 8.5, 5, 3, 1), [paint, paint, paint, paint, new THREE.MeshBasicMaterial({ map: signTex, toneMapped: false, color: new THREE.Color(1.6, 1.6, 1.6) }), paint]);
  sign.position.set(0, 40.5, -7);
  const bulbs = [];
  for (let i = 0; i < 22; i++) {
    const b = new THREE.Mesh(new THREE.SphereGeometry(0.55, 10, 8), glow(0xffd070, 0.3));
    const u = i / 22;
    const per = 2 * (30 + 8.5);
    let d = u * per, x, y;
    if (d < 30) { x = -15 + d; y = 4.8; } else if (d < 38.5) { x = 15; y = 4.8 - (d - 30); } else if (d < 68.5) { x = 15 - (d - 38.5); y = -3.7; } else { x = -15; y = -3.7 + (d - 68.5); }
    b.position.set(x, 40.5 + y * 0.95, -4.3);
    bulbs.push(b); g.add(b);
  }
  // Palanca
  const lever = new THREE.Group();
  const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.7, 13, 12), gold); rod.position.y = 6.5;
  const ball = new THREE.Mesh(new THREE.SphereGeometry(2.2, 20, 16), new THREE.MeshStandardMaterial({ color: 0xb01020, roughness: 0.45 }));
  ball.position.y = 13.5;
  lever.add(rod, ball);
  lever.position.set(15.8, 18, -6);
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(2, 2, 2, 16), gold); hub.rotation.z = Math.PI / 2; hub.position.set(15, 18, -6);
  const tray = new THREE.Mesh(new RoundedBoxGeometry(18, 2.5, 6, 2, 0.6), gold); tray.position.set(0, 5, 2.4);
  // Boton gigante en la mesa: la mosca se para encima para girar
  const btnBase = new THREE.Mesh(new THREE.CylinderGeometry(5.2, 5.6, 0.7, 40), gold); btnBase.position.set(0, 0.35, 11);
  const btn = new THREE.Mesh(new THREE.CylinderGeometry(4.3, 4.5, 0.9, 40), new THREE.MeshStandardMaterial({ color: 0x400008, emissive: 0xff1040, emissiveIntensity: 1.2, roughness: 0.3 }));
  btn.position.set(0, 1.0, 11);
  g.add(shadowAll(cab), bezel, screen, shadowAll(sign), shadowAll(lever), hub, shadowAll(tray), shadowAll(btnBase, false, true), btn);
  let pull = 0, press = 0;
  slot.press = () => { pull = 1; press = 1; };
  return {
    height: 46, approach: [0, 11], look: [0, 0], obstacles: [[0, -8, 17]], surfaces: [[0, 11, 4.5, 4.5, 1.3]], light: [0xff3df0, [0, 30, 14], 2.2],
    update(dt, t) {
      slot.update(dt);
      pull = Math.max(0, pull - dt * 1.6);
      press = Math.max(0, press - dt * 3);
      lever.rotation.x = -Math.sin(Math.min(1, pull) * Math.PI) * 1.1;
      btn.position.y = 1.0 - press * 0.45;
      btn.material.emissiveIntensity = 1 + Math.sin(t * 4) * 0.4 + press * 2;
      const spinning = slot.current && !slot.current.done;
      const win = slot.flash > 0 && slot.msg !== '¡CASI!';
      bulbs.forEach((b, i) => {
        const on = spinning || win ? (Math.floor(t * 14) + i) % 2 === 0 : (Math.floor(t * 5) + i) % 4 === 0;
        b.material.emissiveIntensity = on ? 4 : 0.3;
      });
    },
  };
}

function buildPhone(g, world) {
  const body = new THREE.Mesh(new RoundedBoxGeometry(34, 1.6, 72, 4, 3), new THREE.MeshStandardMaterial({ color: 0x111116, metalness: 0.1, roughness: 0.5 }));
  body.position.set(0, 0.8, -14);
  const feed = new ReelFeed();
  world.reels = feed;
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(31, 66), new THREE.MeshBasicMaterial({ map: feed.tex, toneMapped: false }));
  screen.material.color.setScalar(1.15);
  screen.rotation.x = -Math.PI / 2; // arriba del video = lejos del centro: la mosca lo ve derecho
  screen.position.set(0, 1.72, -14);
  const notch = new THREE.Mesh(new RoundedBoxGeometry(8, 0.2, 2.2, 2, 0.9), new THREE.MeshBasicMaterial({ color: 0x000000 }));
  notch.position.set(0, 1.8, -45);
  g.add(shadowAll(body, true, true), screen, notch);
  const light = new THREE.PointLight(0x3df0ff, 0.5, 22, 2);
  light.position.set(0, 8, -14);
  g.add(light);
  return {
    height: 8, approach: [0, 12], look: [0, 0], obstacles: [], surfaces: [[0, -14, 17, 36, 1.72]],
    update(dt) { feed.update(dt); light.color.copy(feed.color); },
  };
}

function buildBanana(g) {
  const top = canvasTex(256, 256, (c) => {
    const gr = c.createRadialGradient(128, 128, 10, 128, 128, 128);
    gr.addColorStop(0, '#f3e6b0'); gr.addColorStop(0.8, '#f7eec8'); gr.addColorStop(0.93, '#efe0a0'); gr.addColorStop(1, '#e7c94a');
    c.fillStyle = gr; c.fillRect(0, 0, 256, 256);
    c.strokeStyle = 'rgba(190,160,90,0.5)'; c.lineWidth = 3;
    for (let k = 0; k < 3; k++) { const a = k * TAU / 3; c.beginPath(); c.moveTo(128, 128); c.lineTo(128 + Math.cos(a) * 40, 128 + Math.sin(a) * 40); c.stroke(); }
    c.fillStyle = '#4a3420';
    for (let k = 0; k < 14; k++) { const a = k * TAU / 14; c.beginPath(); c.ellipse(128 + Math.cos(a) * 26, 128 + Math.sin(a) * 26, 3, 2, a, 0, TAU); c.fill(); }
    c.fillStyle = 'rgba(120,80,30,0.25)';
    for (let k = 0; k < 40; k++) { c.beginPath(); c.arc(rand(20, 236), rand(20, 236), rand(2, 7), 0, TAU); c.fill(); }
  });
  const side = new THREE.MeshStandardMaterial({ color: 0xe9cf55, roughness: 0.6 });
  const face = new THREE.MeshStandardMaterial({ map: top, roughness: 0.55 });
  const slice = new THREE.Mesh(new THREE.CylinderGeometry(9, 9, 3, 48), [side, face, face]);
  slice.position.set(0, 1.5, 0);
  const slice2 = new THREE.Mesh(new THREE.CylinderGeometry(8, 8, 3, 48), [side, face, face]);
  slice2.position.set(-9, 4.5, -8); slice2.rotation.set(0.5, 0, 0.9);
  const sugar = new THREE.Mesh(new RoundedBoxGeometry(6, 6, 6, 2, 0.5), new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.7, sheen: 1, sheenColor: 0xffffff }));
  sugar.position.set(13, 3, -4); sugar.rotation.y = 0.5;
  g.add(shadowAll(slice), shadowAll(slice2), shadowAll(sugar));
  return { height: 12, approach: [0, 12.2], look: [0, 0], obstacles: [[0, 0, 9.8], [-9, -8, 9], [13, -4, 5]], surfaces: [], light: [0xffe45c, [0, 24, 8], 1.4] };
}

function buildBed(g) {
  const pad = new THREE.Mesh(new THREE.CylinderGeometry(11, 11, 1.4, 48), new THREE.MeshStandardMaterial({ color: 0x6f6c82, roughness: 1 }));
  pad.position.set(0, 0.7, 0);
  const pillow = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16), new THREE.MeshStandardMaterial({ color: 0x8a879c, roughness: 1 }));
  pillow.scale.set(3.4, 1.1, 2.1); pillow.position.set(0, 2.1, -5.2);
  const blanketTex = canvasTex(128, 128, (c) => {
    c.fillStyle = '#3a4468'; c.fillRect(0, 0, 128, 128);
    c.fillStyle = 'rgba(255,255,255,0.08)';
    for (let i = 0; i < 128; i += 16) c.fillRect(0, i, 128, 6);
  });
  const blanket = new THREE.Mesh(new RoundedBoxGeometry(15, 0.4, 7, 2, 0.15), new THREE.MeshStandardMaterial({ map: blanketTex, roughness: 0.9 }));
  blanket.position.set(0, 1.6, 6.5);
  const moon = new THREE.Mesh(new THREE.SphereGeometry(2.3, 24, 16), glow(0xbfd0ff, 0.9));
  moon.position.set(10, 7, -9);
  const stand = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 1.4, 5, 12), new THREE.MeshStandardMaterial({ color: 0x9aa0b8, metalness: 0.2, roughness: 0.55 }));
  stand.position.set(10, 2.5, -9);
  g.add(shadowAll(pad, false, true), shadowAll(pillow), shadowAll(blanket), moon, shadowAll(stand));
  return { height: 12, approach: [0, 0.8], look: [0, -8], obstacles: [[10, -9, 2.5]], surfaces: [[0, 0, 10, 10, 1.4]], light: [0x8fa8ff, [6, 16, -4], 0.35] };
}

export const STATION_DEFS = [
  { id: 'bar', nombre: 'Etanol', emoji: '🍺', color: 0xffb040, scale: 1.7, span: 1.35, build: buildBar },
  { id: 'cigarro', nombre: 'Nicotina', emoji: '🚬', color: 0xff6a2a, scale: 1.7, span: 1.35, build: buildCigarette },
  { id: 'coca', nombre: 'Cocaína', emoji: '❄️', color: 0xbfe4ff, scale: 1.6, span: 1.3, build: buildCoke },
  { id: 'slots', nombre: 'Tragamonedas', emoji: '🎰', color: 0xff3df0, span: 0.9, build: buildSlots },
  { id: 'reels', nombre: 'Reels', emoji: '📱', color: 0x3df0ff, span: 0.85, r: 60, build: buildPhone },
  { id: 'comida', nombre: 'Alimento', emoji: '🍌', color: 0xffe45c, span: 0.65, build: buildBanana },
  { id: 'cama', nombre: 'Reposo', emoji: '🛏️', color: 0x8fa8ff, span: 0.6, build: buildBed },
];

function labelTexture(def, enabled) {
  return canvasTex(512, 96, (c) => {
    const col = '#' + new THREE.Color(def.color).getHexString();
    c.clearRect(0, 0, 512, 96);
    c.font = '600 36px "JetBrains Mono", Consolas, monospace';
    const text = def.nombre.toUpperCase();
    const w = Math.min(496, c.measureText(text).width + 64);
    const x0 = (512 - w) / 2;
    c.fillStyle = enabled ? 'rgba(10,12,16,0.78)' : 'rgba(24,24,28,0.6)';
    c.beginPath(); c.roundRect(x0, 16, w, 64, 8); c.fill();
    c.fillStyle = enabled ? col : '#4a4a52';
    c.fillRect(x0 + 16, 40, 16, 16);
    c.fillStyle = enabled ? '#e6ebf2' : '#707078';
    c.textAlign = 'left'; c.textBaseline = 'middle';
    c.fillText(text, x0 + 44, 50);
    if (!enabled) { c.strokeStyle = '#8a8a92'; c.lineWidth = 3; c.beginPath(); c.moveTo(x0 + 40, 50); c.lineTo(x0 + w - 16, 50); c.stroke(); }
  });
}

// ---------------------------------------------------------------- Mundo
export class World {
  constructor(scene, renderer) {
    this.scene = scene;
    this.stations = new Map();
    this.obstacles = [];
    this.surfaces = [];
    this.updaters = [];
    this.time = 0;

    scene.background = new THREE.Color(0x0b0c0f);
    scene.fog = new THREE.FogExp2(0x0b0c0f, 0.003);
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environmentIntensity = 0.25;

    this.buildLights();
    this.buildTable();
    this.buildStations();
    this.buildCoins();

    // Marcador del destino
    this.focusRing = new THREE.Mesh(new THREE.RingGeometry(2.6, 3.3, 48), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.7, toneMapped: false, depthWrite: false }));
    this.focusRing.rotation.x = -Math.PI / 2;
    this.focusRing.visible = false;
    scene.add(this.focusRing);
  }

  buildLights() {
    const s = this.scene;
    s.add(new THREE.HemisphereLight(0xdfe4ec, 0x202226, 1.0));
    const fill = new THREE.DirectionalLight(0xffffff, 0.8);
    fill.position.set(-80, 120, 160);
    s.add(fill);
    const spot = new THREE.SpotLight(0xfff2e6, 4.2, 0, 0.72, 0.65, 0);
    spot.position.set(0, 180, 40);
    spot.castShadow = true;
    spot.shadow.mapSize.set(4096, 4096);
    spot.shadow.camera.near = 100; spot.shadow.camera.far = 280;
    spot.shadow.bias = -0.0004; spot.shadow.normalBias = 0.04;
    s.add(spot, spot.target);
  }

  buildTable() {
    // Arena circular neutra, como las de los ensayos de comportamiento, con grilla polar de referencia
    const tex = canvasTex(1024, 1024, (c) => {
      const gr = c.createRadialGradient(512, 512, 40, 512, 512, 512);
      gr.addColorStop(0, '#2a2d33'); gr.addColorStop(1, '#1c1e23');
      c.fillStyle = gr; c.fillRect(0, 0, 1024, 1024);
      for (let i = 0; i < 60000; i++) {
        c.fillStyle = Math.random() < 0.5 ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.05)';
        c.fillRect(Math.random() * 1024, Math.random() * 1024, 2, 2);
      }
      const px = 512 / TABLE_R;
      c.strokeStyle = 'rgba(255,255,255,0.06)'; c.lineWidth = 2;
      for (let r = 20; r < TABLE_R; r += 20) { c.beginPath(); c.arc(512, 512, r * px, 0, TAU); c.stroke(); }
      for (let k = 0; k < 12; k++) {
        const a = (k * TAU) / 12;
        c.beginPath(); c.moveTo(512 + Math.cos(a) * 20 * px, 512 + Math.sin(a) * 20 * px); c.lineTo(512 + Math.cos(a) * 506, 512 + Math.sin(a) * 506); c.stroke();
      }
      c.strokeStyle = 'rgba(255,255,255,0.16)';
      for (let k = 0; k < 72; k++) {
        const a = (k * TAU) / 72, r0 = k % 6 === 0 ? 486 : 498;
        c.beginPath(); c.moveTo(512 + Math.cos(a) * r0, 512 + Math.sin(a) * r0); c.lineTo(512 + Math.cos(a) * 510, 512 + Math.sin(a) * 510); c.stroke();
      }
    });
    const floor = new THREE.Mesh(new THREE.CircleGeometry(TABLE_R, 128), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.92 }));
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    const wall = new THREE.Mesh(new THREE.CylinderGeometry(TABLE_R + 0.6, TABLE_R + 0.6, 7, 160, 1, true),
      new THREE.MeshPhysicalMaterial({ color: 0xbcc8d8, roughness: 0.1, transparent: true, opacity: 0.16, side: THREE.DoubleSide, depthWrite: false }));
    wall.position.y = 3.5;
    const lip = new THREE.Mesh(new THREE.TorusGeometry(TABLE_R + 0.6, 0.35, 8, 160), new THREE.MeshStandardMaterial({ color: 0x8a93a3, metalness: 0.2, roughness: 0.55 }));
    lip.rotation.x = -Math.PI / 2;
    lip.position.y = 7;
    const base = new THREE.Mesh(new THREE.CylinderGeometry(TABLE_R + 3, TABLE_R + 3, 6, 128), new THREE.MeshStandardMaterial({ color: 0x121317, roughness: 0.7, metalness: 0.2 }));
    base.position.y = -3.6; // tapa bien por debajo del piso (evita z-fighting)
    this.scene.add(floor, wall, lip, base);
  }

  buildStations() {
    // Angulo de la arena repartido segun el tamaño de cada estacion; la tragamonedas queda al fondo
    const total = STATION_DEFS.reduce((acc, d) => acc + d.span, 0);
    const centers = [];
    let cum = 0;
    for (const d of STATION_DEFS) { centers.push(cum + d.span / 2); cum += d.span; }
    const ref = centers[STATION_DEFS.findIndex(d => d.id === 'slots')];
    STATION_DEFS.forEach((def, i) => {
      const a = -Math.PI / 2 + ((centers[i] - ref) / total) * TAU;
      const rad = def.r ?? STATION_R;
      const group = new THREE.Group();
      group.position.set(Math.cos(a) * rad, 0, Math.sin(a) * rad);
      group.rotation.y = Math.atan2(-Math.cos(a), -Math.sin(a));
      const sc = def.scale || 1;
      group.scale.setScalar(sc);
      this.scene.add(group);
      const info = def.build(group, this);
      group.updateMatrixWorld(true);
      group.traverse(o => { o.userData.stationId = def.id; });
      const toWorld = ([x, z], y = 0) => group.localToWorld(new V3(x, y, z));
      for (const [x, z, r] of info.obstacles) {
        const p = toWorld([x, z]);
        this.obstacles.push({ x: p.x, z: p.z, r: r * sc, id: def.id });
      }
      const inv = group.matrixWorld.clone().invert();
      for (const [cx, cz, hw, hd, h] of info.surfaces) this.surfaces.push({ inv, cx, cz, hw, hd, h: h * sc, id: def.id });
      const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: labelTexture(def, true), transparent: true, depthWrite: false }));
      label.scale.set(18 / sc, 3.4 / sc, 1);
      label.position.set(0, info.height + 8 / sc, 0);
      label.renderOrder = 10;
      group.add(label);
      if (info.update) this.updaters.push(info.update);
      this.stations.set(def.id, {
        ...def, group, label, enabled: true, angle: a,
        approach: toWorld(info.approach), look: toWorld(info.look),
      });
    });
  }

  buildCoins() {
    const geo = new THREE.CylinderGeometry(1.4, 1.4, 0.35, 20);
    const mat = new THREE.MeshStandardMaterial({ color: 0xd9b24a, metalness: 0.5, roughness: 0.45 });
    this.coins = [];
    for (let i = 0; i < 40; i++) {
      const m = new THREE.Mesh(geo, mat);
      m.visible = false; m.castShadow = true;
      m.userData = { life: 0, v: new V3(), w: new V3() };
      this.scene.add(m);
      this.coins.push(m);
    }
  }

  coinBurst(n) {
    const st = this.stations.get('slots');
    const origin = st.group.localToWorld(new V3(0, 6, 3));
    const out = st.group.localToWorld(new V3(0, 0, 1)).sub(st.group.position).normalize();
    let spawned = 0;
    for (const c of this.coins) {
      if (spawned >= n) break;
      if (c.visible) continue;
      c.visible = true;
      c.position.copy(origin);
      c.userData.life = 3.5;
      c.userData.v.set(rand(-8, 8), rand(12, 26), rand(-8, 8)).addScaledVector(out, rand(8, 18));
      c.userData.w.set(rand(-10, 10), rand(-10, 10), rand(-10, 10));
      spawned++;
    }
  }

  groundAt(x, z) {
    let h = 0;
    const p = new V3();
    for (const s of this.surfaces) {
      if (!this.stations.get(s.id)?.enabled) continue;
      p.set(x, 0, z).applyMatrix4(s.inv);
      if (Math.abs(p.x - s.cx) < s.hw && Math.abs(p.z - s.cz) < s.hd) h = Math.max(h, s.h);
    }
    return h;
  }

  setEnabled(id, on) {
    const st = this.stations.get(id);
    if (!st) return;
    st.enabled = on;
    // Retirada: se ocultan los modelos (la etiqueta tachada queda para poder reactivarla)
    // Las luces se apagan en vez de ocultarse: cambiar la cantidad de luces recompila todos los materiales
    for (const child of st.group.children) {
      if (child === st.label) continue;
      if (child.isLight) { child.userData.intensity ??= child.intensity; child.intensity = on ? child.userData.intensity : 0; }
      else child.visible = on;
    }
    st.label.material.map.dispose();
    st.label.material.map = labelTexture(st, on);
    st.label.material.needsUpdate = true;
  }

  setFocus(id) {
    this.focusId = id;
    const st = id && this.stations.get(id);
    if (!st) { this.focusRing.visible = false; return; }
    this.focusRing.visible = true;
    this.focusRing.material.color.set(st.color);
    this.focusRing.position.set(st.approach.x, this.groundAt(st.approach.x, st.approach.z) + 0.15, st.approach.z);
  }

  pickStation(raycaster) {
    const groups = [...this.stations.values()].map(s => s.group);
    const hit = raycaster.intersectObjects(groups, true)[0];
    return hit ? hit.object.userData.stationId : null;
  }

  /** Una vez por cuadro renderizado: redibuja las pantallas (tragamonedas y celular). */
  render(realDt) {
    this.slots.render(realDt);
    this.reels.render(realDt);
  }

  update(dt) {
    this.time += dt;
    const t = this.time;
    for (const u of this.updaters) u(dt, t, this);
    this.focusRing.material.opacity = 0.45 + Math.sin(t * 5) * 0.25;
    this.focusRing.scale.setScalar(1 + Math.sin(t * 5) * 0.08);
    for (const c of this.coins) {
      if (!c.visible) continue;
      const u = c.userData;
      u.life -= dt;
      u.v.y -= 60 * dt;
      c.position.addScaledVector(u.v, dt);
      c.rotation.x += u.w.x * dt; c.rotation.z += u.w.z * dt;
      if (c.position.y < 0.2) { c.position.y = 0.2; u.v.set(u.v.x * 0.4, Math.abs(u.v.y) * 0.3, u.v.z * 0.4); u.w.multiplyScalar(0.5); }
      if (u.life <= 0) c.visible = false;
    }
  }
}
