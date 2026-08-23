"use client";

import { usePathname, useRouter } from "next/navigation";
import { Menu, HeartPulse, LogOut } from "lucide-react";
import { useSidebarContext } from "@/components/layout/SidebarContext";
import { useAuthUser } from "@/components/layout/AuthGate";
import { logout } from "@/lib/api";

const TITLES: Record<string, string> = {
  "/dashboard": "Dashboard",
  "/allocations": "Current-State Allocation Report",
  "/free-pool": "Free Pool",
  "/leave": "Leave Impact",
  "/resourcing": "RMG",
  "/resourcing/deals": "Resourcing",
  "/health": "Project Health & Efficiency Monitor",
  "/clusters": "Cluster Governance",
  "/budget-approvals": "Budget",
  "/forecast": "Forecast",
  "/buddy": "Buddy",
  "/wellbeing": "Wellbeing",
  "/settings": "Settings",
  "/tour-guide": "Tour Guide",
  "/feedback": "Feedback",
};

export function Topbar() {
  const pathname = usePathname();
  const router = useRouter();
  // Exact match first (covers every static route); dynamic routes like
  // /resourcing/[dealKey] fall back to their nearest static ancestor so the
  // title doesn't blank out to "ResourceIQ" while inside a deal's wizard.
  const title = TITLES[pathname] ?? Object.entries(TITLES).find(([path]) => pathname.startsWith(`${path}/`))?.[1] ?? "ResourceIQ";
  const { setMobileOpen } = useSidebarContext();
  const onWellbeing = pathname === "/wellbeing";
  const user = useAuthUser();

  const handleLogout = async () => {
    await logout();
    window.location.href = "/login";
  };

  return (
    <header className="h-14 border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 flex items-center px-3 sm:px-6 gap-3 sm:gap-4 flex-shrink-0">
      <button
        onClick={() => setMobileOpen(true)}
        className="md:hidden flex-shrink-0 p-1.5 -ml-1 rounded-lg text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition"
        title="Open menu"
      >
        <Menu className="w-5 h-5" />
      </button>
      <h1 className="text-sm font-semibold text-gray-700 dark:text-gray-300 truncate">{title}</h1>
      <div className="flex-1" />
      <button
        onClick={() => router.push("/wellbeing")}
        title="Wellbeing — project & employee burnout, in one place"
        className="relative flex-shrink-0 p-1.5 rounded-full transition hover:bg-pink-50 dark:hover:bg-pink-950/30"
      >
        {!onWellbeing && (
          <span
            className="absolute inset-0 rounded-full animate-ping"
            style={{ backgroundColor: "rgba(255, 97, 150, 0.35)" }}
            aria-hidden="true"
          />
        )}
        <HeartPulse className="w-5 h-5 relative" style={{ color: "#FF6196" }} />
      </button>
      {user && (
        <div className="flex items-center gap-2 pl-2 sm:pl-3 border-l border-gray-200 dark:border-gray-800">
          <div className="hidden sm:flex flex-col items-end leading-tight">
            <span className="text-xs font-semibold text-gray-700 dark:text-gray-300 truncate max-w-[140px]">
              {user.name ?? user.email}
            </span>
            {user.name && (
              <span className="text-[11px] text-gray-400 dark:text-gray-500 truncate max-w-[140px]">
                {user.email}
              </span>
            )}
          </div>
          <button
            onClick={handleLogout}
            title="Sign out"
            className="flex-shrink-0 p-1.5 rounded-full text-gray-400 dark:text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800 hover:text-gray-600 dark:hover:text-gray-300 transition"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      )}
    </header>
  );
}
