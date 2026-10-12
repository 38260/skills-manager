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
  /** 把文件总数回传给父级，用于在区块标题右侧显示计数角标。 */
  onFileCount?: (count: number | null) => void;
}

export function SkillStructureSection({ skillId, version, onFileCount }: Props) {
  const { t } = useTranslation();
  const [entries, setEntries] = useState<SkillFileEntry[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  // 行数上限：右栏空间有限，默认只列前 6 行，需要时再展开全部，避免区块内部再出现滚动条。
  // 取 6 是为了让"项目结构"与相邻的"来源信息"视觉重量接近，不至于把右栏顶满。
  const [rowLimit, setRowLimit] = useState(6);
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
  // 读取失败或尚未加载时回传 null，父级据此隐藏计数角标而不是显示 0。
  useEffect(() => { onFileCount?.(entries ? fileCount : null); }, [entries, fileCount, onFileCount]);
  // 把树按当前折叠状态压平成渲染顺序，再按上限截断；保持父子层级不被打断，也不使用可变计数器。
  const rows = useMemo(() => {
    const output: { node: TreeNode; depth: number }[] = [];
    const walk = (nodes: TreeNode[], depth: number) => {
      for (const node of nodes) {
        output.push({ node, depth });
        if (node.is_dir && !collapsed.has(node.relative) && node.children.length > 0) walk(node.children, depth + 1);
      }
    };
    walk(tree, 0);
    return output;
  }, [tree, collapsed]);
  const visibleRows = rows.slice(0, rowLimit);
  const limited = rows.length > rowLimit;

  async function openFile(relative: string) {
    setOpenError("");
    try { await openSkillPath(skillId, relative, false); }
    catch (error) { setOpenError(String(error instanceof Error ? error.message : error)); }
  }

  if (failed) return <p className="px-1 py-1 text-[12px] text-tertiary">{t("mySkills.detail.structureUnavailable")}</p>;
  if (!entries) return <p className="px-1 py-1 text-[12px] text-tertiary">{t("common.loading")}</p>;
  if (entries.length === 0) return <p className="px-1 py-1 text-[12px] text-tertiary">{t("mySkills.detail.structureEmpty")}</p>;

  return (
    <div className="flex flex-col">
      <p className="mb-1 text-[11.5px] text-faint">{t("mySkills.detail.structureSummary", { count: fileCount })}</p>
      <div className="flex flex-col">
        {visibleRows.map(({ node, depth }) => {
          const isCollapsed = collapsed.has(node.relative);
          return (
            <button
              key={node.relative}
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
                "flex w-full items-center gap-1.5 rounded-md py-0.5 pr-1.5 text-left outline-none transition-colors hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-accent",
                node.is_dir ? "text-secondary" : "text-tertiary"
              )}
              style={{ paddingLeft: 6 + depth * 12 }}
            >
              {node.is_dir
                ? (isCollapsed ? <ChevronRight className="h-3 w-3 shrink-0 text-muted" /> : <ChevronDown className="h-3 w-3 shrink-0 text-muted" />)
                : <span className="w-3 shrink-0" aria-hidden="true" />}
              {node.is_dir
                ? (isCollapsed ? <Folder className="h-3 w-3 shrink-0 text-accent" /> : <FolderOpen className="h-3 w-3 shrink-0 text-accent" />)
                : <FileText className="h-3 w-3 shrink-0 text-muted" />}
              <span className="min-w-0 flex-1 truncate text-[12.5px] leading-[18px]">{node.name}</span>
              {!node.is_dir && <span className="shrink-0 text-[10.5px] tabular-nums text-faint">{formatSize(node.size)}</span>}
            </button>
          );
        })}
      </div>
      {limited && (
        <button
          type="button"
          onClick={() => setRowLimit(Number.POSITIVE_INFINITY)}
          className="mt-1 inline-flex w-fit items-center gap-1 rounded-md text-[12px] text-accent-dark outline-none hover:underline focus-visible:ring-2 focus-visible:ring-accent dark:text-accent-light"
        >
          <ChevronDown className="h-3 w-3" />
          {t("mySkills.detail.structureShowAll", { count: rows.length })}
        </button>
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
