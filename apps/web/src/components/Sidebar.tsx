"use client";

import {
  LayoutDashboard,
  ClipboardCheck,
  Users,
  Armchair,
  Cpu,
  BarChart3,
  Settings,
  Boxes,
} from "lucide-react";

const MENU = [
  { label: "Overview", icon: LayoutDashboard, href: "/" },
  { label: "Attendance", icon: ClipboardCheck, href: "/attendance" },
  { label: "Students", icon: Users, href: "/students" },
  { label: "Classes & Seats", icon: Armchair, href: "#" },
  { label: "Device Monitoring", icon: Cpu, href: "#" },
  { label: "Reports", icon: BarChart3, href: "#" },
  { label: "Settings", icon: Settings, href: "#", badge: "ADMIN" },
];

export function Sidebar({ active = "Overview" }: { active?: string }) {

  return (
    <>
      {/* Mobile: top bar with hamburger (drawer is peer-controlled) */}
      <input type="checkbox" id="nav-toggle" className="peer hidden" />
      <label
        htmlFor="nav-toggle"
        className="lg:hidden fixed top-3 left-3 z-40 w-11 h-11 flex items-center justify-center rounded-xl bg-aici-surface border border-aici-border shadow-sm cursor-pointer"
        aria-label="Buka navigasi"
      >
        <svg viewBox="0 0 20 20" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
          <line x1="3" y1="6" x2="17" y2="6" />
          <line x1="3" y1="10" x2="17" y2="10" />
          <line x1="3" y1="14" x2="17" y2="14" />
        </svg>
      </label>
      <label
        htmlFor="nav-toggle"
        aria-hidden
        className="lg:hidden fixed inset-0 z-30 bg-black/40 opacity-0 pointer-events-none peer-checked:opacity-100 peer-checked:pointer-events-auto transition-opacity"
      />
      <aside className="fixed lg:static z-30 inset-y-0 left-0 w-56 shrink-0 bg-aici-surface border-r border-aici-border flex flex-col min-h-screen -translate-x-full peer-checked:translate-x-0 lg:translate-x-0 transition-transform">
        <div className="flex items-center gap-2.5 px-4 py-5">
          <div className="w-8 h-8 rounded-lg bg-aici-lime flex items-center justify-center">
            <Boxes className="w-5 h-5 text-aici-dark" strokeWidth={2} />
          </div>
          <div className="leading-tight">
            <p className="text-sm font-bold">AICI Center</p>
            <p className="text-[11px] text-aici-muted font-mono tracking-wide">
              Smart Classroom AIoT
            </p>
          </div>
        </div>

        <nav className="px-2 space-y-0.5 flex-1">
          {MENU.map((item) => {
            const isActive = item.label === active;
            return (
              <a
                key={item.label}
                href={item.href}
                className={`flex items-center gap-3 px-3 py-2.5 min-h-[44px] rounded-lg text-sm transition-colors ${
                  isActive
                    ? "bg-aici-periwinkle font-semibold text-aici-dark"
                    : "text-aici-muted hover:bg-aici-surface-nested font-medium"
                }`}
              >
                <item.icon className="w-[18px] h-[18px]" strokeWidth={1.8} />
                <span className="flex-1">{item.label}</span>
                {item.badge && (
                  <span className="text-[10px] font-semibold border border-aici-border-dark rounded px-1.5 py-0.5 text-aici-muted">
                    {item.badge}
                  </span>
                )}
              </a>
            );
          })}
        </nav>
      </aside>
    </>
  );
}
