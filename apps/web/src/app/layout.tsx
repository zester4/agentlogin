import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./styles.css";

export const metadata: Metadata = {
  title: { default: "AgentLogin — Secure access for AI agents", template: "%s | AgentLogin" },
  description: "Give AI agents controlled access to accounts without exposing passwords, tokens, or session secrets.",
  icons: { icon: "/favicon.svg" },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return <html lang="en"><body>{children}</body></html>;
}
