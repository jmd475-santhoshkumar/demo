import type { CSSProperties } from "react";
import { cn } from "@/lib/utils";

export function Skeleton({ className, style }: { className?: string; style?: CSSProperties }) {
  return <div className={cn("animate-pulse rounded-md bg-gray-200/70 dark:bg-gray-700/70", className)} style={style} />;
}

export function StatCardSkeleton() {
  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-700 p-4 space-y-2.5">
      <div className="flex items-start justify-between">
        <Skeleton className="h-3 w-20" />
        <Skeleton className="h-3.5 w-3.5 rounded-full" />
      </div>
      <Skeleton className="h-7 w-16" />
      <Skeleton className="h-3 w-28" />
    </div>
  );
}

export function StatCardGridSkeleton({ count, className }: { count: number; className?: string }) {
  return (
    <div className={className}>
      {Array.from({ length: count }).map((_, i) => (
        <StatCardSkeleton key={i} />
      ))}
    </div>
  );
}

export function TableSkeleton({
  columns,
  rows = 6,
  className,
}: {
  columns: number;
  rows?: number;
  className?: string;
}) {
  return (
    <div className={cn("rounded-xl border border-[hsl(var(--primary)/0.3)] bg-white dark:bg-gray-900 overflow-hidden", className)}>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="bg-gray-50 dark:bg-gray-800/60">
            <tr>
              {Array.from({ length: columns }).map((_, c) => (
                <th key={c} className="px-3 py-2.5">
                  <Skeleton className="h-3 w-16" />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: rows }).map((_, r) => (
              <tr key={r} className="border-t border-gray-50 dark:border-gray-800/60">
                {Array.from({ length: columns }).map((_, c) => (
                  <td key={c} className="px-3 py-3">
                    <Skeleton className={cn("h-3", c === 0 ? "w-20" : "w-12")} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function ChartSkeleton({ height = 220 }: { height?: number }) {
  return <Skeleton className="w-full" style={{ height }} />;
}

export function FieldGridSkeleton({ count = 4, className }: { count?: number; className?: string }) {
  return (
    <div className={cn("grid grid-cols-2 sm:grid-cols-4 gap-3", className)}>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="space-y-1.5">
          <Skeleton className="h-2.5 w-14" />
          <Skeleton className="h-3.5 w-20" />
        </div>
      ))}
    </div>
  );
}

export function ChipRowSkeleton({ count = 8 }: { count?: number }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {Array.from({ length: count }).map((_, i) => (
        <Skeleton key={i} className="h-5 rounded-full" style={{ width: 56 + (i % 4) * 18 }} />
      ))}
    </div>
  );
}

export function ListRowSkeleton({ lines = 2 }: { lines?: number }) {
  return (
    <div className="px-3 py-2.5 border-b border-gray-50 dark:border-gray-800/60 space-y-1.5">
      <Skeleton className="h-3 w-3/4" />
      {lines > 1 && <Skeleton className="h-2.5 w-1/2" />}
    </div>
  );
}

export function ListSkeleton({ rows = 6, lines = 2 }: { rows?: number; lines?: number }) {
  return (
    <div>
      {Array.from({ length: rows }).map((_, i) => (
        <ListRowSkeleton key={i} lines={lines} />
      ))}
    </div>
  );
}

export function CardRowSkeleton() {
  return (
    <div className="flex items-center gap-2 px-1.5 py-1.5">
      <Skeleton className="h-4 w-4 rounded-full flex-shrink-0" />
      <Skeleton className="h-3 w-24" />
      <Skeleton className="h-3 w-32 flex-1" />
      <Skeleton className="h-4 w-12 rounded-full flex-shrink-0" />
    </div>
  );
}

export function ModalBodySkeleton() {
  return (
    <div className="space-y-4">
      <FieldGridSkeleton count={4} />
      <div className="flex items-center gap-3">
        <Skeleton className="h-5 w-20 rounded-full" />
        <Skeleton className="h-3 w-40" />
      </div>
      <TableSkeleton columns={5} rows={5} />
    </div>
  );
}

export function CandidateCardSkeleton() {
  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Skeleton className="h-4 w-20" />
        <Skeleton className="h-3 w-28" />
        <Skeleton className="h-4 w-16 rounded-full ml-auto" />
      </div>
      <div className="grid grid-cols-3 gap-3">
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-8 w-full" />
      </div>
    </div>
  );
}
