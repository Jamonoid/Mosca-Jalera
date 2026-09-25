// Mosca 3D: carga el modelo de flybody y lo anima de forma procedural.
// El modelo esta en cm con Z arriba y X hacia adelante (convencion MuJoCo).
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export const FLY_SCALE = 10; // cm -> mm: la mosca mide ~2.5 unidades de mundo

const LEGS = ['T1_left', 'T1_right', 'T2_left', 'T2_right', 'T3_left', 'T3_right'];
// Tripode: L1, R2, L3 se mueven juntas; R1, L2, R3 en contrafase
const TRIPOD = { T1_left: 0, T2_right: 0, T3_left: 0, T1_right: Math.PI, T2_left: Math.PI, T3_right: Math.PI };

const X = new THREE.Vector3(1, 0, 0);
const Y = new THREE.Vector3(0, 1, 0);
const Z = new THREE.Vector3(0, 0, 1);
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();

function makeMaterial(name, def) {
  const [r, g, b, a] = def.rgba;
  const color = new THREE.Color(r, g, b);
  if (name === 'membrane') {
    return new THREE.MeshPhysicalMaterial({
      color: 0xc9dcff, transparent: true, opacity: 0.28, roughness: 0.15,
      iridescence: 1, iridescenceIOR: 1.6, side: THREE.DoubleSide, depthWrite: false,
    });
  }
  if (name === 'red') {
    // ojos compuestos: rojo con brillo facetado
    return new THREE.MeshPhysicalMaterial({ color, roughness: 0.35, clearcoat: 0.8, clearcoatRoughness: 0.4, sheen: 0.4, sheenColor: 0xff6040 });
  }
  const mat = new THREE.MeshStandardMaterial({
    color, transparent: a < 1, opacity: a, roughness: 1 - def.shininess * 0.7, metalness: 0.05,
  });
  if (name === 'black' || name === 'bristle-brown') {
    // capa de pelos casi coplanar con el cuerpo: empujarla atras para evitar z-fighting
    mat.polygonOffset = true; mat.polygonOffsetFactor = 2; mat.polygonOffsetUnits = 4;
  }
  return mat;
}

export class Fly {
  static async load(url = 'assets/') {
    const [gltf, rig] = await Promise.all([
      new GLTFLoader().loadAsync(url + 'fly.glb'),
      fetch(url + 'fly_rig.json').then(r => r.json()),
    ]);
    return new Fly(gltf.scene, rig);
  }

  constructor(model, rig) {
    this.rig = rig;
    // root: posicion/rumbo en el mundo (Y arriba). body: postura (caida, balanceo). model: conversion Z-arriba -> Y-arriba
    this.root = new THREE.Group();
    this.body = new THREE.Group();
    this.root.add(this.body);
    model.rotation.x = -Math.PI / 2;
    model.scale.setScalar(FLY_SCALE);
    this.body.add(model);
    this.model = model;

    const materials = {};
    for (const [name, def] of Object.entries(rig.materials)) materials[name] = makeMaterial(name, def);
    this.materials = materials;

    this.nodes = {};
    model.traverse(o => { if (o.name) this.nodes[o.name] = o; });
    for (const g of rig.geoms) {
      const mesh = this.nodes[g.node];
      if (!mesh?.isMesh) continue;
      mesh.geometry.computeVertexNormals();
      mesh.material = materials[g.material];
      mesh.castShadow = g.material !== 'membrane';
      mesh.receiveShadow = true;
    }

    // Articulaciones: rotacion local = reposo * producto(eje_i, angulo_i)
    this.bodies = {};
    this.joints = {};
    for (const b of rig.bodies) {
      const node = this.nodes['b_' + b.name];
      const entry = { node, rest: node.quaternion.clone(), joints: [], pre: new THREE.Quaternion() };
      for (const j of b.joints) {
        const lo = j.range ? j.range[0] : -Infinity, hi = j.range ? j.range[1] : Infinity;
        // Pose de pie = articulaciones en 0 (patas abiertas); las alas usan springref (plegadas sobre el abdomen)
        const restVal = j.name.startsWith('wing_') ? j.rest : 0;
        const jt = { ...j, axisV: new THREE.Vector3(...j.axis), lo, hi, value: THREE.MathUtils.clamp(restVal, lo, hi) };
        jt.base = jt.value;
        entry.joints.push(jt);
        this.joints[j.name] = jt;
      }
      this.bodies[b.name] = entry;
    }

    this.heading = 0;
    this.gaitPhase = 0;
    this.time = 0;
    this.fall = 0;        // 0 de pie, 1 panza arriba
    this.sway = 0;
    this.spin = 0;
    this.applyPose();
    this.standHeight = this.computeStandHeight();
    this.body.position.y = this.standHeight;
  }

  /** Altura para que las garras toquen el suelo en la pose de reposo. */
  computeStandHeight() {
    this.root.updateMatrixWorld(true);
    let minY = Infinity;
    const v = new THREE.Vector3();
    for (const leg of LEGS) {
      this.nodes['b_claw_' + leg].getWorldPosition(v);
      minY = Math.min(minY, v.y - this.root.position.y);
    }
    return -minY + 0.02;
  }

  /** Rotacion extra de un cuerpo, expresada en el marco del torax (aplicada en su origen). */
  preRotate(bodyName, axis, angle) {
    const e = this.bodies[bodyName];
    _q.setFromAxisAngle(axis, angle);
    e.pre.premultiply(_q);
  }

  setJoint(name, value) {
    const j = this.joints[name];
    if (j) j.value = THREE.MathUtils.clamp(value, j.lo, j.hi);
  }

  offsetJoint(name, delta) {
    const j = this.joints[name];
    if (j) j.value = THREE.MathUtils.clamp(j.base + delta, j.lo, j.hi);
  }

  resetPose() {
    for (const e of Object.values(this.bodies)) {
      e.pre.identity();
      for (const j of e.joints) j.value = j.base;
    }
  }

  applyPose() {
    for (const e of Object.values(this.bodies)) {
      const q = e.node.quaternion.copy(e.pre).multiply(e.rest);
      for (const j of e.joints) q.multiply(_q2.setFromAxisAngle(j.axisV, j.value));
    }
  }

  get position() { return this.root.position; }

  /**
   * Anima un cuadro.
   * m = { speed (mm/s), mode, tremor 0..1, wings 0..1 (zumbido), spread 0..1, proboscis 0..1,
   *       fall 0..1, sway 0..1, groom 0..1, curl 0..1, look (rad) }
   */
  update(dt, m) {
    this.time += dt;
    const t = this.time;
    this.resetPose();

    // --- Marcha en tripode ---
    const stride = 0.55;
    const freq = Math.min(10, m.speed * 0.55);
    this.gaitPhase += freq * dt;
    const swingAmp = Math.min(0.45, 0.12 + m.speed * 0.02) * (m.speed > 0.2 ? 1 : 0);
    for (const leg of LEGS) {
      const left = leg.endsWith('left') ? 1 : -1;
      const front = leg.startsWith('T1');
      const phi = this.gaitPhase + TRIPOD[leg];
      const fore = Math.sin(phi) * swingAmp * stride / 0.55;
      const lift = Math.max(0, Math.cos(phi)) * swingAmp * 0.9;
      // barrido adelante/atras alrededor del eje vertical del torax
      this.preRotate('coxa_' + leg, Z, fore * left);
      // levantar la pata en la fase de vuelo
      this.preRotate('coxa_' + leg, X, lift * left);

      if (m.groom > 0 && front) {
        // acicalarse: patas delanteras hacia la cabeza, frotandose
        const rub = Math.sin(t * 22) * 0.18;
        this.preRotate('coxa_' + leg, Z, (0.55 + rub) * left * m.groom);
        this.preRotate('coxa_' + leg, X, 0.5 * left * m.groom);
        this.preRotate('coxa_' + leg, Y, -0.35 * m.groom);
      }
      if (m.curl > 0) {
        // patas encogidas (dormida / muerta)
        this.offsetJoint('femur_' + leg, 0.9 * m.curl);
        this.offsetJoint('tibia_' + leg, 1.0 * m.curl);
        this.preRotate('coxa_' + leg, X, -0.35 * left * m.curl);
      }
      if (m.flail > 0) {
        this.preRotate('coxa_' + leg, Z, Math.sin(t * 9 + phi * 1.7) * 0.5 * left * m.flail);
        this.preRotate('coxa_' + leg, X, Math.sin(t * 7 + phi) * 0.4 * left * m.flail);
      }
      if (m.tremor > 0) {
        this.preRotate('coxa_' + leg, X, (Math.random() - 0.5) * 0.25 * m.tremor);
        this.preRotate('coxa_' + leg, Z, (Math.random() - 0.5) * 0.25 * m.tremor);
      }
    }

    // --- Alas ---
    for (const side of ['left', 'right']) {
      const s = side === 'left' ? 1 : -1;
      const spread = Math.max(m.spread, m.wings * 0.6);
      this.preRotate('wing_' + side, Z, -0.9 * spread * s);
      if (m.wings > 0) this.preRotate('wing_' + side, Y, Math.sin(t * 95) * 0.5 * m.wings + 0.25 * m.wings);
      if (m.tremor > 0) this.preRotate('wing_' + side, Y, (Math.random() - 0.5) * 0.12 * m.tremor);
    }
    const haltere = Math.sin(t * 60) * 0.2;
    this.offsetJoint('haltere_left', haltere);
    this.offsetJoint('haltere_right', -haltere);

    // --- Cabeza, antenas, proboscide, abdomen ---
    this.setJoint('head_twist', (m.look || 0) + Math.sin(t * 0.7) * 0.05 + (m.tremor ? (Math.random() - 0.5) * 0.1 * m.tremor : 0));
    this.setJoint('head', Math.sin(t * 1.3) * 0.05 - (m.groom ? 0.25 * m.groom : 0));
    const ant = Math.sin(t * 3.1) * 0.15 + (m.tremor ? (Math.random() - 0.5) * 0.6 * m.tremor : 0);
    this.offsetJoint('antenna_left', ant);
    this.offsetJoint('antenna_right', -ant);
    this.setJoint('rostrum', THREE.MathUtils.lerp(0.183, -1.1, m.proboscis || 0));
    this.setJoint('haustellum', THREE.MathUtils.lerp(0.7, -1.0, m.proboscis || 0));
    const breathe = Math.sin(t * 2.2) * 0.04;
    for (const n of ['abdomen', 'abdomen_2', 'abdomen_3', 'abdomen_4']) this.offsetJoint(n, breathe);

    this.applyPose();

    // --- Postura global: caida panza arriba, balanceo de borracha, giro ---
    this.fall += ((m.fall || 0) - this.fall) * Math.min(1, dt * 4);
    this.sway = m.sway || 0;
    const roll = this.fall * Math.PI + Math.sin(t * 2.3) * 0.28 * this.sway;
    this.body.rotation.set(roll, 0, Math.sin(t * 1.7) * 0.12 * this.sway, 'YXZ');
    this.body.position.y = THREE.MathUtils.lerp(this.standHeight, 0.9, this.fall) - (m.curl ? 0.25 * m.curl * (1 - this.fall) : 0);
    this.root.rotation.y = this.heading;
  }

  /** Direccion hacia adelante en el plano XZ del mundo. */
  forward(out = new THREE.Vector3()) {
    return out.set(Math.cos(this.heading), 0, -Math.sin(this.heading));
  }
}
