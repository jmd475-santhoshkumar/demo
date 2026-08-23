"use client";

import Link from "next/link";
import { createPortal } from "react-dom";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  LayoutDashboard, Users, Contact, Sparkles, ShieldAlert, TrendingUp, UserCheck, CalendarOff,
  ChevronLeft, ChevronRight, X, Users2, Settings, Compass, MessageSquare, Wallet, Layers,
} from "lucide-react";
import Image from "next/image";
import { cn } from "@/lib/utils";
import { Mascot } from "@/components/shared/Mascot";
import { useSidebarContext } from "@/components/layout/SidebarContext";

type NavChild = { label: string; href: string; icon: React.ComponentType<{ className?: string }> };
// A nav entry is either a direct link (href) or a hover/click flyout parent
// (children) -- never both, matching the real JIN sidebar's "Human
// Resources"-style expandable groups (no page of their own, just a submenu).
type NavLinkSpec =
  | { label: string; href: string; icon: React.ComponentType<{ className?: string }>; children?: undefined }
  | { label: string; href?: undefined; icon: React.ComponentType<{ className?: string }>; children: NavChild[] };

const TOP_LINK: Extract<NavLinkSpec, { href: string }> = { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard };

const NAV_GROUPS: { label: string; links: NavLinkSpec[] }[] = [
  {
    label: "Allocation",
    links: [
      { label: "Employees", href: "/employees", icon: Contact },
      { label: "Allocations", href: "/allocations", icon: Users },
      { label: "Free Pool", href: "/free-pool", icon: UserCheck },
      { label: "Leave", href: "/leave", icon: CalendarOff },
    ],
  },
  {
    label: "Resourcing",
    links: [
      {
        label: "RMG",
        icon: Sparkles,
        children: [
          { label: "Resourcing", href: "/resourcing/deals", icon: Sparkles },
          { label: "Budget", href: "/budget-approvals", icon: Wallet },
        ],
      },
      {
        label: "Governance",
        icon: ShieldAlert,
        children: [
          { label: "Health", href: "/health", icon: ShieldAlert },
          { label: "Clusters", href: "/clusters", icon: Layers },
        ],
      },
    ],
  },
  {
    label: "Forecast",
    links: [
      { label: "Forecast", href: "/forecast", icon: TrendingUp },
      { label: "Headcount Prediction", href: "/forecast/headcount-prediction", icon: Users2 },
    ],
  },
];

// Plain `pathname.startsWith(href)` lets a shorter route (e.g. "/forecast")
// match as active even when the real current route is a more specific child
// of it (e.g. "/forecast/headcount-prediction") -- highlighting both links at
// once. Only the single longest href that's a real path-segment match (exact,
// or followed by "/") counts as active.
function isRouteActive(pathname: string, href: string, allHrefs: string[]): boolean {
  const matches = (h: string) => pathname === h || pathname.startsWith(h + "/");
  if (!matches(href)) return false;
  const longestMatch = allHrefs.filter(matches).sort((a, b) => b.length - a.length)[0];
  return href === longestMatch;
}

function SectionLabel({ children, collapsed }: { children: React.ReactNode; collapsed: boolean }) {
  if (collapsed) return null;
  return (
    <div className="px-3 pt-3 pb-1">
      <span className="text-[9px] font-bold tracking-widest uppercase text-sidebar-foreground select-none">{children}</span>
    </div>
  );
}

function NavLink({ link, open, isActive }: { link: Extract<NavLinkSpec, { href: string }>; open: boolean; isActive: boolean }) {
  const Icon = link.icon;
  return (
    <Link
      href={link.href}
      title={open ? undefined : link.label}
      className={cn(
        "flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-medium transition-colors",
        open ? "justify-start" : "justify-center",
        !isActive && "text-sidebar-foreground hover:text-sidebar-foreground hover:bg-sidebar-accent"
      )}
      style={
        isActive
          ? { backgroundColor: "hsl(var(--primary) / 0.10)", color: "hsl(var(--primary))", fontWeight: 600, borderLeft: "1px solid hsl(var(--primary))" }
          : {}
      }
    >
      <Icon className="w-3.5 h-3.5 flex-shrink-0" />
      {open && <span>{link.label}</span>}
    </Link>
  );
}

// Hover (desktop) or click (touch/accessibility) flyout of child links, next
// to the trigger -- mirrors the real JIN sidebar's "Human Resources"-style
// expandable groups (a parent with no page of its own). Rendered via a portal
// into document.body and positioned with `fixed` coordinates from the
// trigger's own bounding rect, same technique as SearchableSelect.tsx: the
// nav's own `overflow-y-auto` forces `overflow-x` to clip too (per the CSS
// overflow spec, an axis left at its 'visible' default gets forced to 'auto'
// once the other axis isn't 'visible'), which would otherwise cut the flyout
// off before it ever reaches the main content area.
function NavParent({
  link, open, isActive, pathname,
}: {
  link: Extract<NavLinkSpec, { children: NavChild[] }>;
  open: boolean;
  isActive: boolean;
  pathname: string;
}) {
  const [flyoutOpen, setFlyoutOpen] = useState(false);
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const Icon = link.icon;

  function updateCoords() {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (rect) setCoords({ top: rect.top, left: rect.right + 8 });
  }
  function openFlyout() {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
    updateCoords();
    setFlyoutOpen(true);
  }
  // Small delay so moving the cursor from the trigger to the flyout panel
  // (there's a gap between them) doesn't close it mid-move.
  function scheduleClose() {
    closeTimer.current = setTimeout(() => setFlyoutOpen(false), 150);
  }

  useEffect(() => {
    if (!flyoutOpen) return;
    function onClickOutside(e: MouseEvent) {
      const target = e.target as Node;
      if (triggerRef.current?.contains(target)) return;
      if (panelRef.current?.contains(target)) return;
      setFlyoutOpen(false);
    }
    function onReposition() {
      updateCoords();
    }
    document.addEventListener("mousedown", onClickOutside);
    window.addEventListener("scroll", onReposition, true);
    window.addEventListener("resize", onReposition);
    return () => {
      document.removeEventListener("mousedown", onClickOutside);
      window.removeEventListener("scroll", onReposition, true);
      window.removeEventListener("resize", onReposition);
    };
  }, [flyoutOpen]);

  useEffect(() => () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
  }, []);

  return (
    <div className="relative" onMouseEnter={openFlyout} onMouseLeave={scheduleClose}>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => (flyoutOpen ? setFlyoutOpen(false) : openFlyout())}
        title={open ? undefined : link.label}
        className={cn(
          "w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-medium transition-colors",
          open ? "justify-between" : "justify-center",
          !isActive && "text-sidebar-foreground hover:text-sidebar-foreground hover:bg-sidebar-accent"
        )}
        style={
          isActive
            ? { backgroundColor: "hsl(var(--primary) / 0.10)", color: "hsl(var(--primary))", fontWeight: 600, borderLeft: "1px solid hsl(var(--primary))" }
            : {}
        }
      >
        <span className="flex items-center gap-2.5">
          <Icon className="w-3.5 h-3.5 flex-shrink-0" />
          {open && <span>{link.label}</span>}
        </span>
        {open && <ChevronRight className="w-3 h-3 flex-shrink-0 opacity-60" />}
      </button>

      {flyoutOpen && coords && typeof document !== "undefined" && createPortal(
        <div
          ref={panelRef}
          onMouseEnter={openFlyout}
          onMouseLeave={scheduleClose}
          style={{ position: "fixed", top: coords.top, left: coords.left }}
          className="z-[60] min-w-[170px] rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 shadow-lg py-1.5 overflow-hidden"
        >
          {link.children.map((child) => {
            const ChildIcon = child.icon;
            const childActive = pathname === child.href || pathname.startsWith(child.href + "/");
            return (
              <Link
                key={child.href}
                href={child.href}
                onClick={() => setFlyoutOpen(false)}
                className="flex items-center gap-2.5 px-3 py-2 text-xs font-medium transition-colors hover:bg-gray-50 dark:hover:bg-gray-800"
                style={childActive ? { color: "hsl(var(--primary))", fontWeight: 600 } : undefined}
              >
                <ChildIcon className={cn("w-3.5 h-3.5 flex-shrink-0", !childActive && "text-gray-400 dark:text-gray-500")} />
                {child.label}
              </Link>
            );
          })}
        </div>,
        document.body
      )}
    </div>
  );
}

function PersonGlyph({ x, y, scale = 1 }: { x: number; y: number; scale?: number }) {
  return (
    <g transform={`translate(${x},${y}) scale(${scale})`}>
      <circle cx="0" cy="-5" r="3.4" fill="#ff6196" />
      <path d="M -6 10 C -6 2 6 2 6 10 Z" fill="#ff6196" />
    </g>
  );
}

function SidebarBackground() {
  return (
    <svg className="absolute left-0 right-0 top-14 bottom-0 w-full pointer-events-none" viewBox="0 0 256 844" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <defs>
        <style>{`
          @keyframes sfloat1 { 0%,100%{transform:translateY(0px)} 50%{transform:translateY(-14px)} }
          @keyframes sfloat2 { 0%,100%{transform:translateY(0px)} 50%{transform:translateY(-10px)} }
          @keyframes sfloat3 { 0%,100%{transform:translateY(0px)} 50%{transform:translateY(-8px)} }
          @keyframes sdash   { to { stroke-dashoffset: -32; } }
          @keyframes sspin   { to { transform: rotate(360deg); } }
          .sf1 { animation: sfloat1 7s ease-in-out infinite; }
          .sf2 { animation: sfloat2 9s ease-in-out infinite 1.2s; }
          .sf3 { animation: sfloat3 8s ease-in-out infinite 0.6s; }
          .sline { stroke-dasharray: 4 4; animation: sdash 3s linear infinite; }
          .sring { transform-origin: center; animation: sspin 16s linear infinite; }
        `}</style>
      </defs>

      {}
      <g transform="translate(20,70)" opacity="0.10">
        <g className="sf2">
          <PersonGlyph x={0} y={0} />
          <PersonGlyph x={16} y={-6} scale={0.85} />
          <PersonGlyph x={32} y={2} scale={0.9} />
        </g>
      </g>

      {}
      <g transform="translate(150,40)" opacity="0.09">
        <g className="sf1">
          <rect x="0" y="0" width="70" height="7" rx="3.5" fill="#ff6196" />
          <rect x="14" y="14" width="50" height="7" rx="3.5" fill="#ff6196" />
          <rect x="4" y="28" width="60" height="7" rx="3.5" fill="#ff6196"/>
        </g>
      </g>

      {}
      <g transform="translate(45,280)" opacity="0.10">
        <g className="sring">
          <circle r="22" fill="none" stroke="#ff6196" strokeWidth="5" opacity="0.25" />
          <circle r="22" fill="none" stroke="#ff6196" strokeWidth="5" strokeDasharray="90 138" strokeLinecap="round" />
        </g>
      </g>

      {}
      <g transform="translate(165,300)" opacity="0.09">
        <g className="sf3">
          <PersonGlyph x={0} y={0} scale={0.9} />
          <rect x="40" y="-6" width="14" height="14" rx="3" fill="#ff6196" />
          <line className="sline" x1="10" y1="0" x2="38" y2="0" stroke="#ff6196" strokeWidth="1.4" />
        </g>
      </g>

      {}
      <g transform="translate(30,560)" opacity="0.09">
        <g className="sf2">
          <PersonGlyph x={0} y={0} scale={0.9} />
          <PersonGlyph x={18} y={4} />
          <PersonGlyph x={36} y={-4} scale={0.85} />
        </g>
      </g>

      {}
      <g transform="translate(150,620)" opacity="0.08">
        <g className="sf1">
          <rect x="0" y="0" width="56" height="7" rx="3.5" fill="#ff6196"/>
          <rect x="10" y="14" width="72" height="7" rx="3.5" fill="#ff6196"/>
        </g>
      </g>

      {}
      <g transform="translate(50,760)" opacity="0.08">
        <g className="sf3">
          <rect x="0" y="-6" width="14" height="14" rx="3" fill="#ff6196"/>
          <line className="sline" x1="14" y1="0" x2="42" y2="0" stroke="#ff6196" strokeWidth="1.4" />
          <PersonGlyph x={52} y={0} scale={0.85} />
        </g>
      </g>
    </svg>
  );
}

export function Sidebar() {
  const pathname = usePathname();
  const [open, setOpen] = useState(true);
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const { mobileOpen, setMobileOpen } = useSidebarContext();

  useEffect(() => {
    setMobileOpen(false);
    setProfileMenuOpen(false);
  }, [pathname, setMobileOpen]);

  const showExpanded = open || mobileOpen;
  const allHrefs = [
    TOP_LINK.href,
    ...NAV_GROUPS.flatMap((g) => g.links.flatMap((l) => (l.children !== undefined ? l.children.map((c) => c.href) : [l.href]))),
    "/buddy",
  ];

  return (
    <>
      {mobileOpen && (
        <div className="fixed inset-0 z-40 bg-black/40 md:hidden" onClick={() => setMobileOpen(false)} aria-hidden="true" />
      )}
      <aside
        className={cn(
          "relative h-full bg-sidebar flex flex-col border-r border-sidebar-border shadow-sm overflow-hidden",
          "fixed inset-y-0 left-0 z-50 w-64 transition-transform duration-300",
          mobileOpen ? "translate-x-0" : "-translate-x-full",
          "md:static md:translate-x-0 md:z-auto md:transition-all",
          open ? "md:w-64" : "md:w-20"
        )}
      >
        <SidebarBackground />
        <div className="relative z-10 flex flex-col flex-1 h-full">
          <div className="px-3 min-h-14 flex items-center gap-2">
            {showExpanded ? (
              <Link href="/dashboard" className="flex-1 flex flex-col items-stretch justify-center min-w-0 py-4 gap-0 pl-3 pr-3 px-3">
                <Image src="/jman_logo.svg" alt="JMAN" width={80} height={20} className="h-5 w-auto object-contain mt-1" />
                <span className="leading-none select-none w-full text-right -mt-0.5 pr-10">
                  <span className="text-[14px] font-serif font-bold text-sidebar-foreground">Resource</span>
                  <span className="text-[12px] font-mono font-normal" style={{ color: "hsl(var(--primary))" }}>IQ</span>
                </span>
              </Link>
            ) : (
              <button onClick={() => setOpen(true)} className="flex-1 flex items-center justify-center" title="ResourceIQ — expand sidebar">
                <span className="leading-none select-none">
                  <span className="text-[15px] font-serif font-bold text-sidebar-foreground">R</span>
                  <span className="text-[13px] font-mono font-normal" style={{ color: "hsl(var(--primary))" }}>M</span>
                </span>
              </button>
            )}
            {showExpanded && (
              <button
                onClick={() => setMobileOpen(false)}
                className="flex-shrink-0 p-1.5 rounded-lg hover:bg-sidebar-accent transition-colors text-sidebar-foreground md:hidden"
                title="Close menu"
              >
                <X className="w-4 h-4" />
              </button>
            )}
            {open && (
              <button
                onClick={() => setOpen(false)}
                className="hidden md:flex flex-shrink-0 p-1.5 rounded-lg hover:bg-sidebar-accent transition-colors text-sidebar-foreground"
                title="Collapse sidebar"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
            )}
          </div>

          <nav className="flex-1 overflow-y-auto py-4 scrollbar-thin px-3 space-y-0.5">
            <NavLink link={TOP_LINK} open={showExpanded} isActive={isRouteActive(pathname, TOP_LINK.href, allHrefs)} />

            {NAV_GROUPS.map((group, gi) => (
              <div key={group.label}>
                {showExpanded && <div className={cn("border-t border-sidebar-border/50", gi === 0 ? "mt-3 mb-1" : "mt-2 mb-1")} />}
                <SectionLabel collapsed={!showExpanded}>{group.label}</SectionLabel>
                <div className="space-y-0.5">
                  {group.links.map((link) =>
                    link.children !== undefined ? (
                      <NavParent
                        key={link.label}
                        link={link}
                        open={showExpanded}
                        pathname={pathname}
                        // Active whenever the current route is under ANY of this
                        // parent's children -- e.g. RMG stays highlighted on both
                        // /resourcing/* (deal list, wizard) and /budget-approvals,
                        // even though only /resourcing/deals is a literal child href.
                        isActive={link.children.some((c) => pathname === c.href || pathname.startsWith(c.href.split("/").slice(0, 2).join("/")))}
                      />
                    ) : (
                      <NavLink key={link.href} link={link} open={showExpanded} isActive={isRouteActive(pathname, link.href, allHrefs)} />
                    )
                  )}
                </div>
              </div>
            ))}

            {showExpanded && <div className="my-3 border-t border-sidebar-border/50" />}

            {(() => {
              const buddyActive = isRouteActive(pathname, "/buddy", allHrefs);
              return (
                <Link
                  href="/buddy"
                  title={showExpanded ? undefined : "Buddy"}
                  className={cn(
                    "flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-medium transition-colors",
                    showExpanded ? "justify-start" : "justify-center",
                    buddyActive ? "" : "text-sidebar-foreground hover:bg-sidebar-accent"
                  )}
                  style={
                    buddyActive
                      ? { backgroundColor: "hsl(var(--primary) / 0.10)", color: "hsl(var(--primary))", fontWeight: 600, borderLeft: "1px solid hsl(var(--primary))" }
                      : {}
                  }
                >
                  <Mascot className="w-3.5 h-3.5 flex-shrink-0" />
                  {showExpanded && <span>Buddy</span>}
                  {showExpanded && (
                    <span className="text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-full flex-shrink-0" style={{ color: "#ff6196", backgroundColor: "rgba(255, 97, 150, 0.12)" }}>
                      Beta
                    </span>
                  )}
                </Link>
              );
            })()}
          </nav>

          <div className="relative border-t border-sidebar-border px-3 py-3">
            {profileMenuOpen && (
              <div className="fixed inset-0 z-40" onClick={() => setProfileMenuOpen(false)} aria-hidden="true" />
            )}

            {profileMenuOpen && (
              <div className="absolute bottom-full left-3 right-3 mb-1.5 z-50 rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 shadow-lg py-1.5 overflow-hidden">
                {[
                  { href: "/settings", label: "Settings", icon: Settings },
                  { href: "/tour-guide", label: "Tour Guide", icon: Compass },
                  { href: "/feedback", label: "Feedback", icon: MessageSquare },
                ].map((item) => {
                  const ItemIcon = item.icon;
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className="flex items-center gap-2.5 px-3 py-2 text-xs font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 hover:text-gray-900 dark:hover:text-gray-100 transition-colors"
                    >
                      <ItemIcon className="w-3.5 h-3.5 text-gray-400 dark:text-gray-500" />
                      {item.label}
                    </Link>
                  );
                })}
              </div>
            )}

            <button
              onClick={() => setProfileMenuOpen((v) => !v)}
              className={cn(
                "relative z-50 w-full flex items-center gap-2.5 px-2 py-2 rounded-lg transition-colors hover:bg-sidebar-accent",
                showExpanded ? "justify-start" : "justify-center"
              )}
              title={showExpanded ? undefined : "Resource Manager — Admin"}
            >
              <div
                className="w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold flex-shrink-0"
                style={{ backgroundColor: "#FF6196", color: "#FFF3E0" }}
              >
                RM
              </div>
              {showExpanded && (
                <div className="flex-1 min-w-0 text-left">
                  <p className="text-xs font-medium text-sidebar-foreground truncate leading-tight">Resource Manager</p>
                  <p className="text-[10px] leading-tight" style={{ color: "hsl(var(--primary))" }}>Admin</p>
                </div>
              )}
            </button>
          </div>
        </div>
      </aside>
    </>
  );
}
