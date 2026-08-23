"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { Users, Briefcase, ShieldAlert, Clock, ArrowRight, UserCheck, AlertOctagon, DollarSign, CalendarOff, Mail, Loader2, Check } from "lucide-react";
import { api } from "@/lib/api";
import { StatCard } from "@/components/shared/StatCard";
import { Badge } from "@/components/shared/Badge";
import { ErrorState } from "@/components/shared/EmptyState";
import { StatCardGridSkeleton, ListSkeleton, ChartSkeleton, Skeleton } from "@/components/shared/Skeleton";
import { ProjectHealthDetailModal } from "@/components/health/ProjectHealthDetailModal";
import { rootCauseLabel } from "@/lib/utils";
import { EmployeeProfileModal } from "@/components/shared/EmployeeProfileModal";
import { cn, formatUsd } from "@/lib/utils";

function normalize(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

export default function DashboardPage() {
  const tables = useQuery({ queryKey: ["tables"], queryFn: api.tables });
  const headcount = useQuery({ queryKey: ["employee-headcount-summary"], queryFn: api.employeeHeadcountSummary });
  const health = useQuery({ queryKey: ["health-projects"], queryFn: api.healthProjects });
  const allocations = useQuery({ queryKey: ["allocations"], queryFn: api.allocations });
  const freePool = useQuery({ queryKey: ["free-pool"], queryFn: api.freePool });
  const leave = useQuery({ queryKey: ["leave-impact"], queryFn: () => api.leaveImpact() });
  const pipeline = useQuery({ queryKey: ["pipeline-forecast"], queryFn: api.pipelineForecast });

  const [selectedProject, setSelectedProject] = useState<string | null>(null);
  const [selectedEmployee, setSelectedEmployee] = useState<string | null>(null);
  const [digestStatus, setDigestStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");

  const handleSendDigest = async () => {
    setDigestStatus("sending");
    try {
      await api.sendDigestNow();
      setDigestStatus("sent");
      setTimeout(() => setDigestStatus("idle"), 4000);
    } catch {
      setDigestStatus("error");
      setTimeout(() => setDigestStatus("idle"), 4000);
    }
  };

  if (tables.isLoading || health.isLoading || allocations.isLoading) return <DashboardSkeleton />;
  if (tables.error || health.error || allocations.error) return <ErrorState message="Could not reach the ResourceIQ backend. Is it running on :8000?" />;

  const highRisk = (health.data ?? []).filter((p) => p.risk_band === "high").sort((a, b) => b.risk_score - a.risk_score);
  const mediumRisk = (health.data ?? []).filter((p) => p.risk_band === "medium");
  const understaffed = (health.data ?? []).filter((p) => p.is_understaffed);
  const endingSoon = (allocations.data ?? []).filter((a) => a.ending_soon).sort((a, b) => a.days_to_end - b.days_to_end);
  const overAllocated = (allocations.data ?? []).filter((a) => a.utilization_band === "over_allocated");
  const freePoolCounts = {
    fully_free: (freePool.data ?? []).filter((c) => c.reason === "fully_free").length,
    under_utilized: (freePool.data ?? []).filter((c) => c.reason === "under_utilized").length,
    ending_soon: (freePool.data ?? []).filter((c) => c.reason === "ending_soon").length,
  };
  const totalUnbilledValue = (health.data ?? []).reduce((sum, p) => sum + p.monthly_unbilled_value_usd, 0);
  const onLeaveNow = (leave.data ?? [])
    .filter((i) => i.is_currently_on_leave)
    .sort((a, b) => {
      if (a.backfill_available !== b.backfill_available) return a.backfill_available ? 1 : -1;
      return a.leave_end_date.localeCompare(b.leave_end_date);
    });
  const leaveNoBackfill = (leave.data ?? []).filter((i) => i.is_currently_on_leave && !i.backfill_available);

  const allocationsByType = new Map<string, number>();
  for (const a of allocations.data ?? []) {
    const key = a.type_of_project ?? "Unknown";
    allocationsByType.set(key, (allocationsByType.get(key) ?? 0) + 1);
  }
  const allocationTypeRows = Array.from(allocationsByType.entries()).sort((a, b) => b[1] - a[1]);

  const urgentPipeline = (pipeline.data ?? [])
    .filter((r) => (r.skillset || r.resources_requested) && normalize(r.status) !== "resourced")
    .filter((r) => normalize(r.priority) === "urgent" || r.is_late_notice)
    .sort((a, b) => (a.likely_start_date ?? "").localeCompare(b.likely_start_date ?? ""))
    .slice(0, 5);

  return (
    <div className="p-4 sm:p-6 space-y-6 w-full">
      <div className="flex items-center justify-end -mb-2">
        <button
          onClick={handleSendDigest}
          disabled={digestStatus === "sending"}
          title="Emails the Resource Manager digest right now -- leave coverage gaps with no backfill, and high-risk projects. Also sends automatically every Friday 5pm and Monday 9am."
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-gray-200 text-gray-600 hover:border-gray-300 hover:bg-gray-50 transition disabled:opacity-50 dark:border-gray-700 dark:text-gray-400 dark:hover:border-gray-600 dark:hover:bg-gray-800"
        >
          {digestStatus === "sending" ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : digestStatus === "sent" ? (
            <Check className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
          ) : (
            <Mail className="w-3.5 h-3.5" />
          )}
          {digestStatus === "sending" ? "Sending…" : digestStatus === "sent" ? "Digest sent" : digestStatus === "error" ? "Failed — try again" : "Email digest now"}
        </button>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Delivery Staff"
          value={headcount.data?.delivery_active ?? "-"}
          sub={headcount.data ? `of ${headcount.data.currently_active} total active` : undefined}
          icon={<Users className="w-4 h-4" />}
          href="/employees"
          tooltip={
            headcount.data && (
              <div className="space-y-1">
                <p className="font-semibold text-gray-700 dark:text-gray-300">Delivery staff (active, client-facing): {headcount.data.delivery_active}</p>
                <p>All active accounts (incl. Finance, HR, IT): {headcount.data.currently_active}</p>
                <p>Total ever on roster: {headcount.data.total_ever}</p>
                <p>Already departed: {headcount.data.already_departed}</p>
                <p>In notice period: {headcount.data.in_notice_period}</p>
              </div>
            )
          }
        />
        <StatCard
          label="Active Allocations"
          value={allocations.data?.length ?? "-"}
          icon={<Briefcase className="w-4 h-4" />}
          href="/allocations"
          tooltip={
            <div className="space-y-1">
              <p className="font-semibold text-gray-700 dark:text-gray-300">By project type</p>
              {allocationTypeRows.map(([type, count]) => (
                <p key={type} className="flex justify-between gap-3">
                  <span>{type}</span>
                  <span className="font-medium text-gray-700 dark:text-gray-300">{count}</span>
                </p>
              ))}
            </div>
          }
        />
        <StatCard
          label="At-Risk Projects"
          value={highRisk.length}
          sub="high risk, needs attention now"
          color={highRisk.length > 0 ? "red" : "default"}
          icon={<ShieldAlert className="w-4 h-4" />}
          href="/health"
          breakdown={[{ label: "medium also flagged", value: mediumRisk.length, colorClass: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300" }]}
        />
        <StatCard
          label="Allocations Ending Soon"
          value={endingSoon.length}
          sub="within 30 days"
          color="amber"
          icon={<Clock className="w-4 h-4" />}
          href="/allocations?endingSoon=true"
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Free Pool Available"
          value={freePool.data ? freePoolCounts.fully_free : "-"}
          sub="fully free, available right now"
          color="green"
          icon={<UserCheck className="w-4 h-4" />}
          href="/free-pool"
          breakdown={
            freePool.data && [
              { label: "under-utilized", value: freePoolCounts.under_utilized, colorClass: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300" },
              { label: "ending soon", value: freePoolCounts.ending_soon, colorClass: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300" },
            ]
          }
        />
        <StatCard
          label="Understaffed Projects"
          value={understaffed.length}
          sub="actual headcount below 75% of role-mix expectation"
          color={understaffed.length > 0 ? "amber" : "default"}
          icon={<AlertOctagon className="w-4 h-4" />}
          href="/health?understaffed=true"
        />
        <StatCard
          label="Unbilled Value at Risk"
          value={formatUsd(totalUnbilledValue)}
          sub="rate card, per month"
          color={totalUnbilledValue > 0 ? "red" : "default"}
          icon={<DollarSign className="w-4 h-4" />}
          href="/health?revenue=true"
        />
        <StatCard
          label="On Leave Right Now"
          value={onLeaveNow.length}
          sub={leaveNoBackfill.length > 0 ? `${leaveNoBackfill.length} with no backfill` : undefined}
          color={leaveNoBackfill.length > 0 ? "red" : "default"}
          icon={<CalendarOff className="w-4 h-4" />}
          href="/leave?onLeaveNow=true"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-900">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300">Highest-Risk Projects</h2>
            <Link href="/health" className="text-xs text-primary flex items-center gap-1 hover:underline">
              View all <ArrowRight className="w-3 h-3" />
            </Link>
          </div>
          <div className="space-y-2">
            {highRisk.slice(0, 5).map((p) => (
              <button
                key={p.project_code}
                onClick={() => setSelectedProject(p.project_code)}
                className="flex items-center gap-2 text-xs w-full text-left hover:bg-gray-50 rounded-lg px-1.5 py-1 -mx-1.5 transition dark:hover:bg-gray-800"
              >
                <Badge variant={p.risk_band}>{p.risk_band}</Badge>
                <span className="font-medium text-gray-700 dark:text-gray-300">{p.project_code}</span>
                <span className="text-gray-400 truncate dark:text-gray-500">{p.root_causes.map(rootCauseLabel).join(", ")}</span>
                {p.wsr_worst_signal && <Badge variant={p.wsr_worst_signal}>{p.wsr_worst_signal}</Badge>}
              </button>
            ))}
            {highRisk.length === 0 && <p className="text-xs text-gray-400 italic dark:text-gray-500">No high-risk projects right now.</p>}
          </div>
        </div>

        <div className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-900">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300">Capacity Freeing Up Soon</h2>
            <Link href="/free-pool" className="text-xs text-primary flex items-center gap-1 hover:underline">
              View all <ArrowRight className="w-3 h-3" />
            </Link>
          </div>
          <div className="space-y-2">
            {endingSoon.slice(0, 5).map((a) => (
              <button
                key={`${a.employee_id}-${a.project_id}`}
                onClick={() => setSelectedEmployee(a.employee_id)}
                className="flex items-center gap-2 text-xs w-full text-left hover:bg-gray-50 rounded-lg px-1.5 py-1 -mx-1.5 transition dark:hover:bg-gray-800"
              >
                <span className="font-medium text-gray-700 dark:text-gray-300">{a.employee_id}</span>
                <span className="text-gray-400 dark:text-gray-500">{a.job_name}</span>
                <span className="text-gray-400 ml-auto dark:text-gray-500">{a.days_to_end}d left</span>
              </button>
            ))}
            {endingSoon.length === 0 && <p className="text-xs text-gray-400 italic dark:text-gray-500">Nothing ending in the next 30 days.</p>}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-900">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300">Urgent Pipeline Needing Action</h2>
            <Link href="/resourcing/deals" className="text-xs text-primary flex items-center gap-1 hover:underline">
              View all <ArrowRight className="w-3 h-3" />
            </Link>
          </div>
          <div className="space-y-2">
            {urgentPipeline.map((r) => (
              <Link
                key={r.row_index}
                href={`/resourcing/deals?row=${r.row_index}`}
                className="flex items-center gap-2 text-xs w-full text-left hover:bg-gray-50 rounded-lg px-1.5 py-1 -mx-1.5 transition dark:hover:bg-gray-800"
              >
                {r.is_late_notice && <Badge variant="red">late</Badge>}
                <span className="font-medium text-gray-700 dark:text-gray-300">{r.resources_requested ?? "Role TBD"}</span>
                <span className="text-gray-400 truncate dark:text-gray-500">{r.client ?? "Unnamed client"}</span>
                {r.likely_start_date && <span className="text-gray-400 ml-auto whitespace-nowrap dark:text-gray-500">{r.likely_start_date}</span>}
              </Link>
            ))}
            {!pipeline.isLoading && urgentPipeline.length === 0 && (
              <p className="text-xs text-gray-400 italic dark:text-gray-500">No urgent unresourced demand right now.</p>
            )}
          </div>
        </div>

        <div className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-900">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300">On Leave Right Now</h2>
            <Link href="/leave?onLeaveNow=true" className="text-xs text-primary flex items-center gap-1 hover:underline">
              View all <ArrowRight className="w-3 h-3" />
            </Link>
          </div>
          <div className="space-y-2">
            {onLeaveNow.slice(0, 5).map((i, idx) => (
              <button
                key={`${i.employee_id}-${i.project_id}-${idx}`}
                onClick={() => setSelectedEmployee(i.employee_id)}
                className="flex items-center gap-2 text-xs w-full text-left hover:bg-gray-50 rounded-lg px-1.5 py-1 -mx-1.5 transition dark:hover:bg-gray-800"
              >
                <Badge variant={i.leave_type === "Emergency" ? "red" : i.leave_type === "Sick" ? "amber" : "default"}>{i.leave_type}</Badge>
                <span className="font-medium text-gray-700 dark:text-gray-300">{i.employee_id}</span>
                <span className="text-gray-400 truncate dark:text-gray-500">{i.project_id}</span>
                {!i.backfill_available && <span className="text-red-500 ml-auto whitespace-nowrap dark:text-red-400">no backfill</span>}
              </button>
            ))}
            {onLeaveNow.length === 0 && <p className="text-xs text-gray-400 italic dark:text-gray-500">Nobody is on leave right now.</p>}
          </div>
        </div>
      </div>

      {overAllocated.length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-800/60 dark:bg-amber-950/40">
          <p className="text-xs text-amber-700 dark:text-amber-400">
            <strong>{overAllocated.length}</strong> allocation rows belong to employees currently allocated above 100% capacity.{" "}
            <Link href="/allocations?band=over_allocated" className="underline">Review in Allocations →</Link>
          </p>
        </div>
      )}

      {selectedProject && (
        <ProjectHealthDetailModal projectCode={selectedProject} onClose={() => setSelectedProject(null)} />
      )}
      {selectedEmployee && (
        <EmployeeProfileModal employeeId={selectedEmployee} initialTab="overview" onClose={() => setSelectedEmployee(null)} />
      )}
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <div className="p-4 sm:p-6 space-y-6 w-full">
      <StatCardGridSkeleton count={4} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4" />
      <StatCardGridSkeleton count={4} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4" />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="rounded-xl border border-gray-200 bg-white p-4 space-y-3 dark:border-gray-700 dark:bg-gray-900">
          <Skeleton className="h-4 w-40" />
          <ListSkeleton rows={5} />
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-4 space-y-3 dark:border-gray-700 dark:bg-gray-900">
          <Skeleton className="h-4 w-40" />
          <ListSkeleton rows={5} />
        </div>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="rounded-xl border border-gray-200 bg-white p-4 space-y-3 dark:border-gray-700 dark:bg-gray-900">
          <Skeleton className="h-4 w-48" />
          <ListSkeleton rows={5} />
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-4 space-y-3 dark:border-gray-700 dark:bg-gray-900">
          <Skeleton className="h-4 w-40" />
          <ListSkeleton rows={5} />
        </div>
      </div>
      <div className="rounded-xl border border-gray-200 bg-white p-4 space-y-3 dark:border-gray-700 dark:bg-gray-900">
        <Skeleton className="h-4 w-32" />
        <ChartSkeleton height={180} />
      </div>
    </div>
  );
}
