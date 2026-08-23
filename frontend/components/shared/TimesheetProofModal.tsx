"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Modal } from "@/components/shared/Modal";
import { Badge } from "@/components/shared/Badge";
import { ErrorState } from "@/components/shared/EmptyState";
import { Skeleton, TableSkeleton } from "@/components/shared/Skeleton";

interface TimesheetProofModalProps {
  employeeId: string;
  projectId: string;
  onClose: () => void;
}

type Sort = "date_desc" | "date_asc" | "hours_desc";

function hoursUtilizationBand(pct: number): "over_allocated" | "normal" | "under_utilized" {
  if (pct > 100) return "over_allocated";
  if (pct < 70) return "under_utilized";
  return "normal";
}

export function TimesheetProofModal({ employeeId, projectId, onClose }: TimesheetProofModalProps) {
  const [sort, setSort] = useState<Sort>("date_desc");
  const ts = useQuery({
    queryKey: ["allocation-timesheet", employeeId, projectId],
    queryFn: () => api.allocationTimesheet(employeeId, projectId),
  });

  const rows = ts.data ? [...ts.data.daily_hours] : [];
  switch (sort) {
    case "date_desc": rows.sort((a, b) => b.date.localeCompare(a.date)); break;
    case "date_asc": rows.sort((a, b) => a.date.localeCompare(b.date)); break;
    case "hours_desc": rows.sort((a, b) => (b.hours ?? -1) - (a.hours ?? -1)); break;
  }
  const realLoggedRows = ts.data?.daily_hours.filter((r) => !r.is_missing) ?? [];
  const missingDayCount = (ts.data?.daily_hours.length ?? 0) - realLoggedRows.length;

  const lastLoggedDate = realLoggedRows.length ? [...realLoggedRows].sort((a, b) => b.date.localeCompare(a.date))[0].date : null;
  const daysSinceLastLogged = lastLoggedDate ? Math.round((Date.now() - new Date(lastLoggedDate).getTime()) / 86400000) : null;

  return (
    <Modal title={`${employeeId} on ${projectId}`} onClose={onClose} widthClassName="max-w-lg">
      <div className="p-5 space-y-3">
        {ts.isLoading ? (
          <div className="space-y-3">
            <Skeleton className="h-5 w-32 rounded-full" />
            <Skeleton className="h-3 w-64" />
            <div className="flex items-center justify-between">
              <Skeleton className="h-3 w-40" />
              <Skeleton className="h-6 w-32 rounded-lg" />
            </div>
            <TableSkeleton columns={4} rows={6} />
          </div>
        ) : ts.error || !ts.data ? (
          <ErrorState message="Could not load this allocation's timesheet." />
        ) : (
          <>
            <div className="flex items-center gap-2 flex-wrap">
              {ts.data.hours_data_available && ts.data.hours_utilization_pct !== null ? (
                <Badge variant={hoursUtilizationBand(ts.data.hours_utilization_pct)}>{ts.data.hours_utilization_pct}% hours util.</Badge>
              ) : (
                <span className="text-xs text-gray-300 dark:text-gray-600">no hours data yet</span>
              )}
              {ts.data.possible_unplanned_absence && <Badge variant="unbilled">quiet 14d+</Badge>}
            </div>
            {ts.data.possible_unplanned_absence && (
              <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5 dark:text-amber-400 dark:bg-amber-950/40 dark:border-amber-800/60">
                Proof: last real hours logged on <strong>{lastLoggedDate}</strong>
                {daysSinceLastLogged != null && ` (${daysSinceLastLogged} days ago)`} — zero hours logged against this project since,
                despite real activity before that.
              </p>
            )}
            <p className="text-[11px] text-gray-400 dark:text-gray-500">
              {ts.data.actual_hours_logged}h logged of {ts.data.expected_hours}h expected, {ts.data.allocated_start_date} →{" "}
              {ts.data.hours_window_end} at {ts.data.allocation_by_percentage}%
              {ts.data.hours_window_end !== ts.data.allocated_end_date && " (allocation runs through " + ts.data.allocated_end_date + ")"}.
            </p>
            <div className="flex items-center justify-between">
              <p className="text-[11px] text-gray-400 dark:text-gray-500">
                {realLoggedRows.length} real timesheet day(s) logged
                {missingDayCount > 0 && <span className="text-amber-600 dark:text-amber-400"> · {missingDayCount} working day(s) missing</span>}
              </p>
              <select
                value={sort}
                onChange={(e) => setSort(e.target.value as Sort)}
                className="text-[11px] px-1.5 py-1 rounded-lg border border-gray-200 bg-white text-gray-600 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-400"
              >
                <option value="date_desc">Latest day first</option>
                <option value="date_asc">Earliest day first</option>
                <option value="hours_desc">Most hours first</option>
              </select>
            </div>
            {rows.length === 0 ? (
              <p className="text-xs text-gray-400 dark:text-gray-500 italic">No real timesheet rows logged against this project yet.</p>
            ) : (
              <div className="rounded-xl border border-[hsl(var(--primary)/0.3)] overflow-hidden max-h-80 overflow-y-auto scrollbar-thin">
                <div className="overflow-x-auto">
                <table className="w-full text-[11px]">
                  <thead className="sticky top-0">
                    <tr className="bg-gray-50 border-b border-gray-200 dark:bg-gray-800/60 dark:border-gray-700">
                      <th className="text-left font-semibold text-gray-500 dark:text-gray-400 px-2.5 py-1.5 whitespace-nowrap">Date</th>
                      <th className="text-left font-semibold text-gray-500 dark:text-gray-400 px-2.5 py-1.5 whitespace-nowrap">Logged</th>
                      <th className="text-left font-semibold text-gray-500 dark:text-gray-400 px-2.5 py-1.5 whitespace-nowrap">Expected</th>
                      <th className="text-left font-semibold text-gray-500 dark:text-gray-400 px-2.5 py-1.5 whitespace-nowrap">Day util.</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.date} className="border-b border-gray-50 dark:border-gray-800/60 last:border-0">
                        <td className="px-2.5 py-1.5 text-gray-600 dark:text-gray-400 whitespace-nowrap">{r.date}</td>
                        <td className="px-2.5 py-1.5 text-gray-700 dark:text-gray-300 font-medium whitespace-nowrap">{r.hours}h</td>
                        <td className="px-2.5 py-1.5 text-gray-400 dark:text-gray-500 whitespace-nowrap">{r.expected_hours > 0 ? `${r.expected_hours}h` : "off-cycle"}</td>
                        <td className="px-2.5 py-1.5 whitespace-nowrap">
                          {r.utilization_pct == null ? (
                            <span className="text-gray-300 dark:text-gray-600">-</span>
                          ) : (
                            <Badge variant={hoursUtilizationBand(r.utilization_pct)}>{r.utilization_pct}%</Badge>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}
