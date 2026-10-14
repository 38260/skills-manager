import { useEffect, useRef } from "react";
import type { RefObject } from "react";

const FOCUSABLE = "button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])";
const DIALOG = '[role="dialog"], [role="alertdialog"]';
const activeDialogs: { panel: HTMLElement; restoreTo: HTMLElement | null }[] = [];

export function useDialogFocus(
  open: boolean,
  panelRef: RefObject<HTMLElement | null>,
  onEscape: () => void,
  initialFocusRef?: RefObject<HTMLElement | null>,
) {
  const onEscapeRef = useRef(onEscape);
  useEffect(() => { onEscapeRef.current = onEscape; }, [onEscape]);

  useEffect(() => {
    if (!open || !panelRef.current) return;
    const panel = panelRef.current;
    const scope = { panel, restoreTo: document.activeElement instanceof HTMLElement ? document.activeElement : null };
    // 子弹窗的 effect 可能先执行；父面板始终排在已有子弹窗之前。
    const childIndex = activeDialogs.findIndex((item) => panel.contains(item.panel));
    activeDialogs.splice(childIndex < 0 ? activeDialogs.length : childIndex, 0, scope);
    const isTop = () => activeDialogs[activeDialogs.length - 1] === scope;
    const focusPanel = () => {
      const initial = initialFocusRef?.current;
      if (initial && !initial.matches(":disabled")) initial.focus();
      else panel.focus();
    };
    if (isTop()) focusPanel();

    const onKeyDown = (event: KeyboardEvent) => {
      if (!isTop() || event.defaultPrevented) return;
      // 同时兼容 portal 和面板内嵌的子弹窗，父层不处理子层的键盘事件。
      const owner = event.target instanceof Element ? event.target.closest(DIALOG) : null;
      if (owner && owner !== panel) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onEscapeRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const items = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE))
        .filter((element) => element.tabIndex >= 0 && element.getClientRects().length > 0 && element.closest(DIALOG) === panel);
      const active = document.activeElement;
      if (items.length === 0) {
        event.preventDefault();
        panel.focus();
      } else if (event.shiftKey && (active === panel || active === items[0] || !panel.contains(active))) {
        event.preventDefault();
        items[items.length - 1].focus();
      } else if (!event.shiftKey && (active === items[items.length - 1] || !panel.contains(active))) {
        event.preventDefault();
        items[0].focus();
      }
    };
    const onFocusIn = (event: FocusEvent) => {
      if (!isTop() || !(event.target instanceof Element) || panel.contains(event.target)) return;
      if (event.target.closest(DIALOG)) return;
      focusPanel();
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("focusin", onFocusIn);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("focusin", onFocusIn);
      const wasTop = isTop();
      activeDialogs.splice(activeDialogs.indexOf(scope), 1);
      // 后端动作可能先关闭父确认框；子层关闭后仍应回到最初的页面入口。
      for (const child of activeDialogs) {
        if (child.restoreTo && panel.contains(child.restoreTo)) child.restoreTo = scope.restoreTo;
      }
      if (!wasTop) return;
      const parent = activeDialogs[activeDialogs.length - 1]?.panel;
      if (scope.restoreTo?.isConnected && (!parent || parent.contains(scope.restoreTo))) scope.restoreTo.focus();
      else parent?.focus();
    };
  }, [open, panelRef, initialFocusRef]);
}
