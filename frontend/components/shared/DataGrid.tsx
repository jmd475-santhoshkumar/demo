"use client";

import { useMemo, useState } from "react";
import { ArrowUpDown, ArrowUp, ArrowDown, Search, Download } from "lucide-react";
import { cn } from "@/lib/utils";
import type { HeadcountRawCellValue } from "@/lib/api";
import { JMAN, JMAN_HEADER_GRADIENT } from "@/lib/brandColors";

type SortDir = "asc" | "desc" | null;

function isNumeric(v: HeadcountRawCellValue): v is number {
  return typeof v === "number";
}

function cellToDisplay(v: HeadcountRawCellValue): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "number") return Number.isInteger(v) ? String(v) : v.toFixed(2);
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "object") {
    const entries = Object.entries(v as Record<string, unknown>);
    return entries.length ? entries.map(([k, val]) => `${k}: ${val}`).join(", ") : "—";
  }
  return String(v);
}

function toCsv(columns: string[], rows: Record<string, HeadcountRawCellValue>[]): string {
  const escape = (v: HeadcountRawCellValue) => {
    const s = cellToDisplay(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const header = columns.map(escape).join(",");
  const body = rows.map((r) => columns.map((c) => escape(r[c])).join(",")).join("\n");
  return `${header}\n${body}`;
}

function downloadCsv(filename: string, columns: string[], rows: Record<string, HeadcountRawCellValue>[]) {
  const csv = toCsv(columns, rows);
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Excel-like grid: sortable columns (click header, cycles asc -> desc ->
 * none), a search box that filters across every cell, a sticky header row +
 * sticky first column (frozen-pane feel when there are many columns), and a
 * CSV export button -- for showing exactly the raw data behind a forecast/
 * model, not a polished app-native table.
 */
export function DataGrid({
  columns,
  rows,
  exportFilename = "data.csv",
  maxHeight = 480,
  rowKey,
  editableColumns,
  onCellEdit,
}: {
  columns: string[];
  rows: Record<string, HeadcountRawCellValue>[];
  exportFilename?: string;
  maxHeight?: number;
  /** Column used to identify a row back to the caller when a cell is edited (e.g. "month"). Required if editableColumns is set. */
  rowKey?: string;
  /** Columns the user can edit inline (double-click a cell). Omit for a fully read-only grid. */
  editableColumns?: string[];
  /** Called with (rowKeyValue, column, newNumericValue) when an edit is committed. */
  onCellEdit?: (rowKeyValue: string, column: string, value: number) => void;
}) {
  const [search, setSearch] = useState("");
  const [sortCol, setSortCol] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>(null);
  const [editingCell, setEditingCell] = useState<{ row: string; col: string } | null>(null);
  const [draft, setDraft] = useState("");

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((row) => columns.some((c) => cellToDisplay(row[c]).toLowerCase().includes(q)));
  }, [rows, columns, search]);

  const sorted = useMemo(() => {
    if (!sortCol || !sortDir) return filtered;
    const copy = [...filtered];
    copy.sort((a, b) => {
      const av = a[sortCol];
      const bv = b[sortCol];
      if (av === null || av === undefined) return 1;
      if (bv === null || bv === undefined) return -1;
      let cmp: number;
      if (isNumeric(av) && isNumeric(bv)) cmp = av - bv;
      else cmp = cellToDisplay(av).localeCompare(cellToDisplay(bv));
      return sortDir === "asc" ? cmp : -cmp;
    });
    return copy;
  }, [filtered, sortCol, sortDir]);

  const handleSort = (col: string) => {
    if (sortCol !== col) {
      setSortCol(col);
      setSortDir("asc");
    } else if (sortDir === "asc") {
      setSortDir("desc");
    } else if (sortDir === "desc") {
      setSortCol(null);
      setSortDir(null);
    } else {
      setSortDir("asc");
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
        <div className="relative w-64 max-w-full">
          <Search className="w-3.5 h-3.5 text-muted-foreground absolute left-2.5 top-1/2 -translate-y-1/2" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search all columns…"
            className="w-full text-xs pl-8 pr-3 py-1.5 rounded-lg border bg-background"
            style={{ borderColor: `${JMAN.emerald}40` }}
          />
        </div>
        <div className="flex items-center gap-3">
          <span className="text-[11px] text-muted-foreground">
            {sorted.length.toLocaleString()} row(s) · {columns.length} column(s)
            {search && ` (filtered from ${rows.length.toLocaleString()})`}
          </span>
          <button
            onClick={() => downloadCsv(exportFilename, columns, sorted)}
            className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border hover:bg-muted transition"
            style={{ borderColor: `${JMAN.emerald}40` }}
          >
            <Download className="w-3 h-3" /> Export CSV
          </button>
        </div>
      </div>

      <div className="rounded-lg overflow-auto font-mono" style={{ maxHeight, border: `1px solid ${JMAN.emerald}40` }}>
        <table className="border-collapse text-[11px] w-max min-w-full">
          <thead>
            <tr>
              {columns.map((col, i) => (
                <th
                  key={col}
                  onClick={() => handleSort(col)}
                  className={cn(
                    "sticky top-0 z-10 text-left font-semibold text-white px-2.5 py-1.5 whitespace-nowrap cursor-pointer select-none transition",
                    i === 0 && "left-0 z-20"
                  )}
                  style={{ background: JMAN_HEADER_GRADIENT, borderRight: `1px solid ${JMAN.emerald}` }}
                  title={col}
                >
                  <span className="flex items-center gap-1">
                    {col}
                    {sortCol === col ? (
                      sortDir === "asc" ? <ArrowUp className="w-2.5 h-2.5" /> : <ArrowDown className="w-2.5 h-2.5" />
                    ) : (
                      <ArrowUpDown className="w-2.5 h-2.5 text-white/50" />
                    )}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map((row, ri) => {
              const rowKeyValue = rowKey ? cellToDisplay(row[rowKey]) : String(ri);
              return (
              <tr key={ri} className={ri % 2 === 0 ? "bg-background" : ""} style={ri % 2 !== 0 ? { background: `${JMAN.turquoise}0D` } : undefined}>
                {columns.map((col, ci) => {
                  const value = row[col];
                  const isEditable = !!(editableColumns?.includes(col) && rowKey && onCellEdit);
                  const isEditing = editingCell?.row === rowKeyValue && editingCell?.col === col;
                  const commit = () => {
                    const parsed = Number(draft);
                    if (draft.trim() !== "" && !Number.isNaN(parsed)) onCellEdit!(rowKeyValue, col, parsed);
                    setEditingCell(null);
                  };
                  return (
                    <td
                      key={col}
                      onDoubleClick={
                        isEditable
                          ? () => {
                              setEditingCell({ row: rowKeyValue, col });
                              setDraft(value === null || value === undefined ? "" : String(value));
                            }
                          : undefined
                      }
                      className={cn(
                        "px-2.5 py-1 whitespace-nowrap text-foreground",
                        isNumeric(value) ? "text-right tabular-nums" : "text-left",
                        ci === 0 && "sticky left-0 z-[5] bg-inherit font-medium",
                        isEditable && !isEditing && "cursor-text hover:ring-1 hover:ring-inset"
                      )}
                      style={{
                        borderBottom: `1px solid ${JMAN.emerald}1F`,
                        borderRight: `1px solid ${JMAN.emerald}1F`,
                        ...(isEditable && !isEditing ? { boxShadow: `inset 0 0 0 9999px ${JMAN.amber}0D` } : {}),
                      }}
                      title={isEditable ? "Double-click to edit" : undefined}
                    >
                      {isEditing ? (
                        <input
                          autoFocus
                          value={draft}
                          onChange={(e) => setDraft(e.target.value)}
                          onBlur={commit}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") commit();
                            if (e.key === "Escape") setEditingCell(null);
                          }}
                          className="w-16 text-right bg-background border rounded px-1 py-0.5 text-[11px]"
                          style={{ borderColor: JMAN.emerald }}
                        />
                      ) : value === null || value === undefined ? (
                        <span className="text-muted-foreground/40">—</span>
                      ) : (
                        cellToDisplay(value)
                      )}
                    </td>
                  );
                })}
              </tr>
              );
            })}
            {sorted.length === 0 && (
              <tr>
                <td colSpan={columns.length} className="px-4 py-6 text-center text-muted-foreground italic">
                  No rows match your search.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
