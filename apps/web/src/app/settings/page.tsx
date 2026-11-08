import Link from "next/link";
import { redirect } from "next/navigation";
import { auth0 } from "../../lib/auth0";

export default async function SettingsPage() {
  const session = await auth0.getSession();
  if (!session) redirect("/auth/login");
  return <main className="workspace-shell">
    <aside className="workspace-sidebar"><Link className="brand" href="/"><img src="/agentlogin-mark.svg" alt="" /><span>AgentLogin</span></Link><div className="sidebar-label">WORKSPACE</div><Link className="side-link" href="/dashboard">▦ &nbsp; Overview</Link><Link className="side-link active" href="/settings">⚙ &nbsp; Settings</Link><div className="sidebar-bottom"><span className="avatar">{(session.user.name || session.user.email || "A").slice(0,1).toUpperCase()}</span><div><strong>{session.user.name || "Account"}</strong><small>{session.user.email || "Authenticated account"}</small></div><a href="/auth/logout" aria-label="Sign out">↗</a></div></aside>
    <section className="workspace-main"><header className="workspace-header"><div><span className="section-kicker">WORKSPACE / SETTINGS</span><h1>Settings</h1><p>Manage your identity and understand your security boundary.</p></div><Link className="text-link" href="/dashboard">← Back to overview</Link></header>
      <div className="settings-list">
        <section className="settings-card"><div className="settings-heading"><span>01</span><div><h2>Account identity</h2><p>Your authenticated dashboard identity.</p></div></div><div className="settings-fields"><div><small>NAME</small><strong>{session.user.name || "Not provided"}</strong></div><div><small>EMAIL</small><strong>{session.user.email || "Not provided"}</strong></div><div><small>IDENTITY PROVIDER</small><strong>Auth0</strong></div></div></section>
        <section className="settings-card"><div className="settings-heading"><span>02</span><div><h2>Session security</h2><p>Your dashboard session is separate from agent authorization.</p></div></div><div className="settings-action"><div><strong>Authenticated session</strong><small>Managed by the configured Auth0 application.</small></div><a className="button button-outline" href="/auth/logout">Sign out ↗</a></div></section>
        <section className="settings-card"><div className="settings-heading"><span>03</span><div><h2>Agent permissions</h2><p>Agent access is designed to be narrow, time-bound, and revocable.</p></div></div><div className="settings-callout"><b>DESIGNED SECURITY RULE</b><p>A grant is not a password. It is bound to an authenticated agent, tenant, connected account, exact origin, approved scopes, expiry, and execution context.</p></div><div className="coming-soon">AGENT AND GRANT MANAGEMENT UI · NOT ENABLED YET</div></section>
        <section className="settings-card"><div className="settings-heading"><span>04</span><div><h2>Connected accounts</h2><p>Credential connections will be listed here when account-linking workflows are enabled.</p></div></div><div className="coming-soon">NO CONNECTED ACCOUNTS DISPLAYED</div></section>
      </div>
    </section>
  </main>;
}
