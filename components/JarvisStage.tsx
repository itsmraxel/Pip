"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AgentMicrophone, AgentPlayer, AgentSession, type AgentSessionConfig } from "@deepgram/agents";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Jarvis, type JarvisHandle } from "@/components/Jarvis";
import { Vision, type VisionFrame } from "@/lib/vision";
import { matchByFace, matchByName, debugBestFaceScore, debugTopTwoFaceScores } from "@/lib/identity";
import { buildSystemPrompt } from "@/lib/personality";
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

const LIVE_AGENT_LISTEN_MODEL =
  process.env.NEXT_PUBLIC_DEEPGRAM_AGENT_LISTEN_MODEL || "flux-general-en";
const LIVE_AGENT_THINK_MODEL =
  process.env.NEXT_PUBLIC_DEEPGRAM_AGENT_THINK_MODEL || "gemini-2.5-flash";
const LIVE_AGENT_SPEAK_MODEL =
  process.env.NEXT_PUBLIC_DEEPGRAM_AGENT_SPEAK_MODEL || "aura-2-aurora-en";
type LiveAgentThinkProvider = "google" | "open_ai" | "anthropic";

function getLiveAgentThinkProvider(): LiveAgentThinkProvider {
  const provider = process.env.NEXT_PUBLIC_DEEPGRAM_AGENT_THINK_PROVIDER;
  if (provider === "open_ai" || provider === "anthropic" || provider === "google") {
    return provider;
  }
  return "google";
}

const LIVE_AGENT_THINK_PROVIDER = getLiveAgentThinkProvider();

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

export function JarvisStage() {
  const jarvisRef = useRef<JarvisHandle>(null);
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

  const agentSessionRef = useRef<AgentSession | null>(null);
  const agentMicRef = useRef<AgentMicrophone | null>(null);
  const agentPlayerRef = useRef<AgentPlayer | null>(null);
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
      fetch('http://127.0.0.1:7869/ingest/1322e9a3-526c-4f7e-837c-345fe456b255',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'87d609'},body:JSON.stringify({sessionId:'87d609',runId:'postfix',hypothesisId:'A',location:'components/JarvisStage.tsx:buildLiveAgentPrompt',message:'recognition decision for live prompt',data:{recognizedName:student?.name??null,recognizedId:student?.id??null,via:namedStudent?'name':(faceMatch?'face':'none'),currentNameRef:currentNameRef.current,matchScore:faceMatch?.score??null,bestRawScore:dbg.score,bestRawName:dbg.name,threshold:dbg.threshold,enrolledWithFace:dbg.enrolled,rosterCount:studentsRef.current.length},timestamp:Date.now()})}).catch(()=>{});
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
      session.updatePrompt(buildLiveAgentPrompt());
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
      fetch('http://127.0.0.1:7869/ingest/1322e9a3-526c-4f7e-837c-345fe456b255',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'87d609'},body:JSON.stringify({sessionId:'87d609',runId:'postfix',hypothesisId:'C',location:'components/JarvisStage.tsx:reloadStudents',message:'roster loaded from /api/students',data:{count:studentsRef.current.length,enrolledWithFace:studentsRef.current.filter((s)=>s.faceEmbedding).length,roster:studentsRef.current.map((s)=>({id:s.id,name:s.name,hasFace:!!s.faceEmbedding,memoryCount:s.memory.length}))},timestamp:Date.now()})}).catch(()=>{});
      // #endregion
    } catch {
      /* keep in-memory roster */
    }
  }, []);

  const applyReflectionAnimation = useCallback((reflection: ReflectionResponse) => {
    moodRef.current = reflection.nextMood;
    jarvisRef.current?.setMood(reflection.nextMood);
    jarvisRef.current?.setExpression(reflection.emotion, 3500);
    if (reflection.emote) {
      jarvisRef.current?.react(reflection.emote, reflection.emotion);
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
        fetch('http://127.0.0.1:7869/ingest/1322e9a3-526c-4f7e-837c-345fe456b255',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'87d609'},body:JSON.stringify({sessionId:'87d609',runId:'postfix',hypothesisId:'B',location:'components/JarvisStage.tsx:persistReflection',message:'persist decision',data:{learnedName,nameToUse,namedStudentId:namedStudent?.id??null,resolvedStudentId:resolved?.id??null,faceMatchName:faceMatch?.student.name??null,faceMatchScore:faceMatch?.score??null,currentStudentIdRef:currentStudentIdRef.current,currentNameRef:currentNameRef.current,branch,targetStudentId:student?.id??null,memoryNote:reflection.memoryNote??null,traitNote:reflection.traitNote??null},timestamp:Date.now()})}).catch(()=>{});
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
      agentMicRef.current?.stop();
      agentSessionRef.current?.disconnect();
      agentPlayerRef.current?.dispose();
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
    const jarvis = jarvisRef.current;
    if (!jarvis) return;

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
        fetch('http://127.0.0.1:7869/ingest/1322e9a3-526c-4f7e-837c-345fe456b255',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'ccbd32'},body:JSON.stringify({sessionId:'ccbd32',runId:'diagnose',hypothesisId:'C',location:'components/JarvisStage.tsx:onVisionFrame',message:'identity flip',data:{prevId,matchedId,matchedName:faceMatch?.student.name??null,msSincePrev,totalFlips:dbgFlipCountRef.current,top1:tt.top1,top2:tt.top2,margin:tt.margin,threshold:tt.threshold,enrolled:tt.enrolled},timestamp:now})}).catch(()=>{});
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
      fetch('http://127.0.0.1:7869/ingest/1322e9a3-526c-4f7e-837c-345fe456b255',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'ccbd32'},body:JSON.stringify({sessionId:'ccbd32',runId:'diagnose',hypothesisId:'B',location:'components/JarvisStage.tsx:onVisionFrame',message:'top-two score snapshot',data:{faces:f.faces,matchedName:faceMatch?.student.name??null,top1:tt.top1,top2:tt.top2,margin:tt.margin,threshold:tt.threshold,enrolled:tt.enrolled},timestamp:Date.now()})}).catch(()=>{});
    }
    if (f.faces > 0 && Date.now() - lastVisionLogRef.current > 2500) {
      lastVisionLogRef.current = Date.now();
      const dbg = debugBestFaceScore(f.embedding, studentsRef.current);
      fetch('http://127.0.0.1:7869/ingest/1322e9a3-526c-4f7e-837c-345fe456b255',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'87d609'},body:JSON.stringify({sessionId:'87d609',runId:'postfix',hypothesisId:'A',location:'components/JarvisStage.tsx:onVisionFrame',message:'live face match on frame',data:{faces:f.faces,matchedName:faceMatch?.student.name??null,matchedId:faceMatch?.student.id??null,matchScore:faceMatch?.score??null,bestRawScore:dbg.score,bestRawName:dbg.name,threshold:dbg.threshold,enrolledWithFace:dbg.enrolled,hasEmbedding:!!f.embedding},timestamp:Date.now()})}).catch(()=>{});
    }
    // #endregion

    if (f.nearest) {
      const { width } = jarvis.stageSize();
      const nx = MIRROR ? 1 - f.nearest.x : f.nearest.x;
      jarvis.setFollow(nx * width);

      const now = Date.now();
      if (f.emotion && (f.emotion !== lastEmotionRef.current.label || now - lastEmotionRef.current.at > 4000)) {
        lastEmotionRef.current = { label: f.emotion, at: now };
        const expr = EMOTION_MAP[f.emotion];
        if (expr) jarvis.setExpression(expr, 2000);
      }
    } else {
      jarvis.setFollow(null);
    }

    if (f.faces > lastFaceCountRef.current) {
      const match = matchByFace(f.embedding, studentsRef.current);
      const now = Date.now();
      if (match && now - (lastGreetRef.current[match.student.id] ?? 0) > 30_000) {
        lastGreetRef.current[match.student.id] = now;
        jarvis.react("love", "happy");
        jarvis.setBubble(`Hi ${match.student.name}!`);
        window.setTimeout(() => jarvisRef.current?.hideBubble(), 2400);
      } else if (!match) {
        jarvis.react("sparkle", "excited");
        jarvis.setBubble("Oh! Someone new!");
        window.setTimeout(() => jarvisRef.current?.hideBubble(), 2200);
      } else {
        jarvis.react("sparkle", "excited");
      }
      lastInteractionAtRef.current = now;
    }

    if (f.faces > 1) {
      const now = Date.now();
      if (now - lastMultiFaceAckRef.current > MULTI_FACE_GAP_MS) {
        lastMultiFaceAckRef.current = now;
        jarvis.react("sparkle", "curious");
        jarvis.setBubble(`Wow — ${f.faces} of you!`);
        window.setTimeout(() => jarvisRef.current?.hideBubble(), 2400);
      }
    }

    lastFaceCountRef.current = f.faces;
  }, []);

  // Ambient life: silence prompts, proactive cues, mood sync.
  useEffect(() => {
    if (!started) return;

    const tick = () => {
      const jarvis = jarvisRef.current;
      if (!jarvis) return;

      const now = Date.now();
      const idleMs = now - lastInteractionAtRef.current;
      const facesCount = facesRef.current;
      const voiceBusy = voiceState === "live" && (listening || thinking);

      jarvis.setMood(moodRef.current);

      if (facesCount === 0 && !voiceBusy) {
        const emptyForMs = noFaceSinceRef.current ? now - noFaceSinceRef.current : 0;
        if (emptyForMs > NO_FACE_LOOK_DELAY_MS && now - lastNoFaceLookRef.current > NO_FACE_LOOK_GAP_MS) {
          lastNoFaceLookRef.current = now;
          jarvis.lookAround();
          jarvis.setExpression("curious", 2200);
        }

        if (emptyForMs > NO_FACE_NAP_DELAY_MS && !emptyRoomNapRef.current) {
          emptyRoomNapRef.current = true;
          moodRef.current = "sleepy";
          jarvis.nap();
          jarvis.react("sleep", "sleepy");
        }
      }

      if (facesCount === 0 && !voiceBusy && idleMs > SILENCE_PROMPT_MS) {
        if (now - lastProactiveAtRef.current > PROACTIVE_GAP_MS) {
          const cue =
            proactiveCueRef.current ??
            (moodRef.current === "sleepy" ? "Zzz… anyone still awake?" : "Hello? Anyone still there?");
          jarvis.setBubble(cue);
          jarvis.setExpression(moodRef.current === "sleepy" ? "sleepy" : "curious", 2500);
          if (moodRef.current === "sleepy") jarvis.react("sleep", "sleepy");
          lastProactiveAtRef.current = now;
          proactiveCueRef.current = null;
          window.setTimeout(() => jarvisRef.current?.hideBubble(), 3200);
        }
      }
    };

    const id = window.setInterval(tick, 3000);
    return () => window.clearInterval(id);
  }, [started, listening, thinking, voiceState]);

  const stopLiveVoice = useCallback(() => {
    agentMicRef.current?.stop();
    agentSessionRef.current?.disconnect();
    agentPlayerRef.current?.dispose();
    agentMicRef.current = null;
    agentSessionRef.current = null;
    agentPlayerRef.current = null;
    pendingAssistantTextRef.current = null;
    pendingUserTextRef.current = null;
    pendingTurnRef.current = null;
    wasSpeakingRef.current = false;
    setVoiceState("idle");
    setListening(false);
    setThinking(false);
    jarvisRef.current?.setListening(false);
    jarvisRef.current?.setSpeaking(false);
    jarvisRef.current?.setThinking(false);
  }, []);

  const showPendingAssistantText = useCallback(() => {
    const text = pendingAssistantTextRef.current;
    if (!text) return;
    pendingAssistantTextRef.current = null;
    setCaption(`Jarvis: “${text}”`);
    jarvisRef.current?.setBubble(text);
    jarvisRef.current?.setExpression(expressionFromText(text), 3500);
  }, []);

  const startLiveVoice = useCallback(async () => {
    if (agentSessionRef.current || voiceState === "connecting") {
      stopLiveVoice();
      return;
    }

    setVoiceState("connecting");
    setCaption("Connecting Jarvis's live voice…");

    try {
      const player = new AgentPlayer({ sampleRate: 24000 });
      const isFluxListenModel = LIVE_AGENT_LISTEN_MODEL.startsWith("flux-");
      const livePrompt = buildLiveAgentPrompt();
      // #region agent log
      fetch('http://127.0.0.1:7869/ingest/1322e9a3-526c-4f7e-837c-345fe456b255',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'ea53cc'},body:JSON.stringify({sessionId:'ea53cc',runId:'initial',hypothesisId:'A',location:'components/JarvisStage.tsx:startLiveVoice:prompt',message:'live prompt built for deepgram config',data:{promptLength:livePrompt.length,hasSpokenGuard:livePrompt.includes('Only speak the words the student should hear'),hasStructuredDirective:livePrompt.includes('using the structured fields'),thinkProvider:LIVE_AGENT_THINK_PROVIDER,thinkModel:LIVE_AGENT_THINK_MODEL,promptTail:livePrompt.slice(-400)},timestamp:Date.now()})}).catch(()=>{});
      // #endregion
      const config: AgentSessionConfig = {
        auth: {
          tokenFactory: async () => {
            const res = await fetch("/api/deepgram-token", { method: "POST" });
            if (!res.ok) {
              const error = (await res.json().catch(() => null)) as { message?: string } | null;
              throw new Error(`Deepgram token ${res.status}${error?.message ? `: ${error.message}` : ""}`);
            }
            const data = (await res.json()) as { access_token?: string };
            if (!data.access_token) throw new Error("Deepgram token missing");
            return data.access_token;
          },
        },
        audio: {
          input: { encoding: "linear16", sampleRate: 16000 },
          output: { encoding: "linear16", sampleRate: 24000 },
        },
        agent: {
          listen: {
            provider: isFluxListenModel
              ? {
                  type: "deepgram",
                  version: "v2",
                  model: LIVE_AGENT_LISTEN_MODEL,
                }
              : {
                  type: "deepgram",
                  version: "v1",
                  model: LIVE_AGENT_LISTEN_MODEL,
                  smart_format: true,
                },
          },
          think: {
            provider: {
              type: LIVE_AGENT_THINK_PROVIDER,
              model: LIVE_AGENT_THINK_MODEL,
              temperature: 0.7,
            },
            prompt: livePrompt,
          },
          speak: {
            provider: {
              type: "deepgram",
              model: LIVE_AGENT_SPEAK_MODEL,
            },
          },
        },
        tags: ["jarvis", "live-voice"],
      };

      const session = new AgentSession(config);
      const mic = new AgentMicrophone((data) => session.sendAudio(data), {
        sampleRate: 16000,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      });

      agentPlayerRef.current = player;
      agentSessionRef.current = session;
      agentMicRef.current = mic;

      session.on("settings-applied", () => {
        setVoiceState("live");
        setListening(true);
        setCaption("Jarvis is live — just talk.");
        jarvisRef.current?.setListening(true);
      });

      session.on("user-started-speaking", () => {
        if (wasSpeakingRef.current) {
          jarvisRef.current?.react("surprise", "surprised");
        }
        player.interrupt();
        setListening(true);
        setThinking(false);
        jarvisRef.current?.setSpeaking(false);
        jarvisRef.current?.setThinking(false);
        jarvisRef.current?.setListening(true);
        lastInteractionAtRef.current = Date.now();
      });

      session.on("agent-thinking", () => {
        setListening(false);
        setThinking(true);
        jarvisRef.current?.setListening(false);
        jarvisRef.current?.setThinking(true);
        jarvisRef.current?.setExpression("curious", 1500);
      });

      session.on("conversation-text", (msg) => {
        const text = msg.content.trim();
        // #region agent log
        fetch('http://127.0.0.1:7869/ingest/1322e9a3-526c-4f7e-837c-345fe456b255',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'ea53cc'},body:JSON.stringify({sessionId:'ea53cc',runId:'initial',hypothesisId:'B',location:'components/JarvisStage.tsx:conversation-text',message:'raw conversation-text from deepgram',data:{role:msg.role,content:msg.content,hasCrypticField:/facial_expression|next_mood|nextMood|affinity_update|affinity|traitNote|memoryNote|learnedName|askName/i.test(msg.content)},timestamp:Date.now()})}).catch(()=>{});
        // #endregion
        if (!text) return;

        if (msg.role === "user") {
          pendingUserTextRef.current = text;
          historyRef.current = [...historyRef.current, { role: "user" as const, text }].slice(-12);
          setCaption(`You: “${text}”`);
          lastInteractionAtRef.current = Date.now();
          return;
        }

        historyRef.current = [...historyRef.current, { role: "assistant" as const, text }].slice(-12);
        pendingAssistantTextRef.current = text;
        if (pendingUserTextRef.current) {
          pendingTurnRef.current = {
            userText: pendingUserTextRef.current,
            assistantText: text,
          };
          pendingUserTextRef.current = null;
        }
        setThinking(false);
        jarvisRef.current?.setThinking(false);
        lastInteractionAtRef.current = Date.now();
      });

      session.on("audio", (chunk) => {
        showPendingAssistantText();
        player.queue(chunk);
        jarvisRef.current?.setSpeaking(true);
        jarvisRef.current?.speakingPulse();
        wasSpeakingRef.current = true;
      });

      session.on("agent-started-speaking", () => {
        showPendingAssistantText();
        setListening(false);
        setThinking(false);
        jarvisRef.current?.setListening(false);
        jarvisRef.current?.setThinking(false);
        jarvisRef.current?.setSpeaking(true);
        wasSpeakingRef.current = true;
      });

      session.on("agent-audio-done", () => {
        jarvisRef.current?.setSpeaking(false);
        wasSpeakingRef.current = false;
        window.setTimeout(() => jarvisRef.current?.hideBubble(), 1600);

        const turn = pendingTurnRef.current;
        if (turn) {
          void reflectOnTurn(turn.userText, turn.assistantText);
        }
      });

      session.on("error", (msg) => {
        console.error("deepgram agent error", msg);
        toast.error("Jarvis's live voice hit a Deepgram error.");
      });

      session.on("warning", (msg) => {
        console.warn("deepgram agent warning", msg);
      });

      session.on("sdk-error", (err) => {
        console.error("deepgram agent sdk error", err);
        toast.error("Jarvis couldn't keep the live voice connected.");
        stopLiveVoice();
      });

      mic.on("error", (err) => {
        console.error("deepgram microphone error", err);
        toast.error("Jarvis couldn't access the microphone.");
        stopLiveVoice();
      });

      await session.connect();
      await mic.start();
    } catch (err) {
      console.error("live voice failed", err);
      toast.error("Jarvis couldn't start live voice.");
      stopLiveVoice();
    }
  }, [buildLiveAgentPrompt, reflectOnTurn, showPendingAssistantText, stopLiveVoice, voiceState]);

  const start = useCallback(async () => {
    try {
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

      jarvisRef.current?.react("sparkle", "excited");
    } catch (err) {
      console.error(err);
      toast.error("Jarvis needs camera access to see the room.");
    }
  }, [onVisionFrame, reloadStudents]);

  return (
    <div className="relative h-full w-full overflow-hidden bg-background">
      <Jarvis
        ref={jarvisRef}
        onPoke={() => {
          lastInteractionAtRef.current = Date.now();
          jarvisRef.current?.react("annoyed", "unimpressed");
        }}
        onHover={() => {
          lastInteractionAtRef.current = Date.now();
          jarvisRef.current?.react("music", "happy");
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
          Jarvis&apos;s view · {faces} {faces === 1 ? "person" : "people"}
        </div>
        {loadingVision && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/60 text-xs text-white/90">
            Waking Jarvis&apos;s eyes…
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
                ? "Live — talk anytime, Jarvis can barge in naturally"
                : thinking
                ? "Jarvis is thinking…"
                : "Jarvis is speaking live…"
              : voiceState === "connecting"
              ? "Opening Deepgram live speech…"
              : "Start once, then talk naturally"}
          </span>
        </div>
      )}

      {!started && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-background/70 backdrop-blur-sm">
          <Button size="lg" onClick={start}>Wake up Jarvis</Button>
        </div>
      )}
    </div>
  );
}
