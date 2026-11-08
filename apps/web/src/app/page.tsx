import { auth0 } from "../lib/auth0";

export default async function Home() {
  const session = await auth0.getSession();

  return (
    <main className="shell">
      <header>
        <span className="wordmark">AgentLogin</span>
        <span className="status">Private beta foundation</span>
      </header>
      <section className="hero">
        <p className="eyebrow">IDENTITY · PERMISSION · EXECUTION</p>
        <h1>Your accounts.<br />Your rules.</h1>
        <p className="lead">
          Give agents controlled access to the accounts they need without handing over your credentials.
        </p>
        {session ? (
          <div className="notice">
            <strong>Signed in{session.user.name ? `, ${session.user.name}` : ""}</strong>
            <span>{session.user.email ?? "Authenticated Auth0 user"}</span>
            <a href="/auth/logout">Log out</a>
          </div>
        ) : (
          <div className="notice">
            <strong>Sign in to AgentLogin</strong>
            <span>Authenticate securely to access your workspace.</span>
            <p>
              <a href="/auth/login">Log in</a>
              {" · "}
              <a href="/auth/login?screen_hint=signup">Create account</a>
            </p>
          </div>
        )}
      </section>
      <footer>AgentLogin keeps credentials inside its trusted execution boundary.</footer>
    </main>
  );
}
