import type { ReactNode } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { auth0 } from "../../lib/auth0";
import { Icon } from "../ui-icon";
import { ThemeToggle } from "../theme-toggle";

const navigation = [
  { label: "Overview", href: "#overview", icon: "grid" as const, active: true },
  { label: "Connected accounts", href: "/dashboard/accounts", icon: "globe" as const },
  { label: "Agents", href: "/dashboard/agents", icon: "bot" as const },
  { label: "Agent access", href: "/dashboard/grants", icon: "ticket" as const },
  { label: "Approvals", href: "/dashboard/approvals", icon: "inbox" as const },
  { label: "Activity", href: "/dashboard/activity", icon: "activity" as const },
];
const management = [
  { label: "Your security", href: "/dashboard/security", icon: "shield" as const },
  { label: "Team & members", href: "/settings", icon: "users" as const },
  { label: "For developers", href: "/developers", icon: "code" as const },
];

function ComingSoon({ children }: { children: ReactNode }) {
  return <span className="workspace-coming">{children}</span>;
}

export default async function DashboardPage() {
  const session = await auth0.getSession();
  if (!session) redirect("/auth/login");
  const displayName = session.user.name || session.user.email?.split("@")[0] || "there";
  const initial = (session.user.name || session.user.email || "A").slice(0, 1).toUpperCase();

  return (
    <main className="workspace-shell workspace-shell-v2" id="overview">
      <aside className="workspace-sidebar workspace-sidebar-v2">
        <Link className="brand" href="/"><img src="/agentlogin-mark.svg" alt="" /><span>AgentLogin</span></Link>
        <div className="workspace-switcher">
          <span className="workspace-switcher-mark">A</span>
          <span><small>YOUR ACCOUNT</small><strong>Personal account</strong></span>
          <Icon name="chevron" />
        </div>
        <div className="sidebar-label">YOUR ACCOUNT</div>
        <nav className="workspace-nav" aria-label="Your account">
          {navigation.map((item) => (
            <a key={item.label} className={item.active ? "side-link active" : "side-link"} href={item.href}>
              <Icon name={item.icon} /> <span>{item.label}</span>
              {item.label === "Approvals" ? <small className="nav-count">—</small> : null}
            </a>
          ))}
        </nav>
        <div className="sidebar-label sidebar-label-spaced">SETTINGS</div>
        <nav className="workspace-nav" aria-label="Management navigation">
          {management.map((item) => <a key={item.label} className="side-link" href={item.href}><Icon name={item.icon} /> <span>{item.label}</span></a>)}
        </nav>
        <div className="sidebar-help">
          <span className="help-icon"><Icon name="book" /></span>
          <strong>Build with AgentLogin</strong>
          <p>Connect your AI assistant to AgentLogin in a few simple steps.</p>
          <Link href="/developers">Getting started <Icon name="arrow" /></Link>
        </div>
        <div className="sidebar-bottom sidebar-bottom-v2">
          <span className="avatar">{initial}</span>
          <div><strong>{displayName}</strong><small>{session.user.email || "Authenticated account"}</small></div>
          <a href="/auth/logout" aria-label="Sign out"><Icon name="logout" /></a>
        </div>
      </aside>

      <section className="workspace-main workspace-main-v2">
        <header className="workspace-topbar">
          <div className="workspace-breadcrumb"><span>YOUR ACCOUNT</span><b>/</b><strong>OVERVIEW</strong></div>
          <div className="topbar-right"><ThemeToggle /><span className="topbar-session"><i /> SIGNED IN</span><Link href="/settings" aria-label="Account settings"><Icon name="settings" /></Link></div>
        </header>

        <section className="workspace-welcome">
          <div>
            <span className="section-kicker">YOUR ACCOUNT</span>
            <h1>Good to see you, {displayName}.</h1>
            <p>Your agents. Your accounts. Your rules.</p>
          </div>
          <div className="welcome-date"><span>ACCOUNT STATUS</span><strong><i /> GETTING STARTED</strong></div>
        </section>

        <section className="workspace-metrics" aria-label="Your account at a glance">
          <article className="metric-card"><div><span>CONNECTED ACCOUNTS</span><Icon name="globe" /></div><strong>—</strong><small>Account connections are coming soon</small></article>
          <article className="metric-card"><div><span>YOUR AI AGENTS</span><Icon name="bot" /></div><strong>—</strong><small>Agent management is coming soon</small></article>
          <article className="metric-card"><div><span>AGENT ACCESS</span><Icon name="ticket" /></div><strong>—</strong><small>Agent access is coming soon</small></article>
          <article className="metric-card"><div><span>PENDING APPROVALS</span><Icon name="inbox" /></div><strong>—</strong><small>Approval requests will appear here</small></article>
        </section>

        <section className="workspace-section-heading">
          <div><span className="section-kicker">KEEPING YOUR ACCOUNTS SAFE</span><h2>Your AgentLogin overview</h2></div>
          <span className="workspace-preview-label">YOUR ACCOUNT IS BEING SET UP</span>
        </section>

        <section className="workspace-overview-grid">
          <article className="workspace-feature-card vault-feature">
            <div className="feature-topline"><span className="feature-icon"><Icon name="lock" /></span><ComingSoon>PRIVATE PASSWORD STORAGE</ComingSoon></div>
            <span className="section-kicker">01 / YOUR PASSWORDS</span>
            <h3>Your secrets stay<br />out of agent reach.</h3>
            <p>Your passwords and private keys stay protected. Your AI agents can sign in when you allow them, without ever seeing your actual passwords.</p>
            <div className="feature-foot"><span><Icon name="shield" /> PRIVATE & PROTECTED</span><span>SETUP IN PROGRESS</span></div>
          </article>
          <article className="workspace-feature-card policy-feature">
            <div className="feature-topline"><span className="feature-icon"><Icon name="shield" /></span><ComingSoon>ACCESS RULES</ComingSoon></div>
            <span className="section-kicker">02 / YOUR PERMISSIONS</span>
            <h3>Every permission<br />has a boundary.</h3>
            <p>You decide which accounts each AI agent can use and what it is allowed to do. You can keep access limited and take it away whenever you want.</p>
            <div className="feature-foot"><span><Icon name="check" /> YOU ARE IN CONTROL</span><span>SETUP IN PROGRESS</span></div>
          </article>
        </section>

        <section className="workspace-lower-grid">
          <article className="workspace-panel-v2" id="accounts">
            <div className="panel-heading"><div><span className="section-kicker">CONNECTED ACCOUNTS</span><h3>Your connected accounts</h3></div><ComingSoon>COMING NEXT</ComingSoon></div>
            <div className="empty-state"><span className="empty-state-icon"><Icon name="globe" /></span><strong>No accounts to show yet</strong><p>Websites and services you connect will appear here, so you can see which AI agents have access to each one.</p><span className="empty-state-foot">ACCOUNT CONNECTIONS COMING SOON</span></div>
          </article>
          <article className="workspace-panel-v2" id="agents">
            <div className="panel-heading"><div><span className="section-kicker">YOUR AI AGENTS</span><h3>Your AI agents</h3></div><ComingSoon>COMING NEXT</ComingSoon></div>
            <div className="empty-state"><span className="empty-state-icon"><Icon name="bot" /></span><strong>No agents to show yet</strong><p>See the AI agents you have connected and manage what each one can access.</p><span className="empty-state-foot">AGENT MANAGEMENT COMING SOON</span></div>
          </article>
        </section>

        <section className="workspace-lower-grid workspace-lower-grid-secondary">
          <article className="workspace-panel-v2" id="grants">
            <div className="panel-heading"><div><span className="section-kicker">AGENT ACCESS</span><h3>Recent access</h3></div><ComingSoon>COMING NEXT</ComingSoon></div>
            <div className="compact-empty"><Icon name="ticket" /><span>No AI agents have been given account access yet.</span></div>
          </article>
          <article className="workspace-panel-v2" id="approvals">
            <div className="panel-heading"><div><span className="section-kicker">YOU MAKE THE CALL</span><h3>Requests waiting for you</h3></div><ComingSoon>COMING NEXT</ComingSoon></div>
            <div className="compact-empty"><Icon name="inbox" /><span>If an AI agent asks to do something that needs your permission, you will see the request here.</span></div>
          </article>
        </section>

        <section className="workspace-panel-v2 activity-panel" id="activity">
          <div className="panel-heading"><div><span className="section-kicker">RECENT ACCOUNT ACTIVITY</span><h3>Security activity</h3></div><ComingSoon>ACTIVITY HISTORY COMING SOON</ComingSoon></div>
          <div className="activity-placeholder"><span className="activity-line" /><div><strong>Your audit trail will live here.</strong><p>See when your AI agents use connected accounts, what they ask to do, and which requests you approve or decline.</p></div></div>
        </section>

        <section className="workspace-security-strip" id="security">
          <div><span className="section-kicker">YOUR SECURITY</span><h3>Your passwords stay private. You stay in control.</h3><p>Signing in to AgentLogin is just the first step. We are still finishing the features that let you connect accounts and safely give your AI agents access.</p></div>
          <Link className="button button-outline" href="/security">How we protect you <Icon name="arrow" /></Link>
        </section>

        <footer className="workspace-footer"><span>AGENTLOGIN</span><span>SECURE ACCESS FOR AUTONOMOUS WORK</span><Link href="/settings">ACCOUNT SETTINGS <Icon name="arrow" /></Link></footer>
      </section>
    </main>
  );
}
