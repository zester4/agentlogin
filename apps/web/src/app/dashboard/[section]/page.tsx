import Link from "next/link";
import { redirect } from "next/navigation";
import { auth0 } from "../../../lib/auth0";
import { Icon } from "../../ui-icon";
import { ThemeToggle } from "../../theme-toggle";
import { decideApproval } from "./actions";

const sections = {
  accounts: {
    label: "YOUR ACCOUNTS", title: "Connected accounts",
    description: "See the websites and services you have connected to AgentLogin.",
    icon: "globe" as const, number: "01",
    state: "ENROLLMENT LOCKED — SECURITY REVIEW IN PROGRESS",
    emptyTitle: "Your connected accounts will appear here.",
    emptyBody: "You will be able to add websites and services here. Your passwords will stay private, even when an AI agent signs in for you.",
    next: "We are finishing the secure account-connection process."
  },
  agents: {
    label: "YOUR AI AGENTS", title: "Your AI agents",
    description: "See the AI agents you have connected and decide what each one can access.",
    icon: "bot" as const, number: "02",
    state: "AGENT MANAGEMENT COMING SOON",
    emptyTitle: "No AI agents connected yet.",
    emptyBody: "Your connected AI agents will appear here. You will be able to review their access and disconnect them whenever you choose.",
    next: "We are finishing the tools for managing your AI agents."
  },
  grants: {
    label: "AGENT ACCESS", title: "Agent access",
    description: "See which accounts your AI agents can use and what they are allowed to do.",
    icon: "ticket" as const, number: "03",
    state: "AGENT ACCESS COMING SOON",
    emptyTitle: "No AI agents have account access yet.",
    emptyBody: "When you allow an AI agent to use an account, you will be able to review and manage that permission here.",
    next: "We are finishing the controls for managing agent access."
  },
  approvals: {
    label: "YOUR APPROVALS", title: "Requests waiting for you",
    description: "Review requests from your AI agents before they take an action that needs your permission.",
    icon: "inbox" as const, number: "04",
    state: "APPROVALS COMING SOON",
    emptyTitle: "You're all caught up.",
    emptyBody: "When an AI agent needs your permission, you will see what it wants to do and which account it needs to use before you decide.",
    next: "We are finishing your approval inbox."
  },
  activity: {
    label: "RECENT ACTIVITY", title: "Your activity",
    description: "A simple history of what your AI agents have done with your connected accounts.",
    icon: "activity" as const, number: "05",
    state: "ACTIVITY HISTORY COMING SOON",
    emptyTitle: "Your account activity will appear here.",
    emptyBody: "See when an AI agent uses an account, asks for permission, or loses access.",
    next: "We are preparing your activity history."
  },
  security: {
    label: "YOUR SECURITY", title: "How we protect your accounts",
    description: "Learn how AgentLogin keeps your passwords private and gives you control over what your AI agents can do.",
    icon: "shield" as const, number: "06",
    state: "SECURITY CHECKS IN PROGRESS",
    emptyTitle: "We are putting the final security checks in place.",
    emptyBody: "We are still testing the systems that protect your saved passwords. We will not say account protection is ready until those checks are complete.",
    next: "We are completing and checking the password protection process."
  }
} as const;

type SectionKey = keyof typeof sections;

const navigation = [
  { label: "Overview", href: "/dashboard", icon: "grid" as const },
  { label: "Connected accounts", href: "/dashboard/accounts", icon: "globe" as const, key: "accounts" },
  { label: "Agents", href: "/dashboard/agents", icon: "bot" as const, key: "agents" },
  { label: "Agent access", href: "/dashboard/grants", icon: "ticket" as const, key: "grants" },
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
  let liveDataError = !apiBase ? "We are still connecting your account information. Please try again soon." : !apiToken ? "We could not load your information just now. Please try again in a moment." : "";
  if (apiToken && apiBase && (key === "accounts" || key === "approvals")) {
    try {
      // Provisioning is idempotent: the API derives tenant and user identity
      // from the verified Auth0 token, never from browser-supplied identifiers.
      // The repository uses a transaction lock and returns an existing active
      // membership instead of creating duplicate users or developer workspaces.
      const onboarding = await fetch(new URL("/v1/onboarding", apiBase), {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiToken}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({}),
        cache: "no-store"
      });
      if (!onboarding.ok) {
        liveDataError = onboarding.status === 503
          ? "We are still finishing your account setup. Please try again soon."
          : "We could not finish setting up your account. Please try again in a moment.";
      } else {
        const endpoint = key === "accounts" ? "/v1/connected-accounts" : "/v1/grants/pending";
        const response = await fetch(new URL(endpoint, apiBase), {
          headers: { Authorization: `Bearer ${apiToken}` },
          cache: "no-store"
        });
        if (!response.ok) liveDataError = response.status === 503
          ? "We are still finishing this part of AgentLogin. Please try again soon."
          : "We could not load this information. Please try again in a moment.";
        else {
          const payload = await response.json() as { accounts?: typeof accounts; pending?: typeof approvals };
          if (key === "accounts") accounts = payload.accounts ?? [];
          else approvals = payload.pending ?? [];
        }
      }
    } catch {
      liveDataError = "AgentLogin API is temporarily unavailable.";
    }
  }

  return (
    <main className="workspace-shell workspace-shell-v2">
      <aside className="workspace-sidebar workspace-sidebar-v2">
        <Link className="brand" href="/"><img src="/agentlogin-mark.svg" alt="" /><span>AgentLogin</span></Link>
        <div className="workspace-switcher"><span className="workspace-switcher-mark">A</span><span><small>YOUR ACCOUNT</small><strong>Personal account</strong></span><Icon name="chevron" /></div>
        <div className="sidebar-label">YOUR ACCOUNT</div>
        <nav className="workspace-nav" aria-label="Your account">
          {navigation.map((entry) => <Link key={entry.label} className={entry.key === key ? "side-link active" : "side-link"} href={entry.href}><Icon name={entry.icon} /><span>{entry.label}</span></Link>)}
        </nav>
        <div className="sidebar-label sidebar-label-spaced">SETTINGS</div>
        <nav className="workspace-nav" aria-label="Management navigation">
          <Link className={key === "security" ? "side-link active" : "side-link"} href="/dashboard/security"><Icon name="shield" /><span>Your security</span></Link>
          <Link className="side-link" href="/settings"><Icon name="users" /><span>Team & members</span></Link>
          <Link className="side-link" href="/developers"><Icon name="code" /><span>For developers</span></Link>
        </nav>
        <div className="sidebar-help"><span className="help-icon"><Icon name="book" /></span><strong>Build with AgentLogin</strong><p>Connect your AI assistant to AgentLogin in a few simple steps.</p><Link href="/developers">Getting started <Icon name="arrow" /></Link></div>
        <div className="sidebar-bottom sidebar-bottom-v2"><span className="avatar">{initial}</span><div><strong>{displayName}</strong><small>{session.user.email || "Authenticated account"}</small></div><a href="/auth/logout" aria-label="Sign out"><Icon name="logout" /></a></div>
      </aside>
      <section className="workspace-main workspace-main-v2">
        <header className="workspace-topbar"><div className="workspace-breadcrumb"><Link href="/dashboard">YOUR ACCOUNT</Link><b>/</b><strong>{item.label}</strong></div><div className="topbar-right"><ThemeToggle /><span className="topbar-session"><i /> SIGNED IN</span><Link href="/settings" aria-label="Account settings"><Icon name="settings" /></Link></div></header>
        <section className="workspace-welcome section-page-welcome"><div><span className="section-kicker">YOUR ACCOUNT / {item.number}</span><h1>{item.title}</h1><p>{item.description}</p></div><span className="workspace-coming">{item.state}</span></section>
        {key === "accounts" ? (
          <section className="section-page-card live-data-card">
            <div className="section-page-icon"><Icon name="globe" /></div>
            <span className="section-kicker">CONNECTED ACCOUNTS</span>
            <h2>Connected account directory</h2>
            <p>Only safe account metadata is displayed here. Passwords and encrypted credential material are never sent to the dashboard.</p>
            <div className="live-data-notice" role="status">
              <strong>New account enrollment is temporarily disabled.</strong>
              <span>We are completing the remaining production security checks before accepting any real passwords. Do not send credentials through an AI agent or support message.</span>
            </div>
            {liveDataError ? <p className="live-data-notice">{liveDataError}</p> : accounts.length ? (
              <div className="live-data-list">{accounts.map((account) => (
                <article className="live-data-row" key={account.account_id}>
                  <div><strong>{account.display_label}</strong><small>{account.provider} · {account.origin}</small></div>
                  <span className={account.status === "active" ? "live-status active" : "live-status"}>{account.status}</span>
                </article>
              ))}</div>
            ) : <p className="live-data-notice">No connected accounts yet.</p>}
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
        <footer className="workspace-footer"><span>AGENTLOGIN</span><span>YOUR ACCOUNTS. YOUR PERMISSION. YOUR CONTROL.</span><Link href="/dashboard">BACK TO YOUR ACCOUNT <Icon name="arrow" /></Link></footer>
      </section>
    </main>
  );
}
