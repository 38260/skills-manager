import { parentPort, workerData } from "node:worker_threads";
import { UsageStore } from "./store.mjs";
import { scanSources } from "./scanner.mjs";

const store = new UsageStore(workerData.directory);
const signal = new Int32Array(workerData.signal);
try {
  const summary = await scanSources(store, {
    cancelled: () => Atomics.load(signal, 0) === 1,
    progress: data => parentPort.postMessage({ type: "progress", data }),
  });
  parentPort.postMessage({ type: "done", data: summary });
} catch {
  parentPort.postMessage({ type: "error" });
} finally { store.close(); }
