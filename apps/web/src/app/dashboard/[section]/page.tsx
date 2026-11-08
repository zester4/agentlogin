import Link from "next/link";
import { redirect } from "next/navigation";
import { auth0 } from "../../../lib/auth0";
import { Icon } from "../../ui-icon";\nimport { ThemeToggle } from "../../theme-toggle";
import { decideApproval } from "./actions";

const sections = {
  accounts: {
    label: "CONNECTED ACCOUNTS", title: "Account directory",
    description: "A secure inventory of the websites and services your agents may access.",
    icon: "globe" as const, number: "01",
    state: "ACCOUNT ENROLLMENT NOT ENABLED",
    emptyTitle: "Your account vault is ready for its first connection.",
    emptyBody: "When credential enrollment is connected to the production vault, add a website account here. Secrets will remain encrypted server-side and will never be returned to an agent.",
    next: "Next milestone: wire the credential lifecycle to the production KMS provider."
  },
  agents: {
    label: "AGENT DIRECTORY", title: "Registered agents",
    description: "Give every agent a distinct identity and a clearly bounded permission set.",
    icon: "bot" as const, number: "02",
    state: "AGENT MANAGEMENT NOT ENABLED",
    emptyTitle: "No agents registered in this workspace.",
    emptyBody: "Agent registration and credential management will appear here when the workspace management API is connected. Each agent will have its own identity, status and revocation controls.",
    next: "Next milestone: connect the dashboard to the agent credential repository."
  },
  grants: {
    label: "ACCESS CONTROL", title: "Access grants",
    description: "Review short-lived authorization handles and the exact boundaries attached to them.",
    icon: "ticket" as const, number: "03",
    state: "GRANT ISSUANCE NOT ENABLED",
    emptyTitle: "No access grants have been issued.",
    emptyBody: "Grant issuance will be shown here once the policy and execution flow is connected. Each grant must bind an agent, account, origin, scopes, expiry and execution context.",
    next: "Next milestone: connect policy evaluation and grant issuance."
  },
  approvals: {
    label: "HUMAN IN THE LOOP", title: "Approval inbox",
    description: "Keep people in control of access decisions that require explicit authorization.",
    icon: "inbox" as const, number: "04",
    state: "APPROVAL WORKFLOW NOT CONNECTED",
    emptyTitle: "You're all caught up.",
    emptyBody: "Approval requests will appear here when the approval workflow is connected to the dashboard. Requests should include the agent, account, origin, requested scope and reason.",
    next: "Approval inbox API and repository are present; dashboard integration is the next step."
  },
  activity: {
    label: "AUDIT TRAIL", title: "Activity & audit logs",
    description: "A chronological record of security-relevant events across your workspace.",
    icon: "activity" as const, number: "05",
    state: "EVENT STREAM NOT CONNECTED",
    emptyTitle: "Your audit trail will appear here.",
    emptyBody: "Credential access, grant decisions, approval outcomes, revocations and denied requests should be recorded with tenant-scoped context. No sample events are shown as real activity.",
    next: "Next milestone: connect tenant-scoped audit event queries."
  },
  security: {
    label: "SECURITY POSTURE", title: "Security center",
    description: "Understand the controls protecting credentials, agents and authorization decisions.",
    icon: "shield" as const, number: "06",
    state: "PRODUCTION VERIFICATION IN PROGRESS",
    emptyTitle: "Security controls are being connected.",
    emptyBody: "The production KMS key and adapter are provisioned, but runtime wiring and end-to-end verification are still required before the vault can be marked production-ready.",
    next: "Next milestone: wire Railway API credentials to AWS KMS and verify encrypt/decrypt plus denial cases."
  }
} as const;

type SectionKey = keyof typeof sections;

const navigation = [
  { label: "Overview", href: "/dashboard", icon: "grid" as const },
  { label: "Connected accounts", href: "/dashboard/accounts", icon: "globe" as const, key: "accounts" },
  { label: "Agents", href: "/dashboard/agents", icon: "bot" as const, key: "agents" },
  { label: "Access grants", href: "/dashboard/grants", icon: "ticket" as const, key: "grants" },
  { label: "Approvals", href: "/dashboard/approvals", icon: "inbox" as const, key: "approvals" },
  { label: "Activity", href: "/dashboard/activity", icon: "activity" as const, key: "activity" },
];

export default async function DashboardSectionPage({ params }: { params: Promise<{ section: string }> }) {
  const session = await auth0.getSession();
  if (!session) redirect("/auth/login");
  const { section } = await params;
  if (!(section in sections)) redirect("/dashboard");
  const key = section as SectionKey;
  const item = sections[key];
  const displayName = session.user.name || session.user.email?.split("@")[0] || "there";
  const initial = (session.user.name || session.user.email || "A").slice(0, 1).toUpperCase();

  const apiBase = process.env.AGENTLOGIN_API_URL;
  const apiTokenResult = apiBase ? await auth0.getAccessToken().catch(() => null) : null;
  const apiToken = apiTokenResult?.token;
  let accounts: Array<{ account_id: string; provider: string; origin: string; display_label: string; status: string; created_at: string }> = [];
  let approvals: Array<{ grantId: string; approvalId: string; agentId: string; agentName: string; accountId: string; accountLabel: string; origin: string; scopes: string[]; taskId: string | null; expiresAt: string; requestedAt: string }> = [];
  let liveDataError = !apiBase ? "Set AGENTLOGIN_API_URL on the web service." : !apiToken ? "Auth0 API access is not configured yet. Set AUTH0_AUDIENCE and complete the trusted tenant claim setup." : "";
  if (apiToken && apiBase && (key === "accounts" || key === "approvals")) {
    try {
      const endpoint = key === "accounts" ? "/v1/connected-accounts" : "/v1/grants/pending";
      const response = await fetch(new URL(endpoint, apiBase), {
        headers: { Authorization: `Bearer ${apiToken}` },
        cache: "no-store"
      });
      if (!response.ok) liveDataError = response.status === 503
        ? "The API is not configured for verified user authentication yet."
        : "The API could not load this workspace data. Check the Auth0 and API configuration.";
      else {
        const payload = await response.json() as { accounts?: typeof accounts; pending?: typeof approvals };
        if (key === "accounts") accounts = payload.accounts ?? [];
        else approvals = payload.pending ?? [];
      }
    } catch {
      liveDataError = "AgentLogin API is temporarily unavailable.";
    }
  }

  return (
    <main className="workspace-shell workspace-shell-v2">
      <aside className="workspace-sidebar workspace-sidebar-v2">
        <Link className="brand" href="/"><img src="/agentlogin-mark.svg" alt="" /><span>AgentLogin</span></Link>
        <div className="workspace-switcher"><span className="workspace-switcher-mark">A</span><span><small>WORKSPACE</small><strong>Personal workspace</strong></span><Icon name="chevron" /></div>
        <div className="sidebar-label">PLATFORM</div>
        <nav className="workspace-nav" aria-label="Workspace navigation">
          {navigation.map((entry) => <Link key={entry.label} className={entry.key === key ? "side-link active" : "side-link"} href={entry.href}><Icon name={entry.icon} /><span>{entry.label}</span></Link>)}
        </nav>
        <div className="sidebar-label sidebar-label-spaced">MANAGE</div>
        <nav className="workspace-nav" aria-label="Management navigation">
          <Link className={key === "security" ? "side-link active" : "side-link"} href="/dashboard/security"><Icon name="shield" /><span>Security center</span></Link>
          <Link className="side-link" href="/settings"><Icon name="users" /><span>Team & members</span></Link>
          <Link className="side-link" href="/developers"><Icon name="code" /><span>Developer settings</span></Link>
        </nav>
        <div className="sidebar-help"><span className="help-icon"><Icon name="book" /></span><strong>Build with AgentLogin</strong><p>Connect your agent through the SDK or MCP interface.</p><Link href="/developers">Developer guide <Icon name="arrow" /></Link></div>
        <div className="sidebar-bottom sidebar-bottom-v2"><span className="avatar">{initial}</span><div><strong>{displayName}</strong><small>{session.user.email || "Authenticated account"}</small></div><a href="/auth/logout" aria-label="Sign out"><Icon name="logout" /></a></div>
      </aside>
      <section className="workspace-main workspace-main-v2">
        <header className="workspace-topbar"><div className="workspace-breadcrumb"><Link href="/dashboard">WORKSPACE</Link><b>/</b><strong>{item.label}</strong></div><div className="topbar-right"><ThemeToggle /><span className="topbar-session"><i /> AUTHENTICATED</span><Link href="/settings" aria-label="Workspace settings"><Icon name="settings" /></Link></div></header>
        <section className="workspace-welcome section-page-welcome"><div><span className="section-kicker">CONTROL PLANE / {item.number}</span><h1>{item.title}</h1><p>{item.description}</p></div><span className="workspace-coming">{item.state}</span></section>
        {key === "accounts" ? (
          <section className="section-page-card live-data-card">
            <div className="section-page-icon"><Icon name="globe" /></div>
            <span className="section-kicker">CONNECTED ACCOUNTS</span>
            <h2>Connected account directory</h2>
            <p>Only safe account metadata is displayed here. Passwords and encrypted credential material are never sent to the dashboard.</p>
            {liveDataError ? <p className="live-data-notice">{liveDataError}</p> : accounts.length ? (
              <div className="live-data-list">{accounts.map((account) => (
                <article className="live-data-row" key={account.account_id}>
                  <div><strong>{account.display_label}</strong><small>{account.provider} · {account.origin}</small></div>
                  <span className={account.status === "active" ? "live-status active" : "live-status"}>{account.status}</span>
                </article>
              ))}</div>
            ) : <p className="live-data-notice">No connected accounts in this workspace yet.</p>}
          </section>
        ) : key === "approvals" ? (
          <section className="section-page-card live-data-card">
            <div className="section-page-icon"><Icon name="inbox" /></div>
            <span className="section-kicker">HUMAN IN THE LOOP</span>
            <h2>Approval inbox</h2>
            <p>Review each request’s agent, account, exact origin, scope and expiry before deciding.</p>
            {liveDataError ? <p className="live-data-notice">{liveDataError}</p> : approvals.length ? (
              <div className="live-data-list">{approvals.map((approval) => (
                <article className="approval-row" key={approval.grantId}>
                  <div className="approval-row-head"><strong>{approval.agentName}</strong><span className="live-status pending">PENDING</span></div>
                  <p><b>{approval.accountLabel}</b> · {approval.origin}</p>
                  <div className="approval-scopes">{approval.scopes.map((scope) => <span key={scope}>{scope}</span>)}</div>
                  <small>Requested {new Date(approval.requestedAt).toLocaleString()} · Expires {new Date(approval.expiresAt).toLocaleString()}</small>
                  <div className="approval-actions">
                    <form action={decideApproval}><input type="hidden" name="grant_id" value={approval.grantId} /><input type="hidden" name="approval_id" value={approval.approvalId} /><input type="hidden" name="decision" value="denied" /><button className="button button-outline" type="submit">Deny</button></form>
                    <form action={decideApproval}><input type="hidden" name="grant_id" value={approval.grantId} /><input type="hidden" name="approval_id" value={approval.approvalId} /><input type="hidden" name="decision" value="approved" /><button className="button button-primary" type="submit">Approve request</button></form>
                  </div>
                </article>
              ))}</div>
            ) : <p className="live-data-notice">No pending approval requests. You’re all caught up.</p>}
          </section>
        ) : (
          <section className="section-page-card">
            <div className="section-page-icon"><Icon name={item.icon} /></div>
            <span className="section-kicker">{item.label}</span>
            <h2>{item.emptyTitle}</h2>
            <p>{item.emptyBody}</p>
            <div className="section-page-next"><Icon name="arrow" /><span>{item.next}</span></div>
          </section>
        )}
        <footer className="workspace-footer"><span>AGENTLOGIN / CONTROL PLANE</span><span>SECURE ACCESS FOR AUTONOMOUS WORK</span><Link href="/dashboard">BACK TO OVERVIEW <Icon name="arrow" /></Link></footer>
      </section>
    </main>
  );
}
