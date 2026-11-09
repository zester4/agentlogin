"use client";

import { revokeApplicationAction } from "./actions";

export function ApplicationRevokeButton({ applicationId }: { applicationId: string }) {
  return (
    <form action={revokeApplicationAction} onSubmit={(event) => {
      if (!window.confirm("Revoke this application? Its active application tokens will stop working immediately.")) {
        event.preventDefault();
      }
    }}>
      <input type="hidden" name="application_id" value={applicationId} />
      <button className="application-revoke-button" type="submit">Revoke</button>
    </form>
  );
}
