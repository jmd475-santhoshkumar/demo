"use client";

import { Filter } from "lucide-react";
import { cn } from "@/lib/utils";

export interface TableControlsProps {
  search?: {
    value: string;
    onChange: (v: string) => void;
    placeholder: string;
  };
  filters?: {
    value: string;
    onChange: (v: string) => void;
    options: [string, string][];
    label?: string; // optional per-filter label
  }[];
  toggles?: { active: boolean; onToggle: () => void; label: string }[];
  sort?: {
    value: string;
    onChange: (v: string) => void;
    options: [string, string][];
  };
}

export function TableControls({ search, filters, toggles, sort }: TableControlsProps) {
  const hasInlineRow = (filters && filters.length > 0) || (toggles && toggles.length > 0) || sort;

  // Count how many filters are currently non-default (first option = default)
  const activeFilterCount =
    filters?.filter((f) => f.value !== f.options[0]?.[0]).length ?? 0;

  return (
    <div className="space-y-1.5 mb-2">
      {/* ── Search input ── */}
      {search && (
        <input
          value={search.value}
          onChange={(e) => search.onChange(e.target.value)}
          placeholder={search.placeholder}
          className="w-full text-[11px] px-2.5 py-1.5 rounded-lg border border-gray-200 outline-none focus:border-primary/40 bg-white dark:border-gray-700 dark:bg-gray-900"
        />
      )}

      {/* ── Filters + toggles + sort ── */}
      {hasInlineRow && (
        <div className="flex items-center gap-1.5 flex-wrap min-h-[28px]">

          {/* Filter icon + label — only shown when there are filter selects */}
          {filters && filters.length > 0 && (
            <span
              className={cn(
                "inline-flex items-center gap-1 text-[10px] font-medium whitespace-nowrap",
                activeFilterCount > 0 ? "text-primary" : "text-gray-400 dark:text-gray-500"
              )}
            >
              <Filter className="w-3 h-3" />
              {activeFilterCount > 0 ? `${activeFilterCount} filter${activeFilterCount > 1 ? "s" : ""} active` : "Filter:"}
            </span>
          )}

          {/* Filter selects — highlighted when non-default */}
          {filters?.map((f, i) => (
            <div key={i} className="flex items-center gap-1">
              {f.label && (
                <span className="text-[10px] text-gray-400 dark:text-gray-500 whitespace-nowrap">{f.label}</span>
              )}
              <select
                value={f.value}
                onChange={(e) => f.onChange(e.target.value)}
                className={cn(
                  "text-[11px] px-1.5 py-1 rounded-lg border bg-white dark:bg-gray-900 cursor-pointer transition-colors",
                  f.value !== f.options[0]?.[0]
                    ? "border-primary/50 text-primary font-semibold bg-primary/5 focus:outline-primary"
                    : "border-gray-200 text-gray-600 hover:border-gray-300 dark:border-gray-700 dark:text-gray-400 dark:hover:border-gray-600"
                )}
              >
                {f.options.map(([v, label]) => (
                  <option key={v} value={v}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
          ))}

          {/* Toggle buttons */}
          {toggles?.map((t, i) => (
            <button
              key={i}
              type="button"
              onClick={t.onToggle}
              className={cn(
                "text-[11px] px-2 py-1 rounded-lg border whitespace-nowrap transition-colors",
                t.active
                  ? "bg-primary/10 border-primary/40 text-primary font-semibold"
                  : "border-gray-200 text-gray-500 hover:border-gray-300 hover:text-gray-700 dark:border-gray-700 dark:text-gray-400 dark:hover:border-gray-600 dark:hover:text-gray-200"
              )}
            >
              {t.label}
            </button>
          ))}

          {/* Sort select — pushed to the right */}
          {sort && (
            <select
              value={sort.value}
              onChange={(e) => sort.onChange(e.target.value)}
              className="text-[11px] px-1.5 py-1 rounded-lg border border-gray-200 bg-white text-gray-600 cursor-pointer hover:border-gray-300 ml-auto dark:border-gray-700 dark:bg-gray-900 dark:text-gray-400 dark:hover:border-gray-600"
            >
              {sort.options.map(([v, label]) => (
                <option key={v} value={v}>
                  {label}
                </option>
              ))}
            </select>
          )}
        </div>
      )}
    </div>
  );
}