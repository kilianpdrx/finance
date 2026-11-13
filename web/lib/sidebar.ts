import { useSyncExternalStore } from "react";
import { SIDEBAR_STORAGE_KEY } from "./sidebar-init";

export { SIDEBAR_STORAGE_KEY, SIDEBAR_INIT_SCRIPT } from "./sidebar-init";

/**
 * The desktop sidebar folds to an icon rail. The state is an attribute on
 * <html> (`data-sidebar="collapsed"`) that the CSS reads, set before the first
 * paint by `SIDEBAR_INIT_SCRIPT` (app/layout.tsx) from localStorage — so a
 * folded sidebar never flashes open on load, and the server's markup stays the
 * same whatever the browser remembers. Per browser, like the theme.
 */
const CHANGE_EVENT = "finance-sidebar-change";

// In components, the folded look is the Tailwind variant `[[data-sidebar=collapsed]_&]:…`,
// written out in full (Tailwind only sees literal class names), and only on the
// desktop rail: the phone drawer never folds.

export function readSidebarCollapsed(): boolean {
  if (typeof document === "undefined") return false;
  return document.documentElement.getAttribute("data-sidebar") === "collapsed";
}

export function setSidebarCollapsed(collapsed: boolean): void {
  if (collapsed) document.documentElement.setAttribute("data-sidebar", "collapsed");
  else document.documentElement.removeAttribute("data-sidebar");
  try {
    if (collapsed) window.localStorage.setItem(SIDEBAR_STORAGE_KEY, "collapsed");
    else window.localStorage.removeItem(SIDEBAR_STORAGE_KEY);
  } catch {
    /* storage blocked: the choice lasts until the page is reloaded */
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

function subscribe(onChange: () => void) {
  window.addEventListener(CHANGE_EVENT, onChange);
  return () => window.removeEventListener(CHANGE_EVENT, onChange);
}

/** The folded state for React (false while hydrating, like the server's markup). */
export function useSidebarCollapsed(): boolean {
  return useSyncExternalStore(subscribe, readSidebarCollapsed, () => false);
}

export function isMacPlatform(): boolean {
  if (typeof navigator === "undefined") return false;
  return /Mac|iPhone|iPad/.test(navigator.userAgent);
}

/** ⌘B on a Mac, Ctrl+B elsewhere — the usual sidebar shortcut. */
export function isSidebarShortcut(
  e: Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey">,
  mac: boolean,
): boolean {
  if (e.altKey || e.shiftKey) return false;
  const mod = mac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey;
  return mod && e.key.toLowerCase() === "b";
}

/** Typing in a field keeps its own ⌘B / Ctrl+B (bold in a rich field). */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (!target || typeof (target as HTMLElement).tagName !== "string") return false;
  const el = target as HTMLElement;
  const tag = el.tagName.toLowerCase();
  return tag === "input" || tag === "textarea" || tag === "select" || el.isContentEditable === true;
}

export function shortcutLabel(mac: boolean): string {
  return mac ? "⌘B" : "Ctrl+B";
}
