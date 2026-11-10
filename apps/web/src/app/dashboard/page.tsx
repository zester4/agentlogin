import type { ReactNode } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { auth0 } from "../../lib/auth0";
import { Icon } from "../ui-icon";
import { ThemeToggle } from "../theme-toggle";
import { DashboardNavigation } from "./dashboard-navigation";
import { DashboardLiveSync } from "./dashboard-live-sync";

function ComingSoon({ children }: { children: ReactNode }) {
  return <span className="workspace-coming">{children}</span>;
}

export default async function DashboardPage() {
  const session = await auth0.getSession();
  if (!session) redirect("/auth/login");

  // Provision the verified Auth0 user on the first dashboard visit. The API
  // derives tenant/user identity from the signed access token; this idempotent
  // endpoint reuses existing membership and never accepts browser tenant IDs.
  const apiBase = process.env.AGENTLOGIN_API_URL;
  const apiTokenResult = apiBase ? await auth0.getAccessToken().catch(() => null) : null;
  let identityVerified = false;
  let metrics: { accounts: number | null; agents: number | null; grants: number | null; approvals: number | null } = {
    accounts: null, agents: null, grants: null, approvals: null
  };

  if (apiBase && apiTokenResult?.token) {
    try {
      const headers = { Authorization: `Bearer ${apiTokenResult.token}` };
      const onboardingResponse = await fetch(new URL("/v1/onboarding", apiBase), {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({}),
        cache: "no-store"
      });

      // Onboarding creates/reuses the local membership. Only then can the
      // stricter user endpoint confirm that the signed tenant claim resolves
      // to an active AgentLogin membership. Keep identity fields server-side.
      if (onboardingResponse.ok) {
        const identityResponse = await fetch(new URL("/v1/user/me", apiBase), {
          method: "GET",
          headers,
          cache: "no-store"
        });
        if (identityResponse.ok) {
          const identity = await identityResponse.json().catch(() => null);
          identityVerified = identity?.authenticated === true;
          if (identityVerified) {
            const paths = ["/v1/connected-accounts", "/v1/agents", "/v1/grants", "/v1/grants/pending"];
            const responses = await Promise.all(paths.map((path) => fetch(new URL(path, apiBase), { headers, cache: "no-store" }).catch(() => null)));
            const payloads = await Promise.all(responses.map((response) => response?.ok ? response.json().catch(() => null) : null));
            const count = (payload: unknown, field: string): number | null => {
              if (!payload || typeof payload !== "object") return null;
              const value = (payload as Record<string, unknown>)[field];
              return Array.isArray(value) ? value.length : null;
            };
            metrics = {
              accounts: count(payloads[0], "accounts"),
              agents: count(payloads[1], "agents"),
              grants: count(payloads[2], "grants"),
              approvals: count(payloads[3], "pending")
            };
          }
        }
      }
    } catch {
      // Dashboard access remains available, but identity is not marked verified.
    }
  }

  const displayName = session.user.name || session.user.email?.split("@")[0] || "there";

  return (
    <main className="workspace-shell workspace-shell-v2" id="overview">
      <DashboardNavigation name={displayName} email={session.user.email || "Authenticated account"} />

      <section className="workspace-main workspace-main-v2">
        <header className="workspace-topbar">
          <div className="workspace-breadcrumb"><span>YOUR ACCOUNT</span><b>/</b><strong>OVERVIEW</strong></div>
          <div className="topbar-right"><ThemeToggle /><DashboardLiveSync enabled={identityVerified && Boolean(apiBase)} /><span className="topbar-session"><i /> SIGNED IN</span><Link href="/settings" aria-label="Account settings"><Icon name="settings" /></Link></div>
        </header>

        <section className="workspace-welcome">
          <div>
            <span className="section-kicker">YOUR ACCOUNT</span>
            <h1>Good to see you, {displayName}.</h1>
            <p>Your agents. Your accounts. Your rules.</p>
          </div>
          <div className="welcome-date"><span>ACCOUNT STATUS</span><strong><i /> {identityVerified ? "IDENTITY VERIFIED" : "GETTING STARTED"}</strong></div>
        </section>

        <section className="workspace-metrics" aria-label="Your account at a glance">
          <article className="metric-card"><div><span>CONNECTED ACCOUNTS</span><Icon name="globe" /></div><strong>{metrics.accounts ?? "—"}</strong><small>{metrics.accounts === null ? "Account data unavailable" : "Account records in your workspace"}</small></article>
          <article className="metric-card"><div><span>YOUR AI AGENTS</span><Icon name="bot" /></div><strong>{metrics.agents ?? "—"}</strong><small>{metrics.agents === null ? "Agent data unavailable" : "Registered agent identities"}</small></article>
          <article className="metric-card"><div><span>AGENT ACCESS</span><Icon name="ticket" /></div><strong>{metrics.grants ?? "—"}</strong><small>{metrics.grants === null ? "Grant data unavailable" : "Access grants owned by you"}</small></article>
          <article className="metric-card"><div><span>PENDING APPROVALS</span><Icon name="inbox" /></div><strong>{metrics.approvals ?? "—"}</strong><small>{metrics.approvals === null ? "Approval data unavailable" : "Requests awaiting your decision"}</small></article>
        </section>

        <section className="workspace-section-heading">
          <div><span className="section-kicker">KEEPING YOUR ACCOUNTS SAFE</span><h2>Your AgentLogin overview</h2></div>
          <span className="workspace-preview-label">{identityVerified ? "LIVE ACCOUNT OVERVIEW" : "ACCOUNT SETUP IN PROGRESS"}</span>
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

        <footer className="workspace-footer"><span>AGENTLOGIN</span><span>SECURE ACCESS FOR YOUR TEAM</span><Link href="/settings">ACCOUNT SETTINGS <Icon name="arrow" /></Link></footer>
      </section>
    </main>
  );
}
