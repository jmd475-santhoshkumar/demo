"use client";

import { useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import type { EmployeeAllocationRow } from "@/lib/api";

// Window sizing is data-driven, not fixed -- a rigid window either wastes
// most of the strip on empty space (an employee with no recent activity) or
// clips real history (someone with a long track record). These are just the
// guardrails: always show at least a year of context (including real past
// allocations when they exist), but cap the total span so bars never get so
// numerous/narrow they become unreadable -- older history beyond the cap is
// dropped in favor of the more relevant recent-to-near-future range.
const DEFAULT_PAST_MONTHS = 6;
const DEFAULT_FUTURE_MONTHS = 6;
const MIN_WINDOW_MONTHS = 12;
const MAX_WINDOW_MONTHS = 24;

interface Category {
  key: string;
  label: string;
  color: string;
}

const CATEGORIES: Record<string, Category> = {
  internal: { key: "internal", label: "Internal project", color: "bg-violet-500" },
  billable: { key: "billable", label: "Billable", color: "bg-emerald-500" },
  shadow: { key: "shadow", label: "Shadow", color: "bg-amber-500" },
  unbilled: { key: "unbilled", label: "Unbilled", color: "bg-red-400" },
  proposed: { key: "proposed", label: "Proposed", color: "bg-blue-400" },
  other: { key: "other", label: "Other", color: "bg-gray-400" },
};

// Internal-project status wins over billing status -- "this is internal
// work" is the more useful thing to flag at a glance than whether it happens
// to also be tagged shadow/unbilled, which is the default for internal work anyway.
function categoryOf(a: EmployeeAllocationRow): Category {
  if ((a.type_of_project ?? "").toLowerCase().includes("internal")) return CATEGORIES.internal;
  const key = a.resourcing_status?.toLowerCase();
  return CATEGORIES[key ?? ""] ?? CATEGORIES.other;
}

function monthStart(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}
function addMonths(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth() + n, 1);
}
function monthsBetween(a: Date, b: Date): number {
  return (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth());
}
function monthLabel(d: Date): string {
  return d.toLocaleDateString("en-US", { month: "short", year: "2-digit" });
}

interface LaneItem {
  alloc: EmployeeAllocationRow;
  startPct: number;
  widthPct: number;
}

// A compact, monthly-resolution Gantt-style strip of one employee's real
// allocations. Bars are solid color blocks only -- no on-bar text (project/
// client id just gets truncated and looks broken at this scale) -- hover for
// the real detail, click for the real project. Month ticks and bars share
// the exact same day-based percentage mapping (pctOf), so they always line up.
export function AllocationTimeline({
  allocations,
  onOpenProject,
}: {
  allocations: EmployeeAllocationRow[];
  onOpenProject: (projectCode: string) => void;
}) {
  const [filterStart, setFilterStart] = useState("");
  const [filterEnd, setFilterEnd] = useState("");
  const hasFilter = !!(filterStart || filterEnd);

  const { monthTicks, lanes, todayPct, windowStart, windowEndInclusive } = useMemo(() => {
    const today = new Date();

    const starts = allocations
      .map((a) => a.allocated_start_date)
      .filter((d): d is string => !!d)
      .map((d) => new Date(d));
    const ends = allocations
      .map((a) => a.allocated_end_date)
      .filter((d): d is string => !!d)
      .map((d) => new Date(d));

    const dataMin = starts.length ? new Date(Math.min(...starts.map((d) => d.getTime()))) : today;
    const dataMax = ends.length ? new Date(Math.max(...ends.map((d) => d.getTime()), today.getTime())) : today;

    let windowStart = monthStart(new Date(Math.min(dataMin.getTime(), addMonths(today, -DEFAULT_PAST_MONTHS).getTime())));
    let windowEnd = addMonths(
      monthStart(new Date(Math.max(dataMax.getTime(), addMonths(today, DEFAULT_FUTURE_MONTHS).getTime()))),
      1
    ); // exclusive

    // Auto window stays capped so an employee with a long track record doesn't
    // make every bar unreadably thin -- but an explicit manual filter is the
    // RM asking for a specific range on purpose, so it's honored uncapped
    // (see MIN/MAX_WINDOW_MONTHS's own comment -- that guardrail is for the
    // *default* view only).
    if (!hasFilter) {
      if (monthsBetween(windowStart, windowEnd) > MAX_WINDOW_MONTHS) {
        // Don't blindly clip MAX_WINDOW_MONTHS back from windowEnd -- BAU
        // allocations routinely carry unrealistic "evergreen" end dates
        // (2030+, sometimes 2035), which drag windowEnd years into the
        // future. Clipping backward from THERE produces a window that's
        // pure future BAU continuation with today, all real recent history,
        // and any real near-term allocation clipped out entirely (confirmed:
        // a real employee's timeline showed only a Jan'34-Dec'35 sliver).
        // Anchor the cap at today instead -- split the same total budget
        // between real past and real future room, proportional to how much
        // of each actually exists, so today always stays in view.
        const pastRoom = Math.max(0, monthsBetween(windowStart, monthStart(today)));
        const futureRoom = Math.max(0, monthsBetween(monthStart(today), windowEnd));
        const pastShare = Math.min(pastRoom, Math.round((MAX_WINDOW_MONTHS * pastRoom) / (pastRoom + futureRoom || 1)));
        windowStart = addMonths(monthStart(today), -pastShare);
        windowEnd = addMonths(windowStart, MAX_WINDOW_MONTHS);
      }
      if (monthsBetween(windowStart, windowEnd) < MIN_WINDOW_MONTHS) {
        windowStart = addMonths(windowEnd, -MIN_WINDOW_MONTHS);
      }
    }

    if (filterStart) windowStart = monthStart(new Date(filterStart));
    if (filterEnd) windowEnd = addMonths(monthStart(new Date(filterEnd)), 1); // exclusive
    if (windowEnd <= windowStart) windowEnd = addMonths(windowStart, 1);

    const totalMs = windowEnd.getTime() - windowStart.getTime();
    const pctOf = (d: Date) => Math.min(100, Math.max(0, ((d.getTime() - windowStart.getTime()) / totalMs) * 100));

    const totalMonths = monthsBetween(windowStart, windowEnd);
    // Thin out tick labels once there are more months than comfortably fit
    // without overlapping -- every month up to 15, then progressively
    // coarser so an RM-picked multi-year range still renders legibly instead
    // of a wall of overlapping labels.
    const tickStep = totalMonths > 48 ? 6 : totalMonths > 24 ? 3 : totalMonths > 15 ? 2 : 1;
    const monthTicks: { label: string; pct: number }[] = [];
    for (let i = 0; i <= totalMonths; i += tickStep) {
      const m = addMonths(windowStart, i);
      monthTicks.push({ label: monthLabel(m), pct: Math.min(97, Math.max(3, pctOf(m))) });
    }

    const relevant = allocations
      .filter((a) => a.allocated_start_date)
      .map((a) => {
        const start = new Date(a.allocated_start_date!);
        const end = a.allocated_end_date ? new Date(a.allocated_end_date) : windowEnd;
        return { alloc: a, start, end };
      })
      .filter((r) => r.end >= windowStart && r.start < windowEnd)
      .sort((a, b) => a.start.getTime() - b.start.getTime());

    const lanes: LaneItem[][] = [];
    for (const r of relevant) {
      const startPct = pctOf(r.start < windowStart ? windowStart : r.start);
      const endPct = pctOf(r.end > windowEnd ? windowEnd : r.end);
      const widthPct = Math.max(1.5, endPct - startPct);
      const item: LaneItem = { alloc: r.alloc, startPct, widthPct };
      const lane = lanes.find((l) => {
        const last = l[l.length - 1];
        return last.startPct + last.widthPct <= startPct + 0.3;
      });
      if (lane) lane.push(item);
      else lanes.push([item]);
    }

    return { monthTicks, lanes, todayPct: pctOf(today), windowStart, windowEndInclusive: addMonths(windowEnd, -1) };
  }, [allocations, filterStart, filterEnd, hasFilter]);

  const filterBar = (
    <div className="flex items-center gap-1.5 flex-wrap text-[11px]">
      <span className="text-gray-400 dark:text-gray-500">From</span>
      <input
        type="date"
        value={filterStart}
        onChange={(e) => setFilterStart(e.target.value)}
        className="px-1.5 py-1 rounded-md border border-gray-200 dark:border-gray-700 text-[11px] outline-none"
      />
      <span className="text-gray-400 dark:text-gray-500">to</span>
      <input
        type="date"
        value={filterEnd}
        onChange={(e) => setFilterEnd(e.target.value)}
        className="px-1.5 py-1 rounded-md border border-gray-200 dark:border-gray-700 text-[11px] outline-none"
      />
      {hasFilter && (
        <button
          onClick={() => {
            setFilterStart("");
            setFilterEnd("");
          }}
          className="text-primary hover:underline"
        >
          Reset to auto
        </button>
      )}
    </div>
  );

  if (lanes.length === 0) {
    return (
      <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-4 space-y-2 mb-3">
        <div className="flex items-center justify-between flex-wrap gap-1.5">
          <p className="text-[11px] font-semibold text-gray-600 dark:text-gray-400">Allocation Timeline</p>
          {filterBar}
        </div>
        <p className="text-center text-xs text-gray-400 dark:text-gray-500 italic">
          No allocations between {monthLabel(windowStart)} and {monthLabel(windowEndInclusive)}.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-3 space-y-2 mb-3">
      <div className="flex items-center justify-between flex-wrap gap-1.5">
        <p className="text-[11px] font-semibold text-gray-600 dark:text-gray-400">Allocation Timeline</p>
        <div className="flex items-center gap-2.5 flex-wrap">
          {Object.values(CATEGORIES)
            .filter((c) => c.key !== "other")
            .map((c) => (
              <span key={c.key} className="flex items-center gap-1 text-[10px] text-gray-400 dark:text-gray-500">
                <span className={cn("w-2 h-2 rounded-sm", c.color)} /> {c.label}
              </span>
            ))}
        </div>
      </div>
      <div className="flex items-center justify-between flex-wrap gap-1.5">
        {filterBar}
        <p className="text-[10px] text-gray-400 dark:text-gray-500">
          Showing {monthLabel(windowStart)} – {monthLabel(windowEndInclusive)}
        </p>
      </div>

      <div className="relative pt-4">
        {/* month ticks + gridlines -- positioned with the same day-based % as the bars below, so they always line up */}
        <div className="relative h-3 mb-2 border-b border-gray-100 dark:border-gray-800">
          {monthTicks.map((tick, i) => (
            <div
              key={i}
              className="absolute top-0 text-[9px] text-gray-400 dark:text-gray-500 -translate-x-1/2 whitespace-nowrap"
              style={{ left: `${tick.pct}%` }}
            >
              {tick.label}
            </div>
          ))}
        </div>
        <div className="absolute inset-x-0 top-4 bottom-0 pointer-events-none">
          {monthTicks.map((tick, i) => (
            <div key={i} className="absolute top-0 bottom-0 w-px bg-gray-50 dark:bg-gray-800/60" style={{ left: `${tick.pct}%` }} />
          ))}
        </div>

        {/* today marker */}
        <div className="absolute top-4 bottom-0 w-px bg-primary/60 z-20" style={{ left: `${todayPct}%` }} title="Today" />

        <div className="space-y-1.5">
          {lanes.map((lane, i) => (
            <div key={i} className="relative h-5">
              {lane.map((item, j) => {
                const cat = categoryOf(item.alloc);
                return (
                  <button
                    key={j}
                    onClick={() => onOpenProject(item.alloc.project_id)}
                    className={cn("absolute top-0 h-5 rounded-md hover:ring-2 hover:ring-offset-1 hover:ring-primary/40 transition z-10", cat.color)}
                    style={{ left: `${item.startPct}%`, width: `calc(${item.widthPct}% - 2px)` }}
                    title={`${item.alloc.project_id} · ${cat.label} · ${item.alloc.allocation_by_percentage ?? "?"}% · ${item.alloc.allocated_start_date ?? "?"} → ${item.alloc.allocated_end_date ?? "ongoing"} · click for project details`}
                  />
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
