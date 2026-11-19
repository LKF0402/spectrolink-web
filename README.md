# SpectroLink Web

TDLAS / WMS 光谱仿真与可视化前端。**当前状态：已冻结（archived），功能完整，短期不再维护。**

## 1. 它是什么

一个可离线打开的网页，用于演示波长调制光谱（WMS）的二次谐波（2f）信号与吸光度曲线：
输入物种、波段、温度、压力、浓度、光程、调制深度，输出 α(ν)、τ、2f/1f/4f 曲线。

## 2. 它不是什么（重要，避免误用）

- **不是研究工具**。单次交互形态，不支持批量扫参、不适合进论文的批量出图流程。需要批量计算请直接调 `py/tdlas_sim.py` 内核。
- **不是「任意参数」工具**。受浏览器 CORS 限制，HITRAN 谱线表**无法**在网页里实时下载，只能使用构建期预取的波段库（当前 11 条带）。要测库外的波段，必须先跑预取脚本。
- **装置 3D 图是示意图**，不能替代真实光机设计。

## 3. 目录结构

```
spectrolink-web/
├── index.html                 前端入口（Pyodide 架构版本）
├── spectrolink-offline.html   离线单文件版本（自包含，双击即用）
├── assets/
│   ├── css/style.css
│   └── js/app.js              主逻辑
│       ├── device3d.js        装置 3D 场景
│       ├── device3d.bundle.js 3D 依赖打包（512 KB）
│       ├── device-canvas.js   2D 回退渲染
│       └── hitran-import.js   线表导入
├── py/
│   ├── tdlas_sim.py           ★ 核心内核：吸收系数与谐波仿真（162 KB）
│   ├── web_api.py             前端桥接层
│   ├── spectrolink_core/      ★ 共用物理内核
│   │   ├── hitran.py          HITRAN 线表读取/下载/缓存
│   │   ├── calibfree.py       免标定反演
│   │   └── stats.py           统计工具
│   └── vendor/hapi/hapi.py    HITRAN API 官方客户端（4 MB）
├── data/
│   ├── manifest.json          波段库索引
│   ├── tables/                预取的 HITRAN 线表（43 个文件，5 MB）
│   └── samples/               示例线表
├── tools/                     构建脚本
│   ├── build_bands.py         构建波段库
│   ├── build_offline.py       ★ 打包离线单文件
│   ├── build_tables.py        拉取线表
│   ├── export_mol_meta.py     导出分子元数据
│   ├── bootstrap.py           环境初始化
│   └── fetch_vendor.py        拉取第三方依赖
└── vendor/                    pyodide / three / uplot（19 MB，未入库）
```

## 4. 怎么跑起来

**路径 A：只要看页面**

直接双击 `spectrolink-offline.html`（1.5 MB，自包含，无需任何环境）。

**路径 B：要算数（推荐给科研用）**

```bash
cd spectrolink-web
SPECTROLINK_DATA_DIR=data/tables python3 -c "
import sys; sys.path.insert(0,'py')
import tdlas_sim as ts

# 吸收系数（cm^-1）
nu, alpha = ts.get_alpha('CH4', 2967.6, 2969.2, T=296.0, P=1.01325, x=1e-6, step=2e-4)[:2]

# WMS 谐波仿真
r = ts.simulate(species='CH4', wn0=2968.7325, T=296.0, P=1.01325,
                x=1e-6, L=50.0, a=0.12, span=0.45, n_scan=301, n_mod=64)
# r.keys(): nu, alpha, tau, wn_scan, S1f, S2f, S4f, S2f1f, meta
"
```

内核会自动联网补表：波段超出 `data/tables/` 覆盖范围时，按 `hapi.ISO` 的分子索引自动 `fetch_table` 并写入缓存。首次调用慢，之后走本地。

## 5. 内核 API 要点

| 函数 | 作用 | 关键参数 |
|---|---|---|
| `get_alpha(sp, lo, hi, T, P, x, step)` | 返回 `(nu, alpha)`，单位 cm⁻¹ | `x` 为体积比（1 ppm = 1e-6） |
| `simulate(...)` | 返回 `nu/alpha/tau/wn_scan/S1f/S2f/S4f/S2f1f/meta` | `L` 单位 cm，`a` 为调制深度 cm⁻¹，`span` 为扫描半宽 cm⁻¹ |

**口径提醒**（易错，务必记住）：

- `get_alpha` 返回的是**峰值吸收系数**（含 Voigt 线型因子），不是积分线强。
- 换算关系：`α_peak ≈ S·N·x/(1.4·γ_L)`。同一条带积分强度与峰值可差数倍；判断「能不能测」看峰值，判断「带强不强」看积分。
- 光学厚度 `A = α·L`：<0.05 严格线性，0.05–0.2 轻度非线性，>0.5 饱和畸变。

## 6. 三条硬约束（架构性，不是 bug）

1. **CORS 死结**：hitran.org 的 `/lbl/api` 响应无 `Access-Control-Allow-Origin`，浏览器直连被拦。纯前端「实时取表」不可行，唯一解是服务端代理或构建期预取。本项目选择后者。
2. **波段库需预取**：库外波段必须先 `python3 tools/build_bands.py` 再重打包。
3. **无 WebGL 环境**（如部分虚拟机）时，3D 场景走 2D 回退，属预期行为。

## 7. 怎么加一个波段

```bash
python3 tools/build_bands.py      # 按 data/manifest.json 里的定义预取线表
python3 tools/build_offline.py    # 重新生成自包含单文件
```

之后 `spectrolink-offline.html` 会包含新波段。

## 8. 数据来源

HITRAN2020，I. E. Gordon et al., *JQSRT* 277, 107949 (2022), doi:10.1016/j.jqsrt.2021.107949。

所有输出均为**理论仿真**，不得冒充实验数据。写论文引用数值时请附 `provenance.engine_version` 与线表指纹。

## 9. 恢复维护时的检查清单

1. `python3 -c "import sys;sys.path.insert(0,'py');import tdlas_sim"` 确认内核可导入
2. 跑一次 `get_alpha('CH4', 2967.6, 2969.2, ...)`，峰值应为 **1.337×10⁻⁵ cm⁻¹ @ 2968.7326**
3. 跑一次 `simulate(...)`，确认返回 9 个 key 且 `S2f` 非全零
4. 双击 `spectrolink-offline.html` 确认页面可打开、波段可选
5. 若线表缓存被清空，首次调用需联网（`hapi.fetch`），恢复后应离线可用

归档与验证记录见 `ARCHIVE.md`。
