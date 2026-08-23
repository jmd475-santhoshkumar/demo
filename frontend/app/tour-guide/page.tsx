import Link from "next/link";
import {
  LayoutDashboard, Contact, Users, UserCheck, CalendarOff, Sparkles, ShieldAlert,
  TrendingUp, Users2, HeartPulse, Settings, MessageSquare, ArrowRight, Wallet, Layers,
} from "lucide-react";
import { Mascot } from "@/components/shared/Mascot";

interface GuideItem {
  href: string;
  label: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
}

interface GuideGroup {
  label: string;
  items: GuideItem[];
}

const GROUPS: GuideGroup[] = [
  {
    label: "Overview",
    items: [
      { href: "/dashboard", label: "Dashboard", description: "At-a-glance view of headcount, allocations, and project risk across the org.", icon: LayoutDashboard },
    ],
  },
  {
    label: "Allocation",
    items: [
      { href: "/employees", label: "Employees", description: "Search any employee and drill into their skills, competencies, allocations, and timesheet history.", icon: Contact },
      { href: "/allocations", label: "Allocations", description: "Current-state allocation report -- who's on what, utilization bands, allocations ending within 30 days.", icon: Users },
      { href: "/free-pool", label: "Free Pool", description: "Everyone with spare capacity right now, ranked by idle days and idle $/month value.", icon: UserCheck },
      { href: "/leave", label: "Leave", description: "Upcoming leave cross-referenced against active allocations, with same-designation backfill candidates.", icon: CalendarOff },
    ],
  },
  {
    label: "Resourcing",
    items: [
      { href: "/resourcing/deals", label: "Resourcing", description: "Skill-matched staffing recommendations for pipeline deals or any free-text skillset, with full match proof.", icon: Sparkles },
      { href: "/health", label: "Health", description: "Project risk monitor -- root-cause flags (shadow-heavy, high churn, overtime, DevOps extension risk) and relief-staffing suggestions.", icon: ShieldAlert },
      { href: "/clusters", label: "Clusters", description: "Cluster Governance -- replaces the weekly JQA deck. Real Risks, Top Projects, Kick-off/Ending this week, and WSR Status per delivery cluster.", icon: Layers },
      { href: "/budget-approvals", label: "Budget", description: "Real JIN budget-approval workflow -- approved/pending/rejected budgets, resource line items, and planned-vs-actual staffing.", icon: Wallet },
    ],
  },
  {
    label: "Forecast",
    items: [
      { href: "/forecast", label: "Forecast", description: "New-project and revenue-target forecasting, run against your real current bench, not a generic template.", icon: TrendingUp },
      { href: "/forecast/headcount-prediction", label: "Headcount Prediction", description: "Real headcount trend and a trailing-average forecast, with an honest confidence flag when history is thin.", icon: Users2 },
    ],
  },
  {
    label: "More",
    items: [
      { href: "/wellbeing", label: "Wellbeing", description: "Burnout and 'not happy' signals for projects and employees, in one place.", icon: HeartPulse },
      { href: "/buddy", label: "Buddy", description: "AI copilot with real, read-only access to every engine in this app -- ask it anything about staffing, risk, or the pipeline.", icon: Mascot },
      { href: "/settings", label: "Settings", description: "Data source connection status and manual dataset uploads (skill matrix, competency, pipeline data).", icon: Settings },
      { href: "/feedback", label: "Feedback", description: "Tell us what's working, what's broken, or what you'd like to see next.", icon: MessageSquare },
    ],
  },
];

export default function TourGuidePage() {
  return (
    <div className="p-4 sm:p-6 max-w-3xl mx-auto space-y-6">
      <div>
        <h2 className="text-base font-semibold text-gray-800 dark:text-gray-200">Tour Guide</h2>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">A quick map of what's where in ResourceIQ.</p>
      </div>

      {GROUPS.map((group) => (
        <div key={group.label} className="space-y-2.5">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500">{group.label}</p>
          <div className="space-y-2">
            {group.items.map((item) => {
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className="flex items-center gap-3 rounded-xl border border-gray-200 bg-white p-3.5 hover:border-primary/40 hover:shadow-sm transition group dark:border-gray-700 dark:bg-gray-900"
                >
                  <div className="w-9 h-9 rounded-lg bg-gray-50 flex items-center justify-center flex-shrink-0 text-gray-500 dark:bg-gray-800/60 dark:text-gray-400">
                    <Icon className="w-4.5 h-4.5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-gray-800 dark:text-gray-200">{item.label}</p>
                    <p className="text-[11px] text-gray-500 dark:text-gray-400">{item.description}</p>
                  </div>
                  <ArrowRight className="w-4 h-4 text-gray-300 dark:text-gray-600 group-hover:text-gray-400 dark:group-hover:text-gray-500 group-hover:translate-x-0.5 transition flex-shrink-0" />
                </Link>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
