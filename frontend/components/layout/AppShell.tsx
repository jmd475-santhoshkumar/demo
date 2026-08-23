"use client";

import { usePathname } from "next/navigation";
import { Sidebar } from "@/components/layout/Sidebar";
import { Topbar } from "@/components/layout/Topbar";
import { SidebarProvider } from "@/components/layout/SidebarContext";
import { AuthGate } from "@/components/layout/AuthGate";

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  // The login page renders its own full-bleed layout -- no sidebar/topbar,
  // and no auth check (that would redirect it right back to itself).
  if (pathname === "/login") {
    return <>{children}</>;
  }

  return (
    <AuthGate>
      <SidebarProvider>
        <div className="flex h-[100dvh] overflow-hidden">
          <Sidebar />
          <div className="flex-1 flex flex-col min-w-0">
            <Topbar />
            <main className="flex-1 overflow-y-auto scrollbar-thin">{children}</main>
          </div>
        </div>
      </SidebarProvider>
    </AuthGate>
  );
}
