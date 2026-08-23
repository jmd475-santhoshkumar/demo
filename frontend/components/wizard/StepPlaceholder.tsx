"use client";

import { FileQuestion } from "lucide-react";

// Used only for wizard sub-steps with no screenshot/spec to build against
// (currently just Step 3's "Discount / Premium" tab) -- no fabricated data,
// just an honest placeholder plus a way to move on.
export function StepPlaceholder({ title, onNext, nextLabel = "Next" }: { title: string; onNext?: () => void; nextLabel?: string }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-10 text-center space-y-3 dark:border-gray-700 dark:bg-gray-900">
      <FileQuestion className="mx-auto text-gray-300 dark:text-gray-600" size={28} />
      <p className="text-sm font-semibold text-gray-700 dark:text-gray-300">{title}</p>
      <p className="text-xs text-gray-400 dark:text-gray-500">This step isn&apos;t tracked in ResourceIQ yet.</p>
      {onNext && (
        <button
          onClick={onNext}
          className="text-xs px-4 py-2 rounded-lg text-white font-medium"
          style={{ backgroundColor: "hsl(var(--primary))" }}
        >
          {nextLabel}
        </button>
      )}
    </div>
  );
}
