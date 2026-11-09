"use client";

import { useActionState } from "react";
import { createApplicationAction, type ApplicationActionState } from "./actions";

const initialState: ApplicationActionState = {};

export function ApplicationCreateForm() {
  const [state, action, pending] = useActionState(createApplicationAction, initialState);
  return (
    <div className="application-create-panel">
      <div>
        <span className="section-kicker">NEW INTEGRATION</span>
        <h2>Create application credentials</h2>
        <p>Use these credentials on your trusted backend to connect your organization to AgentLogin and register agents. The client secret is shown only once.</p>
      </div>
      <form action={action} className="application-create-form">
        <label><span>APPLICATION NAME</span><input name="application_name" required maxLength={120} placeholder="e.g. Customer support agent" /></label>
        <button className="button button-light" type="submit" disabled={pending}>{pending ? "CREATING…" : "Create credentials"}</button>
      </form>
      {state.error ? <p className="application-error" role="alert">{state.error}</p> : null}
      {state.clientId && state.clientSecret ? (
        <div className="application-secret-once" role="status">
          <strong>Save these credentials now</strong>
          <p>The client secret cannot be viewed again. Store it in your backend secret manager before closing this page.</p>
          <div><span>CLIENT ID</span><code>{state.clientId}</code><button type="button" onClick={() => navigator.clipboard.writeText(state.clientId!)}>Copy</button></div>
          <div><span>CLIENT SECRET</span><code>{state.clientSecret}</code><button type="button" onClick={() => navigator.clipboard.writeText(state.clientSecret!)}>Copy</button></div>
        </div>
      ) : null}
    </div>
  );
}
