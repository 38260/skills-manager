import { useState, type FormEvent } from "react";
import { FolderPlus, FolderSearch, Loader2, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "../utils";
import type { DiscoveryDirStatus } from "../lib/tauri";

interface DiscoveryDirsPanelProps {
  dirs: DiscoveryDirStatus[];
  loading: boolean;
  busy: boolean;
  onAdd: (path: string) => Promise<boolean>;
  onRemove: (path: string) => Promise<void>;
  onBrowse: () => Promise<string | null>;
}

export function DiscoveryDirsPanel({
  dirs,
  loading,
  busy,
  onAdd,
  onRemove,
  onBrowse,
}: DiscoveryDirsPanelProps) {
  const { t } = useTranslation();
  const [pathValue, setPathValue] = useState("");
  const [adding, setAdding] = useState(false);
  const [browsing, setBrowsing] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const value = pathValue.trim();
    if (!value || adding || busy) return;
    setAdding(true);
    try {
      const added = await onAdd(value);
      if (added) setPathValue("");
    } finally {
      setAdding(false);
    }
  };

  const browse = async () => {
    setBrowsing(true);
    try {
      const selected = await onBrowse();
      if (selected) setPathValue(selected);
    } finally {
      setBrowsing(false);
    }
  };

  const remove = async (path: string) => {
    setRemoving(path);
    try {
      await onRemove(path);
    } finally {
      setRemoving(null);
    }
  };

  const statusLabel = (dir: DiscoveryDirStatus) => {
    if (!dir.exists) return t("install.discovery.status.missing");
    if (!dir.is_dir) return t("install.discovery.status.notDirectory");
    if (!dir.readable) return t("install.discovery.status.unreadable");
    return t("install.discovery.status.available");
  };

  const statusTone = (dir: DiscoveryDirStatus) =>
    dir.exists && dir.is_dir && dir.readable
      ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-500 dark:text-emerald-400"
      : "border-amber-500/25 bg-amber-500/10 text-amber-600 dark:text-amber-400";

  return (
    <section className="app-panel overflow-hidden" aria-labelledby="discovery-dirs-title">
      <div className="border-b border-border-subtle px-4 py-3.5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="max-w-xl">
            <h2 id="discovery-dirs-title" className="text-[13px] font-semibold text-secondary">
              {t("install.discovery.title")}
            </h2>
            <p className="mt-1 text-[13px] leading-5 text-muted">
              {t("install.discovery.description")}
            </p>
          </div>
          <span className="inline-flex shrink-0 items-center gap-1.5 rounded-[5px] border border-border-subtle bg-background px-2 py-1 text-[12px] text-muted">
            <FolderSearch className="h-3.5 w-3.5" />
            {t("install.discovery.count", { count: dirs.length })}
          </span>
        </div>
      </div>

      <div className="space-y-3 p-4">
        <form onSubmit={submit} className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="min-w-0 flex-1">
            <label htmlFor="discovery-dir-input" className="sr-only">
              {t("install.discovery.inputLabel")}
            </label>
            <input
              id="discovery-dir-input"
              type="text"
              value={pathValue}
              onChange={(event) => setPathValue(event.target.value)}
              placeholder={t("install.discovery.placeholder")}
              className="app-input w-full bg-background"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
            />
          </div>
          <div className="flex shrink-0 gap-2">
            <button
              type="button"
              onClick={() => void browse()}
              disabled={busy || browsing}
              className="app-button-secondary bg-background"
            >
              {browsing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FolderSearch className="h-3.5 w-3.5" />}
              {t("install.discovery.browse")}
            </button>
            <button
              type="submit"
              disabled={!pathValue.trim() || adding || busy}
              className="app-button-primary"
            >
              {adding ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FolderPlus className="h-3.5 w-3.5" />}
              {t("install.discovery.add")}
            </button>
          </div>
        </form>

        {loading ? (
          <div className="flex items-center gap-2 py-3 text-[13px] text-muted">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            {t("install.discovery.loading")}
          </div>
        ) : dirs.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border-subtle px-3 py-4 text-[13px] text-muted">
            {t("install.discovery.empty")}
          </p>
        ) : (
          <ul aria-label={t("install.discovery.listLabel")} className="space-y-1.5">
            {dirs.map((dir) => (
              <li
                key={dir.path}
                className="flex flex-wrap items-center gap-2 rounded-lg border border-border-subtle bg-surface px-3 py-2"
              >
                <code className="min-w-0 flex-1 truncate text-[12px] text-secondary" title={dir.path}>
                  {dir.path}
                </code>
                <span
                  className={cn(
                    "inline-flex shrink-0 items-center rounded-[5px] border px-1.5 py-0.5 text-[11px] font-medium",
                    statusTone(dir)
                  )}
                >
                  {statusLabel(dir)}
                </span>
                <button
                  type="button"
                  onClick={() => void remove(dir.path)}
                  disabled={busy || removing === dir.path}
                  aria-label={t("install.discovery.removeAria", { path: dir.path })}
                  title={t("install.discovery.remove")}
                  className="shrink-0 rounded-[5px] p-1.5 text-muted transition-colors hover:bg-surface-hover hover:text-red-400 disabled:opacity-50"
                >
                  {removing === dir.path ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Trash2 className="h-3.5 w-3.5" />
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}

        <p className="text-[12px] leading-5 text-muted">{t("install.discovery.hint")}</p>
      </div>
    </section>
  );
}
