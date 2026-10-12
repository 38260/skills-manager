import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, ChevronRight, FileText, FolderOpen, Folder, FolderSearch } from "lucide-react";
import { cn } from "../utils";
import { getSkillFiles, openSkillPath, type SkillFileEntry } from "../lib/tauri";

interface TreeNode extends SkillFileEntry {
  name: string;
  children: TreeNode[];
}

// 后端返回"目录在前、子项随后"的排序列表；按路径前缀还原成树，保留原始顺序。
function buildTree(entries: SkillFileEntry[]): TreeNode[] {
  const roots: TreeNode[] = [];
  const directories = new Map<string, TreeNode>();
  for (const entry of entries) {
    const segments = entry.relative.split("/");
    const node: TreeNode = { ...entry, name: segments[segments.length - 1], children: [] };
    if (entry.is_dir) directories.set(entry.relative, node);
    const parentPath = segments.slice(0, -1).join("/");
    const parent = parentPath ? directories.get(parentPath) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  return roots;
}

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

interface Props {
  skillId: string;
  /** 技能内容变化后重新读取目录结构。 */
  version: string;
}

export function SkillStructureSection({ skillId, version }: Props) {
  const { t } = useTranslation();
  const [entries, setEntries] = useState<SkillFileEntry[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState(true);
  const [openError, setOpenError] = useState("");

  useEffect(() => {
    let current = true;
    getSkillFiles(skillId)
      .then(result => { if (current) { setEntries(result.entries); setFailed(false); } })
      .catch(() => { if (current) { setEntries(null); setFailed(true); } });
    return () => { current = false; };
  }, [skillId, version]);

  const tree = useMemo(() => buildTree(entries ?? []), [entries]);
  const fileCount = (entries ?? []).filter(entry => !entry.is_dir).length;

  async function openFile(relative: string) {
    setOpenError("");
    try { await openSkillPath(skillId, relative, false); }
    catch (error) { setOpenError(String(error instanceof Error ? error.message : error)); }
  }

  function renderNodes(nodes: TreeNode[], depth: number) {
    return nodes.map(node => {
      const isCollapsed = collapsed.has(node.relative);
      return (
        <div key={node.relative}>
          <button
            type="button"
            onClick={() => {
              if (!node.is_dir) { void openFile(node.relative); return; }
              setCollapsed(previous => {
                const next = new Set(previous);
                if (next.has(node.relative)) next.delete(node.relative);
                else next.add(node.relative);
                return next;
              });
            }}
            title={node.is_dir ? node.relative : `${node.relative} · ${formatSize(node.size)}`}
            className={cn(
              "flex w-full items-center gap-2 rounded-md py-1 pr-2 text-left outline-none transition-colors hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-accent",
              node.is_dir ? "text-secondary" : "text-tertiary"
            )}
            style={{ paddingLeft: 8 + depth * 14 }}
          >
            {node.is_dir
              ? (isCollapsed ? <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted" /> : <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted" />)
              : <span className="w-3.5 shrink-0" aria-hidden="true" />}
            {node.is_dir
              ? (isCollapsed ? <Folder className="h-3.5 w-3.5 shrink-0 text-accent" /> : <FolderOpen className="h-3.5 w-3.5 shrink-0 text-accent" />)
              : <FileText className="h-3.5 w-3.5 shrink-0 text-muted" />}
            <span className="min-w-0 flex-1 truncate text-[13px] leading-5">{node.name}</span>
            {!node.is_dir && <span className="shrink-0 text-[11px] tabular-nums text-faint">{formatSize(node.size)}</span>}
          </button>
          {node.is_dir && !isCollapsed && node.children.length > 0 && renderNodes(node.children, depth + 1)}
        </div>
      );
    });
  }

  if (failed) return <p className="px-1 py-1 text-[12px] text-tertiary">{t("mySkills.detail.structureUnavailable")}</p>;
  if (!entries) return <p className="px-1 py-1 text-[12px] text-tertiary">{t("common.loading")}</p>;
  if (entries.length === 0) return <p className="px-1 py-1 text-[12px] text-tertiary">{t("mySkills.detail.structureEmpty")}</p>;

  return (
    <div className="flex flex-col">
      <button
        type="button"
        onClick={() => setExpanded(value => !value)}
        aria-expanded={expanded}
        className="flex items-center gap-1.5 rounded-md py-1 text-left text-[12px] text-muted outline-none hover:text-secondary focus-visible:ring-2 focus-visible:ring-accent"
      >
        {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        {t("mySkills.detail.structureSummary", { count: fileCount })}
      </button>
      {expanded && (
        <div className="mt-1 flex max-h-[240px] flex-col overflow-y-auto scrollbar-hide">
          {renderNodes(tree, 0)}
        </div>
      )}
      <button
        type="button"
        onClick={async () => {
          setOpenError("");
          try { await openSkillPath(skillId, "", true); }
          catch (error) { setOpenError(String(error instanceof Error ? error.message : error)); }
        }}
        className="mt-2 inline-flex w-fit items-center gap-1.5 rounded-md text-[12px] text-muted outline-none hover:text-secondary focus-visible:ring-2 focus-visible:ring-accent"
      >
        <FolderSearch className="h-3.5 w-3.5" />
        {t("mySkills.detail.revealInFolder")}
      </button>
      {openError && <p role="alert" className="mt-1 text-[12px] text-danger">{openError}</p>}
    </div>
  );
}
