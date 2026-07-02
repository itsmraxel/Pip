// Browser-safe Deepgram auth for live Voice Agent sessions.
// The browser receives a short-lived JWT, never the long-lived API key.

export const maxDuration = 10;

export async function POST() {
  const key = process.env.DEEPGRAM_API_KEY;
  if (!key) {
    return Response.json({ error: "Deepgram API key not configured" }, { status: 501 });
  }

  try {
    const ttl = Number(process.env.DEEPGRAM_TOKEN_TTL_SECONDS ?? 30);
    const res = await fetch("https://api.deepgram.com/v1/auth/grant", {
      method: "POST",
      headers: {
        Authorization: `Token ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ttl_seconds: ttl }),
    });

    if (!res.ok) {
      console.error("deepgram token grant failed", res.status);
      let message = "Deepgram token grant failed";
      try {
        const errorBody = (await res.json()) as { err_msg?: string; message?: string };
        message = errorBody.err_msg ?? errorBody.message ?? message;
      } catch {
        const text = await res.text().catch(() => "");
        if (text) message = text.slice(0, 200);
      }
      return Response.json({ error: "deepgram-token-failed", message }, { status: res.status });
    }

    const data = (await res.json()) as {
      access_token?: string;
      expires_in?: number;
    };

    if (!data.access_token) {
      return Response.json({ error: "deepgram-token-missing" }, { status: 502 });
    }

    return Response.json(data, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (err) {
    console.error("deepgram token route error", err);
    return Response.json({ error: "deepgram-token-failed" }, { status: 502 });
  }
}
