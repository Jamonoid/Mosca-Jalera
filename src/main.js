import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { Fly } from './fly.js';
import { Brain } from './brain.js';
import { World } from './world.js';
import { FlySim } from './sim.js';
import { UI } from './ui.js';
import { Sfx } from './sfx.js';
import { IntoxShader } from './fx.js';
import { BrainView } from './brainview.js';
import { BrainSim } from './brainsim.js';

const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));

async function loadFonts() {
  const fonts = ['600 36px "JetBrains Mono"', '700 72px Rubik', '800 64px Rubik', '500 10px Rubik'];
  try {
    await Promise.race([Promise.all(fonts.map(f => document.fonts.load(f))), new Promise(r => setTimeout(r, 3000))]);
  } catch { /* sin fuentes: se usan las de respaldo */ }
}

const stage = document.getElementById('stage');
const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance', logarithmicDepthBuffer: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
stage.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(42, innerWidth / innerHeight, 1, 900);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.minDistance = 4;
controls.maxDistance = 320;
controls.maxPolarAngle = Math.PI * 0.48;

await loadFonts();
const world = new World(scene, renderer);
const [fly, brainView] = await Promise.all([Fly.load('assets/'), BrainView.load(document.getElementById('brainCanvas'), 'assets/')]);
scene.add(fly.root);

// Sombra de contacto bajo la mosca
const blobTex = (() => {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(0,0,0,0.75)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
})();
const blob = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: blobTex, transparent: true, depthWrite: false }));
blob.rotation.x = -Math.PI / 2;
blob.scale.set(5, 4, 1);
scene.add(blob);

const brain = new Brain();
const sfx = new Sfx();
const sim = new FlySim({ fly, brain, world, sfx });

// Post-proceso
const size = new THREE.Vector2();
renderer.getDrawingBufferSize(size);
const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 4 });
const composer = new EffectComposer(renderer, rt);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.35, 0.4, 0.92);
composer.addPass(bloom);
const intox = new ShaderPass(IntoxShader);
composer.addPass(intox);
composer.addPass(new OutputPass());

// Estado de la app
const app = {
  speed: 1,
  paused: false,
  fx: true,
  camMode: 'follow',
  camAnim: null,
  setSpeed(s) { this.speed = s; },
  toggleCam() {
    this.camMode = this.camMode === 'follow' ? 'overview' : 'follow';
    const fp = fly.root.position;
    this.camAnim = this.camMode === 'overview'
      ? { t: 0, fromP: camera.position.clone(), fromT: controls.target.clone(), toP: new THREE.Vector3(0, 185, 170), toT: new THREE.Vector3(0, 0, 8) }
      : { t: 0, fromP: camera.position.clone(), fromT: controls.target.clone(), toP: fp.clone().add(new THREE.Vector3(-7, 10, 20)), toT: fp.clone().setY(fp.y + 1.2) };
  },
};

// Simulacion LIF del connectome completo en un hilo aparte
const brainSim = new BrainSim(new URL('../assets/', import.meta.url).href, brainView.meta.cells.map(c => c.idx ?? -1));
brainSim.onState(st => brainView.setTrace(st.trace));
sim.brainSim = brainSim;
const ui = new UI({ sim, brain, world, sfx, fly, camera, app, brainView, brainSim });
sim.subject = 0;
sim.reset();

camera.position.copy(fly.root.position).add(new THREE.Vector3(-7, 10, 20));
controls.target.copy(fly.root.position).setY(1.2);

function updateCamera(dt) {
  if (app.camAnim) {
    const a = app.camAnim;
    a.t = Math.min(1, a.t + dt / 1.3);
    const k = a.t * a.t * (3 - 2 * a.t);
    if (app.camMode === 'follow') { a.toT.copy(fly.root.position).setY(fly.root.position.y + 1.2); }
    camera.position.lerpVectors(a.fromP, a.toP, k);
    controls.target.lerpVectors(a.fromT, a.toT, k);
    if (a.t >= 1) app.camAnim = null;
  } else if (app.camMode === 'follow') {
    const goal = fly.root.position.clone(); goal.y += 1.2;
    const delta = goal.sub(controls.target).multiplyScalar(1 - Math.exp(-dt * 4));
    controls.target.add(delta);
    camera.position.add(delta);
  }
  controls.update();
}

// Clic: estacion = activar/desactivar, mosca = susto
const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();
let down = null;
function pickAt(e) {
  ndc.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  if (raycaster.intersectObject(fly.root, true).length) return { fly: true };
  const id = world.pickStation(raycaster);
  return id ? { id } : null;
}
renderer.domElement.addEventListener('pointerdown', e => { down = [e.clientX, e.clientY]; sfx.unlock(); });
renderer.domElement.addEventListener('pointerup', e => {
  if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 5) return;
  const hit = pickAt(e);
  if (!hit) return;
  if (hit.fly) sim.susto();
  else {
    sim.setEnabled(hit.id, !sim.enabled[hit.id]);
    ui.refreshToggles();
    sfx.play('click');
  }
});
let hoverT = 0;
renderer.domElement.addEventListener('pointermove', e => {
  const now = performance.now();
  if (now - hoverT < 80) return;
  hoverT = now;
  renderer.domElement.style.cursor = pickAt(e) ? 'pointer' : '';
});

addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT') return;
  if (e.code === 'Space') { app.paused = !app.paused; document.body.classList.toggle('paused', app.paused); e.preventDefault(); }
  const speeds = { Digit1: 1, Digit2: 3, Digit3: 10 };
  if (speeds[e.code]) { app.setSpeed(speeds[e.code]); ui.refreshTop(); }
  if (e.code === 'KeyC') { app.toggleCam(); ui.refreshTop(); }
});

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  composer.setSize(innerWidth, innerHeight);
});

// Bucle principal
const clock = new THREE.Clock();
const fxState = { drunk: 0, high: 0, sick: 0 };
let sendT = 0;
function frame() {
  const rdt = Math.min(clock.getDelta(), 0.1);
  const sdt = app.paused ? 0 : rdt * app.speed;
  let rem = sdt;
  while (rem > 1e-6) {
    const h = Math.min(rem, 1 / 30);
    sim.update(h);
    world.update(h);
    rem -= h;
  }
  world.render(rdt);
  if (sdt > 0) fly.update(sdt, sim.motor());

  const g = world.groundAt(fly.root.position.x, fly.root.position.z);
  blob.position.set(fly.root.position.x, g + 0.12, fly.root.position.z);
  blob.rotation.z = fly.heading;
  const air = fly.root.position.y - g;
  blob.material.opacity = clamp(1 - air / 12) * (fly.fall > 0.5 ? 0.6 : 1);

  const on = app.fx ? 1 : 0;
  const tgt = {
    drunk: 0, // sin distorsion visual al beber
    high: on * clamp(brain.E('cocaina') * 1.2 + brain.E('nicotina') * 0.3),
    sick: on * (sim.dead ? 1 : clamp(brain.abstinencia * 0.8 + (1 - brain.salud) * 0.6)),
  };
  for (const k in fxState) fxState[k] += (tgt[k] - fxState[k]) * Math.min(1, rdt * 2);
  intox.uniforms.uTime.value += rdt;
  intox.uniforms.uDrunk.value = fxState.drunk;
  intox.uniforms.uHigh.value = fxState.high;
  intox.uniforms.uSick.value = fxState.sick;

  sendT += rdt;
  if (sendT > 0.05) { sendT = 0; brainSim.send(sim, brain, world, app); }
  ui.update(rdt);
  updateCamera(rdt);
  composer.render();
  window.__ready = true;
  requestAnimationFrame(frame);
}
// Calentamiento: compilar todos los shaders ahora (con todo visible y sin recorte por camara)
// para que no se compilen a mitad de la simulacion cuando algo entra en cuadro por primera vez.
{
  const restore = [];
  scene.traverse(o => {
    if (!o.visible) { restore.push(() => { o.visible = false; }); o.visible = true; }
    if (o.frustumCulled) { restore.push(() => { o.frustumCulled = true; }); o.frustumCulled = false; }
  });
  await renderer.compileAsync(scene, camera);
  composer.render();
  restore.forEach(f => f());
}
document.getElementById('loading').remove();
window.__app = { sim, brain, world, fly, camera, controls, app, brainView, ui, renderer, brainSim };
requestAnimationFrame(frame);
