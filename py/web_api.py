#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""浏览器端计算入口：把 SpectroLink 的 TDLAS-WMS 数值内核暴露成 JSON 友好的函数。

设计纪律
--------
1. **零重写**：物理一律走 vendor 的 `tdlas_sim.simulate`（与仓库版逐行相同的代码），
   本模块只做参数校验、异常归一化和数组序列化，不复制任何物理公式。
2. **单位固定**：波数 cm⁻¹、温度 K、压力 atm、光程 cm、摩尔分数无量纲。
   前端传错单位时不做静默换算，直接报错。
3. **报错可读**：异常转成 {"ok": false, "error": "...", "hint": "..."}，
   前端只需展示，不解析堆栈。
"""
from __future__ import annotations

import math
import traceback

import numpy as np

import tdlas_sim as ts


def _disable_network() -> None:
    """封掉 HAPI 的下载入口。

    浏览器里 `urllib` 由 pyodide 代理到 fetch，跨域请求 hitran.org 会真的被发出：
    首次计算凭空多出数秒延迟，且把"全部计算在本地"这条前提打穿。
    这里把 queryHITRAN 换成立即失败，让 `fetch_table` 回到它已有的归因分支——
    要么命中预置切片，要么明确报「该窗口未预置」，不会静默走网络。
    """
    msg = ("离线环境：浏览器内不能访问 hitran.org，线表只能用构建期预置的切片"
           "（见 data/manifest.json 的 presets）")

    def _offline(*_args, **_kwargs):
        raise RuntimeError(msg)

    try:
        import hapi as _h                      # py/vendor/hapi（单文件模块）
    except Exception:
        return
    for target in (_h, getattr(_h, "hapi", None)):
        if target is not None and hasattr(target, "queryHITRAN"):
            setattr(target, "queryHITRAN", _offline)


_disable_network()

# 与 tools/build_tables.py 的 SPAN_MAX 一致：切片窗口只覆盖 ±2 cm⁻¹
SPAN_MAX_CM = 2.0
N_SCAN_LIMITS = (51, 801)
N_MOD_LIMITS = (16, 256)


def _fnum(p, key, lo, hi, name=None):
    try:
        v = float(p[key])
    except (KeyError, TypeError):
        raise ValueError(f"缺少参数 {name or key}")
    if not math.isfinite(v):
        raise ValueError(f"{name or key} 必须是有限数值，收到 {v}")
    if not (lo <= v <= hi):
        raise ValueError(f"{name or key} 必须在 [{lo}, {hi}] 内，收到 {v}")
    return v


def health() -> dict:
    """自检：确认内核与线表在浏览器环境里可用。"""
    import sys
    import spectrolink_core.hitran as th
    data_dirs = [str(d) for d in getattr(th, "_DATA_DIRS", [])]
    return {
        "ok": True,
        "python": sys.version.split()[0],
        "numpy": np.__version__,
        "data_dirs": data_dirs,
        "span_max_cm": SPAN_MAX_CM,
    }


def simulate_wms(params: dict) -> dict:
    """正向仿真一次扫描式 WMS，返回绘图所需的全部曲线。"""
    try:
        species = str(params.get("species", "")).strip().upper()
        if not species:
            raise ValueError("缺少参数 species")
        wn0 = _fnum(params, "wn0", 1e3, 1e4, "波数中心 wn0")
        span = _fnum(params, "span", 1e-4, SPAN_MAX_CM, "扫描半宽 span")
        T = _fnum(params, "T", 100.0, 1000.0, "温度 T")
        P = _fnum(params, "P", 1e-3, 20.0, "压力 P")
        x = _fnum(params, "x", 1e-9, 0.5, "摩尔分数 x")
        L = _fnum(params, "L", 0.01, 1e6, "光程 L")
        a = _fnum(params, "a", 1e-4, 2.0, "调制深度 a")
        n_scan = int(_fnum(params, "n_scan", *N_SCAN_LIMITS, name="扫描点数 n_scan"))
        n_mod = int(_fnum(params, "n_mod", *N_MOD_LIMITS, name="调制采样数 n_mod"))
        i0 = float(params.get("i0", 0.1671))
        i2 = float(params.get("i2", 2.48e-3))
        psi1 = float(params.get("psi1", 1.9356 * np.pi))
        psi2 = float(params.get("psi2", 4.4138 * np.pi))

        r = ts.simulate(species=species, wn0=wn0, T=T, P=P, x=x, L=L, a=a,
                        i0=i0, i2=i2, psi1=psi1, psi2=psi2,
                        span=span, n_scan=n_scan, n_mod=n_mod)

        meta_in = r["meta"]
        meta = {
            "species": meta_in.get("species"),
            "wn0": meta_in.get("wn0"),
            "T": meta_in.get("T"),
            "P": meta_in.get("P"),
            "x": meta_in.get("x"),
            "L": meta_in.get("L"),
            "a": meta_in.get("a"),
            "i0": meta_in.get("i0"),
            "i2": meta_in.get("i2"),
            "psi1": meta_in.get("psi1"),
            "psi2": meta_in.get("psi2"),
            "n_lines_in_window": meta_in.get("n_lines_in_window"),
            "table": meta_in.get("table"),
            # 2f 峰值位置与 2f/1f 免标定斜率，前端直接用于读数
            "peak_2f": float(np.max(r["S2f"])),
            "peak_2f_wn": float(r["wn_scan"][int(np.argmax(r["S2f"]))]),
            "peak_2f1f": float(np.max(r["S2f1f"])),
            "alpha_max": float(np.max(r["alpha"])),
        }

        return {
            "ok": True,
            "axis": {
                "wn_scan": r["wn_scan"].tolist(),
                "nu": r["nu"].tolist(),
            },
            "curves": {
                "alpha": r["alpha"].tolist(),
                "tau": r["tau"].tolist(),
                "S1f": r["S1f"].tolist(),
                "S2f": r["S2f"].tolist(),
                "S4f": r["S4f"].tolist(),
                "S2f1f": r["S2f1f"].tolist(),
            },
            "meta": meta,
        }
    except (ValueError, KeyError, TypeError) as exc:
        return {"ok": False, "error": f"{type(exc).__name__}: {exc}", "hint": "检查参数取值范围与单位"}
    except RuntimeError as exc:
        # 线表未覆盖 / HITRAN 不可用 —— 内核已给出明确归因，原样透出
        return {"ok": False, "error": str(exc), "hint": "该谱区未预置切片，请换用预置谱区"}
    except Exception as exc:  # 兜底：浏览器里展示 traceback 末行，便于用户反馈
        return {"ok": False, "error": f"{type(exc).__name__}: {exc}",
                "hint": traceback.format_exc().strip().splitlines()[-1]}
