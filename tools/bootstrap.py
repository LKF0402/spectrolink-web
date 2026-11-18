#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""一键准备运行所需的全部生成物（本地开发与 CI 共用同一条路径）。

生成物（全部被 .gitignore 忽略，不进 Git 历史）：
  py/tdlas_sim.py, py/spectrolink_core/   从上游 SpectroLink 仓库复制（逐行不改）
  py/vendor/hapi/                          HAPI 1.x
  vendor/pyodide/, vendor/uplot/           浏览器运行时与绘图库
  data/tables/, data/manifest.json         HITRAN 线表切片

为什么这么做：
  · 物理内核与上游保持逐行一致 —— 站点不自己维护第二份物理代码，避免口径漂移；
  · 17 MB 运行时与 4 MB HAPI 不进 Git 历史，clone 与 PR 都轻；
  · 线表按谱区切片后只有 84 KB，构建期生成即可，不必入库。

用法：
  python3 tools/bootstrap.py                  # 全流程
  python3 tools/bootstrap.py --skip-tables    # 只备运行时不切谱区（无网络拉 HITRAN 时用）
  python3 tools/bootstrap.py --ref <sha>      # 锁定上游某次提交（CI 推荐传版本号）
"""
from __future__ import annotations

import argparse
import shutil
import subprocess
import sys
import tempfile
import urllib.request
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
UPSTREAM_ZIP = "https://codeload.github.com/LKF0402/spectrolink/zip/refs/heads/{ref}"

# 上游文件 → 本站路径
UPSTREAM_MAP = {
    "server-tdlas/tdlas_sim.py": "py/tdlas_sim.py",
    "spectrolink_core/__init__.py": "py/spectrolink_core/__init__.py",
    "spectrolink_core/hitran.py": "py/spectrolink_core/hitran.py",
    "spectrolink_core/stats.py": "py/spectrolink_core/stats.py",
    "spectrolink_core/calibfree.py": "py/spectrolink_core/calibfree.py",
}


def fetch_upstream(ref: str) -> None:
    print(f"[上游内核 {ref}]")
    url = UPSTREAM_ZIP.format(ref=ref)
    with tempfile.TemporaryDirectory() as td:
        tmp = Path(td)
        zip_path = tmp / "upstream.zip"
        urllib.request.urlretrieve(url, zip_path)
        with zipfile.ZipFile(zip_path) as zf:
            zf.extractall(tmp)
        roots = [p for p in tmp.iterdir() if p.is_dir()]
        if not roots:
            raise SystemExit("上游压缩包解压后无目录")
        src_root = roots[0]
        for src, dst in UPSTREAM_MAP.items():
            sp = src_root / src
            if not sp.exists():
                raise SystemExit(f"上游缺少 {src}（结构变更？）")
            dp = ROOT / dst
            dp.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(sp, dp)
            print(f"  ← {src}")

        lic = src_root / "LICENSE"
        if lic.exists():
            shutil.copy2(lic, ROOT / "LICENSE-GPL-3.0.txt")
            print("  ← LICENSE-GPL-3.0.txt")


def run(script: str, *args: str) -> None:
    subprocess.run([sys.executable, str(ROOT / "tools" / script), *args], check=True)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--ref", default="main", help="上游分支或 commit SHA")
    ap.add_argument("--skip-tables", action="store_true", help="跳过 HITRAN 线表切片")
    args = ap.parse_args()

    fetch_upstream(args.ref)

    print("[第三方运行时]")
    run("fetch_vendor.py")

    if args.skip_tables:
        print("[线表] 跳过（--skip-tables）")
    else:
        print("[线表切片]")
        run("build_tables.py")

    print("\n[OK] 准备完成。本地预览：python3 -m http.server 8765 → http://127.0.0.1:8765/index.html")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
