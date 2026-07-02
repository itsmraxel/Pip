// Post-turn reflection: after live voice completes a turn, extract mood,
// expression, affinity nudges, and memory notes without blocking speech.

import { google } from "@ai-sdk/google";
import { generateText, Output } from "ai";
import { enrichStudentFromMemory } from "@/lib/memory";
import { buildSystemPrompt } from "@/lib/personality";
import { reflectionResponseSchema } from "@/lib/jarvisSchema";
import type { ChatRequest, ReflectionRequest, ReflectionResponse } from "@/lib/types";

export const maxDuration = 30;

const MODEL = process.env.JARVIS_MODEL || "gemini-2.5-flash";

// #region agent log
function debugLog(hypothesisId: string, message: string, data: unknown) {
  fetch('http://127.0.0.1:7869/ingest/1322e9a3-526c-4f7e-837c-345fe456b255', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '87d609' },
    body: JSON.stringify({ sessionId: '87d609', runId: 'postfix', hypothesisId, location: 'app/api/reflection/route.ts', message, data, timestamp: Date.now() }),
  }).catch(() => {});
}
// #endregion

const fallbackReflection = (): ReflectionResponse => ({
  emotion: "curious",
  emote: null,
  affinityDelta: 0,
  memoryNote: null,
  traitNote: null,
  askName: false,
  nextMood: "neutral",
  learnedName: null,
  proactiveCue: null,
});

export async function POST(req: Request) {
  const body = (await req.json()) as ReflectionRequest;

  // #region agent log
  debugLog('G', 'reflection request received', { userText: body.userText, assistantText: body.assistantText, contextStudentName: body.student?.name ?? null, contextStudentId: body.student?.id ?? null, faces: body.presence?.faces ?? null, hasGoogleKey: Boolean(process.env.GOOGLE_GENERATIVE_AI_API_KEY) });
  // #endregion

  if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
    return Response.json(fallbackReflection());
  }

  const enrichedStudent = body.student
    ? await enrichStudentFromMemory(body.student)
    : null;

  const chatContext: ChatRequest = {
    text: body.userText,
    student: enrichedStudent
      ? {
          name: enrichedStudent.name,
          affinity: enrichedStudent.affinity,
          traits: enrichedStudent.traits,
          memory: enrichedStudent.memory,
        }
      : null,
    presence: body.presence,
    mood: body.mood,
    history: body.history ?? [],
  };

  const history = (body.history ?? [])
    .slice(-8)
    .map((t) => `${t.role === "user" ? "Person" : "Jarvis"}: ${t.text}`)
    .join("\n");

  try {
    const { output } = await generateText({
      model: google(MODEL),
      // Free-tier Gemini has a low per-minute request quota. The default retry
      // policy multiplies every turn into several requests, which exhausts the
      // quota almost immediately and makes memory silently stop working. One
      // attempt per turn keeps us within budget; a rate-limited turn simply
      // skips reflection instead of burning the whole window.
      maxRetries: 0,
      output: Output.object({ schema: reflectionResponseSchema }),
      system: [
        buildSystemPrompt(chatContext),
        "",
        "REFLECTION MODE:",
        "- Jarvis already spoke aloud. Do NOT write a new reply to the student.",
        "- Analyze the exchange that just happened and report Jarvis's updated internal state.",
        "- Set learnedName whenever the student states their own name (e.g. \"I'm Sam\", \"my name is Sam\"), EVEN IF the recognized name in context is different — a different spoken name means this is a different person.",
        "- Do not invent a name; only set learnedName from a name the student actually said.",
        "- Only set memoryNote or traitNote for genuinely new, stable facts.",
        "- proactiveCue is optional: a tiny spontaneous line Jarvis might say if the room goes quiet.",
      ].join("\n"),
      prompt: [
        history ? `Recent conversation:\n${history}\n` : "",
        `The student just said: "${body.userText}"`,
        `Jarvis just replied aloud: "${body.assistantText}"`,
        "Reflect on this exchange as Jarvis.",
      ]
        .filter(Boolean)
        .join("\n"),
    });

    // #region agent log
    debugLog('F', 'reflection model output', { userText: body.userText, contextStudentName: body.student?.name ?? null, learnedName: output.learnedName ?? null, memoryNote: output.memoryNote ?? null, traitNote: output.traitNote ?? null, askName: output.askName ?? null });
    // #endregion
    return Response.json(output satisfies ReflectionResponse);
  } catch (err) {
    // #region agent log
    debugLog('F', 'reflection model THREW (fallback)', { error: err instanceof Error ? err.message : String(err) });
    // #endregion
    console.error("reflection route error", err);
    return Response.json(fallbackReflection());
  }
}
