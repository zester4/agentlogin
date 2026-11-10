import { auth0 } from "../../../../lib/auth0";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const session = await auth0.getSession();
  if (!session) {
    return Response.json({ error: { code: "unauthorized", message: "Sign in is required." } }, { status: 401 });
  }

  const apiBase = process.env.AGENTLOGIN_API_URL;
  if (!apiBase) {
    return Response.json({ error: { code: "api_unavailable", message: "The AgentLogin API is not configured." } }, { status: 503 });
  }

  const accessToken = await auth0.getAccessToken().catch(() => null);
  if (!accessToken?.token) {
    return Response.json({ error: { code: "unauthorized", message: "A valid API session is required." } }, { status: 401 });
  }

  try {
    const headers = new Headers({
      Authorization: `Bearer ${accessToken.token}`,
      Accept: "text/event-stream",
    });
    const lastEventId = request.headers.get("last-event-id") ?? new URL(request.url).searchParams.get("cursor");
    if (lastEventId) headers.set("Last-Event-ID", lastEventId);

    const upstream = await fetch(new URL("/v1/activity/stream", apiBase), {
      method: "GET",
      headers,
      cache: "no-store",
      signal: request.signal,
    });

    if (!upstream.ok || !upstream.body) {
      return Response.json(
        { error: { code: "activity_stream_unavailable", message: "Live activity is temporarily unavailable." } },
        { status: upstream.status || 503 }
      );
    }

    return new Response(upstream.body, {
      status: 200,
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-store, must-revalidate",
        "X-Accel-Buffering": "no",
      },
    });
  } catch {
    return Response.json(
      { error: { code: "activity_stream_unavailable", message: "Live activity is temporarily unavailable." } },
      { status: 503 }
    );
  }
}
