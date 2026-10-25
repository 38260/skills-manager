import type { LibrarySortMode } from "./librarySort";

export interface LibraryViewState {
  viewMode: "grid" | "list";
  sortMode: LibrarySortMode;
  filterMode: "all" | "enabled" | "available" | "favorites";
  search: string;
  sourceFilters: string[];
  tagFilters: string[];
  scrollTop: number;
}

type ViewStorage = Pick<Storage, "getItem" | "setItem">;
interface LibraryViewStorage {
  session?: ViewStorage;
  preferences?: ViewStorage;
}

function getStorage(kind: "sessionStorage" | "localStorage") {
  try {
    return globalThis[kind];
  } catch {
    return undefined;
  }
}

function libraryKey(libraryPath: string) {
  const normalized = libraryPath.replace(/\\/g, "/").replace(/\/+$/, "");
  return encodeURIComponent(/^[a-z]:\//i.test(normalized) ? normalized.toLowerCase() : normalized);
}

function stateKey(libraryPath: string, presetId: string | null) {
  return `skills-manager.libraryView.v1.${libraryKey(libraryPath)}.${presetId === null ? "library" : `preset:${encodeURIComponent(presetId)}`}`;
}

function preferenceKey(libraryPath: string, kind: "ViewMode" | "SortMode") {
  return `skills-manager.library${kind}.v1.${libraryKey(libraryPath)}`;
}

function filterValues(value: unknown): string[] {
  return Array.isArray(value)
    ? [...new Set(value.filter((item): item is string => typeof item === "string" && item.trim().length > 0))]
    : [];
}

export function readLibraryViewState(
  libraryPath: string,
  presetId: string | null,
  storage: LibraryViewStorage = {},
): LibraryViewState {
  let saved: Record<string, unknown> = {};
  let viewMode: LibraryViewState["viewMode"] = "grid";
  let sortMode: LibrarySortMode = "default";
  try {
    const raw = (storage.session ?? getStorage("sessionStorage"))?.getItem(stateKey(libraryPath, presetId));
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) saved = parsed as Record<string, unknown>;
  } catch {
    // 缓存损坏或浏览器禁用存储时仍可正常浏览技能库。
  }
  try {
    const preferences = storage.preferences ?? getStorage("localStorage");
    if (preferences?.getItem(preferenceKey(libraryPath, "ViewMode")) === "list") viewMode = "list";
    const savedSort = preferences?.getItem(preferenceKey(libraryPath, "SortMode"));
    if (savedSort === "usage-desc" || savedSort === "usage-asc") sortMode = savedSort;
  } catch {
    // 视图偏好读取失败不影响本次操作。
  }
  const tagFilters = filterValues(saved.tagFilters);
  return {
    viewMode,
    sortMode,
    filterMode: saved.filterMode === "enabled" || saved.filterMode === "available" || saved.filterMode === "favorites" ? saved.filterMode : "all",
    search: typeof saved.search === "string" ? saved.search : "",
    // 保持现有来源与分类筛选互斥的交互语义。
    sourceFilters: tagFilters.length ? [] : filterValues(saved.sourceFilters),
    tagFilters,
    scrollTop: typeof saved.scrollTop === "number" && Number.isFinite(saved.scrollTop) && saved.scrollTop > 0 ? saved.scrollTop : 0,
  };
}

export function writeLibraryViewState(
  libraryPath: string,
  presetId: string | null,
  state: LibraryViewState,
  storage: LibraryViewStorage = {},
) {
  const { viewMode, sortMode, ...sessionState } = state;
  try {
    (storage.session ?? getStorage("sessionStorage"))?.setItem(stateKey(libraryPath, presetId), JSON.stringify(sessionState));
  } catch {
    // 存储额度不足时保持界面可用。
  }
  try {
    const preferences = storage.preferences ?? getStorage("localStorage");
    preferences?.setItem(preferenceKey(libraryPath, "ViewMode"), viewMode);
    preferences?.setItem(preferenceKey(libraryPath, "SortMode"), sortMode);
  } catch {
    // 视图模式仍保留在当前页面状态中。
  }
}

export function restoreLibraryScroll(container: HTMLElement, scrollTop: number) {
  const requestedTop = Number.isFinite(scrollTop) ? Math.max(0, scrollTop) : 0;
  let frame = 0;
  let attempts = 0;
  let stopped = false;
  const stop = () => {
    stopped = true;
    cancelAnimationFrame(frame);
    container.removeEventListener("wheel", stop);
    container.removeEventListener("touchstart", stop);
    container.removeEventListener("keydown", onKeyDown);
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "].includes(event.key)) stop();
  };
  const restore = () => {
    if (stopped) return;
    const maximumTop = Math.max(0, container.scrollHeight - container.clientHeight);
    // 等待列表完成布局，内容减少时最终恢复到仍存在的位置。
    if (maximumTop >= requestedTop || ++attempts >= 30) {
      container.scrollTop = Math.min(requestedTop, maximumTop);
      stop();
    } else {
      frame = requestAnimationFrame(restore);
    }
  };
  container.addEventListener("wheel", stop, { passive: true });
  container.addEventListener("touchstart", stop, { passive: true });
  container.addEventListener("keydown", onKeyDown);
  frame = requestAnimationFrame(restore);
  return stop;
}
