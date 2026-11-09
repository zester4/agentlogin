"use client";

import { useState } from "react";
import { suspendAgent } from "./actions";

export function AgentSuspendControl({ agentId }: { agentId: string }) {
  const [confirming, setConfirming] = useState(false);

  if (!confirming) {
    return (
      <button className="button button-outline" type="button" onClick={() => setConfirming(true)}>
        Suspend agent
      </button>
    );
  }

  return (
    <div className="agent-suspend-confirm">
      <form action={suspendAgent}>
        <input type="hidden" name="agent_id" value={agentId} />
        <button className="button button-outline" type="submit">Confirm suspension</button>
      </form>
      <button className="button button-quiet" type="button" onClick={() => setConfirming(false)}>
        Cancel
      </button>
    </div>
  );
}
