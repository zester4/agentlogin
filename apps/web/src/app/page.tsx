export default function Home() {
  return <main className="shell">
    <header><span className="wordmark">AgentLogin</span><span className="status">Private beta foundation</span></header>
    <section className="hero">
      <p className="eyebrow">IDENTITY · PERMISSION · EXECUTION</p>
      <h1>Your accounts.<br />Your rules.</h1>
      <p className="lead">Give agents controlled access to the accounts they need without handing over your credentials.</p>
      <div className="notice"><strong>Control plane scaffold</strong><span>Connected accounts, agent permissions, approvals, and audit activity will appear here as those systems are implemented.</span></div>
    </section>
    <footer>AgentLogin keeps credentials inside its trusted execution boundary.</footer>
  </main>;
}
