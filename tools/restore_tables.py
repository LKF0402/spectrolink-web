#!/usr/bin/env python3
"""从仓库内分段编码文件还原离线线表。

分段文件命名约定：data/line-tables.p<N>-<sha256_16>.b64
CI 与本地共用：python tools/restore_tables.py
"""
import base64
import hashlib
import io
import re
import tarfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
PATTERN = re.compile(r"line-tables\.p(\d+)-([0-9a-f]{16})\.b64")


def main() -> int:
    parts = [p for p in DATA.glob("line-tables.p*.b64") if PATTERN.match(p.name)]
    parts.sort(key=lambda p: int(PATTERN.match(p.name).group(1)))
    if not parts:
        print("[SKIP] 未找到分段编码文件，跳过还原")
        return 0

    chunks = []
    for p in parts:
        want = PATTERN.match(p.name).group(2)
        seg = "".join(p.read_text(encoding="utf-8").split())
        got = hashlib.sha256(seg.encode()).hexdigest()[:16]
        if got != want:
            print(f"[FAIL] {p.name} 校验不符：实际 {got}，期望 {want}")
            return 1
        chunks.append(seg)

    blob = base64.b64decode("".join(chunks))
    with tarfile.open(fileobj=io.BytesIO(blob), mode="r:xz") as tf:
        tf.extractall(ROOT)
    print(f"[OK] 已还原 {len(parts)} 段 → data/tables/ 与 data/manifest.json")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
