# 归档记录

## 冻结信息

| 项 | 值 |
|---|---|
| 版本 | v0.3.8 |
| 冻结日期 | 2026-11-19 |
| 冻结决定 | 短期不再维护；功能保持完整可运行 |
| 冻结原因 | 定位为演示器而非研究工具；研究侧需求（批量扫参、任意波段）由 `py/tdlas_sim.py` 内核直接承接 |

## 冻结前的验证记录（2026-11-19 实测）

内核冒烟测试，三项全部通过：

| # | 测试 | 结果 |
|---|---|---|
| 1 | `get_alpha('CH4', 2967.6, 2969.2, 296K, 1atm, 1ppm)` | 峰位 **2968.7326 cm⁻¹**，α = **1.337×10⁻⁵ cm⁻¹** ✔ |
| 2 | `simulate('CH4', 2968.7325, L=50cm, a=0.12, span=0.45)` | 返回 9 个 key（nu/alpha/tau/wn_scan/S1f/S2f/S4f/S2f1f/meta），S2f 峰值 2.550×10⁻³ ✔ |
| 3 | `get_alpha('C2H4', 947.90, 948.06)` | 峰位 **947.9945 cm⁻¹**，α = **8.219×10⁻⁶ cm⁻¹** ✔ |

离线单文件 `spectrolink-offline.html`（1,530,582 B）可正常打开，波段可选，2f 与吸光度曲线联动正常。

## 已知遗留（不在维护范围内）

1. **波段库依赖预取**。网页无法实时取 HITRAN 表（CORS 限制），库外波段需先跑 `tools/build_bands.py`。
2. **GitHub 仓库不含大文件**。`py/tdlas_sim.py`（162 KB）、`py/vendor/hapi/hapi.py`（4 MB）、`data/tables/`（5 MB）、`vendor/`（19 MB）因传输限制未入库，仅存在于归档包中。
3. **3D 装置图为示意**，非真实光机模型；无 WebGL 环境时自动降级为 2D。
4. **UI 细节未做最后打磨**（已知评价：视觉粗糙度高于功能价值）。

## 完整工程怎么取

仓库只承载文档与小体积代码。完整可运行工程（含内核、线表、vendor 依赖）见归档包：

```
spectrolink-web-archive-v0.3.8.zip
```

解压后按 `README.md` 第 4 节运行。

归档包**不含**以下可重建目录，以控制体积：

| 目录 | 体积 | 重建方式 |
|---|---|---|
| `node_modules/` | 35 MB | `npm install` |
| `vendor/`（pyodide/three/uplot） | 19 MB | `python3 tools/fetch_vendor.py` |

不影响功能健全性：`spectrolink-offline.html` 是自包含单文件，不依赖以上任何目录，双击即用。只有 `index.html` 那条 Pyodide 架构路径需要 `vendor/`。

## 恢复维护的五个步骤

1. 解压归档包，确认 `py/tdlas_sim.py` 与 `data/tables/` 存在
2. 按 `README.md` 第 9 节的检查清单跑一遍冒烟测试
3. 需要新波段：编辑 `data/manifest.json` → `python3 tools/build_bands.py`
4. 需要重打包：`python3 tools/build_offline.py`，产物为 `spectrolink-offline.html`
5. 若依赖缺失：`python3 tools/fetch_vendor.py` 重建 `vendor/`，`npm install` 重建 `node_modules`

## 决策备忘（为什么冻结）

冻结不是因为技术做不下去，而是因为**形态选错了**：

- 科研流程要的是「批量、可复现、能进脚本」，网页是「单次、交互、难导出」；
- 「任意设参数自动取表」这个诉求与纯前端架构天然互斥（CORS），无法靠打磨 UI 解决；
- 同类工具（HITRAN 在线工具、SpectraPlot、HitranLink）已覆盖网页侧需求，本项目无不可替代性；
- 真正有长期价值的是 `py/tdlas_sim.py` 内核——它已在实际科研计算中使用，与本仓库的前端形态无关。

因此：**保留内核，冻结前端，不再投入**。
