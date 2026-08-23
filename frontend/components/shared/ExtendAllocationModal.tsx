"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { api } from "@/lib/api";
import { Modal } from "@/components/shared/Modal";

type ExtensionStatus = "BILLABLE" | "UNBILLABLE" | "SHADOW";

// Preview only -- the real extended_start_date is always computed server-side
// (day after the allocation's current end date), this just mirrors that math
// so the modal can show the extension period before saving.
function dayAfter(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

export function ExtendAllocationModal({
  allocationId,
  employeeId,
  projectId,
  currentEndDate,
  currentExtendedEndDate,
  currentExtendedStatus,
  currentResourcingStatus,
  projectExtendedEndDate,
  onClose,
}: {
  allocationId: string;
  employeeId: string;
  projectId: string;
  currentEndDate: string;
  currentExtendedEndDate: string | null;
  currentExtendedStatus: ExtensionStatus | null;
  // Falls back to the allocation's own current status as a sensible default
  // for the extension period, when no extension status has been set yet.
  currentResourcingStatus: string;
  // The project must already have its own approved extension -- an allocation
  // can't run past a project that hasn't itself been formally extended. See
  // ExtendProjectModal / allocation_report_service.extend_allocation_end_date.
  projectExtendedEndDate: string | null;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [date, setDate] = useState(currentExtendedEndDate ?? "");
  const [status, setStatus] = useState<ExtensionStatus>(
    currentExtendedStatus ??
      (["BILLABLE", "UNBILLABLE", "SHADOW"].includes(currentResourcingStatus)
        ? (currentResourcingStatus as ExtensionStatus)
        : "BILLABLE")
  );
  const gated = !projectExtendedEndDate;

  // mutationKey lets any other component (e.g. the allocations table row this
  // modal was opened from) ask "is this specific allocation mid-update?" via
  // useIsMutating, without prop-drilling mutation state around. The mutationFn
  // itself awaits the cache invalidation/refetch, not just the POST, so
  // isPending stays true for the whole visible lag -- otherwise the modal
  // would close (or the table cell settle) while a refetch is still in
  // flight, and the row would appear to change "by itself" moments later.
  const mutationKey = ["extend-allocation", allocationId];

  const mutation = useMutation({
    mutationKey,
    mutationFn: async () => {
      const result = await api.extendAllocationEndDate(allocationId, date || null, date ? status : null);
      await queryClient.invalidateQueries({ queryKey: ["allocations"] });
      return result;
    },
    onSuccess: onClose,
  });
  const clearMutation = useMutation({
    mutationKey,
    mutationFn: async () => {
      const result = await api.extendAllocationEndDate(allocationId, null, null);
      await queryClient.invalidateQueries({ queryKey: ["allocations"] });
      return result;
    },
    onSuccess: onClose,
  });

  const isBusy = mutation.isPending || clearMutation.isPending;

  return (
    <Modal
      title={`Extend ${employeeId} on ${projectId}`}
      subtitle="Bounded by the project's own approved extension."
      onClose={onClose}
      widthClassName="max-w-sm"
    >
      <div className="p-5 space-y-3.5">
        {gated ? (
          <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5 dark:text-amber-400 dark:bg-amber-950/40 dark:border-amber-800/60">
            This project hasn&apos;t been extended yet. Extend the project&apos;s end date first — then individual
            allocations can be extended up to it.
          </p>
        ) : (
          <>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Currently allocated through <strong className="text-gray-700 dark:text-gray-300">{currentEndDate}</strong>. Can be extended
              up to the project&apos;s approved end date, <strong className="text-gray-700 dark:text-gray-300">{projectExtendedEndDate}</strong>.
            </p>
            <div>
              <label className="text-[11px] uppercase tracking-wide text-gray-400 dark:text-gray-500 block mb-1">New end date</label>
              <input
                type="date"
                min={currentEndDate}
                max={projectExtendedEndDate ?? undefined}
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
                <option value="SHADOW">Shadow</option>
              </select>
            </div>
            {date && (
              <p className="text-[11px] text-gray-400 dark:text-gray-500">
                Extension period: <strong className="text-gray-600 dark:text-gray-400">{dayAfter(currentEndDate)}</strong> → <strong className="text-gray-600 dark:text-gray-400">{date}</strong>
              </p>
            )}
          </>
        )}
        {(mutation.isError || clearMutation.isError) && (
          <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-2.5 py-1.5 dark:text-red-400 dark:bg-red-950/40 dark:border-red-800/60">
            {((mutation.error ?? clearMutation.error) as Error).message}
          </p>
        )}
        <div className="flex items-center justify-between gap-2 pt-1">
          {currentExtendedEndDate && !gated && (
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
            {!gated && (
              <button
                onClick={() => mutation.mutate()}
                disabled={!date || isBusy}
                className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-primary text-white disabled:opacity-50"
              >
                {mutation.isPending && <Loader2 className="w-3 h-3 animate-spin" />}
                {mutation.isPending ? "Saving…" : "Save"}
              </button>
            )}
          </div>
        </div>
      </div>
    </Modal>
  );
}
