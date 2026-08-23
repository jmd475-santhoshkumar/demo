"use client";

import { useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy, RenderTask, TextLayer } from "pdfjs-dist";
import { Loader2 } from "lucide-react";

// pdfjs's own text-layer stylesheet (pdfjs-dist/web/pdf_viewer.css) uses
// modern nested CSS (e.g. "&.highlighting { ... }") that this app's CSS
// build pipeline can't parse -- flattened here to just the rules TextLayer's
// rendered spans actually need to size/position correctly over the canvas
// beneath them (driven by the --total-scale-factor custom property set per
// page). Everything pdfjs ships for its own annotation/editor layers and
// built-in find-highlight UI is dropped since this viewer doesn't use them.
const TEXT_LAYER_CSS = `
.textLayer {
  color-scheme: only light;
  position: absolute;
  text-align: initial;
  inset: 0;
  overflow: clip;
  opacity: 1;
  line-height: 1;
  letter-spacing: normal;
  word-spacing: normal;
  -webkit-text-size-adjust: none;
  text-size-adjust: none;
  forced-color-adjust: none;
  transform-origin: 0 0;
  z-index: 0;
  /* Required by pdf.js's own setLayerDimensions() (called inside the
     TextLayer constructor), which sizes this container via a CSS round()
     expression referencing these two variables -- without them the
     container's computed width/height is invalid, silently breaking every
     span's effective position inside it. */
  --scale-round-x: 1px;
  --scale-round-y: 1px;
  --min-font-size: 1;
  --text-scale-factor: calc(var(--total-scale-factor) * var(--min-font-size));
  --min-font-size-inv: calc(1 / var(--min-font-size));
}
.textLayer span, .textLayer br {
  color: transparent;
  position: absolute;
  white-space: pre;
  cursor: text;
  transform-origin: 0% 0%;
  user-select: text;
}
.textLayer > :not(.markedContent),
.textLayer .markedContent span:not(.markedContent) {
  z-index: 1;
  --font-height: 0;
  font-size: calc(var(--text-scale-factor) * var(--font-height));
  --scale-x: 1;
  --rotate: 0deg;
  transform: rotate(var(--rotate)) scaleX(var(--scale-x)) scale(var(--min-font-size-inv));
}
.textLayer .markedContent {
  display: contents;
}
.textLayer span[role="img"] {
  user-select: none;
  cursor: default;
}
.sow-pdf-highlight {
  background: hsl(var(--primary) / 0.4) !important;
  border-radius: 2px;
}
`;

// Same normalize + leaf/window matching approach as the docx viewer
// (SowDocumentViewer.tsx's findMatchingSpan) -- ported to work over a flat
// string array (one page's text runs) instead of DOM elements, since a PDF
// page's text layer gives pdf.js's own text-run strings directly rather
// than paragraph-shaped HTML.
function normalizeText(text: string): string {
  return text.replace(/\|/g, " ").replace(/\s+/g, " ").trim().toLowerCase();
}

function findMatchingIndices(texts: string[], quote: string): number[] | null {
  const target = normalizeText(quote);
  if (!target) return null;
  const norm = texts.map(normalizeText);

  for (let i = 0; i < norm.length; i++) {
    if (norm[i] && norm[i].includes(target)) return [i];
  }

  // pdf.js emits structural empty-string items for line/EOL breaks between
  // real text runs. Naively joining every item with a separator space -- even
  // the empty ones -- inserts a double space that breaks the prefix check
  // against `target` (already single-spaced by normalizeText), so a real
  // multi-line quote never matches. Skip empty items when building the
  // joined string, but keep the original index span (via lastMatchEnd) so
  // the returned range still covers every div, including the empties, from
  // the first real match through the last.
  const MAX_WINDOW = 60;
  for (let i = 0; i < norm.length; i++) {
    if (!norm[i] || !target.startsWith(norm[i])) continue;
    let joined = norm[i];
    let lastMatchEnd = i;
    for (let j = i + 1; j < Math.min(norm.length, i + MAX_WINDOW); j++) {
      if (!norm[j]) continue;
      const next = `${joined} ${norm[j]}`;
      if (!target.startsWith(next)) break;
      joined = next;
      lastMatchEnd = j;
      if (joined === target) return Array.from({ length: lastMatchEnd - i + 1 }, (_, k) => i + k);
    }
  }
  return null;
}

const PAGE_WIDTH_PX = 780;

function PdfPage({
  pdfDoc, pageNumber, focusQuote, onMatchFound, fallbackAspectRatio,
}: {
  pdfDoc: PDFDocumentProxy;
  pageNumber: number;
  focusQuote?: string;
  onMatchFound: (el: HTMLElement) => void;
  fallbackAspectRatio: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textLayerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);

  useEffect(() => {
    let cancelled = false;
    // Same Strict-Mode-double-invoke shape as the parent viewer's worker
    // fix: a discarded first instance's render/text-layer work can still be
    // in flight when its cleanup runs, and pdf.js explicitly disallows a
    // second render() on the same canvas while one is still active -- so
    // both the render task and the text layer are captured and explicitly
    // cancelled, not just gated behind the `cancelled` flag.
    let renderTask: RenderTask | null = null;
    let textLayer: TextLayer | null = null;
    (async () => {
      const pdfjsLib = await import("pdfjs-dist");
      if (cancelled) return;
      const page = await pdfDoc.getPage(pageNumber);
      if (cancelled) return;

      const unscaledWidth = page.getViewport({ scale: 1 }).width;
      const scale = PAGE_WIDTH_PX / unscaledWidth;
      const viewport = page.getViewport({ scale });
      setSize({ width: viewport.width, height: viewport.height });

      const canvas = canvasRef.current;
      if (!canvas || cancelled) return;
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      renderTask = page.render({ canvasContext: ctx, viewport, canvas });
      try {
        await renderTask.promise;
      } catch {
        return; // cancelled mid-render (RenderingCancelledException) -- nothing more to do
      }
      if (cancelled || !textLayerRef.current) return;

      textLayerRef.current.style.setProperty("--total-scale-factor", String(scale));
      const textContent = await page.getTextContent();
      if (cancelled) return;

      textLayer = new pdfjsLib.TextLayer({ textContentSource: textContent, container: textLayerRef.current, viewport });
      await textLayer.render();
      if (cancelled) return;

      if (focusQuote) {
        const matchIndices = findMatchingIndices(textLayer.textContentItemsStr, focusQuote);
        if (matchIndices) {
          const divs = textLayer.textDivs;
          matchIndices.forEach((idx) => divs[idx]?.classList.add("sow-pdf-highlight"));
          const first = divs[matchIndices[0]];
          if (first) onMatchFound(first);
        }
      }
    })();
    return () => {
      cancelled = true;
      renderTask?.cancel();
      textLayer?.cancel();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pdfDoc, pageNumber, focusQuote]);

  return (
    <div className="relative bg-white shadow-[0_1px_3px_rgba(0,0,0,0.15)]" style={size ? { width: size.width, height: size.height } : { width: PAGE_WIDTH_PX, height: PAGE_WIDTH_PX * fallbackAspectRatio }}>
      <canvas ref={canvasRef} className="block" />
      <div ref={textLayerRef} className="textLayer" />
    </div>
  );
}

export function PdfCanvasViewer({ data, focusLocation, focusQuote }: { data: Uint8Array; focusLocation?: string; focusQuote?: string }) {
  const [pdfDoc, setPdfDoc] = useState<PDFDocumentProxy | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Every other page's placeholder (before its own real content loads) was
  // guessing a US-Letter-shaped box (a 1.294 height/width ratio) -- for a
  // document actually laid out on a different page size (e.g. A4, ~1.414),
  // that guess undershoots each page's real height. With ~8 pages ahead of
  // a citation, those errors added up to roughly a full page's worth of
  // height, so the "jump to the cited page" landed a page short by the
  // time everything settled into its true size. Reading the real ratio off
  // the document's own first page before showing anything makes every
  // placeholder accurate from the first paint, instead of guessing and
  // correcting later.
  const [pageAspectRatio, setPageAspectRatio] = useState<number | null>(null);
  const targetPageElRef = useRef<HTMLDivElement | null>(null);
  const hasScrolledToPageRef = useRef(false);
  const pageMatch = focusLocation?.match(/Page\s+(\d+)/i);
  const targetPage = pageMatch ? Number(pageMatch[1]) : null;

  useEffect(() => {
    if (!pdfDoc) return;
    let cancelled = false;
    pdfDoc.getPage(1).then((page) => {
      if (cancelled) return;
      const viewport = page.getViewport({ scale: 1 });
      setPageAspectRatio(viewport.height / viewport.width);
    });
    return () => {
      cancelled = true;
    };
  }, [pdfDoc]);

  // Jumps to the cited page's position immediately, without waiting for
  // that page's own content to finish loading -- we already know which
  // page number we want straight from the citation, so there's no need to
  // wait on an async render+text-search round trip just to find out where
  // to scroll. Every page renders concurrently as before; this only
  // decides WHERE to look, independently of when any given page's content
  // happens to be ready. (An earlier version tried to scroll only after
  // finding the actual highlighted text, gated other pages' rendering
  // behind that, and got tangled in layout-shift races as a result --
  // scrolling to a known page number needs none of that.) Waiting on
  // pageAspectRatio too means this never fires while placeholders are
  // still using a guessed size.
  useEffect(() => {
    if (!pdfDoc || targetPage == null || pageAspectRatio == null || hasScrolledToPageRef.current || !targetPageElRef.current) return;
    hasScrolledToPageRef.current = true;
    targetPageElRef.current.scrollIntoView({ behavior: "auto", block: "start" });
  }, [pdfDoc, targetPage, pageAspectRatio]);

  useEffect(() => {
    let cancelled = false;
    // Every open of this viewer (a citation click) mounts a fresh instance
    // and spins up a real pdf.js worker thread. Without explicitly
    // destroying it on close/unmount, each closed-and-reopened viewer left
    // its worker running -- which is exactly why this intermittently broke
    // after a few opens ("works, then fails, then works again"): repeated
    // orphaned workers piling up until the browser/pdf.js's own internal
    // state got confused. `loadingTask.destroy()` tears down both an
    // in-flight load and an already-resolved one, so capturing it here
    // (rather than only the resolved document, which has no destroy of its
    // own) and calling it unconditionally in cleanup closes that leak.
    let loadingTask: ReturnType<typeof import("pdfjs-dist")["getDocument"]> | null = null;
    hasScrolledToPageRef.current = false;
    (async () => {
      try {
        const pdfjsLib = await import("pdfjs-dist");
        // Strict Mode's double-invoke can run this discarded instance's
        // cleanup *before* the dynamic import above even resolves -- at
        // that point `loadingTask` is still null, so the cleanup's
        // `loadingTask?.destroy()` is a no-op and can't catch what gets
        // created next. Checking `cancelled` again right here, before ever
        // creating a worker, is what actually prevents that orphan.
        if (cancelled) return;
        // Served as a plain static file (copied into public/ at setup time)
        // rather than resolved via `new URL(..., import.meta.url)` -- that
        // pattern hands the worker to webpack as a bundled asset, and this
        // app's production minifier (Terser) then chokes on the worker's
        // own `import.meta` usage with "cannot be used outside of module
        // code". A static path sidesteps the bundler/minifier entirely.
        pdfjsLib.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
        loadingTask = pdfjsLib.getDocument({ data });
        const doc = await loadingTask.promise;
        if (cancelled) {
          // Cleanup already ran (and missed this, per the same race --
          // `loadingTask` wasn't assigned yet when it fired), so it won't
          // run again for this instance. Destroy it ourselves instead of
          // leaving it orphaned.
          loadingTask.destroy();
          return;
        }
        setPdfDoc(doc);
      } catch {
        if (!cancelled) setError("Could not render this PDF.");
      }
    })();
    return () => {
      cancelled = true;
      loadingTask?.destroy();
    };
  }, [data]);

  if (error) return <p className="text-xs text-red-500 dark:text-red-400 text-center py-10">{error}</p>;
  if (!pdfDoc || pageAspectRatio == null) {
    return (
      <div className="flex items-center justify-center gap-2 py-16 text-gray-300 dark:text-gray-600">
        <Loader2 size={16} className="animate-spin" />
        <span className="text-xs">Rendering document…</span>
      </div>
    );
  }

  return (
    // The page itself (PdfPage's bg-white below) intentionally stays white in
    // both themes -- it represents the document's actual paper, the same way
    // Chrome/Adobe's own PDF viewers never darken the page. Only this
    // surrounding "desk" area darkens, for contrast against that fixed-white
    // paper.
    <div className="min-h-full bg-gray-100 dark:bg-gray-950 px-4 py-6 flex flex-col items-center gap-4">
      <style>{TEXT_LAYER_CSS}</style>
      {Array.from({ length: pdfDoc.numPages }, (_, i) => i + 1).map((pageNumber) => {
        const isTarget = pageNumber === targetPage;
        return (
          <div key={pageNumber} ref={isTarget ? targetPageElRef : undefined}>
            <PdfPage
              pdfDoc={pdfDoc}
              pageNumber={pageNumber}
              focusQuote={isTarget ? focusQuote : undefined}
              fallbackAspectRatio={pageAspectRatio}
              onMatchFound={(el) => {
                // The page-level jump above already got the right page on
                // screen; this fine-tunes to the exact matched line within
                // it once that page's own content and text search finish.
                el.scrollIntoView({ behavior: "smooth", block: "center" });
              }}
            />
          </div>
        );
      })}
    </div>
  );
}
