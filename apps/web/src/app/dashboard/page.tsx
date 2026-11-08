import type { ReactNode } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { auth0 } from "../../lib/auth0";
import { Icon } from "../ui-icon";

const navigation = [
  { label: "Overview", href: "#overview", icon: "grid" as const, active: true },
  { label: "Connected accounts", href: "#accounts", icon: "globe" as const },
  { label: "Agents", href: "#agents", icon: "bot" as const },
  { label: "Access grants", href: "#grants", icon: "ticket" as const },
  { label: "Approvals", href: "#approvals", icon: "inbox" as const },
  { label: "Activity", href: "#activity", icon: "activity" as const },
];
const management = [
  { label: "Security center", href: "#security", icon: "shield" as const },
  { label: "Team & members", href: "/settings", icon: "users" as const },
  { label: "Developer settings", href: "/developers", icon: "code" as const },
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
          <span><small>WORKSPACE</small><strong>Personal workspace</strong></span>
          <Icon name="chevron" />
        </div>
        <div className="sidebar-label">PLATFORM</div>
        <nav className="workspace-nav" aria-label="Workspace navigation">
          {navigation.map((item) => (
            <a key={item.label} className={item.active ? "side-link active" : "side-link"} href={item.href}>
              <Icon name={item.icon} /> <span>{item.label}</span>
              {item.label === "Approvals" ? <small className="nav-count">—</small> : null}
            </a>
          ))}
        </nav>
        <div className="sidebar-label sidebar-label-spaced">MANAGE</div>
        <nav className="workspace-nav" aria-label="Management navigation">
          {management.map((item) => <a key={item.label} className="side-link" href={item.href}><Icon name={item.icon} /> <span>{item.label}</span></a>)}
        </nav>
        <div className="sidebar-help">
          <span className="help-icon"><Icon name="book" /></span>
          <strong>Build with AgentLogin</strong>
          <p>Connect your agent through the SDK or MCP interface.</p>
          <Link href="/developers">Developer guide <Icon name="arrow" /></Link>
        </div>
        <div className="sidebar-bottom sidebar-bottom-v2">
          <span className="avatar">{initial}</span>
          <div><strong>{displayName}</strong><small>{session.user.email || "Authenticated account"}</small></div>
          <a href="/auth/logout" aria-label="Sign out"><Icon name="logout" /></a>
        </div>
      </aside>

      <section className="workspace-main workspace-main-v2">
        <header className="workspace-topbar">
          <div className="workspace-breadcrumb"><span>WORKSPACE</span><b>/</b><strong>OVERVIEW</strong></div>
          <div className="topbar-right"><span className="topbar-session"><i /> AUTHENTICATED</span><Link href="/settings" aria-label="Workspace settings"><Icon name="settings" /></Link></div>
        </header>

        <section className="workspace-welcome">
          <div>
            <span className="section-kicker">CONTROL PLANE / 001</span>
            <h1>Good to see you, {displayName}.</h1>
            <p>Your agents. Your accounts. Your rules.</p>
          </div>
          <div className="welcome-date"><span>WORKSPACE STATUS</span><strong><i /> INITIAL SETUP</strong></div>
        </section>

        <section className="workspace-metrics" aria-label="Workspace metrics">
          <article className="metric-card"><div><span>CONNECTED ACCOUNTS</span><Icon name="globe" /></div><strong>—</strong><small>Account linking not enabled</small></article>
          <article className="metric-card"><div><span>REGISTERED AGENTS</span><Icon name="bot" /></div><strong>—</strong><small>Agent directory not enabled</small></article>
          <article className="metric-card"><div><span>ACTIVE GRANTS</span><Icon name="ticket" /></div><strong>—</strong><small>Grant issuance not enabled</small></article>
          <article className="metric-card"><div><span>PENDING APPROVALS</span><Icon name="inbox" /></div><strong>—</strong><small>Approval queue not connected</small></article>
        </section>

        <section className="workspace-section-heading">
          <div><span className="section-kicker">YOUR SECURITY BOUNDARY</span><h2>Workspace overview</h2></div>
          <span className="workspace-preview-label">INTERFACE PREVIEW · LIVE DATA NOT CONNECTED</span>
        </section>

        <section className="workspace-overview-grid">
          <article className="workspace-feature-card vault-feature">
            <div className="feature-topline"><span className="feature-icon"><Icon name="lock" /></span><ComingSoon>VAULT LAYER</ComingSoon></div>
            <span className="section-kicker">01 / CREDENTIALS</span>
            <h3>Your secrets stay<br />out of agent reach.</h3>
            <p>Encrypted credentials are designed to remain server-side. Agents work through restricted grants, never by receiving passwords or raw tokens.</p>
            <div className="feature-foot"><span><Icon name="shield" /> ENCRYPTED STORAGE</span><span>SETUP IN PROGRESS</span></div>
          </article>
          <article className="workspace-feature-card policy-feature">
            <div className="feature-topline"><span className="feature-icon"><Icon name="shield" /></span><ComingSoon>POLICY ENGINE</ComingSoon></div>
            <span className="section-kicker">02 / AUTHORIZATION</span>
            <h3>Every permission<br />has a boundary.</h3>
            <p>Grants are designed to bind an authenticated agent to one account, exact origin, approved scopes, expiry, and execution context.</p>
            <div className="feature-foot"><span><Icon name="check" /> EXPLICIT PERMISSIONS</span><span>SETUP IN PROGRESS</span></div>
          </article>
        </section>

        <section className="workspace-lower-grid">
          <article className="workspace-panel-v2" id="accounts">
            <div className="panel-heading"><div><span className="section-kicker">CONNECTED ACCOUNTS</span><h3>Account directory</h3></div><ComingSoon>COMING NEXT</ComingSoon></div>
            <div className="empty-state"><span className="empty-state-icon"><Icon name="globe" /></span><strong>No accounts to show yet</strong><p>When account enrollment is enabled, connected websites and services will appear here with their credential health and authorized agents.</p><span className="empty-state-foot">ACCOUNT ENROLLMENT · NOT ENABLED</span></div>
          </article>
          <article className="workspace-panel-v2" id="agents">
            <div className="panel-heading"><div><span className="section-kicker">AGENT DIRECTORY</span><h3>Registered agents</h3></div><ComingSoon>COMING NEXT</ComingSoon></div>
            <div className="empty-state"><span className="empty-state-icon"><Icon name="bot" /></span><strong>No agents to show yet</strong><p>Register trusted agent identities, issue credentials, and manage each agent's access independently.</p><span className="empty-state-foot">AGENT MANAGEMENT · NOT ENABLED</span></div>
          </article>
        </section>

        <section className="workspace-lower-grid workspace-lower-grid-secondary">
          <article className="workspace-panel-v2" id="grants">
            <div className="panel-heading"><div><span className="section-kicker">ACCESS CONTROL</span><h3>Recent grants</h3></div><ComingSoon>COMING NEXT</ComingSoon></div>
            <div className="compact-empty"><Icon name="ticket" /><span>No grants have been issued through this workspace UI.</span></div>
          </article>
          <article className="workspace-panel-v2" id="approvals">
            <div className="panel-heading"><div><span className="section-kicker">HUMAN IN THE LOOP</span><h3>Approval inbox</h3></div><ComingSoon>COMING NEXT</ComingSoon></div>
            <div className="compact-empty"><Icon name="inbox" /><span>Approval requests will appear here when the workflow is connected.</span></div>
          </article>
        </section>

        <section className="workspace-panel-v2 activity-panel" id="activity">
          <div className="panel-heading"><div><span className="section-kicker">AUDIT TRAIL</span><h3>Security activity</h3></div><ComingSoon>EVENT STREAM NOT CONNECTED</ComingSoon></div>
          <div className="activity-placeholder"><span className="activity-line" /><div><strong>Your audit trail will live here.</strong><p>Credential access, grant decisions, approvals, revocations, and denied requests should be recorded with tenant-scoped context.</p></div></div>
        </section>

        <section className="workspace-security-strip" id="security">
          <div><span className="section-kicker">SECURITY POSTURE</span><h3>Built to keep authorization separate from secrets.</h3><p>Dashboard sign-in confirms your user session. It does not, by itself, enable credential storage, agent execution, or production vault access.</p></div>
          <Link className="button button-outline" href="/security">Read security model <Icon name="arrow" /></Link>
        </section>

        <footer className="workspace-footer"><span>AGENTLOGIN / CONTROL PLANE</span><span>SECURE ACCESS FOR AUTONOMOUS WORK</span><Link href="/settings">WORKSPACE SETTINGS <Icon name="arrow" /></Link></footer>
      </section>
    </main>
  );
}
