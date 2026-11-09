import { redirect } from "next/navigation";
import { auth0 } from "../../../lib/auth0";
import { DashboardNavigation } from "../dashboard-navigation";
import { ThemeToggle } from "../../theme-toggle";
import { Icon } from "../../ui-icon";
import { ApplicationCreateForm } from "./application-create-form";

export const metadata = { title: "Developer applications" };

type Developer = { developer_id: string; name: string; role: string };
type Application = { application_id: string; name: string; client_id: string; status: string; created_at: string };

export default async function ApplicationsPage() {
  const session = await auth0.getSession();
  if (!session) redirect("/auth/login");
  const displayName = session.user.name || session.user.email?.split("@")[0] || "there";
  const apiBase = process.env.AGENTLOGIN_API_URL;
  const access = apiBase ? await auth0.getAccessToken().catch(() => null) : null;
  let developers: Developer[] = [];
  let applications: Application[] = [];
  let loadError = "";
  if (apiBase && access?.token) {
    const headers = { Authorization: `Bearer ${access.token}` };
    try {
      await fetch(new URL("/v1/onboarding", apiBase), { method: "POST", headers, body: "{}", cache: "no-store" });
      const response = await fetch(new URL("/v1/developers", apiBase), { headers, cache: "no-store" });
      if (response.ok) {
        const payload = await response.json() as { developers?: Developer[] };
        developers = payload.developers ?? [];
        if (developers[0]) {
          const appResponse = await fetch(new URL(`/v1/developers/${encodeURIComponent(developers[0].developer_id)}/applications`, apiBase), { headers, cache: "no-store" });
          if (appResponse.ok) applications = (await appResponse.json() as { applications?: Application[] }).applications ?? [];
        }
      } else loadError = "Developer workspace data is temporarily unavailable.";
    } catch { loadError = "Could not reach the AgentLogin API."; }
  } else loadError = "Developer API access is not configured.";

  return (
    <main className="workspace-shell workspace-shell-v2">
      <DashboardNavigation name={displayName} email={session.user.email || "Authenticated account"} />
      <section className="workspace-main workspace-main-v2">
        <header className="workspace-topbar">
          <div className="workspace-breadcrumb"><span>DEVELOPER</span><b>/</b><strong>APPLICATIONS</strong></div>
          <div className="topbar-right"><ThemeToggle /><span className="topbar-session"><i /> SIGNED IN</span></div>
        </header>
        <section className="workspace-welcome section-page-welcome">
          <div><span className="section-kicker">DEVELOPER SETTINGS</span><h1>Applications</h1><p>Create credentials for backend integrations and agent runtimes.</p></div>
          <span className="workspace-coming">CLIENT SECRET SHOWN ONCE</span>
        </section>
        {loadError ? <div className="application-load-error" role="status"><Icon name="info" />{loadError}</div> : null}
        <ApplicationCreateForm />
        <section className="workspace-panel-v2 application-list-panel">
          <div className="panel-heading"><div><span className="section-kicker">YOUR INTEGRATIONS</span><h3>Registered applications</h3></div><span className="workspace-coming">{applications.length} ACTIVE</span></div>
          {applications.length ? <div className="application-list">{applications.map((app) => (
            <article className="application-list-row" key={app.application_id}>
              <div><strong>{app.name}</strong><small>{app.client_id}</small></div>
              <span className="live-status active">{app.status}</span>
            </article>
          ))}</div> : <div className="empty-state"><span className="empty-state-icon"><Icon name="code" /></span><strong>No applications yet</strong><p>Create an application above to get a client ID and one-time client secret.</p></div>}
        </section>
        <section className="workspace-security-strip">
          <div><span className="section-kicker">SECURITY</span><h3>Keep application secrets on your server.</h3><p>Never place client secrets in browser code, prompts, source control, or client-side mobile applications. Rotate or revoke leaked credentials immediately.</p></div>
        </section>
      </section>
    </main>
  );
}
