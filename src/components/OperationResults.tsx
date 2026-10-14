import { useState } from "react";
import { useTranslation } from "react-i18next";

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
  inspect?: (id: string) => void;
}

export function OperationResults({ report, onClose }: { report: OperationReport; onClose: () => void }) {
  const { t } = useTranslation();
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
        {report.retry && failed.length > 0 && <button type="button" className="app-button-secondary" disabled={busy} onClick={() => void retry()}>{busy ? t("optimization.retrying") : t("optimization.retryFailed", { count: failed.length })}</button>}
        <button type="button" className="app-button-secondary" disabled={busy} onClick={onClose}>{t("optimization.closeResults")}</button>
      </div>
    </div>
    <p role="status" className="mt-2 text-xs text-muted">{t("optimization.resultsSummary", { success: items.filter(item => item.status === "success").length, failed: failed.length, held: items.filter(item => item.status === "held").length })}</p>
    {error && <p role="alert" className="mt-2 text-sm text-danger">{error}</p>}
    <ul className="mt-3 max-h-64 space-y-1 overflow-auto text-sm">
      {items.map(item => <li key={item.id} className="flex flex-wrap gap-x-3 border-t border-border-subtle py-2">
        {report.inspect && item.status !== "success" ? <button type="button" className="font-medium text-accent underline focus-visible:ring-2 focus-visible:ring-accent" onClick={() => report.inspect?.(item.id)}>{item.name}</button> : <span className="font-medium">{item.name}</span>}
        <span className={item.status === "failed" ? "text-danger" : "text-muted"}>{item.message}</span>
      </li>)}
    </ul>
  </section>;
}
