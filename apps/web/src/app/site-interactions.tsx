"use client";

import { useState } from "react";

export function SiteInteractions() {
  const [notice, setNotice] = useState(true);
  return notice ? <div className="announcement"><span>AGENTLOGIN</span><p>Credential access, built for AI agents.</p><a href="#security">Explore the security model ↗</a><button aria-label="Dismiss announcement" onClick={() => setNotice(false)}>×</button></div> : null;
}
