"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { api } from "@/lib/api";
import { Modal } from "@/components/shared/Modal";

type ExtensionStatus = "BILLABLE" | "UNBILLABLE";

export function ExtendProjectModal({
  projectCode,
  originalEndDate,
  currentExtendedEndDate,
  currentExtendedEndStatus,
  onClose,
}: {
  projectCode: string;
  originalEndDate: string | null;
  currentExtendedEndDate: string | null;
  currentExtendedEndStatus: ExtensionStatus | null;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [date, setDate] = useState(currentExtendedEndDate ?? "");
  const [status, setStatus] = useState<ExtensionStatus>(currentExtendedEndStatus ?? "BILLABLE");

  // See ExtendAllocationModal for why mutationFn awaits the invalidation
  // itself (isPending should cover the refetch too, not just the POST) and
  // why mutationKey is shared between save/clear (both represent "this
  // project is mid-update", checkable elsewhere via useIsMutating).
  const mutationKey = ["extend-project", projectCode];
  const invalidate = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ["allocations"] }),
      queryClient.invalidateQueries({ queryKey: ["health-projects"] }),
      queryClient.invalidateQueries({ queryKey: ["health-detail", projectCode] }),
      queryClient.invalidateQueries({ queryKey: ["project-extensions", projectCode] }),
    ]);

  const mutation = useMutation({
    mutationKey,
    mutationFn: async () => {
      const result = await api.extendProjectEndDate(projectCode, date || null, date ? status : null);
      await invalidate();
      return result;
    },
    onSuccess: onClose,
  });
  const clearMutation = useMutation({
    mutationKey,
    mutationFn: async () => {
      const result = await api.extendProjectEndDate(projectCode, null, null);
      await invalidate();
      return result;
    },
    onSuccess: onClose,
  });

  const isBusy = mutation.isPending || clearMutation.isPending;

  return (
    <Modal title={`Extend ${projectCode}`} subtitle="Employees on this project can then be extended up to this date." onClose={onClose} widthClassName="max-w-sm">
      <div className="p-5 space-y-3.5">
        <p className="text-xs text-gray-500 dark:text-gray-400">
          Originally scheduled to end <strong className="text-gray-700 dark:text-gray-300">{originalEndDate ?? "?"}</strong>.
        </p>
        <div>
          <label className="text-[11px] uppercase tracking-wide text-gray-400 dark:text-gray-500 block mb-1">New end date</label>
          <input
            type="date"
            min={originalEndDate ?? undefined}
            value={date}
            disabled={isBusy}
            onChange={(e) => setDate(e.target.value)}
            className="w-full text-xs px-2.5 py-1.5 rounded-lg border border-gray-200 disabled:opacity-50 dark:border-gray-700"
          />
        </div>
        <div>
          <label className="text-[11px] uppercase tracking-wide text-gray-400 dark:text-gray-500 block mb-1">Status for the extension period</label>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as ExtensionStatus)}
            disabled={!date || isBusy}
            className="w-full text-xs px-2.5 py-1.5 rounded-lg border border-gray-200 disabled:opacity-50 dark:border-gray-700"
          >
            <option value="BILLABLE">Billable</option>
            <option value="UNBILLABLE">Unbillable</option>
          </select>
        </div>
        {(mutation.isError || clearMutation.isError) && (
          <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-2.5 py-1.5 dark:text-red-400 dark:bg-red-950/40 dark:border-red-800/60">
            {((mutation.error ?? clearMutation.error) as Error).message}
          </p>
        )}
        <div className="flex items-center justify-between gap-2 pt-1">
          {currentExtendedEndDate && (
            <button
              onClick={() => clearMutation.mutate()}
              disabled={isBusy}
              className="flex items-center gap-1 text-xs text-red-600 hover:underline disabled:opacity-50 dark:text-red-400"
            >
              {clearMutation.isPending && <Loader2 className="w-3 h-3 animate-spin" />}
              Clear extension
            </button>
          )}
          <div className="flex items-center gap-2 ml-auto">
            <button onClick={onClose} disabled={isBusy} className="text-xs px-3 py-1.5 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:text-gray-400 dark:hover:bg-gray-800">
              Cancel
            </button>
            <button
              onClick={() => mutation.mutate()}
              disabled={!date || isBusy}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-primary text-white disabled:opacity-50"
            >
              {mutation.isPending && <Loader2 className="w-3 h-3 animate-spin" />}
              {mutation.isPending ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
