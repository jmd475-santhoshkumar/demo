import type { ReactNode } from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

interface BreakdownItem {
  label: string;
  value: number;
  colorClass: string;
}

interface StatCardProps {
  label: string;
  value: string | number;
  sub?: string;
  color?: "default" | "blue" | "green" | "amber" | "red";
  icon?: ReactNode;
  onClick?: () => void;
  href?: string;
  active?: boolean;
  tooltip?: ReactNode;
  breakdown?: BreakdownItem[];
}
const colorMap = {
  default: "bg-white border-gray-200 text-gray-900 dark:bg-gray-900 dark:border-gray-700 dark:text-gray-100",
  blue: "bg-blue-50 border-blue-200 text-blue-900 dark:bg-blue-950/40 dark:border-blue-800/60 dark:text-blue-100",
  green: "bg-emerald-50 border-emerald-200 text-emerald-900 dark:bg-emerald-950/40 dark:border-emerald-800/60 dark:text-emerald-100",
  amber: "bg-amber-50 border-amber-200 text-amber-900 dark:bg-amber-950/40 dark:border-amber-800/60 dark:text-amber-100",
  red: "bg-red-50 border-red-200 text-red-900 dark:bg-red-950/40 dark:border-red-800/60 dark:text-red-100",
};
const activeRingMap = {
  default: "ring-2 ring-gray-300 dark:ring-gray-600",
  blue: "ring-2 ring-blue-300 dark:ring-blue-700",
  green: "ring-2 ring-emerald-300 dark:ring-emerald-700",
  amber: "ring-2 ring-amber-300 dark:ring-amber-700",
  red: "ring-2 ring-red-300 dark:ring-red-700",
};
export function StatCard({ label, value, sub, color = "default", icon, onClick, href, active, tooltip, breakdown }: StatCardProps) {
  const interactive = Boolean(onClick || href);
  const body = (
    <>
      <div className="flex items-start justify-between">
        <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">{label}</p>
        {icon && <span className="text-gray-400 dark:text-gray-500">{icon}</span>}
      </div>
      <p className="text-2xl font-bold leading-tight">{value}</p>
      {sub && <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">{sub}</p>}
      {breakdown && breakdown.length > 0 && (
        <div className="flex items-center gap-1 mt-1.5 flex-wrap">
          {breakdown.map((b) => (
            <span key={b.label} className={cn("text-[10px] px-1.5 py-0.5 rounded-full font-medium whitespace-nowrap", b.colorClass)}>
              {b.value} {b.label}
            </span>
          ))}
        </div>
      )}
      {interactive && (
        <ChevronRight
          className={cn(
            "w-3.5 h-3.5 absolute bottom-3 right-3 text-gray-300 dark:text-gray-600 transition-transform",
            "group-hover:translate-x-0.5 group-hover:text-gray-400 dark:group-hover:text-gray-400"
          )}
        />
      )}
      {tooltip && (
        <div className="absolute left-0 top-full mt-1.5 z-20 hidden group-hover:block bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg p-3 text-xs w-60 text-left normal-case font-normal text-gray-600 dark:text-gray-300">
          {tooltip}
        </div>
      )}
    </>
  );
  const className = cn(
    "rounded-xl border p-4 relative group",
    colorMap[color],
    interactive && "text-left w-full transition hover:shadow-sm cursor-pointer",
    active && activeRingMap[color]
  );
  if (href) {
    return (
      <Link href={href} className={className}>
        {body}
      </Link>
    );
  }
  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={className}>
        {body}
      </button>
    );
  }
  return <div className={className}>{body}</div>;
}