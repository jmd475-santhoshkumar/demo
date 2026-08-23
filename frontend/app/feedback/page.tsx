"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MessageSquare, CheckCircle2, AlertCircle } from "lucide-react";
import { api } from "@/lib/api";
import { ErrorState } from "@/components/shared/EmptyState";
import { Skeleton } from "@/components/shared/Skeleton";
import { Badge } from "@/components/shared/Badge";
import { cn } from "@/lib/utils";

const CATEGORIES = ["General", "Bug", "Feature request"] as const;

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
}

const CATEGORY_BADGE: Record<string, string> = { Bug: "red", "Feature request": "purple", General: "default" };

export default function FeedbackPage() {
  const queryClient = useQueryClient();
  const feedback = useQuery({ queryKey: ["feedback-list"], queryFn: api.listFeedback });

  const [name, setName] = useState("");
  const [category, setCategory] = useState<(typeof CATEGORIES)[number]>("General");
  const [message, setMessage] = useState("");

  const submit = useMutation({
    mutationFn: () => api.submitFeedback(name, category, message),
    onSuccess: (entry) => {
      queryClient.setQueryData(["feedback-list"], (prev: typeof feedback.data) => [entry, ...(prev ?? [])]);
      setMessage("");
    },
  });

  return (
    <div className="p-4 sm:p-6 max-w-2xl mx-auto space-y-6">
      <div>
        <h2 className="text-base font-semibold text-gray-800 dark:text-gray-200">Feedback</h2>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">Tell us what's working, what's broken, or what you'd like to see next.</p>
      </div>

      <div className="rounded-xl border border-gray-200 bg-white p-4 space-y-3 dark:border-gray-700 dark:bg-gray-900">
        <div className="grid sm:grid-cols-2 gap-3">
          <div>
            <label className="text-[11px] text-gray-400 dark:text-gray-500 block mb-1">Your name (optional)</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Anonymous"
              className="w-full px-2.5 py-1.5 rounded-lg border border-gray-200 text-xs outline-none focus:border-primary/50 dark:border-gray-700"
            />
          </div>
          <div>
            <label className="text-[11px] text-gray-400 dark:text-gray-500 block mb-1">Category</label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value as (typeof CATEGORIES)[number])}
              className="w-full px-2.5 py-1.5 rounded-lg border border-gray-200 text-xs outline-none focus:border-primary/50 bg-white dark:border-gray-700 dark:bg-gray-900"
            >
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label className="text-[11px] text-gray-400 dark:text-gray-500 block mb-1">Message</label>
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={4}
            placeholder="What did you run into, or what would make this more useful?"
            className="w-full px-2.5 py-2 rounded-lg border border-gray-200 text-xs outline-none focus:border-primary/50 resize-none dark:border-gray-700"
          />
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => submit.mutate()}
            disabled={submit.isPending || !message.trim()}
            className="px-3 py-1.5 rounded-lg text-xs font-medium text-white disabled:opacity-40"
            style={{ backgroundColor: "hsl(var(--primary))" }}
          >
            {submit.isPending ? "Sending…" : "Send feedback"}
          </button>
          {submit.isSuccess && (
            <span className="flex items-center gap-1 text-[11px] text-emerald-600 dark:text-emerald-400">
              <CheckCircle2 className="w-3.5 h-3.5" /> Sent, thank you.
            </span>
          )}
          {submit.isError && (
            <span className="flex items-center gap-1 text-[11px] text-red-600 dark:text-red-400">
              <AlertCircle className="w-3.5 h-3.5" /> Couldn't send that -- try again.
            </span>
          )}
        </div>
      </div>

      <div className="space-y-2.5">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500">Previously submitted</p>
        {feedback.isLoading && <Skeleton className="h-20 w-full rounded-xl" />}
        {feedback.error && <ErrorState message="Could not load feedback." />}
        {feedback.data?.length === 0 && (
          <div className="rounded-xl border border-gray-200 bg-white p-4 text-center text-xs text-gray-400 italic flex items-center justify-center gap-1.5 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-500">
            <MessageSquare className="w-4 h-4" /> No feedback submitted yet -- be the first.
          </div>
        )}
        {feedback.data?.map((f, i) => (
          <div key={i} className="rounded-xl border border-gray-200 bg-white p-3.5 dark:border-gray-700 dark:bg-gray-900">
            <div className="flex items-center justify-between gap-2 mb-1">
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-gray-700 dark:text-gray-300">{f.name}</span>
                <Badge variant={CATEGORY_BADGE[f.category] ?? "default"}>{f.category}</Badge>
              </div>
              <span className="text-[10px] text-gray-400 dark:text-gray-500">{formatDate(f.submitted_at)}</span>
            </div>
            <p className={cn("text-xs text-gray-600 dark:text-gray-400 whitespace-pre-wrap")}>{f.message}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
