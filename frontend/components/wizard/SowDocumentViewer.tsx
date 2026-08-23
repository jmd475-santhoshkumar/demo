"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, X } from "lucide-react";
import { api } from "@/lib/api";
import { PdfCanvasViewer } from "@/components/wizard/PdfCanvasViewer";

// Strips the " | " cell separator the backend uses when flattening a table
// row into one line of text for the AI (see sow_chat_service.py's
// _docx_table_text) -- the rendered DOM has no such separator between
// sibling cells, so without stripping it a citation that spans two cells
// (e.g. "Engagement Total: | £118,720") would never match anything.
function normalize(text: string): string {
  return text.replace(/\|/g, " ").replace(/\s+/g, " ").trim().toLowerCase();
}

// The smallest text-bearing units in the rendered document, in reading
// order. A <td>/<th> only counts as its own leaf when it has no nested
// p/li/table -- some real SOWs (this reference one included) put their
// entire body in a single one-cell table, so treating that whole cell as
// one leaf would make every citation "match" the same giant block.
function getLeafBlocks(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>("p, li, td, th")).filter((el) => {
    if (el.tagName === "TD" || el.tagName === "TH") return !el.querySelector("p, li, table");
    return true;
  });
}

// Finds the run of leaf blocks the cited quote actually came from.
//
// Tries a single leaf first (the common case -- the quote sits inside one
// paragraph or cell, maybe only part of it). If nothing matches alone, the
// backend can quote several WHOLE paragraphs joined together (python-docx
// joins a table cell's own paragraphs with "\n" -- see sow_chat_service.py),
// e.g. "Attendees:" / "Veriforce: ..." / "JMAN: ..." as three separate
// paragraphs quoted as one citation. No single DOM element wraps just those
// three, so a multi-leaf window is grown instead.
//
// That window only grows while what's joined so far is a genuine PREFIX of
// the target, not merely "the target shows up somewhere in this window
// eventually" -- this SOW literally repeats the paragraph "Attendees:" in
// two different sections (ExCo and SteerCo), so a plain substring search
// across a growing window would happily start from the WRONG section the
// moment the window grew large enough to reach the real text further down
// the document, and scrollIntoView would land on whatever happened to be
// near the middle of that oversized, wrongly-anchored span.
function findMatchingSpan(root: HTMLElement, quote: string): HTMLElement[] | null {
  const target = normalize(quote);
  if (!target) return null;
  const leaves = getLeafBlocks(root);
  const texts = leaves.map((el) => normalize(el.innerText || el.textContent || ""));

  for (let i = 0; i < leaves.length; i++) {
    if (texts[i] && texts[i].includes(target)) return [leaves[i]];
  }

  const MAX_WINDOW = 12;
  for (let i = 0; i < leaves.length; i++) {
    if (!texts[i] || !target.startsWith(texts[i])) continue;
    let joined = texts[i];
    for (let j = i + 1; j < Math.min(leaves.length, i + MAX_WINDOW); j++) {
      const next = `${joined} ${texts[j]}`;
      if (!target.startsWith(next)) break;
      joined = next;
      if (joined === target) return leaves.slice(i, j + 1);
    }
  }
  return null;
}

function DocxView({ projectCode, filename, focusQuote }: { projectCode: string; filename: string; focusQuote?: string }) {
  const [html, setHtml] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const mammoth = await import("mammoth");
        const res = await fetch(api.projectSowViewUrl(projectCode, filename));
        if (!res.ok) throw new Error(`Could not load document (${res.status})`);
        const arrayBuffer = await res.arrayBuffer();
        const result = await mammoth.convertToHtml({ arrayBuffer });
        if (!cancelled) setHtml(result.value);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Could not render this document.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectCode, filename]);

  useEffect(() => {
    if (!html || !focusQuote || !containerRef.current) return;
    const span = findMatchingSpan(containerRef.current, focusQuote);
    if (span && span.length > 0) {
      span[0].scrollIntoView({ behavior: "smooth", block: "center" });
      span.forEach((el) => el.classList.add("sow-highlight"));
      const t = setTimeout(() => span.forEach((el) => el.classList.remove("sow-highlight")), 2800);
      return () => clearTimeout(t);
    }
  }, [html, focusQuote]);

  if (error) return <p className="text-xs text-red-500 dark:text-red-400 text-center py-10">{error}</p>;
  if (!html) {
    return (
      <div className="flex items-center justify-center gap-2 py-16 text-gray-300 dark:text-gray-600">
        <Loader2 size={16} className="animate-spin" />
        <span className="text-xs">Rendering document…</span>
      </div>
    );
  }

  return (
    <>
      {/* .sow-doc-body renders the actual document paper -- kept white in
          both themes, same as PdfCanvasViewer's page canvas, since it's
          standing in for real page content rather than app chrome. */}
      <style>{`
        .sow-doc-body { font-size: 13px; line-height: 1.65; color: #374151; }
        .sow-doc-body p { margin: 0 0 10px; }
        .sow-doc-body table { border-collapse: collapse; margin: 10px 0; width: 100%; }
        .sow-doc-body td, .sow-doc-body th { border: 1px solid #e5e7eb; padding: 6px 8px; font-size: 12.5px; vertical-align: top; }
        .sow-highlight { background: hsl(var(--primary) / 0.14); outline: 2px solid hsl(var(--primary) / 0.4); border-radius: 4px; transition: background 2.5s ease, outline-color 2.5s ease; }
      `}</style>
      <div className="min-h-full bg-gray-100 dark:bg-gray-950 px-4 py-6 sm:px-8">
        <div
          ref={containerRef}
          className="sow-doc-body max-w-[760px] mx-auto bg-white border border-gray-200 rounded-sm shadow-[0_1px_3px_rgba(0,0,0,0.08)] px-10 py-12 sm:px-14"
          dangerouslySetInnerHTML={{ __html: html }}
        />
      </div>
    </>
  );
}

type PreviewState = { mode: "checking" } | { mode: "pdf"; data: Uint8Array } | { mode: "html" };

// Real pixel-perfect preview is the goal for every SOW, regardless of
// format -- a native PDF already has one; a .docx gets rendered to a real
// PDF by an actual LibreOffice engine (docx_conversion_service.py) so it
// shows the real fonts/colors/images/pagination, not a text approximation.
// That conversion needs LibreOffice installed on the backend machine, which
// isn't guaranteed everywhere (e.g. a fresh environment that never ran
// setup) -- so this fetches the preview first and only commits to the pdf.js
// canvas renderer once it's confirmed to succeed, falling back to the HTML/
// mammoth preview (still real content, just not pixel-perfect) rather than
// showing a dead end if it doesn't. One fetch covers both native PDFs and
// converted docx files -- the backend returns the same shape either way.
function usePdfPreview(projectCode: string, filename: string): PreviewState {
  const [state, setState] = useState<PreviewState>({ mode: "checking" });

  useEffect(() => {
    let cancelled = false;
    setState({ mode: "checking" });

    fetch(api.projectSowPreviewPdfUrl(projectCode, filename))
      .then(async (res) => {
        if (!res.ok) {
          if (!cancelled) setState({ mode: "html" });
          return;
        }
        const buf = await res.arrayBuffer();
        if (!cancelled) setState({ mode: "pdf", data: new Uint8Array(buf) });
      })
      .catch(() => {
        if (!cancelled) setState({ mode: "html" });
      });

    return () => {
      cancelled = true;
    };
  }, [projectCode, filename]);

  return state;
}

export function SowDocumentViewer({
  projectCode, filename, focusQuote, focusLocation, onClose,
}: {
  projectCode: string;
  filename: string;
  focusQuote?: string;
  focusLocation?: string;
  onClose: () => void;
}) {
  const preview = usePdfPreview(projectCode, filename);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/50 dark:bg-black/70" onClick={onClose} />
      <div className="relative w-full max-w-4xl h-[85vh] bg-white dark:bg-gray-900 rounded-2xl shadow-xl flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 dark:border-gray-800 shrink-0">
          <div className="min-w-0">
            <p className="text-xs font-semibold text-gray-800 dark:text-gray-200 truncate">{filename}</p>
            {focusLocation && <p className="text-[10px] text-gray-400 dark:text-gray-500">Jumped to {focusLocation}</p>}
          </div>
          <button onClick={onClose} className="text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 transition shrink-0 ml-3" aria-label="Close">
            <X size={16} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto scrollbar-thin bg-gray-50/40 dark:bg-gray-900/40">
          {preview.mode === "checking" ? (
            <div className="flex items-center justify-center gap-2 py-16 text-gray-300 dark:text-gray-600">
              <Loader2 size={16} className="animate-spin" />
              <span className="text-xs">Preparing pixel-perfect preview…</span>
            </div>
          ) : preview.mode === "pdf" ? (
            <PdfCanvasViewer data={preview.data} focusLocation={focusLocation} focusQuote={focusQuote} />
          ) : (
            <DocxView projectCode={projectCode} filename={filename} focusQuote={focusQuote} />
          )}
        </div>
      </div>
    </div>
  );
}
