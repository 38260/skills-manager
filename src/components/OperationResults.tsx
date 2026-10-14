import { useState } from "react";

export interface OperationItem {
  id: string;
  name: string;
  status: "success" | "failed" | "held";
  message: string;
}

export interface OperationReport {
  title: string;
  items: OperationItem[];
  retry?: (ids: string[]) => Promise<OperationItem[]>;
}

export function OperationResults({ report, onClose }: { report: OperationReport; onClose: () => void }) {
  const [replacement, setReplacement] = useState<OperationItem[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const items = replacement ?? report.items;
  const failed = items.filter(item => item.status === "failed");
  async function retry() {
    if (!report.retry || busy) return;
    setBusy(true);
    setError("");
    try {
      const results = await report.retry(failed.map(item => item.id));
      const next = new Map(results.map(item => [item.id, item]));
      setReplacement(items.map(item => next.get(item.id) ?? item));
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  }
  return <section className="app-panel p-4" aria-label={report.title} aria-busy={busy}>
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h2 className="text-sm font-semibold">{report.title}</h2>
      <div className="flex gap-2">
        {report.retry && failed.length > 0 && <button type="button" className="app-button-secondary" disabled={busy} onClick={() => void retry()}>{busy ? "正在重试…" : `仅重试失败项（${failed.length}）`}</button>}
        <button type="button" className="app-button-secondary" disabled={busy} onClick={onClose}>关闭结果</button>
      </div>
    </div>
    <p role="status" className="mt-2 text-xs text-muted">成功 {items.filter(item => item.status === "success").length} · 失败 {failed.length} · 待确认 {items.filter(item => item.status === "held").length}</p>
    {error && <p role="alert" className="mt-2 text-sm text-danger">{error}</p>}
    <ul className="mt-3 max-h-64 space-y-1 overflow-auto text-sm">
      {items.map(item => <li key={item.id} className="flex flex-wrap gap-x-3 border-t border-border-subtle py-2">
        <span className="font-medium">{item.name}</span>
        <span className={item.status === "failed" ? "text-danger" : "text-muted"}>{item.message}</span>
      </li>)}
    </ul>
  </section>;
}
