"use client";

import { useActionState, useState } from "react";
import { createAgent, type CreateAgentState } from "./actions";

const initialState: CreateAgentState = { status: "idle" };

export function AgentCreateForm() {
  const [state, action, pending] = useActionState(createAgent, initialState);
  const [copied, setCopied] = useState(false);

  async function copyToken() {
    if (!state.token) return;
    try {
      await navigator.clipboard.writeText(state.token);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <section className="agent-create-panel">
      <div>
        <span className="section-kicker">REGISTER AN AGENT</span>
        <h3>Create an agent identity</h3>
        <p>Issue an agent credential for your integration. The token is displayed once and is never included in the agent directory.</p>
      </div>
      <form action={action} className="agent-create-form">
        <label>
          <span>AGENT NAME</span>
          <input name="name" type="text" maxLength={120} minLength={1} placeholder="e.g. Customer support assistant" required />
        </label>
        <label>
          <span>IDENTITY TYPE</span>
          <select name="identity_type" defaultValue="assistant">
            <option value="assistant">Assistant</option>
            <option value="service">Service</option>
          </select>
        </label>
        <button className="button button-primary" type="submit" disabled={pending}>
          {pending ? "Registering…" : "Register agent"}
        </button>
      </form>
      {state.status === "error" ? <p className="agent-create-message" role="alert">{state.message}</p> : null}
      {state.status === "created" ? (
        <div className="agent-token-once" role="status">
          <strong>{state.message}</strong>
          <small>Agent ID: {state.agentId}</small>
          <code>{state.token}</code>
          <button className="button button-outline" type="button" onClick={copyToken}>{copied ? "Copied" : "Copy credential"}</button>
          <small>Expires: {state.expiresAt ? new Date(state.expiresAt).toLocaleString() : "Not provided"}</small>
          <p>Store this token in your own secret manager. Do not paste it into support chats or expose it in browser-side logs.</p>
        </div>
      ) : null}
    </section>
  );
}
