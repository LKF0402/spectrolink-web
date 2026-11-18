#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""拉取站点运行所需的第三方大文件（不进 Git 历史）。

为什么用脚本而不是直接 vendor 进仓库：
  · Pyodide 运行时 17 MB、HAPI 4 MB，塞进 Git 历史后每次 clone 都付这份代价，
    且 Pages 部署产物与仓库内容会重复；
  · 这些文件全部有稳定的上游版本号，下载可复现、可校验。

产物（均被 .gitignore 忽略，本地与 CI 各自拉取）：
  vendor/pyodide/    Pyodide 运行时（wasm + stdlib + lock + numpy wheel）
  vendor/uplot/      uPlot 绘图表与样式
  py/vendor/hapi/    HAPI 1.x（hitran-api 发行名，import 名 hapi）

用法：
  python3 tools/fetch_vendor.py            # 缺什么补什么
  python3 tools/fetch_vendor.py --force    # 全部重下
"""
from __future__ import annotations

import argparse
import sys
import tempfile
import urllib.request
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

PYODIDE_VERSION = "0.27.7"
PYODIDE_BASE = f"https://cdn.jsdelivr.net/pyodide/v{PYODIDE_VERSION}/full/"
PYODIDE_FILES = [
    "pyodide.js",
    "pyodide.asm.js",
    "pyodide.asm.wasm",
    "python_stdlib.zip",
    "pyodide-lock.json",
]
# 与 pyodide-lock.json 中的 file_name 一致；升级 Pyodide 时要同步
NUMPY_WHEEL = "numpy-2.0.2-cp312-cp312-pyodide_2024_0_wasm32.whl"

UPLOT_VERSION = "1.6.32"
UPLOT_FILES = {
    "uPlot.esm.js": f"https://cdn.jsdelivr.net/npm/uplot@{UPLOT_VERSION}/dist/uPlot.esm.js",
    "uPlot.min.css": f"https://cdn.jsdelivr.net/npm/uplot@{UPLOT_VERSION}/dist/uPlot.min.css",
}

HITRAN_API_VERSION = "1.3.0.0"


def _download(url: str, dest: Path) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    with urllib.request.urlopen(url, timeout=120) as resp:
        data = resp.read()
    dest.write_bytes(data)
    print(f"  ↓ {dest.relative_to(ROOT)}  {len(data) / 1e6:.1f} MB")


def fetch_pyodide(force: bool) -> None:
    out = ROOT / "vendor" / "pyodide"
    for name in PYODIDE_FILES + [NUMPY_WHEEL]:
        dest = out / name
        if dest.exists() and not force:
            print(f"  = {dest.relative_to(ROOT)}")
            continue
        _download(PYODIDE_BASE + name, dest)


def fetch_uplot(force: bool) -> None:
    out = ROOT / "vendor" / "uplot"
    for name, url in UPLOT_FILES.items():
        dest = out / name
        if dest.exists() and not force:
            print(f"  = {dest.relative_to(ROOT)}")
            continue
        _download(url, dest)


def fetch_hapi(force: bool) -> None:
    out = ROOT / "py" / "vendor" / "hapi"
    if (out / "hapi.py").exists() and not force:
        print("  = py/vendor/hapi/hapi.py")
        return
    # 从 PyPI 取 wheel（纯 Python，无编译），只解出 hapi 包内两个文件
    with tempfile.TemporaryDirectory() as td:
        tmp = Path(td)
        import subprocess
        subprocess.run(
            [sys.executable, "-m", "pip", "download", "--no-deps", "--dest", str(tmp),
             f"hitran-api=={HITRAN_API_VERSION}"],
            check=True, stdout=subprocess.DEVNULL,
        )
        artifacts = list(tmp.iterdir())
        if not artifacts:
            raise SystemExit("pip download 未产出文件")
        src = artifacts[0]
        if src.suffix == ".whl":
            with zipfile.ZipFile(src) as zf:
                for member in ("hapi/hapi.py", "hapi/__init__.py"):
                    data = zf.read(member)
                    (out / Path(member).name).write_bytes(data)
        else:  # sdist
            import tarfile
            with tarfile.open(src) as tf:
                for member in tf.getmembers():
                    if member.name.endswith(("hapi/hapi.py", "hapi/__init__.py")):
                        fh = tf.extractfile(member)
                        (out / Path(member.name).name).write_bytes(fh.read())
    print(f"  ↓ py/vendor/hapi/hapi.py  ({HITRAN_API_VERSION})")
    (out / "LICENSE").write_text(
        "HAPI (hitran-api) is distributed under the MIT license.\n"
        "Copyright (c) HITRAN team, http://hitran.org\n"
        "Cite: R.V. Kochanov et al., J. Quant. Spectrosc. Radiat. Transfer 177, 15-30 (2016),\n"
        "doi:10.1016/j.jqsrt.2016.03.005\n", encoding="utf-8")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--force", action="store_true", help="忽略已存在文件，全部重下")
    args = ap.parse_args()

    print(f"[pyodide {PYODIDE_VERSION}]")
    fetch_pyodide(args.force)
    print(f"[uplot {UPLOT_VERSION}]")
    fetch_uplot(args.force)
    print(f"[hapi {HITRAN_API_VERSION}]")
    fetch_hapi(args.force)

    print("\n[OK] 运行时已就绪；本地预览：python3 -m http.server 8765")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
