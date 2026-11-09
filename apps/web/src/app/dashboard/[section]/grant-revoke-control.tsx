"use client";

import { useState } from "react";
import { revokeGrant } from "./actions";

export function GrantRevokeControl({ grantId }: { grantId: string }) {
  const [confirming, setConfirming] = useState(false);

  if (!confirming) {
    return (
      <button className="button button-outline" type="button" onClick={() => setConfirming(true)}>
        Revoke access
      </button>
    );
  }

  return (
    <div className="agent-suspend-confirm">
      <form action={revokeGrant}>
        <input type="hidden" name="grant_id" value={grantId} />
        <button className="button button-outline" type="submit">Confirm revocation</button>
      </form>
      <button className="button button-quiet" type="button" onClick={() => setConfirming(false)}>
        Cancel
      </button>
    </div>
  );
}
