"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  HeartPulse,
  ChevronRight,
  Flame,
  Users,
  HandHeart,
  ShieldCheck,
  TrendingUp,
  Smile,
  Sparkles,
  PartyPopper,
} from "lucide-react";
import { api, type BurnoutOvertimeEmployee, type HealthProject, type NotHappyEmployee } from "@/lib/api";
import { ErrorState } from "@/components/shared/EmptyState";
import { TableSkeleton } from "@/components/shared/Skeleton";
import { TableControls } from "@/components/shared/TableControls";
import { ProjectHealthDetailModal } from "@/components/health/ProjectHealthDetailModal";
import { EmployeeProfileModal } from "@/components/shared/EmployeeProfileModal";
import { cn } from "@/lib/utils";

type WellbeingTab = "projects" | "employees";
type ProjectSignal = "all" | "overtime" | "understaffed" | "healthy";
type ProjectSort = "support_desc" | "overtime_desc" | "project_asc";
type EmployeeSort = "hours_desc" | "days_desc" | "employee_asc";
type EmployeeSignal = "overtime" | "not_happy";

// Plain-language, people-first framing -- this page is about support, not risk
// classification (that's what the Health page is for).
function supportReason(r: HealthProject): string {
  const parts: string[] = [];
  if (r.root_causes.includes("overtime_risk")) {
    parts.push(`${r.overtime_employee_count} ${r.overtime_employee_count === 1 ? "person" : "people"} in sustained overtime`);
  }
  if (r.root_causes.includes("understaffed")) {
    const gap = r.expected_headcount != null ? Math.max(0, r.expected_headcount - r.n_employees) : null;
    parts.push(gap != null && gap > 0 ? `short ${gap} ${gap === 1 ? "person" : "people"}` : "team is short-staffed");
  }
  return parts.join(" · ");
}

function HeroBanner() {
  return (
    <div
      className="relative overflow-hidden rounded-2xl p-6 sm:p-8 text-white shadow-sm"
      style={{ background: "linear-gradient(135deg, hsl(var(--primary)) 0%, #C30D5C 100%)" }}
    >
      <HeartPulse className="absolute -right-6 -top-8 w-44 h-44 text-white/10 rotate-12" strokeWidth={1} />
      <Sparkles className="absolute right-24 bottom-2 w-10 h-10 text-white/10" strokeWidth={1} />
      <div className="relative z-10 flex items-start gap-3.5">
        <div className="w-11 h-11 rounded-2xl bg-white/15 backdrop-blur flex items-center justify-center flex-shrink-0">
          <HeartPulse className="w-6 h-6" />
        </div>
        <div>
          <h1 className="text-xl font-bold tracking-tight">Wellbeing</h1>
          <p className="font-serif text-base text-white/90 mt-1.5 italic tracking-wide max-w-xl">
            &ldquo;Happy people. Happy clients. A company that grows.&rdquo;
          </p>
        </div>
      </div>
      <div className="relative z-10 flex flex-wrap gap-2 mt-5">
        {[
          [Smile, "Employee wellbeing"],
          [ShieldCheck, "Healthy projects"],
          [TrendingUp, "Company growth"],
        ].map(([Icon, label]) => {
          const I = Icon as typeof Smile;
          return (
            <span
              key={label as string}
              className="inline-flex items-center gap-1.5 text-[11px] font-medium px-2.5 py-1 rounded-full bg-white/10 border border-white/20"
            >
              <I className="w-3 h-3" /> {label as string}
            </span>
          );
        })}
      </div>
    </div>
  );
}

function WellbeingTile({
  icon: Icon,
  label,
  value,
  sub,
  theme,
  onClick,
  active,
}: {
  icon: typeof Smile;
  label: string;
  value: number | string;
  sub?: string;
  theme: "rose" | "red" | "violet" | "emerald";
  onClick?: () => void;
  active?: boolean;
}) {
  const themes = {
    rose: {
      bg: "bg-gradient-to-br from-jman-rose-50 to-white border-jman-rose-100 dark:from-jman-rose-500/10 dark:to-gray-900 dark:border-jman-rose-500/30",
      iconBg: "bg-jman-rose-500",
      decor: "text-jman-rose-100 dark:text-jman-rose-500/20",
      value: "text-jman-rose-700 dark:text-jman-rose-500",
      ring: "ring-2 ring-jman-rose-500",
    },
    red: {
      bg: "bg-gradient-to-br from-red-50 to-white border-red-100 dark:from-red-950/40 dark:to-gray-900 dark:border-red-800/60",
      iconBg: "bg-red-500",
      decor: "text-red-100 dark:text-red-900/40",
      value: "text-red-700 dark:text-red-400",
      ring: "ring-2 ring-red-300 dark:ring-red-700",
    },
    violet: {
      bg: "bg-gradient-to-br from-violet-50 to-white border-violet-100 dark:from-violet-950/40 dark:to-gray-900 dark:border-violet-800/60",
      iconBg: "bg-violet-500",
      decor: "text-violet-100 dark:text-violet-900/40",
      value: "text-violet-700 dark:text-violet-400",
      ring: "ring-2 ring-violet-300 dark:ring-violet-700",
    },
    emerald: {
      bg: "bg-gradient-to-br from-emerald-50 to-white border-emerald-100 dark:from-emerald-950/40 dark:to-gray-900 dark:border-emerald-800/60",
      iconBg: "bg-emerald-500",
      decor: "text-emerald-100 dark:text-emerald-900/40",
      value: "text-emerald-700 dark:text-emerald-400",
      ring: "ring-2 ring-emerald-300 dark:ring-emerald-700",
    },
  }[theme];

  const Wrapper = onClick ? "button" : "div";
  return (
    <Wrapper
      type={onClick ? "button" : undefined}
      onClick={onClick}
      className={cn(
        "relative overflow-hidden rounded-2xl border p-4 text-left transition",
        themes.bg,
        onClick && "hover:shadow-md cursor-pointer w-full",
        active && themes.ring
      )}
    >
      <Icon className={cn("absolute -right-3 -bottom-3 w-20 h-20", themes.decor)} strokeWidth={1.5} />
      <div className="relative z-10">
        <div className={cn("w-9 h-9 rounded-xl flex items-center justify-center mb-2.5", themes.iconBg)}>
          <Icon className="w-4.5 h-4.5 text-white" />
        </div>
        <p className={cn("text-2xl font-bold leading-tight", themes.value)}>{value}</p>
        <p className="text-xs font-semibold text-gray-700 dark:text-gray-300 mt-0.5">{label}</p>
        {sub && <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-0.5">{sub}</p>}
      </div>
    </Wrapper>
  );
}

function AllClearCard({ icon: Icon, message }: { icon: typeof Sparkles; message: string }) {
  return (
    <div className="rounded-2xl border border-emerald-100 dark:border-emerald-800/60 bg-gradient-to-br from-emerald-50 to-white dark:from-emerald-950/40 dark:to-gray-900 p-6 text-center">
      <div className="w-12 h-12 rounded-2xl bg-emerald-500 flex items-center justify-center mx-auto mb-3">
        <Icon className="w-6 h-6 text-white" />
      </div>
      <p className="text-sm font-semibold text-emerald-800 dark:text-emerald-400">{message}</p>
    </div>
  );
}

function ProjectsTab() {
  const overview = useQuery({ queryKey: ["wellbeing-projects"], queryFn: api.projectBurnoutOverview });
  const healthProjects = useQuery({ queryKey: ["health-projects"], queryFn: api.healthProjects });
  const [search, setSearch] = useState("");
  const [signal, setSignal] = useState<ProjectSignal>("all");
  const [sort, setSort] = useState<ProjectSort>("support_desc");
  const [selectedProject, setSelectedProject] = useState<string | null>(null);

  if (overview.isLoading) return <TableSkeleton columns={6} rows={6} />;
  if (overview.error || !overview.data) return <ErrorState message="Could not load project burnout data." />;

  const totalActive = healthProjects.data?.length;
  const healthyCount = totalActive != null ? Math.max(0, totalActive - overview.data.total_flagged) : null;

  const flaggedCodes = new Set(overview.data.projects.map((r) => r.project_code));
  let rows = signal === "healthy" ? (healthProjects.data ?? []).filter((r) => !flaggedCodes.has(r.project_code)) : overview.data.projects;
  const q = search.trim().toLowerCase();
  if (q) {
    rows = rows.filter((r) => r.project_code.toLowerCase().includes(q) || (r.client_id ?? "").toLowerCase().includes(q));
  }
  if (signal === "overtime" || signal === "understaffed") {
    rows = rows.filter((r) => (signal === "overtime" ? r.root_causes.includes("overtime_risk") : r.root_causes.includes("understaffed")));
  }
  rows = [...rows];
  switch (sort) {
    case "support_desc": rows.sort((a, b) => b.risk_score - a.risk_score); break;
    case "overtime_desc": rows.sort((a, b) => b.overtime_employee_count - a.overtime_employee_count); break;
    case "project_asc": rows.sort((a, b) => a.project_code.localeCompare(b.project_code)); break;
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <WellbeingTile
          icon={HandHeart}
          label="Projects That Could Use Support"
          value={overview.data.total_flagged}
          sub="overworked and/or short-staffed teams"
          theme="rose"
          onClick={() => setSignal("all")}
          active={signal === "all"}
        />
        <WellbeingTile
          icon={Flame}
          label="Sustained Overtime"
          value={overview.data.overtime_count}
          theme="red"
          onClick={() => setSignal(signal === "overtime" ? "all" : "overtime")}
          active={signal === "overtime"}
        />
        <WellbeingTile
          icon={Users}
          label="Short-Staffed"
          value={overview.data.understaffed_count}
          theme="violet"
          onClick={() => setSignal(signal === "understaffed" ? "all" : "understaffed")}
          active={signal === "understaffed"}
        />
        {healthyCount != null && (
          <WellbeingTile
            icon={ShieldCheck}
            label="Projects Running Healthy"
            value={`${healthyCount}/${totalActive}`}
            sub="no support needed right now"
            theme="emerald"
            onClick={() => setSignal(signal === "healthy" ? "all" : "healthy")}
            active={signal === "healthy"}
          />
        )}
      </div>

      {overview.data.total_flagged === 0 && signal !== "healthy" ? (
        <AllClearCard icon={PartyPopper} message="Every active project is running within healthy thresholds right now." />
      ) : (
        <>
          <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-3 space-y-2.5">
            <p className="text-xs font-semibold text-gray-700 dark:text-gray-300">
              {signal === "healthy" ? `Projects Running Healthy (${rows.length})` : `Teams That Could Use Support (${rows.length}/${overview.data.total_flagged})`}
            </p>
            <TableControls
              search={{ value: search, onChange: setSearch, placeholder: "Search project or client…" }}
              sort={{
                value: sort,
                onChange: (v) => setSort(v as ProjectSort),
                options: [
                  ["support_desc", "Needs support most"],
                  ["overtime_desc", "Most overtime employees"],
                  ["project_asc", "Project A–Z"],
                ],
              }}
            />
          </div>

          <div className="rounded-xl border border-jman-rose-100 dark:border-jman-rose-500/30 bg-white dark:bg-gray-900 overflow-hidden">
            <div className="overflow-x-auto">
            <table className="w-full text-xs data-table">
              <thead className="bg-gradient-to-r from-[hsl(var(--primary)/0.06)] to-jman-rose-50 dark:to-jman-rose-500/10 text-gray-600 dark:text-gray-400">
                <tr>
                  {["Project", "Client", "Why Support Helps", "Overtime Staff", "Team Size", ""].map((h) => (
                    <th key={h} className="text-left font-medium px-3 py-2 whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr
                    key={r.project_code}
                    className="border-b border-gray-50 dark:border-gray-800 last:border-0 hover:bg-jman-rose-50/40 dark:hover:bg-jman-rose-500/10 cursor-pointer transition"
                    onClick={() => setSelectedProject(r.project_code)}
                  >
                    <td className="px-3 py-2 font-medium text-primary whitespace-nowrap">{r.project_code}</td>
                    <td className="px-3 py-2 text-gray-500 dark:text-gray-400 whitespace-nowrap">{r.client_id ?? "-"}</td>
                    <td className="px-3 py-2 text-gray-500 dark:text-gray-400">{signal === "healthy" ? "No active risk signals" : supportReason(r)}</td>
                    <td className="px-3 py-2 text-gray-500 dark:text-gray-400 whitespace-nowrap">{r.overtime_employee_count}</td>
                    <td className="px-3 py-2 text-gray-500 dark:text-gray-400 whitespace-nowrap">{r.n_employees} / {r.expected_headcount ?? "?"}</td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      <span className="inline-flex items-center gap-1 text-[11px] font-medium text-jman-rose-700 dark:text-jman-rose-500 bg-jman-rose-50 dark:bg-jman-rose-500/10 border border-jman-rose-100 dark:border-jman-rose-500/30 rounded-full px-2.5 py-1">
                        <HandHeart className="w-3 h-3" /> {signal === "healthy" ? "View project" : "Support options"} <ChevronRight className="w-3 h-3" />
                      </span>
                    </td>
                  </tr>
                ))}
                {rows.length === 0 && (
                  <tr><td colSpan={6} className="px-3 py-6 text-center text-gray-400 dark:text-gray-500 italic">No projects match the current filters.</td></tr>
                )}
              </tbody>
            </table>
            </div>
          </div>
        </>
      )}

      {selectedProject && (
        <ProjectHealthDetailModal projectCode={selectedProject} initialTab="relief" onClose={() => setSelectedProject(null)} />
      )}
    </div>
  );
}

function OvertimeEmployeeCard({
  e,
  onSelect,
  onSupport,
}: {
  e: BurnoutOvertimeEmployee;
  onSelect: (id: string) => void;
  onSupport: (projectCode: string) => void;
}) {
  const topProject = e.recent_projects[0];
  return (
    <div className="rounded-xl border-2 border-red-200 dark:border-red-800/60 bg-white dark:bg-gray-900 p-3">
      <div className="flex items-center justify-between mb-2 flex-wrap gap-1">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-7 h-7 rounded-full bg-red-50 dark:bg-red-950/40 flex items-center justify-center flex-shrink-0">
            <Flame className="w-3.5 h-3.5 text-red-500" />
          </div>
          <button onClick={() => onSelect(e.employee_id)} className="text-xs font-medium text-primary hover:underline truncate">
            {e.employee_id} — {e.job_name ?? "Employee"}
          </button>
        </div>
        <div className="flex items-center gap-1.5">
          <p className="text-[11px] text-gray-400 dark:text-gray-500">{e.overtime_days_recent} overtime day(s) · max {e.max_daily_hours_recent}h</p>
        </div>
      </div>
      {e.department_name && <p className="text-[11px] text-gray-400 dark:text-gray-500 mb-1.5 ml-9">{e.department_name}</p>}
      <div className="flex gap-1.5 flex-wrap ml-9">
        {e.daily_hours.map((dh) => (
          <span
            key={dh.date}
            title={dh.date}
            className={cn(
              "text-[10px] px-1.5 py-0.5 rounded-full border whitespace-nowrap",
              dh.is_overtime ? "bg-red-50 border-red-200 text-red-700 dark:bg-red-950/40 dark:border-red-800/60 dark:text-red-400" : "bg-gray-50 border-gray-200 text-gray-500 dark:bg-gray-800/60 dark:border-gray-700 dark:text-gray-400"
            )}
          >
            {dh.date.slice(5)}: {dh.hours}h
          </span>
        ))}
      </div>
      {topProject && (
        <div className="mt-2.5 pt-2.5 border-t border-gray-50 dark:border-gray-800 flex items-center justify-between flex-wrap gap-1.5 ml-9">
          <p className="text-[11px] text-gray-400 dark:text-gray-500">
            Mostly working on <span className="font-medium text-gray-600 dark:text-gray-400">{topProject.project_id}</span> ({topProject.hours_recent}h recently)
          </p>
          {topProject.needs_support && (
            <button
              onClick={() => onSupport(topProject.project_id)}
              className="inline-flex items-center gap-1 text-[11px] font-medium text-jman-rose-700 dark:text-jman-rose-500 bg-jman-rose-50 dark:bg-jman-rose-500/10 border border-jman-rose-100 dark:border-jman-rose-500/30 rounded-full px-2.5 py-1 hover:bg-jman-rose-100 dark:hover:bg-jman-rose-500/20 transition"
            >
              <HandHeart className="w-3 h-3" /> Bring relief to {topProject.project_id}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function NotHappyCard({ e, onSelect }: { e: NotHappyEmployee; onSelect: (id: string) => void }) {
  return (
    <div className="rounded-lg border border-purple-200 dark:border-purple-800/60 bg-white dark:bg-gray-900 px-3 py-2 flex items-center gap-2">
      <HeartPulse className="w-3.5 h-3.5 text-purple-500 flex-shrink-0" />
      <button onClick={() => onSelect(e.employee_id)} className="text-xs font-medium text-primary hover:underline truncate">
        {e.employee_id} — {e.job_name ?? "Employee"}
      </button>
    </div>
  );
}

function EmployeesTab() {
  const overview = useQuery({ queryKey: ["wellbeing-employees"], queryFn: api.employeeBurnoutOverview });
  const [signal, setSignal] = useState<EmployeeSignal>("overtime");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<EmployeeSort>("hours_desc");
  const [selectedEmployee, setSelectedEmployee] = useState<string | null>(null);
  const [selectedProject, setSelectedProject] = useState<string | null>(null);

  if (overview.isLoading) return <TableSkeleton columns={4} rows={6} />;
  if (overview.error || !overview.data) return <ErrorState message="Could not load employee burnout data." />;

  let employees = overview.data.overtime_employees;
  const q = search.trim().toLowerCase();
  if (q) employees = employees.filter((e) => e.employee_id.toLowerCase().includes(q) || (e.job_name ?? "").toLowerCase().includes(q));
  employees = [...employees];
  switch (sort) {
    case "hours_desc": employees.sort((a, b) => b.max_daily_hours_recent - a.max_daily_hours_recent); break;
    case "days_desc": employees.sort((a, b) => b.overtime_days_recent - a.overtime_days_recent); break;
    case "employee_asc": employees.sort((a, b) => a.employee_id.localeCompare(b.employee_id)); break;
  }

  let notHappy = overview.data.not_happy_employees;
  if (q) notHappy = notHappy.filter((e) => e.employee_id.toLowerCase().includes(q) || (e.job_name ?? "").toLowerCase().includes(q));

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <WellbeingTile
          icon={Flame}
          label="Sustained Overtime"
          value={overview.data.overtime_employee_count}
          sub="≥11h logged on 4+ of the trailing 14 days"
          theme="red"
          onClick={() => setSignal("overtime")}
          active={signal === "overtime"}
        />
        <WellbeingTile
          icon={HeartPulse}
          label="Not Happy"
          value={overview.data.not_happy_count}
          sub="Disagreed on project fit/support/workload, last 4wks"
          theme="rose"
          onClick={() => setSignal("not_happy")}
          active={signal === "not_happy"}
        />
      </div>

      {signal === "overtime" ? (
        overview.data.overtime_employee_count === 0 ? (
          <AllClearCard icon={Sparkles} message="No one is in sustained overtime right now -- a great sign for the team." />
        ) : (
          <>
            <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-3 space-y-2.5">
              <p className="text-xs font-semibold text-gray-700 dark:text-gray-300">Sustained Overtime ({employees.length})</p>
              <TableControls
                search={{ value: search, onChange: setSearch, placeholder: "Search employee ID or role…" }}
                sort={{
                  value: sort,
                  onChange: (v) => setSort(v as EmployeeSort),
                  options: [
                    ["hours_desc", "Max daily hours ↓"],
                    ["days_desc", "Overtime days ↓"],
                    ["employee_asc", "Employee A–Z"],
                  ],
                }}
              />
            </div>

            <div className="space-y-2.5">
              {employees.map((e) => (
                <OvertimeEmployeeCard key={e.employee_id} e={e} onSelect={setSelectedEmployee} onSupport={setSelectedProject} />
              ))}
              {employees.length === 0 && <p className="text-xs text-gray-400 dark:text-gray-500 italic text-center py-4">No employees match the current search.</p>}
            </div>
          </>
        )
      ) : overview.data.not_happy_count === 0 ? (
        <AllClearCard icon={Sparkles} message="No one has flagged as not happy in the last 4 weeks -- a great sign for the team." />
      ) : (
        <>
          <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-3 space-y-2.5">
            <p className="text-xs font-semibold text-gray-700 dark:text-gray-300">Not Happy ({notHappy.length})</p>
            <TableControls search={{ value: search, onChange: setSearch, placeholder: "Search employee ID or role…" }} />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {notHappy.map((e) => (
              <NotHappyCard key={e.employee_id} e={e} onSelect={setSelectedEmployee} />
            ))}
            {notHappy.length === 0 && <p className="text-xs text-gray-400 dark:text-gray-500 italic text-center py-4 col-span-2">No employees match the current search.</p>}
          </div>
        </>
      )}

      {selectedEmployee && (
        <EmployeeProfileModal employeeId={selectedEmployee} initialTab="overtime" onClose={() => setSelectedEmployee(null)} />
      )}
      {selectedProject && (
        <ProjectHealthDetailModal projectCode={selectedProject} initialTab="relief" onClose={() => setSelectedProject(null)} />
      )}
    </div>
  );
}

export default function WellbeingPage() {
  const [tab, setTab] = useState<WellbeingTab>("projects");

  return (
    <div className="p-4 sm:p-6 w-full space-y-5 bg-gradient-to-b from-jman-rose-50/40 dark:from-jman-rose-500/10 via-transparent to-transparent">
      <HeroBanner />

      <div className="inline-flex items-center gap-1 p-1 rounded-full bg-gray-100 dark:bg-gray-800">
        {(
          [
            ["projects", "Project Burnout", ShieldCheck],
            ["employees", "Employee Burnout", Smile],
          ] as [WellbeingTab, string, typeof Smile][]
        ).map(([key, label, Icon]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={cn(
              "flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-medium transition",
              tab === key ? "bg-white dark:bg-gray-700 text-primary shadow-sm" : "text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
            )}
          >
            <Icon className="w-3.5 h-3.5" />
            {label}
          </button>
        ))}
      </div>

      {tab === "projects" ? <ProjectsTab /> : <EmployeesTab />}
    </div>
  );
}
