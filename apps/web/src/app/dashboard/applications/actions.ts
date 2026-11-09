"use server";

import { auth0 } from "../../../lib/auth0";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

export type ApplicationActionState = {
  error?: string;
  clientId?: string;
  clientSecret?: string;
  applicationName?: string;
};

export async function createApplicationAction(
  _previous: ApplicationActionState,
  formData: FormData
): Promise<ApplicationActionState> {
  const applicationName = String(formData.get("application_name") ?? "").trim();
  if (!applicationName || applicationName.length > 120) {
    return { error: "Enter a valid application name." };
  }
  const session = await auth0.getSession();
  if (!session) return { error: "Your session expired. Sign in again." };
  const apiBase = process.env.AGENTLOGIN_API_URL;
  const access = apiBase ? await auth0.getAccessToken().catch(() => null) : null;
  if (!apiBase || !access?.token) return { error: "Developer API access is not configured yet." };

  const headers = { Authorization: `Bearer ${access.token}`, "Content-Type": "application/json" };
  try {
    const onboardingResponse = await fetch(new URL("/v1/onboarding", apiBase), { method: "POST", headers, body: "{}", cache: "no-store" });
    if (!onboardingResponse.ok) return { error: "We couldn't finish setting up your organization. Please try again." };
    const onboarding = await onboardingResponse.json().catch(() => null) as { developer_id?: string } | null;
    let developerId = onboarding?.developer_id;
    if (!developerId) {
      const listResponse = await fetch(new URL("/v1/developers", apiBase), { headers, cache: "no-store" });
      if (!listResponse.ok) return { error: "We couldn't load your organization. Please try again." };
      const list = await listResponse.json() as { developers?: Array<{ developer_id: string }> };
      developerId = list.developers?.[0]?.developer_id;
    }
    if (!developerId) return { error: "Your organization setup is incomplete. Please contact support." };
    const response = await fetch(new URL(`/v1/developers/${encodeURIComponent(developerId)}/applications`, apiBase), {
      method: "POST", headers, body: JSON.stringify({ name: applicationName }), cache: "no-store"
    });
    const payload = await response.json().catch(() => null) as { client_id?: string; client_secret?: string } | null;
    if (!response.ok || !payload?.client_id || !payload.client_secret) {
      if (response.status === 503) return { error: "Application credentials are temporarily unavailable. Please try again shortly." };
      if (response.status === 403) return { error: "You don't have permission to create applications for this organization." };
      if (response.status === 401) return { error: "Your sign-in has expired. Sign in again and retry." };
      return { error: "We couldn't create these application credentials. Please try again." };
    }
    return { clientId: payload.client_id, clientSecret: payload.client_secret, applicationName };
  } catch {
    return { error: "AgentLogin could not reach the API. Try again in a moment." };
  }
}

export async function revokeApplicationAction(formData: FormData): Promise<void> {
  const applicationId = String(formData.get("application_id") ?? "");
  if (!applicationId || applicationId.length > 200) redirect("/dashboard/applications?error=invalid_application");
  const session = await auth0.getSession();
  if (!session) redirect("/auth/login");
  const apiBase = process.env.AGENTLOGIN_API_URL;
  const access = apiBase ? await auth0.getAccessToken().catch(() => null) : null;
  if (!apiBase || !access?.token) redirect("/dashboard/applications?error=api_unavailable");
  let revoked = false;
  try {
    const response = await fetch(new URL(`/v1/developer-applications/${encodeURIComponent(applicationId)}`, apiBase), {
      method: "DELETE", headers: { Authorization: `Bearer ${access.token}` }, cache: "no-store"
    });
    revoked = response.ok;
  } catch { revoked = false; }
  if (!revoked) redirect("/dashboard/applications?error=revoke_failed");
  revalidatePath("/dashboard/applications");
  redirect("/dashboard/applications?revoked=1");
}
