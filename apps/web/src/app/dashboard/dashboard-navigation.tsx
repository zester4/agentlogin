"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon } from "../ui-icon";

const primary = [
  { label: "Overview", href: "/dashboard", icon: "grid" as const },
  { label: "Connected accounts", href: "/dashboard/accounts", icon: "globe" as const },
  { label: "Agents", href: "/dashboard/agents", icon: "bot" as const },
  { label: "Agent access", href: "/dashboard/grants", icon: "ticket" as const },
  { label: "Approvals", href: "/dashboard/approvals", icon: "inbox" as const },
  { label: "Activity", href: "/dashboard/activity", icon: "activity" as const },
];
const secondary = [
  { label: "Security", href: "/dashboard/security", icon: "shield" as const },
  { label: "Team & members", href: "/settings", icon: "users" as const },
  { label: "For developers", href: "/developers", icon: "code" as const },
  { label: "Applications", href: "/dashboard/applications", icon: "key" as const },
];

export function DashboardNavigation({ name, email }: { name: string; email: string }) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const initial = (name || email || "A").slice(0, 1).toUpperCase();

  const nav = (items: ReadonlyArray<{ label: string; href: string; icon: "grid" | "globe" | "bot" | "ticket" | "inbox" | "activity" | "shield" | "users" | "code" | "key" }>, label: string) => (
    <nav className="dashboard-nav-list" aria-label={label}>
      {items.map((item) => {
        const active = item.href === "/dashboard"
          ? pathname === "/dashboard"
          : pathname === item.href || pathname.startsWith(item.href + "/");
        return (
          <Link key={item.href} href={item.href} className={active ? "dashboard-nav-link active" : "dashboard-nav-link"}
            aria-current={active ? "page" : undefined} title={collapsed ? item.label : undefined}
            onClick={() => setMobileOpen(false)}>
            <Icon name={item.icon} /><span>{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );

  return (
    <>
      <button className="dashboard-mobile-menu" type="button" aria-label="Open navigation"
        aria-expanded={mobileOpen} onClick={() => setMobileOpen(true)}><Icon name="menu" /></button>
      {mobileOpen ? <button className="dashboard-nav-backdrop" aria-label="Close navigation" onClick={() => setMobileOpen(false)} /> : null}
      <aside className={`dashboard-sidebar ${collapsed ? "is-collapsed" : ""} ${mobileOpen ? "is-mobile-open" : ""}`}>
        <div className="dashboard-sidebar-top">
          <Link className="dashboard-brand" href="/dashboard" onClick={() => setMobileOpen(false)}>
            <img src="/agentlogin-mark.svg" alt="" /><span>AgentLogin</span>
          </Link>
          <button type="button" className="dashboard-collapse" aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            aria-expanded={!collapsed} onClick={() => setCollapsed(!collapsed)}><Icon name={collapsed ? "panel-left-open" : "panel-left-close"} /></button>
          <button type="button" className="dashboard-mobile-close" aria-label="Close navigation" onClick={() => setMobileOpen(false)}><Icon name="x" /></button>
        </div>
        <div className="dashboard-workspace"><span className="dashboard-workspace-mark">A</span><span><small>WORKSPACE</small><strong>Personal account</strong></span></div>
        <span className="dashboard-nav-label">WORKSPACE</span>
        {nav(primary, "Workspace navigation")}
        <span className="dashboard-nav-label dashboard-settings-label">SETTINGS</span>
        {nav(secondary, "Settings navigation")}
        <div className="dashboard-sidebar-spacer" />
        <div className="dashboard-sidebar-help"><strong>Build with AgentLogin</strong><p>Connect your AI assistant in a few steps.</p><Link href="/developers">Developer setup <Icon name="arrow" /></Link></div>
        <div className="dashboard-profile"><span className="dashboard-avatar">{initial}</span><span className="dashboard-profile-copy"><strong>{name}</strong><small>{email}</small></span><a href="/auth/logout" aria-label="Sign out" title="Sign out"><Icon name="logout" /></a></div>
      </aside>
    </>
  );
}
