"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { auth0 } from "../../../lib/auth0";

export async function decideApproval(formData: FormData): Promise<void> {
  const grantId = formData.get("grant_id");
  const approvalId = formData.get("approval_id");
  const decision = formData.get("decision");
  if (typeof grantId !== "string" || !/^grt_[A-Za-z0-9_-]{8,200}$/.test(grantId) ||
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
