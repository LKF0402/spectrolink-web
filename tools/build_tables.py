#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""生成站点用的离线 HITRAN 线表切片。

背景：浏览器内既没有 spectrolink 的 Hitran_Data 缓存，也无法跨域直连 HITRAN 服务端，
因此必须在构建期把「预置谱区」的线表切片成静态文件随站点分发。

切片窗口 = wn_center ± PAD_CM。PAD_CM 需覆盖 UI 允许的最大扫描半宽 span_max
再加取数翼宽余量（hitran.fetch_margin，P≈1 atm 时约 1.6 cm⁻¹）。

用法：
    python3 tools/build_tables.py            # 生成全部预置谱区
    python3 tools/build_tables.py --check    # 只校验 data/tables 与 manifest 一致

依赖：numpy、hitran-api（pip 包名；import 名为 hapi）。
"""
from __future__ import annotations

import argparse
import contextlib
import hashlib
import io
import json
import os
import shutil
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "py"))

PAD_CM = 5.0          # 切片半宽（cm⁻¹）：UI span 上限 2.0 + 取数余量
SPAN_MAX = 2.0        # 与前端 UI 的扫描半宽上限保持一致

# 预置谱区：[id, 物种, 波数中心, 说明]
# 波数取值依据 HITRAN 线表实测最强线（build_tables 生成的 manifest 会记录 n_lines 与最强线）。
PRESETS = [
    # defaults：该谱区的推荐工况，用于首次打开页面时落在可读的弱吸收区（x·L 太小会看不出 2f 结构）
    {"id": "h2o_7185", "species": "H2O", "wn0": 7185.596,
     "label": "H2O · 7185.596 cm⁻¹ (1.39 µm)",
     "defaults": {"ppm": 2000, "L": 50, "a": 0.10, "span": 0.8}},
    {"id": "ch4_6046", "species": "CH4", "wn0": 6046.9636,
     "label": "CH4 · 6046.96 cm⁻¹ (1.65 µm)",
     "defaults": {"ppm": 100, "L": 50, "a": 0.08, "span": 0.6}},
]


def _table_lines(path: Path):
    """解析 HITRAN 160 字符定长表：返回 [(nu, sw)]。"""
    rows = []
    with path.open("rb") as fh:
        for raw in fh:
            line = raw.decode("ascii", "ignore")
            if len(line) >= 25:
                try:
                    rows.append((float(line[3:15]), float(line[15:25])))
                except ValueError:
                    continue
    return rows


def _sha256_16(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()[:16]


def build_one(preset: dict, tmpdir: Path, out_dir: Path) -> dict:
    os.environ["SPECTROLINK_DATA_DIR"] = str(tmpdir)
    from spectrolink_core import hitran as th  # noqa: E402

    formula = preset["species"]
    M = th.resolve(formula)[1]
    h = th._hapi()
    iso = [I for (m, I) in h.ISO if m == M][0]
    lo, hi = preset["wn0"] - PAD_CM, preset["wn0"] + PAD_CM
    with contextlib.redirect_stdout(io.StringIO()):
        table, cov = th.fetch_table(formula, M, iso, lo, hi)

    src_data = tmpdir / f"{table}.data"
    src_head = tmpdir / f"{table}.header"
    if not src_data.exists():
        raise SystemExit(f"切片失败：{src_data} 不存在")

    out_dir.mkdir(parents=True, exist_ok=True)
    shutil.copy2(src_data, out_dir / f"{table}.data")
    shutil.copy2(src_head, out_dir / f"{table}.header")

    rows = _table_lines(out_dir / f"{table}.data")
    rows.sort(key=lambda r: -r[1])
    strongest = {"nu": rows[0][0], "sw": rows[0][1]} if rows else None

    return {
        "id": preset["id"],
        "label": preset["label"],
        "species": formula,
        "M": M,
        "iso": iso,
        "wn0": preset["wn0"],
        "span_max": SPAN_MAX,
        "defaults": preset.get("defaults", {}),
        "table": table,
        "coverage": [float(cov[0]), float(cov[1])],
        "n_lines": int(cov[2]) if len(cov) > 2 else len(rows),
        "strongest_line": strongest,
        "bytes": (out_dir / f"{table}.data").stat().st_size
                 + (out_dir / f"{table}.header").stat().st_size,
        "sha256_16": _sha256_16(out_dir / f"{table}.data"),
        "source": "HITRAN2020 line list via HAPI 1.x; slice fetched at build time",
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true", help="只校验，不重新下载")
    args = ap.parse_args()

    out_dir = ROOT / "data" / "tables"
    manifest_path = ROOT / "data" / "manifest.json"
    entries = []

    if args.check:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        ok = True
        for e in manifest["presets"]:
            data = out_dir / f"{e['table']}.data"
            if not data.exists():
                print(f"[FAIL] 缺文件 {data.name}")
                ok = False
                continue
            sha = _sha256_16(data)
            if sha != e["sha256_16"]:
                print(f"[FAIL] {data.name} sha256_16 不匹配：{sha} != {e['sha256_16']}")
                ok = False
        print("[OK] data/tables 与 manifest 一致" if ok else "[FAIL] 校验未通过")
        return 0 if ok else 1

    with tempfile.TemporaryDirectory(prefix="sl_slice_") as td:
        for preset in PRESETS:
            e = build_one(preset, Path(td), out_dir)
            print(f"[{e['id']}] {e['table']}  lines={e['n_lines']}  "
                  f"cov={e['coverage']}  bytes={e['bytes']}  sha={e['sha256_16']}")
            entries.append(e)

    manifest = {
        "generated_by": "tools/build_tables.py",
        "pad_cm": PAD_CM,
        "span_max_cm": SPAN_MAX,
        "presets": entries,
    }
    manifest_path.write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"[OK] 写入 {manifest_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
