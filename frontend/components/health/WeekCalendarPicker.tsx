"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import { type GovernanceWeek } from "@/lib/api";
import { cn } from "@/lib/utils";

function toDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// `new Date("2026-08-17")` parses as UTC midnight, which .getDate()/.getDay()
// then read back in the VIEWER's local timezone -- in any UTC-negative zone
// that silently displays as the previous day. Parsing the (year, month, day)
// components into the local-time Date constructor instead avoids that.
function parseLocalDate(dateStr: string): Date {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d);
}

// Monday-start ISO week, matching the backend's governance_common.current_week_start().
function mondayOf(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay(); // 0=Sun..6=Sat
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function monthGrid(year: number, month: number): Date[] {
  const first = new Date(year, month, 1);
  const start = mondayOf(first);
  return Array.from({ length: 42 }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    return d;
  });
}

function formatWeekLabel(weekStartDate: string, isCurrent: boolean): string {
  const label = parseLocalDate(weekStartDate).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
  return isCurrent ? `Week of ${label} (current)` : `Week of ${label}`;
}

// A month calendar (not a plain dropdown) so weeks with a real captured
// Cluster Governance snapshot are visually distinguishable at a glance --
// picking any day within a highlighted week selects that whole week.
export function WeekCalendarPicker({
  weekOptions, selectedWeek, onSelectWeek,
}: {
  weekOptions: GovernanceWeek[];
  selectedWeek: string | undefined;
  onSelectWeek: (week: string | undefined) => void;
}) {
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const current = weekOptions.find((w) => w.is_current);
  const activeWeekStr = selectedWeek ?? current?.week_start_date;
  const activeDate = activeWeekStr ? parseLocalDate(activeWeekStr) : new Date();

  const [viewYear, setViewYear] = useState(activeDate.getFullYear());
  const [viewMonth, setViewMonth] = useState(activeDate.getMonth());

  const dataWeeks = new Set(weekOptions.map((w) => w.week_start_date));

  // Panel width matches `w-72` (18rem) below -- aligning its RIGHT edge to
  // the trigger's right edge (not left-to-left) so it opens toward the left
  // instead of overflowing the viewport when the trigger sits near the
  // right edge of the page, as it usually does here.
  const PANEL_WIDTH = 288;

  function updateCoords() {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const left = Math.min(Math.max(8, rect.right - PANEL_WIDTH), window.innerWidth - PANEL_WIDTH - 8);
    setCoords({ top: rect.bottom + 6, left });
  }
  function openCalendar() {
    setViewYear(activeDate.getFullYear());
    setViewMonth(activeDate.getMonth());
    updateCoords();
    setOpen(true);
  }
  function shiftMonth(delta: number) {
    let m = viewMonth + delta;
    let y = viewYear;
    if (m < 0) { m = 11; y -= 1; }
    if (m > 11) { m = 0; y += 1; }
    setViewMonth(m);
    setViewYear(y);
  }

  useEffect(() => {
    if (!open) return;
    function onClickOutside(e: MouseEvent) {
      const target = e.target as Node;
      if (triggerRef.current?.contains(target)) return;
      if (panelRef.current?.contains(target)) return;
      setOpen(false);
    }
    function onReposition() {
      updateCoords();
    }
    document.addEventListener("mousedown", onClickOutside);
    window.addEventListener("scroll", onReposition, true);
    window.addEventListener("resize", onReposition);
    return () => {
      document.removeEventListener("mousedown", onClickOutside);
      window.removeEventListener("scroll", onReposition, true);
      window.removeEventListener("resize", onReposition);
    };
  }, [open]);

  function selectDay(d: Date) {
    const mondayStr = toDateStr(mondayOf(d));
    onSelectWeek(mondayStr === current?.week_start_date ? undefined : mondayStr);
    setOpen(false);
  }

  const days = monthGrid(viewYear, viewMonth);
  const todayStr = toDateStr(new Date());
  const monthLabel = new Date(viewYear, viewMonth, 1).toLocaleDateString(undefined, { month: "long", year: "numeric" });

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => (open ? setOpen(false) : openCalendar())}
        className="flex items-center gap-2 text-xs font-medium px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-300 hover:border-primary transition"
      >
        <CalendarDays className="w-3.5 h-3.5 text-gray-400 dark:text-gray-500" />
        {activeWeekStr ? formatWeekLabel(activeWeekStr, activeWeekStr === current?.week_start_date) : "Select week"}
        <ChevronDown className={cn("w-3 h-3 text-gray-400 dark:text-gray-500 transition-transform", open && "rotate-180")} />
      </button>

      {open && coords && typeof document !== "undefined" && createPortal(
        <div
          ref={panelRef}
          style={{ position: "fixed", top: coords.top, left: coords.left }}
          className="z-[60] w-72 rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 shadow-lg p-3"
        >
          <div className="flex items-center justify-between mb-2">
            <button onClick={() => shiftMonth(-1)} className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500 dark:text-gray-400">
              <ChevronLeft className="w-4 h-4" />
            </button>
            <p className="text-xs font-semibold text-gray-700 dark:text-gray-200">{monthLabel}</p>
            <button onClick={() => shiftMonth(1)} className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500 dark:text-gray-400">
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>

          <div className="grid grid-cols-7 gap-y-1">
            {["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"].map((label) => (
              <span key={label} className="text-[9px] font-semibold text-gray-400 dark:text-gray-500 text-center">{label}</span>
            ))}
            {days.map((d) => {
              const dStr = toDateStr(d);
              const mondayStr = toDateStr(mondayOf(d));
              const hasData = dataWeeks.has(mondayStr);
              const inViewMonth = d.getMonth() === viewMonth;
              const isSelectedWeek = mondayStr === activeWeekStr;
              const isToday = dStr === todayStr;
              return (
                <button
                  key={dStr}
                  onClick={() => selectDay(d)}
                  title={hasData ? `Week of ${mondayStr} — data captured` : `Week of ${mondayStr} — no data captured`}
                  className={cn(
                    "h-7 w-7 mx-auto flex items-center justify-center rounded-md text-[11px] transition-colors",
                    !inViewMonth && "text-gray-300 dark:text-gray-700",
                    inViewMonth && !hasData && "text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800",
                    hasData && "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400 hover:bg-emerald-200 dark:hover:bg-emerald-900/60 font-semibold",
                    isSelectedWeek && "ring-2 ring-primary ring-offset-1 dark:ring-offset-gray-900",
                    isToday && !isSelectedWeek && "underline decoration-2 underline-offset-2"
                  )}
                >
                  {d.getDate()}
                </button>
              );
            })}
          </div>

          <div className="flex items-center gap-3 mt-2.5 pt-2.5 border-t border-gray-100 dark:border-gray-800 text-[10px] text-gray-400 dark:text-gray-500">
            <span className="flex items-center gap-1">
              <span className="h-2.5 w-2.5 rounded-sm bg-emerald-100 dark:bg-emerald-900/40" /> Data captured
            </span>
            <span className="flex items-center gap-1">
              <span className="h-2.5 w-2.5 rounded-sm ring-2 ring-primary" /> Selected week
            </span>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
