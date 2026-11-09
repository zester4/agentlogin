"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { auth0 } from "../../../lib/auth0";

export async function suspendAgent(formData: FormData): Promise<void> {
  const agentId = formData.get("agent_id");
  if (typeof agentId !== "string" || !/^agt_[A-Za-z0-9_-]{8,300}$/.test(agentId)) {
    redirect("/dashboard/agents?result=invalid");
  }
  const apiBase = process.env.AGENTLOGIN_API_URL;
  if (!apiBase) redirect("/dashboard/agents?result=api_unconfigured");
  const session = await auth0.getSession();
  if (!session) redirect("/auth/login");
  const tokenResult = await auth0.getAccessToken().catch(() => null);
  if (!tokenResult?.token) redirect("/dashboard/agents?result=auth0_unconfigured");
  try {
    const response = await fetch(new URL(`/v1/agents/${encodeURIComponent(agentId)}/suspend`, apiBase), {
      method: "POST",
      headers: { Authorization: `Bearer ${tokenResult.token}` },
      cache: "no-store"
    });
    if (!response.ok) redirect("/dashboard/agents?result=suspend_failed");
  } catch (error) {
    if (error && typeof error === "object" && "digest" in error) throw error;
    redirect("/dashboard/agents?result=api_unavailable");
  }
  revalidatePath("/dashboard/agents");
  redirect("/dashboard/agents?result=suspended");
}

export async function decideApproval(formData: FormData): Promise<void> {
  const grantId = formData.get("grant_id");
  const approvalId = formData.get("approval_id");
  const decision = formData.get("decision");
  if (typeof grantId !== "string" || !/^[A-Za-z0-9_-]{8,300}$/.test(grantId) ||
      typeof approvalId !== "string" || approvalId.length < 8 || approvalId.length > 300 ||
      (decision !== "approved" && decision !== "denied")) {
    redirect("/dashboard/approvals?result=invalid");
  }

  const apiBase = process.env.AGENTLOGIN_API_URL;
  if (!apiBase) redirect("/dashboard/approvals?result=api_unconfigured");
  const session = await auth0.getSession();
  if (!session) redirect("/auth/login");
  const tokenResult = await auth0.getAccessToken().catch(() => null);
  if (!tokenResult?.token) redirect("/dashboard/approvals?result=auth0_unconfigured");

  try {
    const response = await fetch(new URL(`/v1/grants/${encodeURIComponent(grantId)}/approval`, apiBase), {
      method: "POST",
      headers: { Authorization: `Bearer ${tokenResult.token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ approval_id: approvalId, decision }),
      cache: "no-store"
    });
    if (!response.ok) redirect("/dashboard/approvals?result=decision_failed");
  } catch (error) {
    if (error && typeof error === "object" && "digest" in error) throw error;
    redirect("/dashboard/approvals?result=api_unavailable");
  }
  revalidatePath("/dashboard/approvals");
  redirect(`/dashboard/approvals?result=${decision}`);
}


export type CreateAgentState = {
  status: "idle" | "error" | "created";
  message?: string;
  agentId?: string;
  token?: string;
  expiresAt?: string;
};

export async function createAgent(
  _previousState: CreateAgentState,
  formData: FormData
): Promise<CreateAgentState> {
  const name = formData.get("name");
  const identityType = formData.get("identity_type");
  if (typeof name !== "string" || name.trim().length < 1 || name.trim().length > 120 ||
      typeof identityType !== "string" || !["assistant", "service"].includes(identityType)) {
    return { status: "error", message: "Enter a valid agent name and identity type." };
  }
  const apiBase = process.env.AGENTLOGIN_API_URL;
  if (!apiBase) return { status: "error", message: "AgentLogin API is not configured." };
  const session = await auth0.getSession();
  if (!session) return { status: "error", message: "Your session has expired. Sign in again." };
  const tokenResult = await auth0.getAccessToken().catch(() => null);
  if (!tokenResult?.token) return { status: "error", message: "We could not verify your session with AgentLogin." };

  try {
    const onboarding = await fetch(new URL("/v1/onboarding", apiBase), {
      method: "POST",
      headers: { Authorization: `Bearer ${tokenResult.token}`, "Content-Type": "application/json" },
      body: JSON.stringify({}),
      cache: "no-store"
    });
    if (!onboarding.ok) return { status: "error", message: "Your workspace is not ready for agent registration." };
    const workspace = await onboarding.json() as { developer_id?: string };
    if (!workspace.developer_id) return { status: "error", message: "Your developer workspace could not be identified." };

    const response = await fetch(new URL(`/v1/developers/${encodeURIComponent(workspace.developer_id)}/agents`, apiBase), {
      method: "POST",
      headers: { Authorization: `Bearer ${tokenResult.token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ name: name.trim(), identity_type: identityType }),
      cache: "no-store"
    });
    if (!response.ok) return { status: "error", message: "Agent registration failed. Check your workspace permissions and try again." };
    const result = await response.json() as { agent_id?: string; credential?: { token?: string; expires_at?: string; display_once?: boolean } };
    if (!result.agent_id || !result.credential?.token || !result.credential.expires_at || result.credential.display_once !== true) {
      return { status: "error", message: "Agent registration returned an incomplete credential response. Contact support before retrying." };
    }
    revalidatePath("/dashboard/agents");
    return {
      status: "created",
      message: "Agent registered. Copy its credential now; it will not be shown again.",
      agentId: result.agent_id,
      token: result.credential.token,
      expiresAt: result.credential.expires_at
    };
  } catch {
    return { status: "error", message: "AgentLogin is temporarily unavailable. No credential was displayed." };
  }
}


export async function revokeGrant(formData: FormData): Promise<void> {
  const grantId = formData.get("grant_id");
  if (typeof grantId !== "string" || !/^[A-Za-z0-9_-]{8,300}$/.test(grantId)) {
    redirect("/dashboard/grants?result=invalid");
  }
  const apiBase = process.env.AGENTLOGIN_API_URL;
  if (!apiBase) redirect("/dashboard/grants?result=api_unconfigured");
  const session = await auth0.getSession();
  if (!session) redirect("/auth/login");
  const tokenResult = await auth0.getAccessToken().catch(() => null);
  if (!tokenResult?.token) redirect("/dashboard/grants?result=auth0_unconfigured");
  try {
    const response = await fetch(new URL(`/v1/grants/${encodeURIComponent(grantId)}/revoke`, apiBase), {
      method: "POST",
      headers: { Authorization: `Bearer ${tokenResult.token}` },
      cache: "no-store"
    });
    if (!response.ok) redirect("/dashboard/grants?result=revoke_failed");
  } catch (error) {
    if (error && typeof error === "object" && "digest" in error) throw error;
    redirect("/dashboard/grants?result=api_unavailable");
  }
  revalidatePath("/dashboard/grants");
  redirect("/dashboard/grants?result=revoked");
}
