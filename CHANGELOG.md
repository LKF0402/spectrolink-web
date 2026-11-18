# CHANGELOG

## v0.1.0 · 2026-11-18

首个可用版本：把 SpectroLink 的 TDLAS-WMS 内核搬进浏览器。

### 新增

- 纯前端仿真站点：CPython 3.12 + numpy 2.0 经 Pyodide 在浏览器内运行，无后端、不上传数据。
- 三张交互图：吸收系数 α(ν)、WMS 谐波 R₁f/R₂f/R₄f（可归一化）、免标定 2f/1f。
- 参数面板：温度、压力、浓度（ppm）、光程、调制深度、扫描半宽、采样点数；改动后 380 ms 防抖自动重算。
- 两个预置谱区：H2O 7185.596 cm⁻¹（1.39 µm）、CH4 6046.96 cm⁻¹（1.65 µm），各自带推荐工况。
- 线表按需加载：切谱区时才请求约 37 KB 的切片，不进首屏。
- 溯源信息展示：线表名、`sha256_16`、工况、谱线数、计算耗时，便于论文引用核对。
- `tools/bootstrap.py` 一键准备：从上游复制物理内核、拉 Pyodide/uPlot/HAPI、切 HITRAN 线表。
- `tools/verify_pyodide.mjs` headless 数值验证：与 CPython 基线逐项比对，相对误差门禁 1×10⁻⁶。
- GitHub Actions 部署流程，部署前自动跑同一套数值门禁。

### 说明

- 物理内核与上游逐行一致，本站只新增 `py/web_api.py`（参数校验 + 序列化），不维护第二份物理代码。
- 首屏约 23 MB（Pyodide wasm 10 MB + numpy 3 MB + HAPI 4 MB + 其余），运行时随站点分发，不依赖第三方 CDN。
- 只覆盖 WMS 与预置谱区；DAS、仪器函数、检测限、混合气等仍在 Python 端。
