import Link from "next/link";
import { redirect } from "next/navigation";
import { auth0 } from "../../../lib/auth0";
import { Icon } from "../../ui-icon";
import { ThemeToggle } from "../../theme-toggle";
import { DashboardNavigation } from "../dashboard-navigation";
import { decideApproval } from "./actions";
import { AgentSuspendControl } from "./agent-suspend-control";
import { AgentCreateForm } from "./agent-create-form";
import { GrantRevokeControl } from "./grant-revoke-control";

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
    state: "AGENT DIRECTORY",
    emptyTitle: "No AI agents registered yet.",
    emptyBody: "Agents registered in your developer workspace will appear here with safe identity and status metadata.",
    next: "Register an agent through the AgentLogin developer API; credential values are never listed here."
  },
  grants: {
    label: "AGENT ACCESS", title: "Agent access",
    description: "See which accounts your AI agents can use and what they are allowed to do.",
    icon: "ticket" as const, number: "03",
    state: "LIVE GRANT DIRECTORY",
    emptyTitle: "No AI agents have account access yet.",
    emptyBody: "When you allow an AI agent to use an account, you will be able to review and manage that permission here.",
    next: "Review, expire, and revoke each permission from this directory."
  },
  approvals: {
    label: "YOUR APPROVALS", title: "Requests waiting for you",
    description: "Review requests from your AI agents before they take an action that needs your permission.",
    icon: "inbox" as const, number: "04",
    state: "LIVE APPROVAL INBOX",
    emptyTitle: "You're all caught up.",
    emptyBody: "When an AI agent needs your permission, you will see what it wants to do and which account it needs to use before you decide.",
    next: "We are finishing your approval inbox."
  },
  activity: {
    label: "RECENT ACTIVITY", title: "Your activity",
    description: "A simple history of what your AI agents have done with your connected accounts.",
    icon: "activity" as const, number: "05",
    state: "LIVE AUDIT ACTIVITY",
    emptyTitle: "Your account activity will appear here.",
    emptyBody: "See when an AI agent uses an account, asks for permission, or loses access.",
    next: "Only activity associated with your authenticated account and grants is shown."
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
  let agents: Array<{ agent_id: string; developer_id: string; developer_name: string; can_manage: boolean; name: string; identity_type: string; status: string; created_at: string }> = [];
  let grants: Array<{ grant_id: string; agent_id: string; agent_name: string; account_id: string; account_label: string; origin: string; scopes: string[]; task_id: string | null; issued_at: string; expires_at: string; revoked_at: string | null; approval_decision: string | null; decided_at: string | null }> = [];
  let activity: Array<{ event_id: string; event_type: string; actor_type: string; decision: string | null; resource_ref: string | null; correlation_id: string | null; created_at: string }> = [];
  let approvals: Array<{ grantId: string; approvalId: string; agentId: string; agentName: string; accountId: string; accountLabel: string; origin: string; scopes: string[]; taskId: string | null; expiresAt: string; requestedAt: string }> = [];
  let liveDataError = !apiBase ? "We are still connecting your account information. Please try again soon." : !apiToken ? "We could not load your information just now. Please try again in a moment." : "";
  if (apiToken && apiBase && (key === "accounts" || key === "approvals" || key === "agents" || key === "grants" || key === "activity")) {
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
        const endpoint = key === "accounts" ? "/v1/connected-accounts" : key === "approvals" ? "/v1/grants/pending" : key === "agents" ? "/v1/agents" : key === "grants" ? "/v1/grants" : "/v1/activity";
        const response = await fetch(new URL(endpoint, apiBase), {
          headers: { Authorization: `Bearer ${apiToken}` },
          cache: "no-store"
        });
        if (!response.ok) liveDataError = response.status === 503
          ? "We are still finishing this part of AgentLogin. Please try again soon."
          : "We could not load this information. Please try again in a moment.";
        else {
          const payload = await response.json() as { accounts?: typeof accounts; pending?: typeof approvals; agents?: typeof agents; grants?: typeof grants; events?: typeof activity };
          if (key === "accounts") accounts = payload.accounts ?? [];
          else if (key === "approvals") approvals = payload.pending ?? [];
          else if (key === "agents") agents = payload.agents ?? [];
          else if (key === "grants") grants = payload.grants ?? [];
          else activity = payload.events ?? [];
        }
      }
    } catch {
      liveDataError = "AgentLogin API is temporarily unavailable.";
    }
  }

  return (
    <main className="workspace-shell workspace-shell-v2">
      <DashboardNavigation name={displayName} email={session.user.email || "Authenticated account"} />
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
        ) : key === "agents" ? (
          <section className="section-page-card live-data-card">
            <div className="section-page-icon"><Icon name="bot" /></div>
            <span className="section-kicker">REGISTERED AGENTS</span>
            <h2>Agent directory</h2>
            <p>Review the agents registered in your developer workspace. Only identity and lifecycle metadata is displayed; agent tokens are never returned by this directory.</p>
            <AgentCreateForm />
            {liveDataError ? <p className="live-data-notice" role="status">{liveDataError}</p> : agents.length ? (
              <div className="live-data-list">{agents.map((agent) => (
                <article className="live-data-row" key={agent.agent_id}>
                  <div>
                    <strong>{agent.name}</strong>
                    <small>{agent.identity_type} · {agent.developer_name} · {agent.agent_id}</small>
                    <small>Added {new Date(agent.created_at).toLocaleString()}</small>
                  </div>
                  <div className="agent-row-actions">
                    <span className={agent.status === "active" ? "live-status active" : "live-status"}>{agent.status}</span>
                    {agent.status === "active" && agent.can_manage ? <AgentSuspendControl agentId={agent.agent_id} /> : null}
                  </div>
                </article>
              ))}</div>
            ) : <p className="live-data-notice">{sections.agents.emptyTitle} {sections.agents.emptyBody}</p>}
          </section>
        ) : key === "grants" ? (
          <section className="section-page-card live-data-card">
            <div className="section-page-icon"><Icon name="ticket" /></div>
            <span className="section-kicker">ACCOUNT PERMISSIONS</span>
            <h2>Agent access grants</h2>
            <p>Review each grant's agent, connected account, exact origin, approved scope, expiry and current decision. Revocation is confirmed before it is submitted.</p>
            {liveDataError ? <p className="live-data-notice" role="status">{liveDataError}</p> : grants.length ? (
              <div className="live-data-list">{grants.map((grant) => {
                const expired = new Date(grant.expires_at).getTime() <= Date.now();
                const status = grant.revoked_at ? "revoked" : expired ? "expired" : grant.approval_decision === "approved" ? "active" : grant.approval_decision === "denied" ? "denied" : "pending";
                const revocable = !grant.revoked_at && !expired && grant.approval_decision !== "denied";
                return (
                  <article className="grant-row" key={grant.grant_id}>
                    <div className="grant-row-head">
                      <div><strong>{grant.agent_name}</strong><small>{grant.account_label} · {grant.origin}</small></div>
                      <span className={status === "active" ? "live-status active" : "live-status"}>{status}</span>
                    </div>
                    <div className="approval-scopes">{grant.scopes.map((scope) => <span key={scope}>{scope}</span>)}</div>
                    <small>Issued {new Date(grant.issued_at).toLocaleString()} · Expires {new Date(grant.expires_at).toLocaleString()}</small>
                    {revocable ? <GrantRevokeControl grantId={grant.grant_id} /> : null}
                  </article>
                );
              })}</div>
            ) : <p className="live-data-notice">No access grants have been issued for your account.</p>}
          </section>
        ) : key === "activity" ? (
          <section className="section-page-card live-data-card">
            <div className="section-page-icon"><Icon name="activity" /></div>
            <span className="section-kicker">AUDIT HISTORY</span>
            <h2>Recent account activity</h2>
            <p>Events are filtered to your authenticated user and grants owned by your account. Secret values and raw credential material are never included.</p>
            {liveDataError ? <p className="live-data-notice" role="status">{liveDataError}</p> : activity.length ? (
              <div className="live-data-list">{activity.map((event) => (
                <article className="activity-row" key={event.event_id}>
                  <div><strong>{event.event_type.replaceAll(".", " ")}</strong><small>{event.actor_type}{event.decision ? ` · ${event.decision}` : ""}</small></div>
                  <small>{new Date(event.created_at).toLocaleString()}</small>
                </article>
              ))}</div>
            ) : <p className="live-data-notice">No account activity has been recorded yet.</p>}
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
