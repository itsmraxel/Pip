// Browser-safe OpenAI auth for live Realtime voice sessions.
// The browser receives a short-lived ephemeral client secret (ek_...),
// never the long-lived API key.

import OpenAI from "openai";

export const maxDuration = 10;

const REALTIME_MODEL = process.env.OPENAI_REALTIME_MODEL || "gpt-realtime";

export async function POST() {
  const key = process.env.OPENAI_API_KEY;
  if (!key) {
    return Response.json({ error: "OpenAI API key not configured" }, { status: 501 });
  }

  try {
    const ttl = Number(process.env.OPENAI_REALTIME_TOKEN_TTL_SECONDS ?? 600);
    const openai = new OpenAI({ apiKey: key });
    const secret = await openai.realtime.clientSecrets.create({
      expires_after: { anchor: "created_at", seconds: ttl },
      session: { type: "realtime", model: REALTIME_MODEL },
    });

    if (!secret.value) {
      return Response.json({ error: "realtime-token-missing" }, { status: 502 });
    }

    return Response.json(
      { value: secret.value, expires_at: secret.expires_at },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (err) {
    console.error("realtime token route error", err);
    const message = err instanceof Error ? err.message : "realtime-token-failed";
    return Response.json({ error: "realtime-token-failed", message }, { status: 502 });
  }
}
