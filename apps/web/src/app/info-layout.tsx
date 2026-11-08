import Link from "next/link";
import type { ReactNode } from "react";

export function InfoLayout({ eyebrow, title, intro, children }: { eyebrow: string; title: string; intro: string; children: ReactNode }) {
  return <main className="site-shell info-shell">
    <header className="top-nav"><Link className="brand" href="/"><img src="/agentlogin-mark.svg" alt="" /><span>AgentLogin</span></Link><nav className="nav-links"><Link href="/how-it-works">How it works</Link><Link href="/security">Security</Link><Link href="/developers">Developers</Link></nav><Link className="nav-action" href="/auth/login">Sign in <span>↗</span></Link></header>
    <section className="info-hero"><span className="section-kicker">{eyebrow}</span><h1>{title}</h1><p>{intro}</p></section>
    <article className="info-content">{children}</article>
    <footer className="info-footer"><Link href="/">← Back to AgentLogin</Link><div><Link href="/privacy">Privacy</Link><Link href="/terms">Terms</Link><Link href="/acceptable-use">Acceptable use</Link><Link href="/security-disclosure">Security disclosure</Link><Link href="/cookies">Cookies</Link></div></footer>
  </main>;
}

export function InfoSection({ title, children }: { title: string; children: ReactNode }) {
  return <section className="info-section"><h2>{title}</h2><div>{children}</div></section>;
}
