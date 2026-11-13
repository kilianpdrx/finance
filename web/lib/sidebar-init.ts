// No React here: app/layout.tsx (a server component) inlines the script.
export const SIDEBAR_STORAGE_KEY = "finance-sidebar";

/** Run in <head> before the first paint: folds the rail if this browser asked for it (lib/sidebar.ts). */
export const SIDEBAR_INIT_SCRIPT =
  `try{if(localStorage.getItem("${SIDEBAR_STORAGE_KEY}")==="collapsed")` +
  `document.documentElement.setAttribute("data-sidebar","collapsed")}catch(e){}`;
