// headless 验证：用 pyodide 加载仓库 py/ 与 data/，比对与本地 Python 版的数值一致性。
// 用法：npm install pyodide@0.27.7 && node tools/verify_pyodide.mjs
//      （运行前需先执行 python3 tools/bootstrap.py 生成 py/ 与 data/）
import { loadPyodide } from "pyodide";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// 默认用仓库自带运行时（含 numpy wheel 与 lock），保证与浏览器端同版本
const PYODIDE_DIR = process.env.PYODIDE_DIR || path.join(ROOT, "vendor/pyodide");
const PY_FILES = ["py/tdlas_sim.py", "py/web_api.py",
                  "py/spectrolink_core/__init__.py", "py/spectrolink_core/hitran.py",
                  "py/spectrolink_core/stats.py", "py/spectrolink_core/calibfree.py",
                  "py/vendor/hapi/__init__.py", "py/vendor/hapi/hapi.py"];
const DATA_FILES = fs.readdirSync(path.join(ROOT, "data/tables"));

const py = await loadPyodide({ indexURL: path.join(PYODIDE_DIR, "/") });
await py.loadPackage("numpy");
py.FS.mkdirTree("/py/spectrolink_core"); py.FS.mkdirTree("/py/vendor/hapi"); py.FS.mkdirTree("/data");
for (const f of PY_FILES) py.FS.writeFile("/" + f, fs.readFileSync(path.join(ROOT, f)));
for (const f of DATA_FILES)
  py.FS.writeFile("/data/" + f, fs.readFileSync(path.join(ROOT, "data/tables", f)));

py.runPython(`
import sys, os, time
sys.path.insert(0, "/py"); sys.path.insert(0, "/py/vendor")
os.environ["SPECTROLINK_DATA_DIR"] = "/data"
t0 = time.time()
import web_api
print("import web_api %.2fs" % (time.time()-t0))
`);

// 基线：本地 CPython 同一参数的结果
const CASES = [
  { name: "CH4@6046.96", params: { species: "CH4", wn0: 6046.9636, span: 0.6, T: 296, P: 1.01325,
      x: 1e-4, L: 50, a: 0.08, n_scan: 201, n_mod: 96 },
    base: { peak_2f: 0.0026775647526798996, peak_2f1f: 0.0032880216908727678,
            alpha_max: 3.879514103641624e-05, n_lines_in_window: 23 } },
  { name: "H2O@7185.596", params: { species: "H2O", wn0: 7185.596, span: 0.8, T: 296, P: 1.0,
      x: 0.01, L: 30, a: 0.1, n_scan: 201, n_mod: 96 },
    base: null },
];

let failed = 0;
for (const c of CASES) {
  py.globals.set("params_json", JSON.stringify(c.params));
  const t = Date.now();
  py.runPython(`
import json
r = web_api.simulate_wms(json.loads(params_json))
result_json = json.dumps((r["ok"], r.get("meta", {}), r.get("error")))
`);
  const [ok, meta, err] = JSON.parse(py.globals.get("result_json"));
  console.log(`[${c.name}] ok=${ok} elapsed=${Date.now() - t}ms`);
  if (!ok) { console.log("  error:", err); failed++; continue; }
  console.log(`  peak_2f=${meta.peak_2f} peak_2f1f=${meta.peak_2f1f} alpha_max=${meta.alpha_max} n_lines=${meta.n_lines_in_window}`);
  if (c.base) {
    for (const k of Object.keys(c.base)) {
      const rel = Math.abs(meta[k] - c.base[k]) / Math.abs(c.base[k]);
      const pass = rel < 1e-6;
      console.log(`  ${k}: rel_err=${rel.toExponential(2)} ${pass ? "PASS" : "FAIL"}`);
      if (!pass) failed++;
    }
  }
}
console.log(failed ? `RESULT: ${failed} FAIL` : "RESULT: ALL PASS");
process.exitCode = failed ? 1 : 0;
