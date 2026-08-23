"use client";

import { useQuery } from "@tanstack/react-query";
import { api, type AllocationRow } from "@/lib/api";
import { Modal } from "@/components/shared/Modal";
import { Badge } from "@/components/shared/Badge";
import { AssignModal } from "@/components/shared/AssignModal";
import { JMAN } from "@/lib/brandColors";
import { useState } from "react";

function WarningTable({ employeeId, rows }: { employeeId: string; rows: AllocationRow[] }) {
  return (
    <div className="rounded-xl border border-red-200 dark:border-red-800/60 overflow-hidden">
      <div className="px-3 py-2 text-white text-xs font-semibold" style={{ backgroundColor: JMAN.midnightBlue }}>
        {employeeId}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-[11px]">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-200 dark:bg-gray-800/60 dark:border-gray-700">
              {["Project", "Allocation %", "Start Date", "End Date", "Status"].map((h) => (
                <th key={h} className="text-left font-semibold text-gray-500 dark:text-gray-400 px-2.5 py-1.5 whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-b border-gray-50 last:border-0 dark:border-gray-800">
                <td className="px-2.5 py-1.5 font-medium text-gray-700 dark:text-gray-300 whitespace-nowrap">{r.project_id}</td>
                <td className="px-2.5 py-1.5 text-gray-700 dark:text-gray-300 whitespace-nowrap">{r.allocation_by_percentage}%</td>
                <td className="px-2.5 py-1.5 text-gray-500 dark:text-gray-400 whitespace-nowrap">{r.allocated_start_date}</td>
                <td className="px-2.5 py-1.5 text-gray-500 dark:text-gray-400 whitespace-nowrap">{r.allocated_end_date}</td>
                <td className="px-2.5 py-1.5 whitespace-nowrap"><Badge variant={r.resourcing_status}>{r.resourcing_status}</Badge></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function OverAllocationWarningModal({
  employeeId, rows, onCancel, onOverride,
}: {
  employeeId: string; rows: AllocationRow[]; onCancel: () => void; onOverride: () => void;
}) {
  return (
    <Modal title="Exceeding Resource Allocations" subtitle="View existing allocations of this resource to better plan the next allocation" onClose={onCancel} widthClassName="max-w-2xl">
      <div className="p-4 space-y-3">
        <WarningTable employeeId={employeeId} rows={rows} />
        <div className="flex justify-end gap-2">
          <button onClick={onCancel} className="text-xs px-4 py-2 rounded-lg bg-white border border-gray-200 text-gray-600 font-medium dark:bg-gray-900 dark:border-gray-700 dark:text-gray-400">Cancel</button>
          <button onClick={onOverride} className="text-xs px-4 py-2 rounded-lg bg-red-600 text-white font-medium">Override</button>
        </div>
      </div>
    </Modal>
  );
}

// Drop-in replacement for <AssignModal> that checks the candidate's real
// current allocations first (GET /allocations/current) and, if any are
// already over-allocated (utilization_band === "over_allocated", the same
// flag Health/Free Pool already use -- not re-derived here), shows JIN's
// Cancel/Override warning before letting the assignment proceed.
export function AssignWithOverAllocationCheck(props: {
  employeeId: string; projectId: string; defaultAllocationPct?: number;
  defaultStartDate?: string | null; defaultEndDate?: string | null;
  onClose: () => void; onAssigned?: () => void;
}) {
  const allocations = useQuery({ queryKey: ["allocations"], queryFn: api.allocations });
  const [overridden, setOverridden] = useState(false);

  if (allocations.isLoading) return null;

  const empRows = (allocations.data ?? []).filter((a) => a.employee_id === props.employeeId);
  const overAllocated = empRows.some((r) => r.utilization_band === "over_allocated");

  if (overAllocated && !overridden) {
    return (
      <OverAllocationWarningModal
        employeeId={props.employeeId}
        rows={empRows}
        onCancel={props.onClose}
        onOverride={() => setOverridden(true)}
      />
    );
  }

  return <AssignModal {...props} />;
}
