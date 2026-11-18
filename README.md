# SpectroLink Web

把 [SpectroLink](https://github.com/LKF0402/spectrolink) 的 TDLAS 波长调制（WMS）仿真内核封装成**纯前端可视化站点**：打开网页即可调参、出图，全部数值计算在浏览器本地完成——没有服务器、不需要装 Python、不把任何数据传出去。

> 输出为**理论仿真**，不是实验测量。引用数值时请一并注明页面右下角给出的 `line_table.sha256_16`。

## 能力

| 曲线 | 说明 |
|---|---|
| α(ν) | HITRAN2020 线表 + Voigt 线型，按 T/P/x/L 现算 |
| R₁f / R₂f / R₄f | 数字锁相正交解调的谐波幅度 |
| 2f/1f | 免标定：2f 先以 1f 归一化、再扣背景基线；弱吸收下正比于浓度 |

参数（温度、压力、浓度、光程、调制深度、扫描宽度）改动后自动重算，热调用 150–250 ms。

## 关键事实（实测，非估计）

- **物理内核零重写**：`py/tdlas_sim.py` 与 `py/spectrolink_core/` 由 `tools/bootstrap.py` 从上游仓库逐行复制，本站只新增 `py/web_api.py`（参数校验 + 序列化）。
- **三端数值一致**：同一组参数（CH4 @ 6046.9636 cm⁻¹，100 ppm，50 cm，a = 0.08 cm⁻¹）在 CPython、pyodide headless、浏览器内分别得到 `peak_2f = 0.0026775647526798996 / 0.0026775647526798996 / 0.00268`，相对误差 ≤ 5.5×10⁻¹⁵。
- **首屏体积约 23 MB**：Pyodide wasm 10 MB + numpy 3 MB + `hapi.py` 4 MB + 其余；运行时随站点分发（`vendor/`），不依赖第三方 CDN。gzip/brotli 传输后约 **9.7 MB**（wasm 10→3.0 MB，`hapi.py` 3.9→1.2 MB）。
- **线表按需加载**：两个预置谱区各约 37 KB，只在切到该谱区时才请求。

## 快速开始

```bash
python3 tools/bootstrap.py        # 拉上游内核 + 运行时 + 切 HITRAN 线表（需要联网）
python3 -m http.server 8765       # 浏览器对 file:// 下的 Worker 有限制，必须走 HTTP
# 打开 http://127.0.0.1:8765/index.html
```

首次打开会下载约 9.7 MB 传输量（解压后 23 MB），本地回环下约 10 s 完成初始化。

只改前端、不想重新切线表时：

```bash
python3 tools/bootstrap.py --skip-tables
```

## 仓库里存什么

| 入库 | 说明 |
|---|---|
| `index.html`、`assets/` | 页面、样式、UI 逻辑、Pyodide Worker——本站独有，需人工维护 |
| `py/web_api.py` | 浏览器端计算入口：参数校验、异常归一化、数组序列化 |
| `tools/` | `bootstrap.py`（一键准备）、`build_tables.py`（线表切片）、`fetch_vendor.py`（第三方运行时）、`verify_pyodide.mjs`（数值验证） |
| `sw.js`、`_headers` | 离线缓存与长缓存头 |
| `.github/workflows/pages.yml` | 构建 + 部署 GitHub Pages，并在部署前跑数值门禁 |
| `.github/workflows/cloudflare.yml` | 构建 + 部署 Cloudflare Pages（同一套门禁） |

| 不入库（生成物） | 生成者 |
|---|---|
| `py/tdlas_sim.py`、`py/spectrolink_core/` | `bootstrap.py` 从上游复制 |
| `py/vendor/hapi/` | `fetch_vendor.py` 从 PyPI 取 |
| `vendor/pyodide/`、`vendor/uplot/` | `fetch_vendor.py` 从 jsDelivr 取 |
| `data/tables/`、`data/manifest.json` | `build_tables.py` 拉 HITRAN 后切片 |

这样做的代价是首次准备需要联网，收益是：物理代码不与上游分叉、Git 历史里没有 17 MB 二进制、许可与版本关系清晰。

## 部署

推送到 `main` 即触发 GitHub Actions：装依赖 → `bootstrap.py` → 跑数值门禁（`peak_2f` 相对误差超 1×10⁻⁶ 即失败）→ 上传 Pages。

首次部署需在仓库 **Settings → Pages → Source** 选择 **GitHub Actions**。

### 免费托管选项

| 方式 | 访问地址 | 成本 | 中国大陆可达性 |
|---|---|---|---|
| GitHub Pages | `lkf0402.github.io/spectrolink-web` | 免费 | 一般，偶发慢或不通 |
| Cloudflare Pages | `spectrolink-web.pages.dev` | 免费 | 多数地区可用，优于 github.io |

Cloudflare Pages 有两种接法，都免费。

**方式 A · GitHub Actions 构建后直传（推荐）**

`.github/workflows/cloudflare.yml` 在 GitHub runner 上完成 bootstrap 与数值门禁，再把产物推到 CF Pages。相比让 CF 自己构建，这条路复用与 GitHub Pages 完全相同的构建环境，不受 CF 构建镜像的 Python 版本影响。

1. Cloudflare 控制台 → My Profile → API Tokens → Create Token，用 **Edit Cloudflare Workers** 模板（或自定义：`Account:Read` + `Pages:Edit`）；
2. Account ID 在 CF 控制台右侧栏（或浏览器地址栏里 `dash.cloudflare.com/<account_id>`）复制；
3. 仓库 Settings → Secrets and variables → Actions → New repository secret，加两条：`CLOUDFLARE_API_TOKEN`、`CLOUDFLARE_ACCOUNT_ID`；
4. 仓库 Actions → **Deploy to Cloudflare Pages** → Run workflow。

首次运行会在 CF 侧自动创建 `spectrolink-web` 项目，地址 `https://spectrolink-web.pages.dev`。若报 project not found，先在 CF 控制台 Pages 建一个同名空项目（Direct Upload 模式）再跑。

workflow 先把产物 rsync 到 `dist/` 再上传：wrangler 会读 `.gitignore` 决定上传范围，而 `vendor/`、`data/` 恰在 `.gitignore` 中（它们是构建生成物），直接在仓库根上传会漏掉运行时。

**方式 B · CF 自己构建（不用 token）**

CF 控制台 → Pages → Connect to Git → 选本仓库，构建设置填

- Build command: `pip install "numpy>=1.24" "hitran-api>=1.3,<2" && python tools/bootstrap.py`
- Build output directory: `/`

代价是构建环境由 CF 提供，Python 版本与可用的 pip 包需以 CF 构建镜像为准。

两种方式下，根目录的 `_headers` 都会被 Cloudflare Pages 识别，给 `vendor/` 打一年期强缓存。

不需要备案；只有当托管在**中国大陆**的服务器上时才需要 ICP 备案，境外托管（GitHub、Cloudflare）不涉及。

### 弱网与离线

`sw.js` 会在首次访问后把运行时与已用过的线表写入 Cache Storage。之后断网、切网络、信号差都能直接打开，不再依赖远端。入口与 `data/manifest.json` 走网络优先，保证版本更新不会被旧缓存粘住。

## 增加谱区

1. 在 `tools/build_tables.py` 的 `PRESETS` 里加一项（物种、波数中心、推荐工况）；
2. `python3 tools/build_tables.py`；
3. 生成的 `data/` 不入库，由 CI 每次重建（如需固定某次数据，可在 workflow 里缓存该目录）。

切片窗口固定 `wn0 ± 5 cm⁻¹`，前端扫描半宽上限 `2 cm⁻¹`。超出窗口的谱区会被内核明确拒绝，不会静默返回平谱。

## 一致性验证

```bash
npm install pyodide@0.27.7
node tools/verify_pyodide.mjs
```

脚本把 `py/` 与 `data/` 写进 pyodide 虚拟文件系统，跑同一组参数与 CPython 基线逐项比对，任一项相对误差 ≥ 1×10⁻⁶ 即判失败。

浏览器端有一处刻意保留的处理：装入新谱区线表后会把 `spectrolink_core.hitran._DB_READY` 置为 `False`，强制下一次取数重新 `db_begin`。原因是 HAPI 的表索引在首次 `db_begin` 时固定，运行期新写入的表不会被自动发现；不重置会误判"本地无表"并尝试联网，而浏览器里这是必然失败。

## 已知边界

- **只支持预置谱区**：浏览器内既无本地 HITRAN 缓存也不能跨域直连 HITRAN，未预置的窗口直接报错。
- **只移植 WMS**：DAS、仪器函数六子图、DAQ 噪声链、检测限扫描（LOD）、混合气批处理仍在 Python 端；LITES / CRDS / NDIR / FTIR / DOAS 未移植。
- **不内置仪器**：`i0`、`i2`、`ψ₁`、`ψ₂` 仍用上游默认占位值，真实器件参数须自行核对（`py/web_api.py` 已将其暴露为可选入参）。
- **移动端未专门优化**：900 px 以下切成单列，但图表高度与刻度密度未按手机重排。

## 许可

本站沿上游 **GPL-3.0-or-later**。HAPI 1.x 为 MIT，uPlot 为 MIT，Pyodide 为 MPL-2.0，各自许可随 `vendor/` 一并分发。

线表数据来自 HITRAN2020：

> I. E. Gordon et al., *The HITRAN2020 molecular spectroscopic database*, J. Quant. Spectrosc. Radiat. Transfer **277**, 107949 (2022). doi:10.1016/j.jqsrt.2021.107949

## English summary

A fully client-side visualizer for SpectroLink's TDLAS-WMS engine. CPython 3.12 + numpy 2.0 run in the browser through Pyodide; the physics code is copied verbatim from upstream at build time, and HITRAN line lists are pre-sliced into ~37 KB per preset. Transfer size is ~9.7 MB gzipped. A Service Worker caches the runtime after first visit, so the site still opens offline. Cross-implementation agreement verified at relative error ≤ 5.5×10⁻¹⁵ against CPython. No server, no data leaves the machine. Outputs are theoretical simulations.
