"use client";

import { useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Send, Loader2, FileText, Quote } from "lucide-react";
import { api, type SowChatCitation, type SowChatHistoryMessage } from "@/lib/api";
import { Modal } from "@/components/shared/Modal";
import { SowDocumentViewer } from "@/components/wizard/SowDocumentViewer";
import { cn } from "@/lib/utils";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  citations?: SowChatCitation[];
}

const EXAMPLE_QUESTIONS = ["What's the total fee for this engagement?", "What roles are staffed on this?", "What's explicitly out of scope?"];

export function SowChatModal({ projectCode, filename, onClose }: { projectCode: string; filename: string; onClose: () => void }) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [openCitation, setOpenCitation] = useState<SowChatCitation | null>(null);
  const listEndRef = useRef<HTMLDivElement>(null);

  const ask = useMutation({
    mutationFn: (message: string) => {
      const history: SowChatHistoryMessage[] = messages.map((m) => ({ role: m.role, content: m.content }));
      return api.askSowQuestion(projectCode, filename, message, history);
    },
    onSuccess: (res) => {
      setMessages((prev) => [...prev, { role: "assistant", content: res.answer, citations: res.citations }]);
      requestAnimationFrame(() => listEndRef.current?.scrollIntoView({ behavior: "smooth" }));
    },
    onError: (e: Error) => setError(e.message),
  });

  function send(question?: string) {
    const text = (question ?? draft).trim();
    if (!text || ask.isPending) return;
    setError(null);
    setMessages((prev) => [...prev, { role: "user", content: text }]);
    setDraft("");
    requestAnimationFrame(() => listEndRef.current?.scrollIntoView({ behavior: "smooth" }));
    ask.mutate(text);
  }

  return (
    <Modal
      title={
        <span className="inline-flex items-center gap-1.5">
          <FileText size={13} className="text-gray-400 dark:text-gray-500" />
          {filename}
        </span>
      }
      subtitle="Ask anything about this document — answers are scoped to it only"
      onClose={onClose}
      widthClassName="max-w-xl"
    >
      <div className="flex flex-col h-[65vh]">
        <div className="flex-1 overflow-y-auto scrollbar-thin px-4 py-4 space-y-3">
          {messages.length === 0 && (
            <div className="h-full flex flex-col items-center justify-center gap-3 text-center px-6">
              <p className="text-xs text-gray-400 dark:text-gray-500">Ask a question about this SOW to get started.</p>
              <div className="flex flex-wrap justify-center gap-1.5">
                {EXAMPLE_QUESTIONS.map((q) => (
                  <button
                    key={q}
                    onClick={() => send(q)}
                    className="text-[11px] px-2.5 py-1 rounded-full border border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:border-[hsl(var(--primary)/0.4)] hover:text-[hsl(var(--primary))] transition"
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((m, i) => (
            <div key={i} className={cn("flex", m.role === "user" ? "justify-end" : "justify-start")}>
              <div className="max-w-[85%] space-y-1.5">
                <div
                  className={cn(
                    "px-3.5 py-2 rounded-2xl text-[13px] leading-relaxed whitespace-pre-wrap",
                    m.role === "user"
                      ? "text-white rounded-br-md bg-[hsl(var(--primary))]"
                      : "bg-gray-50 dark:bg-gray-800/60 text-gray-800 dark:text-gray-200 rounded-bl-md border border-gray-100 dark:border-gray-800"
                  )}
                >
                  {m.content}
                </div>
                {m.citations && m.citations.length > 0 && <CitationList citations={m.citations} onOpen={setOpenCitation} />}
              </div>
            </div>
          ))}

          {ask.isPending && (
            <div className="flex justify-start">
              <div className="px-3.5 py-2 rounded-2xl rounded-bl-md bg-gray-50 dark:bg-gray-800/60 border border-gray-100 dark:border-gray-800 flex items-center gap-2 text-xs text-gray-400 dark:text-gray-500">
                <Loader2 size={12} className="animate-spin" /> reading the document…
              </div>
            </div>
          )}

          {error && <p className="text-xs text-red-500 dark:text-red-400 text-center">{error}</p>}
          <div ref={listEndRef} />
        </div>

        <div className="border-t border-gray-100 dark:border-gray-800 px-3 py-3">
          <div className="flex items-center gap-2 rounded-full border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-1.5 focus-within:border-gray-300 dark:focus-within:border-gray-600 transition">
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && send()}
              placeholder="Ask about this SOW…"
              className="flex-1 text-[13px] outline-none bg-transparent text-gray-900 dark:text-gray-100 placeholder:text-gray-300 dark:placeholder:text-gray-600"
            />
            <button
              onClick={() => send()}
              disabled={!draft.trim() || ask.isPending}
              className="w-7 h-7 rounded-full flex items-center justify-center text-white shrink-0 disabled:opacity-30 transition"
              style={{ backgroundColor: "hsl(var(--primary))" }}
            >
              <Send size={13} />
            </button>
          </div>
        </div>
      </div>

      {openCitation && (
        <SowDocumentViewer
          projectCode={projectCode}
          filename={filename}
          focusQuote={openCitation.quote}
          focusLocation={openCitation.location}
          onClose={() => setOpenCitation(null)}
        />
      )}
    </Modal>
  );
}

const SNIPPET_MAX_CHARS = 72;

// "Part 3 of 15" is only meaningful to the code that generated it -- Word
// documents have no real page numbers, so that label is just an internal
// chunk index used to keep citations grounded, not something an RM or
// governance reviewer could use to find anything. A real PDF page number
// (e.g. "Page 2") IS genuinely useful, so that one still gets shown; for
// everything else, showing the actual quoted text lets the reader see at a
// glance what's being cited, before they even click into the document.
function isRealPageLabel(location: string): boolean {
  return /^page\s+\d+$/i.test(location.trim());
}

function CitationList({ citations, onOpen }: { citations: SowChatCitation[]; onOpen: (c: SowChatCitation) => void }) {
  return (
    <div className="flex flex-col gap-1">
      {citations.map((c, i) => {
        const snippet = c.quote.length > SNIPPET_MAX_CHARS ? `${c.quote.slice(0, SNIPPET_MAX_CHARS).trim()}…` : c.quote;
        return (
          <button
            key={i}
            onClick={() => onOpen(c)}
            title={c.quote}
            className="flex items-start gap-1.5 text-left text-[11px] px-2.5 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:border-[hsl(var(--primary)/0.4)] hover:bg-[hsl(var(--primary)/0.04)] hover:text-[hsl(var(--primary))] transition"
          >
            <Quote size={11} className="shrink-0 mt-0.5 text-gray-300 dark:text-gray-600" />
            <span className="italic leading-snug">
              &ldquo;{snippet}&rdquo;
              {isRealPageLabel(c.location) && <span className="not-italic text-gray-400 dark:text-gray-500"> — {c.location}</span>}
            </span>
          </button>
        );
      })}
    </div>
  );
}
