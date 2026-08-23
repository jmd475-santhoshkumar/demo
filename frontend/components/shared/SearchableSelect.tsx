"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Search, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

export interface SearchableSelectOption {
  value: string;
  label: string;
}

// Searchable checkbox/radio dropdown used throughout the Project Wizard --
// replaces plain <select>s wherever the option list is long enough to need
// search (Client, Managers, COEs) or where multiple real values are
// legitimately valid at once (tech_coe/proposition_coe are already stored as
// semicolon-joined multi-value strings elsewhere in this app's real data).
//
// The panel is rendered via a portal into document.body, positioned with
// `fixed` coordinates computed from the trigger's bounding rect. It can't be
// a plain `position: absolute` child of the trigger -- several call sites
// (Step 3's budget table rows) sit inside an `overflow-x-auto` wrapper, and
// per the CSS overflow spec, setting overflow-x to anything but `visible`
// forces the other axis to `auto` too, which clips/scrolls an absolutely
// positioned dropdown inside the table instead of letting it float above it.
export function SearchableSelect({
  options,
  value,
  onChange,
  multi = false,
  placeholder = "-- Select --",
  disabled = false,
  className,
  size = "md",
}: {
  options: SearchableSelectOption[];
  value: string[];
  onChange: (value: string[]) => void;
  multi?: boolean;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  // "sm" matches a dense table row (e.g. Step5's allocation drafts sitting
  // next to plain-text roster rows) -- default "md" is the original size
  // used everywhere else (forms, filter bars).
  size?: "sm" | "md";
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [coords, setCoords] = useState<{ top: number; left: number; width: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  function updateCoords() {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (rect) setCoords({ top: rect.bottom + 4, left: rect.left, width: Math.max(rect.width, 220) });
  }

  useEffect(() => {
    if (!open) return;
    updateCoords();
    function onClickOutside(e: MouseEvent) {
      const target = e.target as Node;
      if (triggerRef.current?.contains(target)) return;
      if (panelRef.current?.contains(target)) return;
      setOpen(false);
      setSearch("");
    }
    function onReposition() {
      updateCoords();
    }
    document.addEventListener("mousedown", onClickOutside);
    // capture:true so this also fires on scroll inside the table's own
    // overflow-x-auto wrapper, not just window-level scrolling.
    window.addEventListener("scroll", onReposition, true);
    window.addEventListener("resize", onReposition);
    return () => {
      document.removeEventListener("mousedown", onClickOutside);
      window.removeEventListener("scroll", onReposition, true);
      window.removeEventListener("resize", onReposition);
    };
  }, [open]);

  const filtered = options.filter((o) => o.label.toLowerCase().includes(search.toLowerCase()));
  const allFilteredSelected = filtered.length > 0 && filtered.every((o) => value.includes(o.value));

  function toggle(v: string) {
    if (multi) {
      onChange(value.includes(v) ? value.filter((x) => x !== v) : [...value, v]);
    } else {
      onChange([v]);
      setOpen(false);
      setSearch("");
    }
  }
  function toggleSelectAll() {
    if (allFilteredSelected) {
      const filteredValues = new Set(filtered.map((o) => o.value));
      onChange(value.filter((v) => !filteredValues.has(v)));
    } else {
      onChange(Array.from(new Set([...value, ...filtered.map((o) => o.value)])));
    }
  }

  const selectedLabels = options.filter((o) => value.includes(o.value)).map((o) => o.label);
  const triggerText =
    selectedLabels.length === 0 ? placeholder : multi ? `${selectedLabels.length} selected` : selectedLabels[0];

  return (
    <div className={cn("relative", className)}>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "w-full flex items-center justify-between gap-2 rounded-lg border border-gray-200 bg-white text-left outline-none dark:border-gray-700 dark:bg-gray-900",
          size === "sm" ? "px-2 py-1 text-xs" : "px-3 py-2 text-sm",
          disabled && "opacity-50 cursor-not-allowed",
          !disabled && "focus:border-[hsl(var(--primary))]"
        )}
      >
        <span className={cn("truncate", selectedLabels.length === 0 && "text-gray-400 dark:text-gray-500")}>{triggerText}</span>
        <ChevronDown className={cn("flex-shrink-0 text-gray-400 dark:text-gray-500 transition-transform", size === "sm" ? "w-3 h-3" : "w-3.5 h-3.5", open && "rotate-180")} />
      </button>
      {open && !disabled && coords && typeof document !== "undefined" && createPortal(
        <div
          ref={panelRef}
          style={{ position: "fixed", top: coords.top, left: coords.left, width: coords.width }}
          className="z-[999] rounded-lg border border-gray-200 bg-white shadow-lg dark:border-gray-700 dark:bg-gray-900"
        >
          <div className="flex items-center gap-1.5 px-2.5 py-2 border-b border-gray-100 dark:border-gray-800">
            <Search className="w-3.5 h-3.5 text-gray-300 dark:text-gray-600 flex-shrink-0" />
            <input
              autoFocus
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search…"
              className="flex-1 text-xs outline-none"
            />
          </div>
          <div className="max-h-56 overflow-y-auto py-1">
            {multi && filtered.length > 0 && (
              <label className="flex items-center gap-2 px-2.5 py-1.5 text-xs hover:bg-gray-50 dark:hover:bg-gray-800 cursor-pointer font-medium text-gray-600 dark:text-gray-400 border-b border-gray-50 dark:border-gray-800/60">
                <input type="checkbox" checked={allFilteredSelected} onChange={toggleSelectAll} />
                (Select All)
              </label>
            )}
            {filtered.map((o) => (
              <label key={o.value} className="flex items-center gap-2 px-2.5 py-1.5 text-xs hover:bg-gray-50 dark:hover:bg-gray-800 cursor-pointer">
                <input type={multi ? "checkbox" : "radio"} checked={value.includes(o.value)} onChange={() => toggle(o.value)} />
                <span className="truncate">{o.label}</span>
              </label>
            ))}
            {filtered.length === 0 && <p className="text-xs text-gray-400 dark:text-gray-500 italic px-2.5 py-2">No matches.</p>}
          </div>
          <button
            type="button"
            onClick={() => { setOpen(false); setSearch(""); }}
            className="w-full text-xs text-center py-2 border-t border-gray-100 dark:border-gray-800 text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800"
          >
            Close
          </button>
        </div>,
        document.body
      )}
    </div>
  );
}
