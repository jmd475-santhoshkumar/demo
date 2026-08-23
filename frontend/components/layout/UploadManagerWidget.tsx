"use client";

import { useSyncExternalStore } from "react";
import { AlertCircle, CheckCircle2, Loader2, UploadCloud } from "lucide-react";
import { getUploadTasks, subscribeToUploads, type UploadTask } from "@/lib/uploadManager";

// Rendered once in app/layout.tsx, above the page content -- lib/uploadManager.ts
// is a module-level singleton, not tied to any page component, so this widget
// (and the upload it's tracking) survives client-side navigation to any other
// page. Deliberately fixed-position and small: this is a status indicator for
// something running in the background, not a modal blocking the rest of the app.

function formatEta(seconds: number | null): string | null {
  if (seconds == null) return null;
  if (seconds < 5) return "a few seconds left";
  if (seconds < 60) return `~${Math.round(seconds)}s left`;
  return `~${Math.round(seconds / 60)}m left`;
}

function TaskRow({ task }: { task: UploadTask }) {
  const pct = task.phase === "uploading" ? task.transferPct : task.processingPct;
  const eta = task.phase === "processing" ? formatEta(task.remainingSeconds) : null;

  return (
    <div className="px-3 py-2.5 border-b border-gray-100 dark:border-gray-800 last:border-b-0">
      <div className="flex items-center gap-2 mb-1">
        {task.phase === "done" ? (
          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 flex-shrink-0" />
        ) : task.phase === "error" ? (
          <AlertCircle className="w-3.5 h-3.5 text-rose-500 flex-shrink-0" />
        ) : (
          <Loader2 className="w-3.5 h-3.5 text-jman-midnight dark:text-jman-lightblue animate-spin flex-shrink-0" />
        )}
        <span className="text-xs font-medium text-gray-800 dark:text-gray-100 truncate flex-1" title={task.label}>
          {task.label}
        </span>
      </div>
      <div className="h-1.5 rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-300 ${
            task.phase === "error" ? "bg-rose-500" : task.phase === "done" ? "bg-emerald-500" : "bg-jman-midnight dark:bg-jman-lightblue"
          }`}
          style={{ width: `${pct == null ? 100 : Math.max(pct, 3)}%`, opacity: pct == null && task.phase !== "done" && task.phase !== "error" ? 0.5 : 1 }}
        />
      </div>
      <div className="mt-1 flex items-center justify-between text-[11px] text-gray-500 dark:text-gray-400">
        <span className="truncate">
          {task.phase === "error" ? task.error : task.message}
          {task.phase === "uploading" && task.transferPct == null ? " (progress unavailable for this file)" : ""}
        </span>
        <span className="flex-shrink-0 ml-2 tabular-nums">
          {task.phase === "uploading" && task.transferPct != null ? `${task.transferPct}%` : eta || (pct != null && task.phase !== "done" ? `${pct}%` : "")}
        </span>
      </div>
    </div>
  );
}

export function UploadManagerWidget() {
  const tasks = useSyncExternalStore(subscribeToUploads, getUploadTasks, getUploadTasks);
  if (tasks.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 w-72 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-lg overflow-hidden">
      <div className="px-3 py-2 border-b border-gray-100 dark:border-gray-800 flex items-center gap-2 bg-gray-50 dark:bg-gray-800/60">
        <UploadCloud className="w-3.5 h-3.5 text-gray-500 dark:text-gray-400" />
        <span className="text-xs font-semibold text-gray-700 dark:text-gray-200">
          {tasks.length === 1 ? "Upload" : `${tasks.length} uploads`} in progress
        </span>
        <span className="ml-auto text-[10px] text-gray-400 dark:text-gray-500">keeps running — feel free to navigate</span>
      </div>
      <div className="max-h-72 overflow-y-auto scrollbar-thin">
        {tasks.map((t) => (
          <TaskRow key={t.id} task={t} />
        ))}
      </div>
    </div>
  );
}
