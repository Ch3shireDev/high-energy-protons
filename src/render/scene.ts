// Scena Three.js: detektor, ślady, aureola, post-processing (bloom, aberracja).
// Efekty sterują tylko parametrami renderu – nigdy danymi fizyki.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import type { DetectorConfig } from '../sim/detector';
import { disposeGroup } from './aureola';
import type { TrackView } from './tracks';

const MM = 1 / 1000;

const AberrationShader = {
  uniforms: { tDiffuse: { value: null }, uAmount: { value: 0 } },
  vertexShader: /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse; uniform float uAmount; varying vec2 vUv;
    void main(){
      vec2 d = (vUv - 0.5) * uAmount;
      float r = texture2D(tDiffuse, vUv + d).r;
      float g = texture2D(tDiffuse, vUv).g;
      float b = texture2D(tDiffuse, vUv - d).b;
      gl_FragColor = vec4(r, g, b, 1.0);
    }`,
};

export interface FxState {
  science: boolean;
  /** 0..1 – impuls z beatu muzyki (prezentacja). */
  beat: number;
  /** 0..1 – błysk zderzenia (prezentacja). */
  flash: number;
  /** Jasność śladów i bloomu, 0.1..2 (suwak w UI). */
  brightness: number;
}

export class SceneView {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  composer: EffectComposer;
  bloom: UnrealBloomPass;
  aberration: ShaderPass;
  detector = new THREE.Group();
  private tracks: TrackView | null = null;
  private aureola: THREE.Object3D | null = null;
  private flashMesh: THREE.Mesh;
  fx: FxState = { science: false, beat: 0, flash: 0, brightness: 0.5 };

  constructor(private canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.setClearColor(0x05060a, 1);
    this.camera = new THREE.PerspectiveCamera(45, 1, 0.01, 200);
    this.camera.position.set(4.2, 2.6, 5.2);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.target.set(0, 0, 0);

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.7, 0.4, 0.3);
    this.composer.addPass(this.bloom);
    this.aberration = new ShaderPass(AberrationShader);
    this.composer.addPass(this.aberration);
    this.composer.addPass(new OutputPass());

    this.scene.add(this.detector);
    this.flashMesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.06, 24, 12),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }),
    );
    this.scene.add(this.flashMesh);
    this.resize();
    new ResizeObserver(() => this.resize()).observe(canvas);
  }

  resize(): void {
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  buildDetector(det: DetectorConfig, show = { muon: true }): void {
    disposeGroup(this.detector);
    this.detector.clear();
    const shell = (r: number, hz: number, color: number, opacity: number, rings = 2, staves = 24) => {
      const pts: THREE.Vector3[] = [];
      const nSeg = 96;
      for (let k = 0; k < rings; k++) {
        const z = rings === 1 ? 0 : -hz + (2 * hz * k) / (rings - 1);
        for (let i = 0; i < nSeg; i++) {
          const a0 = (2 * Math.PI * i) / nSeg;
          const a1 = (2 * Math.PI * (i + 1)) / nSeg;
          pts.push(new THREE.Vector3(r * Math.cos(a0), r * Math.sin(a0), z), new THREE.Vector3(r * Math.cos(a1), r * Math.sin(a1), z));
        }
      }
      for (let i = 0; i < staves; i++) {
        const a = (2 * Math.PI * i) / staves;
        pts.push(new THREE.Vector3(r * Math.cos(a), r * Math.sin(a), -hz), new THREE.Vector3(r * Math.cos(a), r * Math.sin(a), hz));
      }
      const g = new THREE.BufferGeometry().setFromPoints(pts);
      return new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color, transparent: true, opacity, depthWrite: false }));
    };
    const c = (x: { r_mm: number; halfZ_mm: number }) => [x.r_mm * MM, x.halfZ_mm * MM] as const;
    this.detector.add(shell(...c(det.tracker), 0x3a4256, 0.35, 5, 36));
    // Warstwy trackera (wewnętrzne).
    for (const r of [0.04, 0.07, 0.11, 0.16, 0.25, 0.35, 0.5, 0.6, 0.7, 0.8, 0.95]) this.detector.add(shell(r, det.tracker.halfZ_mm * MM * Math.min(1, 0.3 + r), 0x2a3142, 0.25, 2, 0));
    this.detector.add(shell(...c(det.ecal), 0x2f6a6a, 0.3, 3, 48));
    this.detector.add(shell(...c(det.hcal), 0x6a4a2f, 0.25, 3, 36));
    this.detector.add(shell(...c(det.solenoid), 0x444a5a, 0.2, 2, 18));
    if (show.muon) {
      this.detector.add(shell(...c(det.muon.inner), 0x2f5a3a, 0.2, 4, 12));
      this.detector.add(shell(...c(det.muon.outer), 0x2f5a3a, 0.2, 4, 12));
    }
    // Oś wiązki.
    const beam = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, -det.world.halfZ_mm * MM), new THREE.Vector3(0, 0, det.world.halfZ_mm * MM)]);
    this.detector.add(new THREE.Line(beam, new THREE.LineBasicMaterial({ color: 0x5a6375, transparent: true, opacity: 0.5 })));
  }

  setTracks(v: TrackView | null): void {
    if (this.tracks) {
      this.scene.remove(this.tracks.group);
      this.tracks.dispose();
    }
    this.tracks = v;
    if (v) this.scene.add(v.group);
  }

  setAureola(g: THREE.Object3D | null, at: [number, number, number] = [0, 0, 0]): void {
    if (this.aureola) {
      this.scene.remove(this.aureola);
      disposeGroup(this.aureola);
    }
    this.aureola = g;
    if (g) {
      g.position.set(at[0] * MM, at[1] * MM, at[2] * MM);
      this.scene.add(g);
    }
  }

  frame(t_ns: number): void {
    const f = this.fx;
    const glow = f.science ? 0 : 1;
    this.tracks?.setTime(t_ns, glow, f.brightness);
    this.bloom.enabled = !f.science;
    // Bloom skaluje się z jasnością, żeby suwak faktycznie przyciemniał obraz.
    this.bloom.strength = Math.min(1, f.brightness) * (0.7 + 0.8 * f.beat + 1.2 * f.flash);
    this.aberration.enabled = !f.science && f.flash + f.beat > 0.01;
    this.aberration.uniforms.uAmount.value = 0.012 * f.flash + 0.004 * f.beat;
    const m = this.flashMesh.material as THREE.MeshBasicMaterial;
    m.opacity = f.science ? 0 : f.flash * Math.min(1, f.brightness);
    this.flashMesh.scale.setScalar(1 + 6 * (1 - f.flash));
    this.controls.update();
    if (f.science) this.renderer.render(this.scene, this.camera);
    else this.composer.render();
  }

  zoomTo(radius_m: number): void {
    const dir = this.camera.position.clone().sub(this.controls.target).normalize();
    this.camera.position.copy(dir.multiplyScalar(radius_m * 2.6));
    this.controls.target.set(0, 0, 0);
  }
}
