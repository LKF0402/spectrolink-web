// SpectroLink Web · 装置链路图
// 作用：把「仪器」和「信号」放在同一屏，由同一次计算驱动。
//   · 参数改动 → 装置上的标注（波长、扫描区间、调制幅度、光程、浓度）立即同步；
//   · 扫描相位变化 → 激光光点沿光程池移动，调制波形随之起伏，谱图游标同步走位。
//
// 几何约定：池内光束从 X0 到 X1 表示整个扫描区间 [wn0 - span, wn0 + span]，
// 因此任一瞬时波数 ν 的位置为 X0 + (ν - (wn0 - span)) / (2 span) * (X1 - X0)。
// 这是纯几何映射，不参与物理计算。

const X0 = 150;
const X1 = 710;
const BEAM_Y = 138;

const SVG = `
<svg viewBox="0 0 1000 300" preserveAspectRatio="xMidYMid meet" role="img"
     aria-label="TDLAS-WMS 透射式装置链路示意">
  <defs>
    <marker id="arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
      <path d="M0,0 L8,4 L0,8 z" fill="#8a9096"/>
    </marker>
    <linearGradient id="beamGrad" x1="0" x2="1">
      <stop offset="0" stop-color="#b45309" stop-opacity="0.55"/>
      <stop offset="1" stop-color="#b45309" stop-opacity="0.95"/>
    </linearGradient>
  </defs>

  <g>
    <rect x="16" y="110" width="96" height="56" rx="3" fill="#f6f5f2" stroke="#c9c7c1"/>
    <text x="64" y="130" text-anchor="middle" class="svg-t">DFB / ICL</text>
    <text x="64" y="146" text-anchor="middle" class="svg-s" id="t-lambda">λ = — µm</text>
    <text x="64" y="160" text-anchor="middle" class="svg-s" id="t-nu">ν = — cm⁻¹</text>
  </g>

  <ellipse cx="128" cy="${BEAM_Y}" rx="6" ry="19" fill="#dfe3e6" stroke="#b9c0c5"/>

  <rect x="${X0}" y="64" width="${X1 - X0}" height="148" rx="3"
        fill="#fbfaf7" stroke="#c9c7c1"/>
  <text x="${X0 + 12}" y="86" class="svg-s" id="t-L">L = — cm</text>
  <text x="${X1 - 12}" y="86" text-anchor="end" class="svg-s" id="t-TP">T — K · P — atm</text>
  <text x="${X0 + 12}" y="200" class="svg-s" id="t-x">x = — ppm</text>
  <text x="${X1 - 12}" y="200" text-anchor="end" class="svg-s" id="t-species">—</text>
  <text x="${(X0 + X1) / 2}" y="52" text-anchor="middle" class="svg-s" id="t-scan">ν 扫描 —</text>

  <line x1="112" y1="${BEAM_Y}" x2="${X1}" y2="${BEAM_Y}" stroke="url(#beamGrad)" stroke-width="2.5"/>
  <line x1="${X1}" y1="${BEAM_Y}" x2="748" y2="${BEAM_Y}" stroke="#b45309" stroke-width="2.5" opacity="0.75"/>
  <path id="mod-path" d="" fill="none" stroke="#b45309" stroke-width="1.3" opacity="0.85"/>
  <circle id="spot" cx="${(X0 + X1) / 2}" cy="${BEAM_Y}" r="4.5" fill="#b45309"/>

  <rect x="748" y="110" width="80" height="56" rx="3" fill="#f2f5f8" stroke="#c2cdd6"/>
  <text x="788" y="132" text-anchor="middle" class="svg-t">InGaAs PD</text>
  <text x="788" y="150" text-anchor="middle" class="svg-s">光电探测</text>

  <line x1="828" y1="${BEAM_Y}" x2="840" y2="${BEAM_Y}" stroke="#8a9096" stroke-width="1.6" marker-end="url(#arrow)"/>

  <rect x="840" y="110" width="64" height="56" rx="3" fill="#f2f5f8" stroke="#c2cdd6"/>
  <text x="872" y="132" text-anchor="middle" class="svg-t">TIA</text>
  <text x="872" y="150" text-anchor="middle" class="svg-s">前放</text>

  <line x1="904" y1="${BEAM_Y}" x2="916" y2="${BEAM_Y}" stroke="#8a9096" stroke-width="1.6" marker-end="url(#arrow)"/>

  <rect x="916" y="110" width="68" height="56" rx="3" fill="#eef3f2" stroke="#9dbfb9"/>
  <text x="950" y="132" text-anchor="middle" class="svg-t">Lock-in</text>
  <text x="950" y="150" text-anchor="middle" class="svg-s">2f 解调</text>

  <line x1="950" y1="166" x2="950" y2="192" stroke="#9dbfb9" stroke-width="1.4"/>
  <text x="950" y="208" text-anchor="middle" class="svg-s" id="t-freq">参考 f —</text>
  <text x="950" y="226" text-anchor="middle" class="svg-s" id="t-peak">2f 峰值 —</text>

  <text x="16" y="272" class="svg-s" id="t-note">扫描相位 —</text>
  <text x="16" y="290" class="svg-s">光点位置表示当前瞬时波数；波形为调制项示意，非按振幅绘制。</text>
</svg>
`;

export const Instrument = {
  host: null,
  svg: null,
  state: null,

  mount(host) {
    this.host = host;
    host.innerHTML = SVG;
    this.svg = host.querySelector("svg");
    this.el = {
      lambda: host.querySelector("#t-lambda"),
      nu: host.querySelector("#t-nu"),
      L: host.querySelector("#t-L"),
      TP: host.querySelector("#t-TP"),
      x: host.querySelector("#t-x"),
      species: host.querySelector("#t-species"),
      scan: host.querySelector("#t-scan"),
      freq: host.querySelector("#t-freq"),
      peak: host.querySelector("#t-peak"),
      note: host.querySelector("#t-note"),
      spot: host.querySelector("#spot"),
      mod: host.querySelector("#mod-path"),
    };
  },

  // state: { species, wn0, span, a, L, x, T, P, nu, phase, peak2f, peakWn }
  update(state) {
    if (!this.el) return;
    this.state = state;
    const { species, wn0, span, a, L, x, T, P, nu, phase, peak2f } = state;
    const e = this.el;

    const lambda = wn0 > 0 ? 1e4 / wn0 : NaN;
    e.lambda.textContent = `λ = ${lambda.toFixed(4)} µm`;
    e.nu.textContent = `ν = ${nu.toFixed(4)} cm⁻¹`;
    e.L.textContent = `L = ${fmt(L)} cm`;
    e.TP.textContent = `T ${fmt(T)} K · P ${fmt(P)} atm`;
    e.x.textContent = `x = ${fmt(x * 1e6)} ppm`;
    e.species.textContent = species || "—";
    e.scan.textContent = `ν 扫描 ${(wn0 - span).toFixed(3)} – ${(wn0 + span).toFixed(3)} cm⁻¹`;
    e.freq.textContent = `参考 f —`;
    e.peak.textContent = peak2f == null ? "2f 峰值 —" : `2f 峰值 ${sci(peak2f)}`;
    e.note.textContent = `扫描相位 ${(phase * 100).toFixed(0)}%`;

    // 光点位置
    const t = clamp01((nu - (wn0 - span)) / (2 * span));
    const px = X0 + t * (X1 - X0);
    e.spot.setAttribute("cx", px.toFixed(1));

    // 调制波形：幅度随 a/span 增大，波形固定在光点两侧
    // 用开方映射：a/span 很小的常用工况也要能看出调制，否则视觉上像一条直线
    const ampPx = clamp(Math.sqrt(a / span) * 30, 5, 34);
    const halfW = 46;
    let d = "";
    const N = 40;
    for (let i = 0; i <= N; i++) {
      const u = i / N;
      const sx = px - halfW + u * 2 * halfW;
      const sy = BEAM_Y - Math.sin(u * Math.PI * 4) * ampPx;
      d += `${i ? "L" : "M"}${sx.toFixed(1)},${sy.toFixed(1)}`;
    }
    e.mod.setAttribute("d", d);
  },
};

function clamp01(v) {
  return !Number.isFinite(v) ? 0.5 : Math.min(1, Math.max(0, v));
}
function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v));
}
function fmt(v) {
  if (v == null || !Number.isFinite(v)) return "—";
  const a = Math.abs(v);
  return a >= 1000 ? v.toFixed(0) : a >= 10 ? v.toFixed(1) : v.toFixed(3);
}
function sci(v) {
  if (v == null || !Number.isFinite(v)) return "—";
  if (v === 0) return "0";
  return Math.abs(v) < 1e-3 || Math.abs(v) >= 1e4 ? v.toExponential(2) : v.toPrecision(3);
}
