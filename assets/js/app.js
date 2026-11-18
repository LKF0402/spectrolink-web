// SpectroLink Web · 主线程 UI
// 负责：读取 manifest → 组装参数 → 交给 Worker 计算 → 用 uPlot 绘图。
// 物理计算一律不在此处发生，这里只做 I/O 与绘图。

import { Instrument } from "./instrument.js";

// uPlot 随站点分发（不依赖第三方 CDN）
const UPLOT_URL = new URL("../../vendor/uplot/uPlot.esm.js", import.meta.url).href;

const $ = (id) => document.getElementById(id);
const els = {
  preset: $("preset"), presetMeta: $("preset-meta"),
  T: $("T"), P: $("P"), ppm: $("ppm"), L: $("L"),
  span: $("span"), a: $("a"), n_scan: $("n_scan"), n_mod: $("n_mod"),
  run: $("run"), runHint: $("run-hint"),
  statusDot: $("status-dot"), statusText: $("status-text"),
  progressWrap: $("progress-wrap"), progressBar: $("progress-bar"),
  rPeak2f: $("r-peak2f"), rPeak2fWn: $("r-peak2f-wn"), rPeak2f1f: $("r-peak2f1f"),
  rAlpha: $("r-alpha"), rLines: $("r-lines"), rElapsed: $("r-elapsed"),
  provenance: $("provenance"),
  scanPlay: $("scan-play"), scanT: $("scan-t"),
};

const state = { manifest: null, ready: false, busy: false, UPlot: null, plots: {},
                phase: 0.5, playing: false, raf: 0, lastTs: 0 };

// ───────────────────────── 格式化 ─────────────────────────
const sci = (v, digits = 2) => {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  if (v === 0) return "0";
  const a = Math.abs(v);
  return (a < 1e-3 || a >= 1e4) ? v.toExponential(digits) : v.toPrecision(digits + 1);
};

function setStatus(kind, text) {
  els.statusDot.className = "dot " + kind;
  els.statusText.textContent = text;
}

function setProgress(pct) {
  els.progressBar.style.width = pct + "%";
  els.progressWrap.classList.toggle("hidden", pct >= 100);
}

function showHint(text, isError = false) {
  els.runHint.textContent = text;
  els.runHint.classList.toggle("error", isError);
}

// ───────────────────────── Worker ─────────────────────────
const worker = new Worker("assets/js/worker.js");
worker.onerror = (err) => {
  setStatus("error", "Worker 异常");
  showHint(`${err.message || "worker error"}${err.filename ? " @ " + err.filename : ""}`, true);
};

worker.onmessage = (ev) => {
  const msg = ev.data || {};
  switch (msg.type) {
    case "stage":
      setStatus("busy", msg.text);
      setProgress(msg.pct);
      break;
    case "ready":
      state.ready = true;
      setStatus("ready", "就绪");
      setProgress(100);
      els.run.disabled = false;
      showHint(`运行时 ${msg.info.python} · numpy ${msg.info.numpy}`);
      runSim();
      break;
    case "result":
      state.busy = false;
      els.run.disabled = false;
      render(msg.data, msg.elapsed);
      break;
    case "error":
      state.busy = false;
      els.run.disabled = false;
      setStatus("error", "计算失败");
      showHint(`${msg.error}${msg.hint ? " · " + msg.hint : ""}`, true);
      break;
    case "dbg":
      showHint(msg.m);
      break;
    case "fatal":
      setStatus("error", "运行时启动失败");
      showHint(msg.error, true);
      break;
    default:
      break;
  }
};

// ───────────────────────── 参数 ─────────────────────────
async function loadManifest() {
  const res = await fetch("data/manifest.json", { cache: "no-cache" });
  if (!res.ok) throw new Error("manifest.json 缺失（先运行 tools/build_tables.py）");
  state.manifest = await res.json();

  els.preset.innerHTML = "";
  for (const p of state.manifest.presets) {
    const opt = document.createElement("option");
    opt.value = p.id;
    opt.textContent = p.label;
    els.preset.appendChild(opt);
  }
  applyPreset(state.manifest.presets[0].id);
}

function currentPreset() {
  const p = state.manifest.presets.find((x) => x.id === els.preset.value);
  return p || state.manifest.presets[0];
}

function applyPreset(id) {
  const p = state.manifest.presets.find((x) => x.id === id) || state.manifest.presets[0];
  els.preset.value = p.id;
  const strong = p.strongest_line
    ? `最强线 ${p.strongest_line.nu.toFixed(4)} cm⁻¹ (S=${sci(p.strongest_line.sw)})`
    : "";
  els.presetMeta.textContent =
    `${p.species} · ${p.n_lines} 条线 · 窗 ${p.coverage[0].toFixed(2)}–${p.coverage[1].toFixed(2)} cm⁻¹ · ${strong}`;
  els.span.max = String(Math.min(2, p.span_max));
  if (Number(els.span.value) > Number(els.span.max)) els.span.value = els.span.max;
  if (p.defaults) {
    if (p.defaults.ppm) els.ppm.value = p.defaults.ppm;
    if (p.defaults.a) els.a.value = p.defaults.a;
    if (p.defaults.L) els.L.value = p.defaults.L;
    if (p.defaults.span) els.span.value = p.defaults.span;
  }
}

function buildParams() {
  const p = currentPreset();
  return {
    species: p.species,
    wn0: p.wn0,
    T: Number(els.T.value),
    P: Number(els.P.value),
    x: Number(els.ppm.value) * 1e-6,
    L: Number(els.L.value),
    a: Number(els.a.value),
    span: Number(els.span.value),
    n_scan: Number(els.n_scan.value),
    n_mod: Number(els.n_mod.value),
  };
}

function runSim() {
  if (!state.ready || state.busy) return;
  const p = currentPreset();
  state.busy = true;
  els.run.disabled = true;
  setStatus("busy", "计算中…");
  worker.postMessage({ type: "simulate", params: buildParams(), table: p.table });
}

let debounceTimer = null;
function scheduleRun() {
  if (!state.ready) return;
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(runSim, 380);
}

// ───────────────────────── 绘图 ─────────────────────────
async function getUPlot() {
  if (!state.UPlot) {
    const mod = await import(UPLOT_URL);
    state.UPlot = mod.default || mod;
  }
  return state.UPlot;
}

const COLORS = {
  alpha: "#0f6d63",
  S1f: "#1d4ed8",
  S2f: "#b45309",
  S4f: "#6b7280",
  calib: "#9d1c3f",
};

function axisX() {
  return {
    label: "波数 (cm⁻¹)",
    labelSize: 22,
    stroke: "#4b5158",
    grid: { stroke: "#eeeef0", width: 1 },
    ticks: { stroke: "#d8d8d4", size: 5 },
    font: '11px ui-monospace, Menlo, monospace',
    values: (u, splits) => splits.map((v) => (v == null ? "" : String(+v.toFixed(3)))),
  };
}

function axisY(label) {
  return {
    label,
    labelSize: 22,
    stroke: "#4b5158",
    grid: { stroke: "#eeeef0", width: 1 },
    ticks: { stroke: "#d8d8d4", size: 5 },
    font: '11px ui-monospace, Menlo, monospace',
    size: 74,
    values: (u, splits) => splits.map((v) => (v == null ? "" : sci(v, 1))),
  };
}

async function draw(key, targetId, xs, seriesDefs) {
  const U = await getUPlot();
  const host = $(targetId);
  if (state.plots[key]) {
    state.plots[key].destroy();
    state.plots[key] = null;
  }
  const ys = seriesDefs.map((s) => s.data);
  const width = Math.max(280, host.clientWidth);
  const height = host.clientHeight || 220;

  state.plots[key] = new U(
    {
      width,
      height,
      padding: [6, 10, 0, 0],
      legend: { show: seriesDefs.length > 1, live: false, font: '11.5px ui-monospace, monospace' },
      cursor: { drag: { x: true, y: false, setScale: false } },
      scales: { x: { time: false } },
      axes: [axisX(), axisY(seriesDefs[0].axisLabel)],
      series: [
        { label: "波数" },
        ...seriesDefs.map((s) => ({
          label: s.label,
          stroke: s.color,
          width: s.width || 1.6,
          points: { show: false },
          data: s.data,
          value: (u, v) => (v == null ? "—" : sci(v, 2)),
        })),
      ],
    },
    [xs, ...ys],
    host
  );
}

function normalize(arr) {
  let m = 0;
  for (const v of arr) m = Math.max(m, Math.abs(v));
  return m > 0 ? arr.map((v) => v / m) : arr;
}

async function render(res, elapsed) {
  state.lastResult = res;
  state.lastElapsed = elapsed;
  setStatus("ready", "就绪");
  const m = res.meta;

  els.rPeak2f.textContent = sci(m.peak_2f);
  els.rPeak2fWn.textContent = m.peak_2f_wn.toFixed(4) + " cm⁻¹";
  els.rPeak2f1f.textContent = sci(m.peak_2f1f);
  els.rAlpha.textContent = sci(m.alpha_max);
  els.rLines.textContent = String(m.n_lines_in_window ?? "—");
  els.rElapsed.textContent = elapsed.toFixed(0) + " ms";

  const p = currentPreset();
  els.provenance.textContent =
    `线表 ${m.table || p.table} · sha256:${p.sha256_16}\n` +
    `T=${m.T} K · P=${m.P} atm · x=${sci(m.x)} · L=${m.L} cm · a=${m.a} cm⁻¹\n` +
    `SpectroLink 内核（浏览器内 CPython）· 输出为理论仿真`;

  const nu = res.axis.nu;
  const ws = res.axis.wn_scan;
  const c = res.curves;

  await draw("alpha", "plot-alpha", nu, [
    { label: "α", data: c.alpha, color: COLORS.alpha, width: 1.8, axisLabel: "α (cm⁻¹)" },
  ]);

  const norm = $("norm").checked;
  const pick = (arr) => (norm ? normalize(arr) : arr);
  await draw("harmonics", "plot-harmonics", ws, [
    { label: "R1f", data: pick(c.S1f), color: COLORS.S1f, axisLabel: norm ? "归一化幅度" : "谐波幅度 (a.u.)" },
    { label: "R2f", data: pick(c.S2f), color: COLORS.S2f, width: 2.0 },
    { label: "R4f", data: pick(c.S4f), color: COLORS.S4f },
  ]);

  await draw("calib", "plot-calib", ws, [
    { label: "2f/1f", data: c.S2f1f, color: COLORS.calib, width: 1.8, axisLabel: "2f/1f (a.u.)" },
  ]);

  syncAll();
}

// ───────────────────── 装置 ↔ 信号同步 ─────────────────────
// 扫描相位 phase ∈ [0,1] 映射为瞬时波数 ν = wn0 - span + 2·span·phase。
// 装置图上的光点位置与三张图的游标都由这一个 ν 驱动，不存在第二套时间轴。
function currentNu() {
  const p = currentPreset();
  const span = Number(els.span.value);
  return p.wn0 - span + 2 * span * state.phase;
}

function syncAll() {
  const res = state.lastResult;
  if (!res) return;
  const nu = currentNu();
  const preset = currentPreset();     // 谱区切换后立刻以新谱区为准，避免沿用上一次的 wn0
  const p = buildParams();            // 装置图反映"当前设定"，曲线反映"最近一次计算"
  Instrument.update({
    species: preset.species,
    wn0: preset.wn0,
    span: p.span,
    a: p.a,
    L: p.L,
    x: p.x,
    T: p.T,
    P: p.P,
    nu,
    phase: state.phase,
    peak2f: res.meta.peak_2f,
  });

  // 注意：uPlot 的 setCursor 只接受像素坐标，波数→像素必须走 valToPos
  for (const key of ["alpha", "harmonics", "calib"]) {
    const plot = state.plots[key];
    if (!plot) continue;
    plot.setCursor({ left: plot.valToPos(nu, "x"), top: 0 });
  }
}

function tick(ts) {
  if (!state.playing) return;
  const dt = state.lastTs ? (ts - state.lastTs) / 1000 : 0.016;
  state.lastTs = ts;
  state.phase = (state.phase + dt / 6) % 1;   // 6 s 一个扫描周期
  els.scanT.value = String(Math.round(state.phase * 1000));
  syncAll();
  state.raf = requestAnimationFrame(tick);
}

function togglePlay() {
  state.playing = !state.playing;
  state.lastTs = 0;
  els.scanPlay.textContent = state.playing ? "暂停扫描" : "播放扫描";
  if (state.playing) state.raf = requestAnimationFrame(tick);
  else cancelAnimationFrame(state.raf);
}

// 窗口尺寸变化时按新宽度重绘（uPlot 不做自动布局）
let resizeTimer = null;
window.addEventListener("resize", () => {
  if (!state.lastResult) return;
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => render(state.lastResult, state.lastElapsed || 0), 220);
});

// ───────────────────────── 事件绑定 ─────────────────────────
els.preset.addEventListener("change", () => {
  applyPreset(els.preset.value);
  scheduleRun();
});
for (const el of [els.T, els.P, els.ppm, els.L, els.span, els.a, els.n_scan, els.n_mod]) {
  el.addEventListener("input", scheduleRun);
}
$("norm").addEventListener("change", () => {
  if (state.lastResult) render(state.lastResult, state.lastElapsed || 0);
});
els.run.addEventListener("click", runSim);

els.scanPlay.addEventListener("click", togglePlay);
els.scanT.addEventListener("input", () => {
  if (state.playing) togglePlay();
  state.phase = Number(els.scanT.value) / 1000;
  syncAll();
});

// 注册 Service Worker：首次访问后把运行时与线表留在本地，之后弱网/断网也能打开。
// 失败不阻塞使用（部分浏览器在非 HTTPS 或隐身模式下属正常拒绝）。
if ("serviceWorker" in navigator) {
  navigator.serviceWorker
    .register(new URL("../../sw.js", import.meta.url).href)
    .catch(() => {});
}

// ───────────────────────── 启动 ─────────────────────────
(async function main() {
  try {
    Instrument.mount($("instrument"));
    await loadManifest();
    // 先按表单默认值画一次装置图，避免等待首次计算时空着
    const p0 = buildParams();
    Instrument.update({
      species: p0.species, wn0: p0.wn0, span: p0.span, a: p0.a, L: p0.L,
      x: p0.x, T: p0.T, P: p0.P,
      nu: p0.wn0 - p0.span + 2 * p0.span * state.phase,
      phase: state.phase, peak2f: null,
    });
    setStatus("busy", "加载运行时…");
    setProgress(3);
  } catch (err) {
    setStatus("error", "初始化失败");
    showHint(String(err.message || err), true);
  }
})();
