// Aureola prawdopodobieństwa: powierzchnia r(Ω) ∝ dP/dΩ w układzie spoczynkowym rodzica
// + kropka w faktycznie wylosowanym kierunku. Kształt z tej samej funkcji, co generator.

import * as THREE from 'three';
import { density, type AngularDist } from '../physics/angular';
import type { V3 } from '../physics/vec4';

export function buildAureola(dist: AngularDist, axis: V3, dir: V3 | null, size = 0.28): THREE.Group {
  const geo = new THREE.SphereGeometry(1, 40, 20);
  const p = geo.attributes.position as THREE.BufferAttribute;
  const n = new THREE.Vector3();
  const ax = new THREE.Vector3(...axis).normalize();
  let max = 0;
  const dens: number[] = [];
  for (let i = 0; i < p.count; i++) {
    n.fromBufferAttribute(p, i).normalize();
    const v = density(dist, n.dot(ax));
    dens.push(v);
    max = Math.max(max, v);
  }
  const colors = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    n.fromBufferAttribute(p, i).normalize();
    const f = max > 0 ? dens[i] / max : 0;
    const r = size * (0.08 + 0.92 * f);
    p.setXYZ(i, n.x * r, n.y * r, n.z * r);
    // Jasność koduje gęstość prawdopodobieństwa.
    const b = 0.1 + 0.5 * f;
    colors.set([0.85 * b, 0.9 * b, 1.0 * b], i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  const mat = new THREE.MeshBasicMaterial({ vertexColors: true, wireframe: true, transparent: true, opacity: 0.55, depthWrite: false });
  const g = new THREE.Group();
  g.add(new THREE.Mesh(geo, mat));
  // Oś (wiązka / spin).
  const axGeo = new THREE.BufferGeometry().setFromPoints([ax.clone().multiplyScalar(-size * 1.4), ax.clone().multiplyScalar(size * 1.4)]);
  g.add(new THREE.Line(axGeo, new THREE.LineBasicMaterial({ color: 0x7c8594, transparent: true, opacity: 0.6 })));
  if (dir) {
    const d = new THREE.Vector3(...dir).normalize();
    const r = size * (0.08 + (0.92 * density(dist, d.dot(ax))) / (max || 1));
    const dot = new THREE.Mesh(new THREE.SphereGeometry(size * 0.06, 16, 8), new THREE.MeshBasicMaterial({ color: 0xbfe3ff }));
    dot.position.copy(d.multiplyScalar(r));
    g.add(dot);
  }
  return g;
}

export function disposeGroup(g: THREE.Object3D): void {
  g.traverse((o) => {
    const m = o as THREE.Mesh;
    m.geometry?.dispose();
    const mat = m.material as THREE.Material | THREE.Material[] | undefined;
    if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
    else mat?.dispose();
  });
}
