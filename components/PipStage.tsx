"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { RealtimeAgent, RealtimeSession } from "@openai/agents-realtime";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Pip, type PipHandle } from "@/components/Pip";
import { Vision, type VisionFrame } from "@/lib/vision";
import { matchByFace, matchByName, debugBestFaceScore, debugTopTwoFaceScores } from "@/lib/identity";
import { buildSystemPrompt } from "@/lib/personality";
import { sounds } from "@/lib/sounds";
import { buildStudentPatch, upsertStudentRoster } from "@/lib/studentMemory";
import type { ChatRequest, ChatTurn, Expression, Mood, ReflectionResponse, RoomState, Student } from "@/lib/types";

const MIRROR = true;
const PROACTIVE_GAP_MS = 60_000;
const SILENCE_PROMPT_MS = 45_000;
const MULTI_FACE_GAP_MS = 90_000;
const NO_FACE_LOOK_DELAY_MS = 10_000;
const NO_FACE_NAP_DELAY_MS = 90_000;
const NO_FACE_LOOK_GAP_MS = 18_000;

const EMOTION_MAP: Record<string, Expression> = {
  happy: "happy",
  surprise: "surprised",
  sad: "sad",
  angry: "unimpressed",
  fear: "surprised",
  disgust: "unimpressed",
  neutral: "curious",
};

// OpenAI Realtime handles listening (STT), thinking (LLM), and speaking (TTS)
// in a single speech-to-speech model, so one model + one voice drive the whole
// live conversation loop.
const LIVE_REALTIME_MODEL =
  process.env.NEXT_PUBLIC_OPENAI_REALTIME_MODEL || "gpt-realtime";
const LIVE_REALTIME_VOICE =
  process.env.NEXT_PUBLIC_OPENAI_REALTIME_VOICE || "coral";
const LIVE_INPUT_TRANSCRIBE_MODEL =
  process.env.NEXT_PUBLIC_OPENAI_TRANSCRIBE_MODEL || "gpt-4o-mini-transcribe";

function expressionFromText(text: string): Expression {
  const lower = text.toLowerCase();
  if (lower.includes("?")) return "curious";
  if (/\b(great|awesome|brilliant|nice|yay|hooray|love)\b/.test(lower)) return "happy";
  if (/\b(oops|whoa|wow|surprise)\b/.test(lower)) return "surprised";
  return "excited";
}

function roomStateFromFaces(faces: number): RoomState {
  if (faces === 0) return "empty";
  if (faces > 1) return "multi";
  return "single";
}

export function PipStage() {
  const pipRef = useRef<PipHandle>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const visionRef = useRef<Vision | null>(null);

  const studentsRef = useRef<Student[]>([]);
  const lastFaceCountRef = useRef(0);
  const lastGreetRef = useRef<Record<string, number>>({});
  const lastEmotionRef = useRef<{ label: string | null; at: number }>({ label: null, at: 0 });
  const lastMultiFaceAckRef = useRef(0);
  const noFaceSinceRef = useRef<number | null>(null);
  const lastNoFaceLookRef = useRef(0);
  const emptyRoomNapRef = useRef(false);

  const historyRef = useRef<ChatTurn[]>([]);
  const lastEmbeddingRef = useRef<number[] | null>(null);
  const currentEmotionRef = useRef<string | null>(null);
  const facesRef = useRef(0);
  const moodRef = useRef<Mood>("neutral");
  const roomStateRef = useRef<RoomState>("empty");
  const currentStudentIdRef = useRef<string | null>(null);
  // Name established for the person in the current conversation (via a spoken
  // self-introduction or a confident face match). Authoritative over face.
  const currentNameRef = useRef<string | null>(null);
  // #region agent log
  const lastVisionLogRef = useRef(0);
  const dbgLastIdRef = useRef<string | null>(null);
  const dbgLastIdAtRef = useRef(0);
  const dbgFlipCountRef = useRef(0);
  // #endregion
  const lastInteractionAtRef = useRef(0);
  const lastProactiveAtRef = useRef(0);
  const proactiveCueRef = useRef<string | null>(null);
  const pendingTurnRef = useRef<{ userText: string; assistantText: string } | null>(null);
  const reflectingRef = useRef(false);
  const wasSpeakingRef = useRef(false);

  const agentSessionRef = useRef<RealtimeSession | null>(null);
  const assistantTranscriptRef = useRef<string>("");
  const pendingAssistantTextRef = useRef<string | null>(null);
  const pendingUserTextRef = useRef<string | null>(null);

  const [started, setStarted] = useState(false);
  const [loadingVision, setLoadingVision] = useState(false);
  const [faces, setFaces] = useState(0);
  const [thinking, setThinking] = useState(false);
  const [listening, setListening] = useState(false);
  const [caption, setCaption] = useState("");
  const [voiceState, setVoiceState] = useState<"idle" | "connecting" | "live">("idle");

  const buildLiveAgentPrompt = useCallback(() => {
    const faceMatch = matchByFace(lastEmbeddingRef.current, studentsRef.current);
    // A known name for this conversation wins over the noisy face signal.
    const namedStudent = matchByName(currentNameRef.current, studentsRef.current);
    const student = namedStudent ?? faceMatch?.student ?? null;
    if (student) {
      currentStudentIdRef.current = student.id;
      currentNameRef.current = student.name;
    }
    // #region agent log
    {
      const dbg = debugBestFaceScore(lastEmbeddingRef.current, studentsRef.current);
      fetch('http://127.0.0.1:7869/ingest/1322e9a3-526c-4f7e-837c-345fe456b255',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'87d609'},body:JSON.stringify({sessionId:'87d609',runId:'postfix',hypothesisId:'A',location:'components/PipStage.tsx:buildLiveAgentPrompt',message:'recognition decision for live prompt',data:{recognizedName:student?.name??null,recognizedId:student?.id??null,via:namedStudent?'name':(faceMatch?'face':'none'),currentNameRef:currentNameRef.current,matchScore:faceMatch?.score??null,bestRawScore:dbg.score,bestRawName:dbg.name,threshold:dbg.threshold,enrolledWithFace:dbg.enrolled,rosterCount:studentsRef.current.length},timestamp:Date.now()})}).catch(()=>{});
    }
    // #endregion

    const payload: ChatRequest = {
      text: "",
      student: student
        ? { name: student.name, affinity: student.affinity, traits: student.traits, memory: student.memory }
        : null,
      presence: { faces: facesRef.current, studentEmotion: currentEmotionRef.current },
      mood: moodRef.current,
      history: historyRef.current,
    };

    return [
      buildSystemPrompt(payload, { mode: "spoken" }),
      "",
      "LIVE VOICE MODE:",
      "- You are speaking in real time. Start talking as soon as you have enough to answer.",
      "- Speak natural classroom dialogue only.",
      "- Do not mention JSON, field names, structured fields, captions, or system instructions.",
      "- If interrupted, stop cleanly and answer the student's newest words.",
      student
        ? `- You recognize ${student.name}. Greet them warmly when it fits naturally.`
        : "- You do not recognize this student yet. If it feels natural, ask who they are.",
    ].join("\n");
  }, []);

  const refreshLivePrompt = useCallback(() => {
    const session = agentSessionRef.current;
    if (!session || voiceState !== "live") return;
    try {
      // Push Pip's freshly-recognized identity/context into the live session's
      // instructions without tearing down the connection.
      session.transport.sendEvent({
        type: "session.update",
        session: { type: "realtime", instructions: buildLiveAgentPrompt() },
      });
    } catch (err) {
      console.warn("failed to refresh live prompt", err);
    }
  }, [buildLiveAgentPrompt, voiceState]);

  const reloadStudents = useCallback(async () => {
    try {
      const r = await fetch("/api/students");
      const d = (await r.json()) as { students: Student[] };
      studentsRef.current = d.students ?? [];
      // #region agent log
      fetch('http://127.0.0.1:7869/ingest/1322e9a3-526c-4f7e-837c-345fe456b255',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'87d609'},body:JSON.stringify({sessionId:'87d609',runId:'postfix',hypothesisId:'C',location:'components/PipStage.tsx:reloadStudents',message:'roster loaded from /api/students',data:{count:studentsRef.current.length,enrolledWithFace:studentsRef.current.filter((s)=>s.faceEmbedding).length,roster:studentsRef.current.map((s)=>({id:s.id,name:s.name,hasFace:!!s.faceEmbedding,memoryCount:s.memory.length}))},timestamp:Date.now()})}).catch(()=>{});
      // #endregion
    } catch {
      /* keep in-memory roster */
    }
  }, []);

  const applyReflectionAnimation = useCallback((reflection: ReflectionResponse) => {
    moodRef.current = reflection.nextMood;
    pipRef.current?.setMood(reflection.nextMood);
    pipRef.current?.setExpression(reflection.emotion, 3500);
    if (reflection.emote) {
      pipRef.current?.react(reflection.emote, reflection.emotion);
    }
    proactiveCueRef.current = reflection.proactiveCue;
  }, []);

  const persistReflection = useCallback(
    async (reflection: ReflectionResponse, resolved: { id: string; name: string } | null) => {
      const embedding = lastEmbeddingRef.current;
      const learnedName = reflection.learnedName?.trim() || null;

      // Identity resolution, in order of reliability:
      //   1. A spoken name (from this turn or the ongoing conversation).
      //   2. The student resolved when the turn started (stable mid-turn).
      //   3. A confident face match.
      // A learned name that does NOT match the current record means a *different*
      // person is speaking — create/switch rather than overwriting someone else.
      const nameToUse = learnedName ?? currentNameRef.current;
      const namedStudent = matchByName(nameToUse, studentsRef.current);
      const faceMatch = matchByFace(embedding, studentsRef.current);
      const resolvedStudent = resolved
        ? studentsRef.current.find((s) => s.id === resolved.id) ?? null
        : null;

      let student: Student | null = namedStudent ?? resolvedStudent ?? faceMatch?.student ?? null;
      const isNewPerson = Boolean(learnedName) && !namedStudent;

      // #region agent log
      {
        const branch = isNewPerson ? "create-new" : student ? "update-existing" : "skip-no-id";
        fetch('http://127.0.0.1:7869/ingest/1322e9a3-526c-4f7e-837c-345fe456b255',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'87d609'},body:JSON.stringify({sessionId:'87d609',runId:'postfix',hypothesisId:'B',location:'components/PipStage.tsx:persistReflection',message:'persist decision',data:{learnedName,nameToUse,namedStudentId:namedStudent?.id??null,resolvedStudentId:resolved?.id??null,faceMatchName:faceMatch?.student.name??null,faceMatchScore:faceMatch?.score??null,currentStudentIdRef:currentStudentIdRef.current,currentNameRef:currentNameRef.current,branch,targetStudentId:student?.id??null,memoryNote:reflection.memoryNote??null,traitNote:reflection.traitNote??null},timestamp:Date.now()})}).catch(()=>{});
      }
      // #endregion

      if (isNewPerson) {
        const res = await fetch("/api/students", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: learnedName,
            faceEmbedding: embedding,
            affinity: reflection.affinityDelta,
            traits: reflection.traitNote ? [reflection.traitNote.trim()] : [],
            memory: reflection.memoryNote ? [reflection.memoryNote.trim()] : [],
          }),
        });
        if (res.ok) {
          const data = (await res.json()) as { student: Student };
          student = data.student;
          studentsRef.current = upsertStudentRoster(studentsRef.current, student);
          currentStudentIdRef.current = student.id;
          currentNameRef.current = student.name;
        }
        return student;
      }

      if (!student) return null;
      // Keep the conversation anchored to the resolved identity.
      currentStudentIdRef.current = student.id;
      currentNameRef.current = student.name;
      const studentId = student.id;

      const existing = studentsRef.current.find((s) => s.id === studentId);
      if (!existing) return null;

      const patch = buildStudentPatch(existing, reflection, embedding);
      const res = await fetch("/api/students", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: studentId,
          faceEmbedding: patch.faceEmbedding,
          affinityDelta: reflection.affinityDelta,
          memoryNote: reflection.memoryNote,
          traitNote: reflection.traitNote,
        }),
      });
      if (res.ok) {
        const data = (await res.json()) as { student: Student };
        studentsRef.current = upsertStudentRoster(studentsRef.current, data.student);
        currentStudentIdRef.current = data.student.id;
        return data.student;
      }
      return existing;
    },
    []
  );

  const reflectOnTurn = useCallback(
    async (userText: string, assistantText: string) => {
      if (reflectingRef.current) return;
      reflectingRef.current = true;
      try {
        const namedStudent = matchByName(currentNameRef.current, studentsRef.current);
        const faceMatch = matchByFace(lastEmbeddingRef.current, studentsRef.current);
        const student =
          namedStudent ??
          faceMatch?.student ??
          studentsRef.current.find((knownStudent) => knownStudent.id === currentStudentIdRef.current) ??
          null;

        const res = await fetch("/api/reflection", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            userText,
            assistantText,
            student: student
              ? {
                  id: student.id,
                  name: student.name,
                  affinity: student.affinity,
                  traits: student.traits,
                  memory: student.memory,
                }
              : null,
            faceEmbedding: lastEmbeddingRef.current,
            presence: { faces: facesRef.current, studentEmotion: currentEmotionRef.current },
            mood: moodRef.current,
            history: historyRef.current,
          }),
        });

        if (!res.ok) return;
        const reflection = (await res.json()) as ReflectionResponse;

        applyReflectionAnimation(reflection);
        await persistReflection(reflection, student ? { id: student.id, name: student.name } : null);
        await reloadStudents();
        refreshLivePrompt();
        lastInteractionAtRef.current = Date.now();
      } catch (err) {
        console.warn("reflection failed", err);
      } finally {
        reflectingRef.current = false;
        pendingTurnRef.current = null;
      }
    },
    [applyReflectionAnimation, persistReflection, refreshLivePrompt, reloadStudents]
  );

  useEffect(() => {
    lastInteractionAtRef.current = Date.now();
    return () => {
      visionRef.current?.stop();
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      try {
        agentSessionRef.current?.close();
      } catch {
        /* already closed */
      }
    };
  }, []);

  const onVisionFrame = useCallback((f: VisionFrame) => {
    setFaces(f.faces);
    facesRef.current = f.faces;
    roomStateRef.current = roomStateFromFaces(f.faces);
    lastEmbeddingRef.current = f.embedding ?? null;
    currentEmotionRef.current = f.emotion ?? null;
    if (f.faces === 0) {
      noFaceSinceRef.current ??= Date.now();
      currentStudentIdRef.current = null;
      currentNameRef.current = null;
    } else {
      noFaceSinceRef.current = null;
      emptyRoomNapRef.current = false;
    }
    const pip = pipRef.current;
    if (!pip) return;

    const faceMatch = matchByFace(f.embedding, studentsRef.current);
    // #region agent log
    // H-C: detect per-frame identity flips (matched id changing frame-to-frame).
    if (f.faces > 0 && f.embedding) {
      const matchedId = faceMatch?.student.id ?? null;
      const prevId = dbgLastIdRef.current;
      if (matchedId !== prevId) {
        const now = Date.now();
        const msSincePrev = dbgLastIdAtRef.current ? now - dbgLastIdAtRef.current : -1;
        dbgFlipCountRef.current += 1;
        const tt = debugTopTwoFaceScores(f.embedding, studentsRef.current);
        fetch('http://127.0.0.1:7869/ingest/1322e9a3-526c-4f7e-837c-345fe456b255',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'ccbd32'},body:JSON.stringify({sessionId:'ccbd32',runId:'diagnose',hypothesisId:'C',location:'components/PipStage.tsx:onVisionFrame',message:'identity flip',data:{prevId,matchedId,matchedName:faceMatch?.student.name??null,msSincePrev,totalFlips:dbgFlipCountRef.current,top1:tt.top1,top2:tt.top2,margin:tt.margin,threshold:tt.threshold,enrolled:tt.enrolled},timestamp:now})}).catch(()=>{});
        dbgLastIdRef.current = matchedId;
        dbgLastIdAtRef.current = now;
      }
    }
    // #endregion
    if (faceMatch) currentStudentIdRef.current = faceMatch.student.id;
    // #region agent log
    // H-B/H-D: throttled snapshot of top-two scores + margin vs threshold.
    if (f.faces > 0 && f.embedding && Date.now() - lastVisionLogRef.current > 2500) {
      const tt = debugTopTwoFaceScores(f.embedding, studentsRef.current);
      fetch('http://127.0.0.1:7869/ingest/1322e9a3-526c-4f7e-837c-345fe456b255',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'ccbd32'},body:JSON.stringify({sessionId:'ccbd32',runId:'diagnose',hypothesisId:'B',location:'components/PipStage.tsx:onVisionFrame',message:'top-two score snapshot',data:{faces:f.faces,matchedName:faceMatch?.student.name??null,top1:tt.top1,top2:tt.top2,margin:tt.margin,threshold:tt.threshold,enrolled:tt.enrolled},timestamp:Date.now()})}).catch(()=>{});
    }
    if (f.faces > 0 && Date.now() - lastVisionLogRef.current > 2500) {
      lastVisionLogRef.current = Date.now();
      const dbg = debugBestFaceScore(f.embedding, studentsRef.current);
      fetch('http://127.0.0.1:7869/ingest/1322e9a3-526c-4f7e-837c-345fe456b255',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'87d609'},body:JSON.stringify({sessionId:'87d609',runId:'postfix',hypothesisId:'A',location:'components/PipStage.tsx:onVisionFrame',message:'live face match on frame',data:{faces:f.faces,matchedName:faceMatch?.student.name??null,matchedId:faceMatch?.student.id??null,matchScore:faceMatch?.score??null,bestRawScore:dbg.score,bestRawName:dbg.name,threshold:dbg.threshold,enrolledWithFace:dbg.enrolled,hasEmbedding:!!f.embedding},timestamp:Date.now()})}).catch(()=>{});
    }
    // #endregion

    if (f.nearest) {
      const { width } = pip.stageSize();
      const nx = MIRROR ? 1 - f.nearest.x : f.nearest.x;
      pip.setFollow(nx * width);

      const now = Date.now();
      if (f.emotion && (f.emotion !== lastEmotionRef.current.label || now - lastEmotionRef.current.at > 4000)) {
        lastEmotionRef.current = { label: f.emotion, at: now };
        const expr = EMOTION_MAP[f.emotion];
        if (expr) pip.setExpression(expr, 2000);
      }
    } else {
      pip.setFollow(null);
    }

    if (f.faces > lastFaceCountRef.current) {
      const match = matchByFace(f.embedding, studentsRef.current);
      const now = Date.now();
      if (match && now - (lastGreetRef.current[match.student.id] ?? 0) > 30_000) {
        lastGreetRef.current[match.student.id] = now;
        pip.react("love", "happy");
        pip.setBubble(`Hi ${match.student.name}!`);
        sounds.play("greet");
        window.setTimeout(() => pipRef.current?.hideBubble(), 2400);
      } else if (!match) {
        pip.react("sparkle", "excited");
        pip.setBubble("Oh! Someone new!");
        sounds.play("surprise");
        window.setTimeout(() => pipRef.current?.hideBubble(), 2200);
      } else {
        pip.react("sparkle", "excited");
        sounds.play("surprise");
      }
      lastInteractionAtRef.current = now;
    }

    if (f.faces > 1) {
      const now = Date.now();
      if (now - lastMultiFaceAckRef.current > MULTI_FACE_GAP_MS) {
        lastMultiFaceAckRef.current = now;
        pip.react("sparkle", "curious");
        pip.setBubble(`Wow — ${f.faces} of you!`);
        window.setTimeout(() => pipRef.current?.hideBubble(), 2400);
      }
    }

    lastFaceCountRef.current = f.faces;
  }, []);

  // Ambient life: silence prompts, proactive cues, mood sync.
  useEffect(() => {
    if (!started) return;

    const tick = () => {
      const pip = pipRef.current;
      if (!pip) return;

      const now = Date.now();
      const idleMs = now - lastInteractionAtRef.current;
      const facesCount = facesRef.current;
      const voiceBusy = voiceState === "live" && (listening || thinking);

      pip.setMood(moodRef.current);

      if (facesCount === 0 && !voiceBusy) {
        const emptyForMs = noFaceSinceRef.current ? now - noFaceSinceRef.current : 0;
        if (emptyForMs > NO_FACE_LOOK_DELAY_MS && now - lastNoFaceLookRef.current > NO_FACE_LOOK_GAP_MS) {
          lastNoFaceLookRef.current = now;
          pip.lookAround();
          pip.setExpression("curious", 2200);
        }

        if (emptyForMs > NO_FACE_NAP_DELAY_MS && !emptyRoomNapRef.current) {
          emptyRoomNapRef.current = true;
          moodRef.current = "sleepy";
          pip.nap();
          pip.react("sleep", "sleepy");
        }
      }

      if (facesCount === 0 && !voiceBusy && idleMs > SILENCE_PROMPT_MS) {
        if (now - lastProactiveAtRef.current > PROACTIVE_GAP_MS) {
          const cue =
            proactiveCueRef.current ??
            (moodRef.current === "sleepy" ? "Zzz… anyone still awake?" : "Hello? Anyone still there?");
          pip.setBubble(cue);
          pip.setExpression(moodRef.current === "sleepy" ? "sleepy" : "curious", 2500);
          if (moodRef.current === "sleepy") pip.react("sleep", "sleepy");
          lastProactiveAtRef.current = now;
          proactiveCueRef.current = null;
          window.setTimeout(() => pipRef.current?.hideBubble(), 3200);
        }
      }
    };

    const id = window.setInterval(tick, 3000);
    return () => window.clearInterval(id);
  }, [started, listening, thinking, voiceState]);

  const stopLiveVoice = useCallback(() => {
    try {
      agentSessionRef.current?.close();
    } catch {
      /* already closed */
    }
    agentSessionRef.current = null;
    assistantTranscriptRef.current = "";
    pendingAssistantTextRef.current = null;
    pendingUserTextRef.current = null;
    pendingTurnRef.current = null;
    wasSpeakingRef.current = false;
    setVoiceState("idle");
    setListening(false);
    setThinking(false);
    pipRef.current?.setListening(false);
    pipRef.current?.setSpeaking(false);
    pipRef.current?.setThinking(false);
  }, []);

  const maybeReflectPendingTurn = useCallback(() => {
    const turn = pendingTurnRef.current;
    if (!turn || wasSpeakingRef.current) return;
    void reflectOnTurn(turn.userText, turn.assistantText);
  }, [reflectOnTurn]);

  const startLiveVoice = useCallback(async () => {
    if (agentSessionRef.current || voiceState === "connecting") {
      stopLiveVoice();
      return;
    }

    setVoiceState("connecting");
    setCaption("Connecting Pip's live voice…");

    try {
      const tokenRes = await fetch("/api/realtime-token", { method: "POST" });
      if (!tokenRes.ok) {
        const error = (await tokenRes.json().catch(() => null)) as { message?: string } | null;
        throw new Error(
          `Realtime token ${tokenRes.status}${error?.message ? `: ${error.message}` : ""}`
        );
      }
      const tokenData = (await tokenRes.json()) as { value?: string; model?: string };
      if (!tokenData.value) throw new Error("Realtime token missing");
      const realtimeModel =
        typeof tokenData.model === "string" && tokenData.model.trim()
          ? tokenData.model.trim()
          : LIVE_REALTIME_MODEL;

      const livePrompt = buildLiveAgentPrompt();

      const agent = new RealtimeAgent({
        name: "Pip",
        instructions: livePrompt,
        voice: LIVE_REALTIME_VOICE,
      });

      // OpenAI Realtime speech-to-speech: the WebRTC transport captures the mic
      // and plays Pip's audio automatically, so we only wire up UI/reflection.
      const session = new RealtimeSession(agent, {
        model: realtimeModel,
        config: {
          outputModalities: ["audio"],
          audio: {
            input: {
              transcription: { model: LIVE_INPUT_TRANSCRIBE_MODEL },
              turnDetection: {
                type: "semantic_vad",
                interruptResponse: true,
                createResponse: true,
              },
            },
          },
        },
      });

      agentSessionRef.current = session;
      assistantTranscriptRef.current = "";

      // Agent begins generating a response for the turn.
      session.on("agent_start", () => {
        setListening(false);
        setThinking(true);
        pipRef.current?.setListening(false);
        pipRef.current?.setThinking(true);
        pipRef.current?.setExpression("curious", 1500);
      });

      // Pip started speaking (first audio of the response).
      session.on("audio_start", () => {
        setListening(false);
        setThinking(false);
        pipRef.current?.setListening(false);
        pipRef.current?.setThinking(false);
        pipRef.current?.setSpeaking(true);
        pipRef.current?.speakingPulse();
        if (!wasSpeakingRef.current) sounds.play("speak");
        wasSpeakingRef.current = true;
      });

      // Pip finished speaking — settle the bubble and (if we already have both
      // transcripts) kick off background reflection.
      session.on("audio_stopped", () => {
        pipRef.current?.setSpeaking(false);
        wasSpeakingRef.current = false;
        window.setTimeout(() => pipRef.current?.hideBubble(), 1600);
        maybeReflectPendingTurn();
      });

      // Student barged in while Pip was talking.
      session.on("audio_interrupted", () => {
        if (wasSpeakingRef.current) {
          pipRef.current?.react("surprise", "surprised");
        }
        wasSpeakingRef.current = false;
        setListening(true);
        setThinking(false);
        pipRef.current?.setSpeaking(false);
        pipRef.current?.setThinking(false);
        pipRef.current?.setListening(true);
        lastInteractionAtRef.current = Date.now();
      });

      session.on("error", (event) => {
        console.error("openai realtime error", event);
        toast.error("Pip's live voice hit an error.");
      });

      // Stable end-of-turn signal from the SDK. This is more reliable than only
      // relying on transcript.done ordering.
      session.on("agent_end", (_context, _agent, outputText) => {
        const text = outputText.trim();
        assistantTranscriptRef.current = "";
        if (!text) return;

        setCaption(`Pip: “${text}”`);
        pipRef.current?.setBubble(text);
        pipRef.current?.setExpression(expressionFromText(text), 3500);
        historyRef.current = [
          ...historyRef.current,
          { role: "assistant" as const, text },
        ].slice(-12);

        if (pendingUserTextRef.current) {
          pendingTurnRef.current = {
            userText: pendingUserTextRef.current,
            assistantText: text,
          };
          pendingUserTextRef.current = null;
        } else {
          // Input transcription can lag response generation; hold the assistant
          // line and pair it when the user's transcript arrives.
          pendingAssistantTextRef.current = text;
        }

        lastInteractionAtRef.current = Date.now();
        maybeReflectPendingTurn();
      });

      // Raw transport events give us fine-grained speech + transcript signals.
      session.transport.on("*", (event: { type: string; [key: string]: unknown }) => {
        switch (event.type) {
          case "input_audio_buffer.speech_started": {
            setListening(true);
            setThinking(false);
            pipRef.current?.setListening(true);
            pipRef.current?.setThinking(false);
            lastInteractionAtRef.current = Date.now();
            break;
          }
          case "conversation.item.input_audio_transcription.completed": {
            const text = String(event.transcript ?? "").trim();
            if (!text) break;
            pendingUserTextRef.current = text;
            historyRef.current = [
              ...historyRef.current,
              { role: "user" as const, text },
            ].slice(-12);
            setCaption(`You: “${text}”`);
            lastInteractionAtRef.current = Date.now();
            if (pendingAssistantTextRef.current) {
              pendingTurnRef.current = {
                userText: text,
                assistantText: pendingAssistantTextRef.current,
              };
              pendingUserTextRef.current = null;
              pendingAssistantTextRef.current = null;
              maybeReflectPendingTurn();
            }
            break;
          }
          case "response.output_audio_transcript.delta": {
            assistantTranscriptRef.current += String(event.delta ?? "");
            const partial = assistantTranscriptRef.current.trim();
            if (partial) {
              setCaption(`Pip: “${partial}”`);
              pipRef.current?.setBubble(partial);
              pipRef.current?.speakingPulse();
            }
            break;
          }
          default:
            break;
        }
      });

      await session.connect({
        apiKey: tokenData.value,
        model: realtimeModel,
      });

      setVoiceState("live");
      setListening(true);
      setCaption("Pip is live — just talk.");
      pipRef.current?.setListening(true);
    } catch (err) {
      console.error("live voice failed", err);
      const detail = err instanceof Error ? err.message : null;
      toast.error(detail ? `Pip couldn't start live voice: ${detail}` : "Pip couldn't start live voice.");
      stopLiveVoice();
    }
  }, [buildLiveAgentPrompt, maybeReflectPendingTurn, stopLiveVoice, voiceState]);

  const start = useCallback(async () => {
    try {
      sounds.init();
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => {});
      }
      setStarted(true);
      lastInteractionAtRef.current = Date.now();

      await reloadStudents();

      setLoadingVision(true);
      try {
        const vision = new Vision();
        visionRef.current = vision;
        await vision.load();
        if (videoRef.current) vision.start(videoRef.current, onVisionFrame);
      } catch (err) {
        console.warn("vision failed to load", err);
        toast.error("Couldn't load the camera vision models.");
      } finally {
        setLoadingVision(false);
      }

      pipRef.current?.react("sparkle", "excited");
      sounds.play("greet");
    } catch (err) {
      console.error(err);
      toast.error("Pip needs camera access to see the room.");
    }
  }, [onVisionFrame, reloadStudents]);

  return (
    <div className="relative h-full w-full overflow-hidden bg-background">
      <Pip
        ref={pipRef}
        onPoke={() => {
          lastInteractionAtRef.current = Date.now();
          pipRef.current?.react("annoyed", "unimpressed");
          sounds.play("surprise");
        }}
        onHover={() => {
          lastInteractionAtRef.current = Date.now();
          pipRef.current?.react("music", "happy");
        }}
      />

      <div className="absolute bottom-4 right-4 overflow-hidden rounded-xl border border-border bg-black/60 shadow-2xl">
        <video
          ref={videoRef}
          muted
          playsInline
          className="block h-[195px] w-[260px] scale-x-[-1] object-cover"
          style={{ opacity: started ? 1 : 0 }}
        />
        <div className="pointer-events-none absolute left-2 top-2 rounded-md bg-black/50 px-2 py-0.5 text-xs text-white/90">
          Pip&apos;s view · {faces} {faces === 1 ? "person" : "people"}
        </div>
        {loadingVision && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/60 text-xs text-white/90">
            Waking Pip&apos;s eyes…
          </div>
        )}
      </div>

      {started && (listening || thinking || caption) && (
        <div className="pointer-events-none absolute bottom-28 left-1/2 z-40 w-[min(92vw,720px)] -translate-x-1/2 text-center">
          <p className="inline-block max-w-full rounded-2xl bg-black/70 px-4 py-2 text-base leading-snug text-white shadow-lg">
            {caption || (listening ? "🎤 Listening…" : thinking ? "…" : "")}
          </p>
        </div>
      )}

      {started && (
        <div className="absolute bottom-6 left-1/2 z-40 flex -translate-x-1/2 flex-col items-center gap-2">
          <Button
            className="rounded-full px-6"
            disabled={voiceState === "connecting"}
            onClick={startLiveVoice}
            size="lg"
            variant={voiceState === "live" ? "destructive" : "default"}
          >
            {voiceState === "live" ? "Stop live voice" : voiceState === "connecting" ? "Connecting…" : "Start live voice"}
          </Button>
          <span className="rounded-full bg-black/50 px-3 py-1 text-xs text-white/90">
            {voiceState === "live"
              ? listening
                ? "Live — talk anytime, Pip can barge in naturally"
                : thinking
                ? "Pip is thinking…"
                : "Pip is speaking live…"
              : voiceState === "connecting"
              ? "Opening OpenAI live speech…"
              : "Start once, then talk naturally"}
          </span>
        </div>
      )}

      {!started && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-background/70 backdrop-blur-sm">
          <Button size="lg" onClick={start}>Wake up Pip 🦜</Button>
        </div>
      )}
    </div>
  );
}
