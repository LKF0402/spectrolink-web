// SpectroLink Web · Pyodide 计算 Worker（classic worker）
// 职责：在浏览器内启动 CPython，装 numpy，把 vendor 的 SpectroLink 内核与离线线表
// 写入虚拟文件系统，然后接收参数、调用 py/web_api.py，回传曲线数据。
//
// 为什么放 Worker：首次加载与单次仿真都会占用 1~2 s 主线程时间，
// 放到 Worker 可保证界面不卡（进度条、撤销输入都仍可用）。
//
// 为什么运行时放 vendor/pyodide 而不是 CDN：站点自包含，避免依赖第三方域名
// 的可用性与限速；Worker 内一律只访问同源资源。

const HERE = new URL("../../", self.location.href);
const PYODIDE_INDEX = new URL("vendor/pyodide/", HERE).href;
importScripts(PYODIDE_INDEX + "pyodide.js");

// 需要写入虚拟 FS 的 Python 文件（与仓库 py/ 目录一一对应）
const PY_FILES = [
  "py/tdlas_sim.py",
  "py/web_api.py",
  "py/spectrolink_core/__init__.py",
  "py/spectrolink_core/hitran.py",
  "py/spectrolink_core/stats.py",
  "py/spectrolink_core/calibfree.py",
  "py/vendor/hapi/__init__.py",
  "py/vendor/hapi/hapi.py",
];

let pyodideReady = false;
let bootInfo = null;
const loadedTables = new Set();

const post = (msg) => self.postMessage(msg);

function setStage(text, pct) {
  post({ type: "stage", text, pct });
}

async function boot() {
  setStage("加载 Python 运行时", 5);
  const py = await loadPyodide({ indexURL: PYODIDE_INDEX });

  setStage("加载 numpy", 25);
  await py.loadPackage("numpy");

  setStage("写入内核文件", 55);
  for (const dir of ["/py/spectrolink_core", "/py/vendor/hapi", "/data"]) {
    py.FS.mkdirTree(dir);
  }
  for (const f of PY_FILES) {
    const res = await fetch(new URL(f, HERE).href);
    if (!res.ok) throw new Error(`缺失文件 ${f} (HTTP ${res.status})`);
    py.FS.writeFile("/" + f, new Uint8Array(await res.arrayBuffer()));
  }

  py.runPython(`
import sys, os
sys.path.insert(0, "/py")
sys.path.insert(0, "/py/vendor")
os.environ["SPECTROLINK_DATA_DIR"] = "/data"
`);

  setStage("导入内核", 80);
  py.runPython("import web_api");

  pyodideReady = true;
  bootInfo = JSON.parse(py.runPython("import json; json.dumps(web_api.health())"));
  setStage("就绪", 100);
  post({ type: "ready", info: bootInfo });
  return py;
}

// 按需装载谱区线表：只在第一次选中该谱区时 fetch，避免首屏拖入全部切片
async function ensureTable(py, tableName) {
  if (loadedTables.has(tableName)) return;
  const files = [`data/tables/${tableName}.data`, `data/tables/${tableName}.header`];
  for (const f of files) {
    const res = await fetch(new URL(f, HERE).href);
    if (!res.ok) throw new Error(`线表缺失 ${f} (HTTP ${res.status})`);
    py.FS.writeFile("/data/" + f.split("/").pop(), new Uint8Array(await res.arrayBuffer()));
  }
  // HAPI 的表索引在首次 db_begin 时固定，新写入的表不会被自动发现；
  // 置位 _DB_READY 让下一次取数重新 db_begin，否则会误判“本地无表”而去联网。
  py.runPython("import spectrolink_core.hitran as _th; _th._DB_READY = False");
  loadedTables.add(tableName);
  post({ type: "table-loaded", table: tableName });
}

let pyPromise = boot();
pyPromise.catch((err) => post({ type: "fatal", error: String((err && err.stack) || err) }));

self.onmessage = async (ev) => {
  const msg = ev.data || {};
  if (msg.type === "simulate") {
    try {
      const py = await pyPromise;
      if (!pyodideReady) throw new Error("运行时尚未就绪");
      if (msg.table) await ensureTable(py, msg.table);

      const t0 = performance.now();
      py.globals.set("params_json", JSON.stringify(msg.params));
      py.runPython(`
import json
_r = web_api.simulate_wms(json.loads(params_json))
_result_json = json.dumps(_r, ensure_ascii=False)
`);
      const payload = JSON.parse(py.globals.get("_result_json"));
      const elapsed = performance.now() - t0;
      if (!payload.ok) {
        post({ type: "error", error: payload.error, hint: payload.hint });
        return;
      }
      post({ type: "result", data: payload, elapsed });
    } catch (err) {
      post({ type: "error", error: String((err && err.message) || err),
             hint: "检查所选谱区线表是否已生成（tools/build_tables.py）" });
    }
  }
};
