"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { PDFDocumentLoadingTask, PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";
import type { TextContent } from "pdfjs-dist/types/src/display/api";
import { ExternalLink, Loader2, Maximize2, Minus, Plus } from "lucide-react";
import { labelKey } from "@/lib/payroll-review";

/** A line of the review, as the PDF prints it: its label's key, and which
 *  occurrence (the second « AHV » line of the review is the second AHV row). */
export interface PdfTarget { key: string; occurrence: number }

/** A row of text on a page, in PDF units (origin bottom left). */
interface Row { page: number; key: string; x0: number; x1: number; y0: number; y1: number }

const ZOOMS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4];
const MAX_PAGES = 20;
const PAD = 12;

let pdfjs: Promise<typeof import("pdfjs-dist")> | null = null;
/** pdf.js, loaded on first use — in the browser only — with its worker. The
 *  LEGACY build: the modern one calls JavaScript only the newest browsers have
 *  (`Map.prototype.getOrInsertComputed`), and failed in Safari and older Chromes. */
function loadPdfjs() {
  pdfjs ??= import("pdfjs-dist/legacy/build/pdf.mjs").then((lib) => {
    lib.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/legacy/build/pdf.worker.min.mjs", import.meta.url).toString();
    return lib;
  }).catch((e) => {
    pdfjs = null;                            // try again next time
    throw e;
  });
  return pdfjs;
}

/** The PDF in its own tab: the way out when it cannot be drawn here. */
async function openElsewhere(source: File | string) {
  const tab = window.open("", "_blank");
  try {
    const blob = source instanceof File ? source : await fetch(source).then((r) => {
      if (!r.ok) throw new Error(String(r.status));
      return r.blob();
    });
    const url = URL.createObjectURL(blob);
    if (tab) tab.location.href = url;
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } catch {
    tab?.close();
  }
}

/** The page's words grouped into rows by their baseline. */
async function textRows(page: PDFPageProxy, index: number): Promise<Row[]> {
  // Read the stream by hand: `getTextContent` iterates it with `for await`,
  // which Safari's streams do not support (« undefined is not a function »).
  const reader = (page.streamTextContent() as ReadableStream<TextContent>).getReader();
  const parts: TextContent["items"] = [];
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    parts.push(...value.items);
  }
  const items = parts
    .flatMap((it) => ("str" in it && it.str.trim() ? [{ str: it.str, x: it.transform[4], y: it.transform[5], w: it.width, h: it.height }] : []))
    .sort((a, b) => b.y - a.y || a.x - b.x);
  const rows: { y: number; parts: typeof items }[] = [];
  for (const it of items) {
    const row = rows.find((r) => Math.abs(r.y - it.y) <= 2);
    if (row) row.parts.push(it); else rows.push({ y: it.y, parts: [it] });
  }
  return rows.map((r) => {
    const parts = [...r.parts].sort((a, b) => a.x - b.x);
    const h = Math.max(...parts.map((p) => p.h || 8));
    return {
      page: index, key: labelKey(parts.map((p) => p.str).join(" ")),
      x0: parts[0].x, x1: Math.max(...parts.map((p) => p.x + p.w)), y0: r.y - h * 0.25, y1: r.y + h,
    };
  });
}

/** The row printing that line: the same label first, else a row starting with it. */
function find(rows: Row[], target: PdfTarget | null): Row | null {
  if (!target?.key) return null;
  const exact = rows.filter((r) => r.key === target.key);
  if (exact.length > target.occurrence) return exact[target.occurrence];
  return rows.filter((r) => r.key.startsWith(target.key))[target.occurrence] ?? null;
}

type State =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; doc: PDFDocumentProxy; pages: PDFPageProxy[]; rows: Row[] };

/** The payslip's PDF beside its review, drawn by pdf.js: the same zoom in
 *  every browser, and the line being checked highlighted on the page. */
export function PdfViewer({ source, target }: {
  /** The file being reviewed, or a saved payslip's `/api/payroll/documents/{id}`. */
  source: File | string;
  target: PdfTarget | null;
}) {
  const [state, setState] = useState<State>({ status: "loading" });
  const [zoom, setZoom] = useState<number | "fit">("fit");
  const [width, setWidth] = useState(0);
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    let task: PDFDocumentLoadingTask | null = null;
    setState({ status: "loading" });
    (async () => {
      try {
        const lib = await loadPdfjs();
        const data = source instanceof File ? await source.arrayBuffer() : await fetch(source).then((r) => {
          if (!r.ok) throw new Error(String(r.status));
          return r.arrayBuffer();
        });
        task = lib.getDocument({ data: new Uint8Array(data), enableXfa: false });
        const doc = await task.promise;
        const pages = await Promise.all(Array.from({ length: Math.min(doc.numPages, MAX_PAGES) }, (_, i) => doc.getPage(i + 1)));
        // Without its text the PDF is still drawn, only nothing can be highlighted.
        const rows = (await Promise.all(pages.map((page, i) => textRows(page, i).catch(() => [])))).flat();
        if (!cancelled) setState({ status: "ready", doc, pages, rows });
      } catch (e) {
        // The cause, for the console only: never the PDF's content.
        console.error("Aperçu du PDF impossible :", e instanceof Error ? `${e.name}: ${e.message}` : e);
        if (!cancelled) setState({ status: "error" });
      }
    })();
    return () => { cancelled = true; void task?.destroy(); };
  }, [source]);

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const pageWidth = state.status === "ready" ? state.pages[0].getViewport({ scale: 1 }).width : 0;
  const fit = pageWidth && width ? Math.max(0.25, (width - 2 * PAD) / pageWidth) : 1;
  const scale = zoom === "fit" ? fit : zoom;
  const scaleRef = useRef(scale);
  scaleRef.current = scale;

  // ⌘/Ctrl + scroll zooms inside the pane, not the whole page.
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      // Several events can arrive before the next render: each builds on the last.
      scaleRef.current = Math.min(4, Math.max(0.5, scaleRef.current * (e.deltaY < 0 ? 1.1 : 1 / 1.1)));
      setZoom(scaleRef.current);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const highlighted = useMemo(() => (state.status === "ready" ? find(state.rows, target) : null), [state, target]);
  const step = (dir: 1 | -1) => {
    const next = dir > 0 ? ZOOMS.find((z) => z > scale + 0.01) : [...ZOOMS].reverse().find((z) => z < scale - 0.01);
    setZoom(next ?? (dir > 0 ? ZOOMS.at(-1)! : ZOOMS[0]));
  };

  return (
    <section aria-label="Aperçu du PDF" className="flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-border bg-muted/40">
      <div className="flex shrink-0 items-center justify-end gap-1 border-b border-border px-2 py-1.5">
        <button type="button" aria-label="Zoom arrière" onClick={() => step(-1)} disabled={scale <= ZOOMS[0] + 0.001}
          className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40"><Minus className="size-4" /></button>
        <span className="nums w-12 text-center text-xs tabular-nums" aria-label="Zoom">{Math.round(scale * 100)} %</span>
        <button type="button" aria-label="Zoom avant" onClick={() => step(1)} disabled={scale >= ZOOMS.at(-1)! - 0.001}
          className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40"><Plus className="size-4" /></button>
        <button type="button" aria-label="Ajuster à la largeur" title="Ajuster à la largeur" onClick={() => setZoom("fit")}
          className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"><Maximize2 className="size-4" /></button>
      </div>
      <div ref={scroller} className="min-h-0 flex-1 overflow-auto">
        {state.status === "loading" && (
          <p className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" /> Ouverture du PDF…</p>
        )}
        {state.status === "error" && (
          <div className="flex flex-col items-center gap-3 py-16 text-center text-sm text-muted-foreground">
            <p>Ce PDF ne peut pas être affiché ici.</p>
            <button type="button" onClick={() => void openElsewhere(source)}
              className="inline-flex items-center gap-1 text-xs text-brand hover:underline">
              <ExternalLink className="size-3" /> L&apos;ouvrir dans un nouvel onglet
            </button>
          </div>
        )}
        {state.status === "ready" && (
          <div className="flex w-max min-w-full flex-col items-center gap-3" style={{ padding: PAD }}>
            {state.pages.map((page, i) => (
              <Page key={i} page={page} scale={scale} mark={highlighted?.page === i ? highlighted : null} />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function Page({ page, scale, mark }: { page: PDFPageProxy; scale: number; mark: Row | null }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const band = useRef<HTMLDivElement>(null);
  const viewport = page.getViewport({ scale });

  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = Math.floor(viewport.width * dpr);
    c.height = Math.floor(viewport.height * dpr);
    const task = page.render({ canvas: c, viewport, transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined });
    task.promise.catch(() => {});            // cancelled by a newer zoom
    return () => task.cancel();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, scale]);

  useEffect(() => {
    band.current?.scrollIntoView({ block: "center", inline: "nearest", behavior: "smooth" });
  }, [mark, scale]);

  let style: React.CSSProperties | undefined;
  if (mark) {
    const [x1, y1] = viewport.convertToViewportPoint(mark.x0, mark.y0);
    const [x2, y2] = viewport.convertToViewportPoint(mark.x1, mark.y1);
    style = { top: Math.min(y1, y2) - 3, height: Math.abs(y2 - y1) + 6, left: Math.max(0, Math.min(x1, x2) - 6) };
  }
  return (
    <div className="relative shrink-0 bg-white shadow-sm" style={{ width: viewport.width, height: viewport.height }}>
      <canvas ref={canvas} className="block size-full" />
      {style && (
        <div ref={band} data-testid="pdf-highlight" aria-hidden
          className="pointer-events-none absolute right-1.5 rounded-sm bg-yellow-300/35 ring-2 ring-yellow-500/80" style={style} />
      )}
    </div>
  );
}
