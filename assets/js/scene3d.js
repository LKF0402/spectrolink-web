// SpectroLink Web · 三维装置链路
// 与 2D SVG 同语义、同一份 state：装置几何是真实三维的（可拖拽旋转/滚轮缩放），
// 不是把平面图斜着画。无 WebGL 时由 app.js 回退到 SVG 版本。
//
// 几何按物理链路布置（同一直线光轴）：激光器 → 准直 → 光程池入口窗 → 池内气体 → 出口窗 → 探测器 → 前放 → 锁相。
// 池内为单程直射，不做多次反射的视觉暗示，避免与实际 L（单程光程）混淆。

import * as THREE from "../../vendor/three/three.module.js";

const BEAM_COLOR = 0xffa94d;
const CELL_X = 0.28;      // 池半长（世界单位）
const CELL_H = 0.145;

function box(w, h, d, color, opts = {}) {
  const mat = new THREE.MeshStandardMaterial({
    color,
    metalness: opts.metalness ?? 0.35,
    roughness: opts.roughness ?? 0.45,
    transparent: opts.opacity != null,
    opacity: opts.opacity ?? 1,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  return mesh;
}

export const Instrument3D = {
  ok: false,
  host: null, renderer: null, scene: null, camera: null,
  spot: null, core: null, glow: null, gas: null,
  view: { theta: 0.74, phi: 0.68, r: 1.45 },
  dirty: true,
  last: null,
  drag: null,

  init(host) {
    if (!host) return false;
    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    } catch (e) {
      return false;                       // 无 WebGL：调用方回退 SVG
    }
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.setClearAlpha(0);
    host.appendChild(renderer.domElement);

    this.host = host;
    this.renderer = renderer;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(38, 1, 0.05, 20);

    const scene = this.scene;
    scene.add(new THREE.AmbientLight(0xffffff, 0.6));
    const key = new THREE.DirectionalLight(0xffffff, 0.9);
    key.position.set(0.9, 1.2, 0.8);
    scene.add(key);
    const fill = new THREE.DirectionalLight(0xbfe3de, 0.4);
    fill.position.set(-1.0, 0.5, -0.9);
    scene.add(fill);
    const emitL = new THREE.PointLight(0xffa94d, 1.1, 0.9);
    emitL.position.set(-0.44, 0.02, 0.02);
    scene.add(emitL);

    this.build();

    // 拖拽旋转 + 滚轮缩放（指针事件足够，不引 OrbitControls）
    const el = renderer.domElement;
    el.style.touchAction = "none";
    el.style.cursor = "grab";
    el.addEventListener("pointerdown", (ev) => {
      this.drag = { x: ev.clientX, y: ev.clientY };
      el.setPointerCapture(ev.pointerId);
      el.style.cursor = "grabbing";
    });
    el.addEventListener("pointermove", (ev) => {
      if (!this.drag) return;
      const dx = ev.clientX - this.drag.x;
      const dy = ev.clientY - this.drag.y;
      this.drag = { x: ev.clientX, y: ev.clientY };
      this.view.theta -= dx * 0.006;
      this.view.phi = Math.min(1.32, Math.max(0.22, this.view.phi - dy * 0.005));
      this.dirty = true;
    });
    const stop = () => { this.drag = null; el.style.cursor = "grab"; };
    el.addEventListener("pointerup", stop);
    el.addEventListener("pointercancel", stop);
    el.addEventListener("wheel", (ev) => {
      ev.preventDefault();
      this.view.r = Math.min(2.8, Math.max(0.85, this.view.r * (1 + ev.deltaY * 0.0008)));
      this.dirty = true;
    }, { passive: false });

    this.onResize = this.onResize.bind(this);
    window.addEventListener("resize", this.onResize);
    this.onResize();

    this.ok = true;
    this.loop();
    return true;
  },

  build() {
    const g = new THREE.Group();
    this.group = g;
    this.scene.add(g);

    // 激光器本体
    const laser = box(0.075, 0.06, 0.06, 0x3d444b, { metalness: 0.45, roughness: 0.4 });
    laser.position.set(-0.44, 0, 0);
    g.add(laser);

    // 发光面（朝 +x）
    const face = new THREE.Mesh(
      new THREE.PlaneGeometry(0.018, 0.018),
      new THREE.MeshBasicMaterial({ color: BEAM_COLOR, transparent: true, opacity: 0.9 })
    );
    face.rotation.y = Math.PI / 2;
    face.position.set(-0.4022, 0, 0);
    g.add(face);

    // 准直透镜
    const lens = new THREE.Mesh(
      new THREE.CylinderGeometry(0.024, 0.024, 0.005, 40),
      new THREE.MeshStandardMaterial({ color: 0xd2e6e8, transparent: true, opacity: 0.5,
                                       roughness: 0.08, metalness: 0.05 })
    );
    lens.rotation.z = Math.PI / 2;
    lens.position.set(-0.368, 0, 0);
    g.add(lens);

    // 光程池（玻璃腔 + 边框）
    const cell = box(CELL_X * 2, CELL_H, CELL_H, 0xdfeef0, { opacity: 0.12, metalness: 0.1, roughness: 0.05 });
    g.add(cell);
    const edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(cell.geometry),
      new THREE.LineBasicMaterial({ color: 0x8d979f, transparent: true, opacity: 0.8 })
    );
    g.add(edges);

    // 端窗
    for (const sx of [-1, 1]) {
      const win = box(0.006, CELL_H * 0.92, CELL_H * 0.92, 0xcfe3e6, { opacity: 0.35, roughness: 0.03 });
      win.position.set(sx * CELL_X, 0, 0);
      g.add(win);
    }

    // 池内气体（浓度越高越"实"）
    const gasMat = new THREE.MeshBasicMaterial({ color: 0x6fbfb4, transparent: true, opacity: 0.06, depthWrite: false });
    const gas = new THREE.Mesh(new THREE.BoxGeometry(CELL_X * 2 - 0.012, CELL_H * 0.8, CELL_H * 0.8), gasMat);
    gas.position.set(0, 0, 0);
    g.add(gas);
    this.gas = gas;

    // 光束：核心 + 外辉光。长度止于探测器前表面（x=0.3125），不穿入器件内部
    const len = 0.715;
    const coreMat = new THREE.MeshBasicMaterial({ color: BEAM_COLOR, transparent: true, opacity: 0.85 });
    const core = new THREE.Mesh(new THREE.CylinderGeometry(0.0035, 0.0035, len, 14), coreMat);
    core.rotation.z = Math.PI / 2;
    core.position.set(-0.045, 0, 0);
    g.add(core);
    this.core = core;

    const glowMat = new THREE.MeshBasicMaterial({
      color: BEAM_COLOR, transparent: true, opacity: 0.2,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const glow = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.011, len, 16), glowMat);
    glow.rotation.z = Math.PI / 2;
    glow.position.copy(core.position);
    g.add(glow);
    this.glow = glow;

    // 瞬时波数光点
    const spot = new THREE.Mesh(
      new THREE.SphereGeometry(0.011, 20, 14),
      new THREE.MeshBasicMaterial({ color: 0xffd7a0 })
    );
    spot.position.set(0, 0, 0);
    g.add(spot);
    this.spot = spot;

    // 探测器 / 前放 / 锁相
    const pd = box(0.085, 0.07, 0.07, 0x424c55, { metalness: 0.4, roughness: 0.4 });
    pd.position.set(0.355, 0, 0);
    g.add(pd);
    const pdFace = new THREE.Mesh(
      new THREE.PlaneGeometry(0.032, 0.032),
      new THREE.MeshBasicMaterial({ color: 0x86c7bf, transparent: true, opacity: 0.75 })
    );
    pdFace.rotation.y = Math.PI / 2;
    pdFace.position.set(0.3115, 0, 0);
    g.add(pdFace);

    const tia = box(0.058, 0.045, 0.045, 0xb9c4cc, { metalness: 0.3, roughness: 0.55 });
    tia.position.set(0.45, 0, 0.085);
    g.add(tia);
    const lock = box(0.07, 0.05, 0.05, 0x9fc3be, { metalness: 0.25, roughness: 0.5 });
    lock.position.set(0.45, 0, -0.085);
    g.add(lock);

    // 信号连线（PD → 前放 / 锁相）
    const line = (a, b, color) => {
      const geo = new THREE.BufferGeometry().setFromPoints([a, b]);
      return new THREE.Line(geo, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.7 }));
    };
    g.add(line(new THREE.Vector3(0.355, 0.035, 0.02), new THREE.Vector3(0.45, 0.0225, 0.085), 0x7f8b95));
    g.add(line(new THREE.Vector3(0.355, -0.035, 0.02), new THREE.Vector3(0.45, -0.025, -0.085), 0x7f8b95));
  },

  update(state) {
    if (!this.ok) return;
    this.last = state;
    const { wn0, span, nu, phase, x } = state;

    const t = Math.min(1, Math.max(0, (nu - (wn0 - span)) / (2 * span)));
    this.spot.position.x = -CELL_X + (CELL_H * 0.06) + t * (CELL_X * 2 - CELL_H * 0.12);

    // 调制项：亮度按 phase 周期性起伏（示意，不代表真实波形形状）
    const mod = 0.5 + 0.5 * Math.sin(phase * Math.PI * 2 * 10);
    this.glow.material.opacity = 0.10 + 0.28 * mod;
    this.core.material.opacity = 0.55 + 0.35 * mod;

    // 浓度 → 气体体积的"实感"（2000 ppm 封顶，超过不再加深，避免误导为饱和）
    const ppm = Math.min(2000, Math.max(0, (x || 0) * 1e6));
    this.gas.material.opacity = 0.03 + (ppm / 2000) * 0.13;

    this.dirty = true;
  },

  setVisible(v) {
    if (!this.host) return;
    this.host.style.display = v ? "" : "none";
    if (v) { this.dirty = true; this.onResize(); }
  },

  onResize() {
    if (!this.renderer || !this.host) return;
    const w = Math.max(200, this.host.clientWidth);
    const h = Math.max(160, this.host.clientHeight);
    this.renderer.setSize(w, h, true);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.dirty = true;
  },

  frame() {
    const v = this.view;
    const sp = Math.sin(v.phi);
    this.camera.position.set(
      v.r * sp * Math.cos(v.theta),
      v.r * Math.cos(v.phi),
      v.r * sp * Math.sin(v.theta)
    );
    this.camera.lookAt(0.05, 0, 0);
  },

  loop() {
    const step = () => {
      if (this.dirty) {
        this.frame();
        this.renderer.render(this.scene, this.camera);
        this.dirty = false;
      }
      this.raf = requestAnimationFrame(step);
    };
    this.raf = requestAnimationFrame(step);
  },

  dispose() {
    if (this.raf) cancelAnimationFrame(this.raf);
    window.removeEventListener("resize", this.onResize);
    if (this.renderer) {
      this.renderer.dispose();
      this.renderer.domElement.remove();
    }
    this.ok = false;
  },
};
