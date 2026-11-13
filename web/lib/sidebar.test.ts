import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import {
  isSidebarShortcut, isEditableTarget, readSidebarCollapsed, setSidebarCollapsed,
  SIDEBAR_INIT_SCRIPT, SIDEBAR_STORAGE_KEY, shortcutLabel,
} from "./sidebar";

const key = (k: string, mods: Partial<KeyboardEvent> = {}) =>
  ({ key: k, metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...mods }) as KeyboardEvent;

// An in-memory Storage, whatever the test runtime provides as `localStorage`.
function memoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    get length() { return data.size; },
    clear: () => data.clear(),
    getItem: (k: string) => data.get(k) ?? null,
    key: (i: number) => [...data.keys()][i] ?? null,
    removeItem: (k: string) => { data.delete(k); },
    setItem: (k: string, v: string) => { data.set(k, String(v)); },
  };
}

function blockedStorage(): Storage {
  const no = () => { throw new Error("blocked"); };
  return { length: 0, clear: no, getItem: no, key: no, removeItem: no, setItem: no };
}

beforeEach(() => {
  vi.stubGlobal("localStorage", memoryStorage());
});

afterEach(() => {
  document.documentElement.removeAttribute("data-sidebar");
  vi.unstubAllGlobals();
});

describe("isSidebarShortcut", () => {
  it("is ⌘B on a Mac and Ctrl+B elsewhere", () => {
    expect(isSidebarShortcut(key("b", { metaKey: true }), true)).toBe(true);
    expect(isSidebarShortcut(key("B", { metaKey: true }), true)).toBe(true);
    expect(isSidebarShortcut(key("b", { ctrlKey: true }), true)).toBe(false);
    expect(isSidebarShortcut(key("b", { ctrlKey: true }), false)).toBe(true);
    expect(isSidebarShortcut(key("b", { metaKey: true }), false)).toBe(false);
  });

  it("leaves the other combinations alone", () => {
    expect(isSidebarShortcut(key("b"), true)).toBe(false);
    expect(isSidebarShortcut(key("b", { metaKey: true, shiftKey: true }), true)).toBe(false);
    expect(isSidebarShortcut(key("b", { metaKey: true, altKey: true }), true)).toBe(false);
    expect(isSidebarShortcut(key("k", { metaKey: true }), true)).toBe(false);
  });

  it("names itself for the platform", () => {
    expect(shortcutLabel(true)).toBe("⌘B");
    expect(shortcutLabel(false)).toBe("Ctrl+B");
  });
});

describe("isEditableTarget", () => {
  it("spots fields", () => {
    expect(isEditableTarget(document.createElement("input"))).toBe(true);
    expect(isEditableTarget(document.createElement("textarea"))).toBe(true);
    expect(isEditableTarget(document.createElement("select"))).toBe(true);
    const div = document.createElement("div");
    expect(isEditableTarget(div)).toBe(false);
    expect(isEditableTarget(null)).toBe(false);
    expect(isEditableTarget(window)).toBe(false);
  });
});

describe("folded state", () => {
  it("lives on <html> and in localStorage", () => {
    expect(readSidebarCollapsed()).toBe(false);
    setSidebarCollapsed(true);
    expect(document.documentElement.getAttribute("data-sidebar")).toBe("collapsed");
    expect(localStorage.getItem(SIDEBAR_STORAGE_KEY)).toBe("collapsed");
    expect(readSidebarCollapsed()).toBe(true);
    setSidebarCollapsed(false);
    expect(document.documentElement.hasAttribute("data-sidebar")).toBe(false);
    expect(localStorage.getItem(SIDEBAR_STORAGE_KEY)).toBeNull();
  });

  it("still folds when storage is blocked", () => {
    vi.stubGlobal("localStorage", blockedStorage());
    expect(() => setSidebarCollapsed(true)).not.toThrow();
    expect(readSidebarCollapsed()).toBe(true);
  });

  it("is restored before paint by the init script", () => {
    localStorage.setItem(SIDEBAR_STORAGE_KEY, "collapsed");
    new Function(SIDEBAR_INIT_SCRIPT)();
    expect(readSidebarCollapsed()).toBe(true);
  });

  it("init script survives blocked storage", () => {
    vi.stubGlobal("localStorage", blockedStorage());
    expect(() => new Function(SIDEBAR_INIT_SCRIPT)()).not.toThrow();
    expect(readSidebarCollapsed()).toBe(false);
  });
});
