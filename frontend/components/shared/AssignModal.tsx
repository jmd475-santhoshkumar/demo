"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Modal } from "@/components/shared/Modal";
import { SearchableSelect } from "@/components/shared/SearchableSelect";

export const RESOURCING_STATUSES = ["BILLABLE", "SHADOW", "UNBILLED"];
// Real shift categories: "General" (Indian shift hours) and "UK" (UK shift
// hours) -- just the two, not a made-up longer list.
export const SHIFT_TYPES = ["General", "UK"];

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

function addWeeks(dateStr: string, weeks: number): string {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + weeks * 7);
  return d.toISOString().slice(0, 10);
}

// Shared assign-to-project action used everywhere a candidate is shown
// against a real project (Relief Staffing, Leave Backfill, Replacement/
// Backfill tab, the Project Wizard's Resource Allocation step) -- writes a
// real allocation row via /allocations/assign.
export function AssignModal({
  employeeId,
  projectId,
  defaultAllocationPct = 100,
  defaultStartDate,
  defaultEndDate,
  onClose,
  onAssigned,
}: {
  employeeId: string;
  projectId: string;
  defaultAllocationPct?: number;
  // Caller-supplied real dates (leave start/end, project start/end, the
  // vacated allocation's own dates, etc.) -- falls back to today/+12w only
  // when the caller genuinely has nothing better to seed from. Always
  // editable regardless of where the default came from.
  defaultStartDate?: string | null;
  defaultEndDate?: string | null;
  onClose: () => void;
  onAssigned?: () => void;
}) {
  const qc = useQueryClient();
  const employees = useQuery({ queryKey: ["employees-list"], queryFn: api.employeesList });
  const [allocationPct, setAllocationPct] = useState(String(Math.round(defaultAllocationPct)));
  const [startDate, setStartDate] = useState(defaultStartDate || todayStr());
  const [endDate, setEndDate] = useState(defaultEndDate || addWeeks(defaultStartDate || todayStr(), 12));
  const [resourcingStatus, setResourcingStatus] = useState(["BILLABLE"]);
  const [shiftType, setShiftType] = useState(["General"]);
  const [reviewerEmployeeId, setReviewerEmployeeId] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const employeeOptions = (employees.data ?? [])
    .filter((e) => e.employee_id !== employeeId)
    .map((e) => ({ value: e.employee_id, label: `${e.employee_id} (${e.job_name})` }));

  async function submit() {
    setError(null);
    setSubmitting(true);
    try {
      await api.assignAllocation({
        employeeId, projectId,
        allocationPct: Number(allocationPct) || 0,
        startDate, endDate,
        resourcingStatus: resourcingStatus[0],
        shiftType: shiftType[0] ?? null,
        reviewerEmployeeId: reviewerEmployeeId[0] ?? null,
      });
      // This is the single choke point almost every assign flow in the app
      // goes through (Relief Staffing, Leave Backfill, Replacement tab, every
      // recommendation candidate list, Step 5's manual search) -- refresh
      // everything a fresh allocation can change the answer to here, rather
      // than leaving each caller to remember its own invalidation:
      // - this employee's current allocations (over-allocation checks, Free
      //   Pool, Employee Profile)
      // - this project's roster
      // - every open candidate/recommendation list's availability scoring
      //   (prefix match catches every rowIndex/topN/filter combination)
      qc.invalidateQueries({ queryKey: ["allocations"] });
      qc.invalidateQueries({ queryKey: ["roster", projectId] });
      qc.invalidateQueries({ queryKey: ["recommendation"] });
      onAssigned?.();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not assign this employee.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal title={`Assign ${employeeId} to ${projectId}`} onClose={onClose} widthClassName="max-w-sm">
      <div className="p-4 space-y-3 text-xs">
        {error && <p className="text-red-600 bg-red-50 border border-red-200 rounded-lg px-2 py-1.5 dark:text-red-400 dark:bg-red-950/40 dark:border-red-800/60">{error}</p>}
        <div>
          <label className="text-[11px] text-gray-400 dark:text-gray-500 block mb-0.5">Allocation %</label>
          <input
            type="number" min={1} max={100} value={allocationPct}
            onChange={(e) => setAllocationPct(e.target.value)}
            className="w-full px-2.5 py-1.5 rounded-lg border border-gray-200 outline-none dark:border-gray-700"
          />
        </div>
        <div className="flex items-center gap-2">
          <div className="flex-1">
            <label className="text-[11px] text-gray-400 dark:text-gray-500 block mb-0.5">Start date</label>
            <input
              type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)}
              className="w-full px-2.5 py-1.5 rounded-lg border border-gray-200 outline-none dark:border-gray-700"
            />
          </div>
          <div className="flex-1">
            <label className="text-[11px] text-gray-400 dark:text-gray-500 block mb-0.5">End date</label>
            <input
              type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)}
              className="w-full px-2.5 py-1.5 rounded-lg border border-gray-200 outline-none dark:border-gray-700"
            />
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex-1">
            <label className="text-[11px] text-gray-400 dark:text-gray-500 block mb-0.5">Status</label>
            <SearchableSelect options={RESOURCING_STATUSES.map((s) => ({ value: s, label: s }))} value={resourcingStatus} onChange={setResourcingStatus} />
          </div>
          <div className="flex-1">
            <label className="text-[11px] text-gray-400 dark:text-gray-500 block mb-0.5">Shift Type</label>
            <SearchableSelect options={SHIFT_TYPES.map((s) => ({ value: s, label: s }))} value={shiftType} onChange={setShiftType} />
          </div>
        </div>
        <div>
          <label className="text-[11px] text-gray-400 dark:text-gray-500 block mb-0.5">Reviewer</label>
          <SearchableSelect options={employeeOptions} value={reviewerEmployeeId} onChange={setReviewerEmployeeId} placeholder="Select Employee" />
        </div>
        <button
          onClick={submit}
          disabled={submitting}
          className="w-full px-4 py-2 rounded-lg text-xs font-medium text-white disabled:opacity-50"
          style={{ backgroundColor: "hsl(var(--primary))" }}
        >
          {submitting ? "Assigning…" : "Confirm assignment"}
        </button>
      </div>
    </Modal>
  );
}
