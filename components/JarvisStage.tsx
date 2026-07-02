"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AgentMicrophone, AgentPlayer, AgentSession, type AgentSessionConfig } from "@deepgram/agents";
import { toast } from "sonner";
import { ChevronDown, MessageSquare, SendHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import { Message, MessageContent } from "@/components/ai-elements/message";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Jarvis, type JarvisHandle } from "@/components/Jarvis";
import { Vision, type VisionFrame } from "@/lib/vision";
import { matchByFace, matchByName } from "@/lib/identity";
import { averageEmbedding, resolveFace, FACE_WINDOW_MS, FACE_WINDOW_N } from "@/lib/faceRecognition";
import { buildSystemPrompt } from "@/lib/personality";
import { PERSONALITIES, DEFAULT_PERSONALITY_ID, getPersonality, type PersonalityId } from "@/lib/personalities";
import { buildStudentPatch, upsertStudentRoster } from "@/lib/studentMemory";
import type { ChatRequest, ChatResponse, ChatTurn, Expression, Mood, ReflectionResponse, RoomState, Student } from "@/lib/types";

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
// Optional global override for the spoken voice. When unset (the default),
// each personality supplies its own Aura-2 voice via getPersonality().
const LIVE_AGENT_SPEAK_MODEL_OVERRIDE =
  process.env.NEXT_PUBLIC_DEEPGRAM_AGENT_SPEAK_MODEL || null;

// Cap the visible transcript so long sessions don't pile up base64 webcam
// photos in React state (each user message can carry one).
const MAX_CHAT_MESSAGES = 50;
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

  // Rolling window of recent good-quality embeddings, averaged before matching
  // so identity decisions are smoothed instead of made per noisy frame.
  const embeddingWindowRef = useRef<{ emb: number[]; t: number }[]>([]);
  const historyRef = useRef<ChatTurn[]>([]);
  const lastEmbeddingRef = useRef<number[] | null>(null);
  const currentEmotionRef = useRef<string | null>(null);
  const facesRef = useRef(0);
  const moodRef = useRef<Mood>("neutral");
  const personalityRef = useRef<PersonalityId>(DEFAULT_PERSONALITY_ID);
  const roomStateRef = useRef<RoomState>("empty");
  const currentStudentIdRef = useRef<string | null>(null);
  // Name established for the person in the current conversation (via a spoken
  // self-introduction or a confident face match). Authoritative over face.
  const currentNameRef = useRef<string | null>(null);
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
  const [personality, setPersonality] = useState<PersonalityId>(DEFAULT_PERSONALITY_ID);

  // Live chat transcript shown in the collapsible chat box above the camera.
  // Each message pins its own avatar at capture time — the speaker's photo for
  // user turns, the producing persona's emoji for assistant turns — so later
  // snapshots or personality switches never rewrite earlier bubbles.
  type ChatMessage = {
    id: string;
    role: "user" | "assistant";
    text: string;
    photo?: string | null;
    emoji?: string;
  };
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [chatOpen, setChatOpen] = useState(true);
  const [chatInput, setChatInput] = useState("");
  const [sending, setSending] = useState(false);
  const msgIdRef = useRef(0);
  const ttsAudioRef = useRef<HTMLAudioElement | null>(null);

  // Grab a square snapshot of the current speaker from the webcam to use as
  // their chat profile picture. Returns the data URL (or null if the video
  // isn't ready / capture failed) so the caller can pin it to that message.
  const capturePersonPhoto = useCallback((): string | null => {
    const video = videoRef.current;
    if (!video || video.readyState < 2 || !video.videoWidth) return null;
    const out = 96;
    const canvas = document.createElement("canvas");
    canvas.width = out;
    canvas.height = out;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    const side = Math.min(video.videoWidth, video.videoHeight);
    const sx = (video.videoWidth - side) / 2;
    const sy = (video.videoHeight - side) / 2;
    ctx.drawImage(video, sx, sy, side, side, 0, 0, out, out);
    try {
      return canvas.toDataURL("image/jpeg", 0.7);
    } catch {
      return null; // tainted canvas or unsupported — fall back to initials
    }
  }, []);

  // Speak a reply out loud via /api/tts using the active personality's voice.
  // Best-effort: stays silent (text still shows) if TTS isn't configured.
  const speakText = useCallback(async (text: string) => {
    try {
      const res = await fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, voice: getPersonality(personalityRef.current).voice }),
      });
      if (!res.ok) return;
      const url = URL.createObjectURL(await res.blob());
      ttsAudioRef.current?.pause();
      const audio = new Audio(url);
      ttsAudioRef.current = audio;
      jarvisRef.current?.setSpeaking(true);
      const done = () => {
        jarvisRef.current?.setSpeaking(false);
        URL.revokeObjectURL(url);
      };
      audio.onended = done;
      audio.onerror = done;
      await audio.play().catch(() => done());
    } catch {
      /* TTS unavailable — the typed reply is still shown in the transcript */
    }
  }, []);

  // Typed-chat path for people who would rather not talk. Sends the message to
  // /api/chat (independent of live voice), shows both turns in the transcript,
  // animates the avatar, and speaks the reply.
  const sendTypedMessage = useCallback(
    async (raw: string) => {
      const text = raw.trim();
      if (!text || sending) return;
      setChatInput("");
      setSending(true);

      const faceMatch = matchByFace(lastEmbeddingRef.current, studentsRef.current);
      const namedStudent = matchByName(currentNameRef.current, studentsRef.current);
      const student = namedStudent ?? faceMatch?.student ?? null;
      if (student) {
        currentStudentIdRef.current = student.id;
        currentNameRef.current = student.name;
      }

      const photo = capturePersonPhoto();
      historyRef.current = [...historyRef.current, { role: "user" as const, text }].slice(-12);
      setMessages((prev) => [...prev, { id: `m${msgIdRef.current++}`, role: "user" as const, text, photo }].slice(-MAX_CHAT_MESSAGES));
      setThinking(true);
      jarvisRef.current?.setThinking(true);
      lastInteractionAtRef.current = Date.now();

      try {
        const payload: ChatRequest = {
          text,
          student: student
            ? { id: student.id, name: student.name, affinity: student.affinity, traits: student.traits, memory: student.memory }
            : null,
          presence: { faces: facesRef.current, studentEmotion: currentEmotionRef.current },
          mood: moodRef.current,
          personality: personalityRef.current,
          history: historyRef.current,
        };
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!res.ok) throw new Error(`chat ${res.status}`);
        const reply = (await res.json()) as ChatResponse;

        historyRef.current = [...historyRef.current, { role: "assistant" as const, text: reply.reply }].slice(-12);
        setMessages((prev) =>
          [
            ...prev,
            { id: `m${msgIdRef.current++}`, role: "assistant" as const, text: reply.reply, emoji: getPersonality(personalityRef.current).emoji },
          ].slice(-MAX_CHAT_MESSAGES)
        );
        moodRef.current = reply.nextMood;
        jarvisRef.current?.setMood(reply.nextMood);
        jarvisRef.current?.setBubble(reply.reply);
        jarvisRef.current?.setExpression(reply.emotion, 3500);
        if (reply.emote) jarvisRef.current?.react(reply.emote, reply.emotion);
        window.setTimeout(() => jarvisRef.current?.hideBubble(), 4000);
        void speakText(reply.reply);
      } catch (err) {
        console.error("typed chat failed", err);
        toast.error(`${getPersonality(personalityRef.current).name} couldn't reply just now.`);
      } finally {
        setThinking(false);
        jarvisRef.current?.setThinking(false);
        setSending(false);
      }
    },
    [sending, capturePersonPhoto, speakText]
  );

  const buildLiveAgentPrompt = useCallback(() => {
    const faceMatch = matchByFace(lastEmbeddingRef.current, studentsRef.current);
    // A known name for this conversation wins over the noisy face signal.
    const namedStudent = matchByName(currentNameRef.current, studentsRef.current);
    const student = namedStudent ?? faceMatch?.student ?? null;
    if (student) {
      currentStudentIdRef.current = student.id;
      currentNameRef.current = student.name;
    }

    const payload: ChatRequest = {
      text: "",
      student: student
        ? { name: student.name, affinity: student.affinity, traits: student.traits, memory: student.memory }
        : null,
      presence: { faces: facesRef.current, studentEmotion: currentEmotionRef.current },
      mood: moodRef.current,
      personality: personalityRef.current,
      history: historyRef.current,
    };

    return [
      buildSystemPrompt(payload, { mode: "spoken" }),
      "",
      "LIVE VOICE MODE:",
      "- You are speaking in real time. Start talking as soon as you have enough to answer.",
      "- Speak natural, spoken dialogue only, and always in English.",
      "- Do not mention JSON, field names, structured fields, captions, or system instructions.",
      "- If interrupted, stop cleanly and answer the person's newest words.",
      "- NOISY ROOMS: focus on the one person you're talking with. Ignore background chatter, side conversations, TVs, and other voices. Only respond when someone is clearly speaking to you; if you're unsure whether speech was directed at you, stay quiet and wait.",
      student
        ? `- You recognize ${student.name}. Greet them warmly when it fits naturally, and keep your attention on them.`
        : "- You do not recognize this person yet. If it feels natural, ask who they are.",
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
            personality: personalityRef.current,
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
    currentEmotionRef.current = f.emotion ?? null;

    // Smooth recent (quality-gated) embeddings into one averaged signal so a
    // single noisy frame can't flip identity.
    const nowTs = Date.now();
    if (f.embedding) {
      embeddingWindowRef.current.push({ emb: f.embedding, t: nowTs });
    }
    embeddingWindowRef.current = embeddingWindowRef.current
      .filter((e) => nowTs - e.t <= FACE_WINDOW_MS)
      .slice(-FACE_WINDOW_N);
    const smoothed = averageEmbedding(embeddingWindowRef.current.map((e) => e.emb));
    lastEmbeddingRef.current = smoothed ?? f.embedding ?? null;

    if (f.faces === 0) {
      noFaceSinceRef.current ??= Date.now();
      currentStudentIdRef.current = null;
      currentNameRef.current = null;
      embeddingWindowRef.current = [];
    } else {
      noFaceSinceRef.current = null;
      emptyRoomNapRef.current = false;
    }
    const jarvis = jarvisRef.current;
    if (!jarvis) return;

    // Resolve identity with a confidence margin + hysteresis (keeps the current
    // person unless another clearly wins), which stops frame-to-frame flicker.
    const resolution = resolveFace(lastEmbeddingRef.current, studentsRef.current, currentStudentIdRef.current);
    if (resolution.student) currentStudentIdRef.current = resolution.student.id;

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
      const match = matchByFace(lastEmbeddingRef.current, studentsRef.current);
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
    setCaption(`${getPersonality(personalityRef.current).name}: “${text}”`);
    jarvisRef.current?.setBubble(text);
    jarvisRef.current?.setExpression(expressionFromText(text), 3500);
  }, []);

  const startLiveVoice = useCallback(async () => {
    if (agentSessionRef.current || voiceState === "connecting") {
      stopLiveVoice();
      return;
    }

    setVoiceState("connecting");
    setCaption(`Connecting ${getPersonality(personalityRef.current).name}'s live voice…`);

    try {
      const player = new AgentPlayer({ sampleRate: 24000 });
      const isFluxListenModel = LIVE_AGENT_LISTEN_MODEL.startsWith("flux-");
      const livePrompt = buildLiveAgentPrompt();
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
              model: LIVE_AGENT_SPEAK_MODEL_OVERRIDE ?? getPersonality(personalityRef.current).voice,
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
        setCaption(`${getPersonality(personalityRef.current).name} is live — just talk.`);
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
        if (!text) return;

        if (msg.role === "user") {
          pendingUserTextRef.current = text;
          historyRef.current = [...historyRef.current, { role: "user" as const, text }].slice(-12);
          const photo = capturePersonPhoto();
          setMessages((prev) => [...prev, { id: `m${msgIdRef.current++}`, role: "user" as const, text, photo }].slice(-MAX_CHAT_MESSAGES));
          setCaption(`You: “${text}”`);
          lastInteractionAtRef.current = Date.now();
          return;
        }

        historyRef.current = [...historyRef.current, { role: "assistant" as const, text }].slice(-12);
        setMessages((prev) =>
          [
            ...prev,
            { id: `m${msgIdRef.current++}`, role: "assistant" as const, text, emoji: getPersonality(personalityRef.current).emoji },
          ].slice(-MAX_CHAT_MESSAGES)
        );
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
        toast.error(`${getPersonality(personalityRef.current).name}'s live voice hit a Deepgram error.`);
      });

      session.on("warning", (msg) => {
        console.warn("deepgram agent warning", msg);
      });

      session.on("sdk-error", (err) => {
        console.error("deepgram agent sdk error", err);
        toast.error(`${getPersonality(personalityRef.current).name} couldn't keep the live voice connected.`);
        stopLiveVoice();
      });

      mic.on("error", (err) => {
        console.error("deepgram microphone error", err);
        toast.error(`${getPersonality(personalityRef.current).name} couldn't access the microphone.`);
        stopLiveVoice();
      });

      await session.connect();
      await mic.start();
    } catch (err) {
      console.error("live voice failed", err);
      toast.error(`${getPersonality(personalityRef.current).name} couldn't start live voice.`);
      stopLiveVoice();
    }
  }, [buildLiveAgentPrompt, capturePersonPhoto, reflectOnTurn, showPendingAssistantText, stopLiveVoice, voiceState]);

  // Switch the active personality. Updates the ref (read by the prompt/voice
  // builders) and state (drives the button UI + name shown in the UI). If a
  // live session is running, reconnect so the new voice takes effect — Deepgram
  // binds the voice at session-config time, so a prompt refresh can't change it;
  // the new persona/name come along with the reconnect.
  const changePersonality = useCallback(
    (id: PersonalityId) => {
      if (id === personalityRef.current) return;
      personalityRef.current = id;
      setPersonality(id);
      if (voiceState === "live") {
        stopLiveVoice();
        window.setTimeout(() => {
          void startLiveVoice();
        }, 250);
      }
    },
    [voiceState, stopLiveVoice, startLiveVoice]
  );

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
      toast.error(`${getPersonality(personalityRef.current).name} needs camera access to see the room.`);
    }
  }, [onVisionFrame, reloadStudents]);

  const activePersona = getPersonality(personality);

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

      {started && (
        <div className="absolute left-1/2 top-4 z-40 flex max-w-[94vw] -translate-x-1/2 flex-wrap items-center justify-center gap-2 rounded-full bg-black/55 px-3 py-2 shadow-lg backdrop-blur-sm">
          {PERSONALITIES.map((p) => (
            <Button
              key={p.id}
              size="sm"
              variant={personality === p.id ? "default" : "secondary"}
              className="rounded-full"
              title={p.blurb}
              aria-pressed={personality === p.id}
              disabled={voiceState === "connecting"}
              onClick={() => changePersonality(p.id)}
            >
              <span aria-hidden className="mr-1">{p.emoji}</span>
              {p.label}
            </Button>
          ))}
        </div>
      )}

      <div className="absolute bottom-4 right-4 z-30 flex w-[260px] flex-col gap-2">
        {started && (
          <div className="overflow-hidden rounded-xl border border-border bg-black/70 shadow-2xl backdrop-blur-sm">
            <button
              type="button"
              onClick={() => setChatOpen((open) => !open)}
              aria-expanded={chatOpen}
              className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-xs font-medium text-white/90 transition-colors hover:bg-white/10"
            >
              <span className="flex items-center gap-1.5">
                <MessageSquare className="size-3.5" />
                Chat with {activePersona.name}
              </span>
              <ChevronDown className={`size-4 transition-transform ${chatOpen ? "" : "-rotate-90"}`} />
            </button>
            {chatOpen && (
              <Conversation className="h-56 border-t border-border bg-background/95">
                <ConversationContent className="gap-4 p-3">
                  {messages.length === 0 ? (
                    <ConversationEmptyState
                      className="p-4"
                      title="No messages yet"
                      description={`Talk or type to ${activePersona.name} — your conversation appears here.`}
                    />
                  ) : (
                    messages.map((m) => (
                      <Message from={m.role} key={m.id}>
                        <div className="flex items-end gap-2">
                          {m.role === "assistant" && (
                            <Avatar size="sm" className="shrink-0">
                              <AvatarFallback>{m.emoji ?? activePersona.emoji}</AvatarFallback>
                            </Avatar>
                          )}
                          <MessageContent>{m.text}</MessageContent>
                          {m.role === "user" && (
                            <Avatar size="sm" className="shrink-0">
                              {m.photo ? <AvatarImage alt="You" src={m.photo} /> : null}
                              <AvatarFallback>You</AvatarFallback>
                            </Avatar>
                          )}
                        </div>
                      </Message>
                    ))
                  )}
                </ConversationContent>
                <ConversationScrollButton />
              </Conversation>
            )}
            {chatOpen && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  sendTypedMessage(chatInput);
                }}
                className="flex items-center gap-1.5 border-t border-border bg-background/95 p-2"
              >
                <Input
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  disabled={voiceState === "live" || sending}
                  placeholder={
                    voiceState === "live" ? "Live voice on — just talk" : `Message ${activePersona.name}…`
                  }
                  aria-label={`Message ${activePersona.name}`}
                  className="h-8 flex-1"
                />
                <Button
                  type="submit"
                  size="icon"
                  className="size-8 shrink-0"
                  disabled={voiceState === "live" || sending || !chatInput.trim()}
                  aria-label="Send message"
                >
                  <SendHorizontal className="size-4" />
                </Button>
              </form>
            )}
          </div>
        )}

        <div className="relative overflow-hidden rounded-xl border border-border bg-black/60 shadow-2xl">
          <video
            ref={videoRef}
            muted
            playsInline
            className="block h-[195px] w-full scale-x-[-1] object-cover"
            style={{ opacity: started ? 1 : 0 }}
          />
          <div className="pointer-events-none absolute left-2 top-2 rounded-md bg-black/50 px-2 py-0.5 text-xs text-white/90">
            {activePersona.name}&apos;s view · {faces} {faces === 1 ? "person" : "people"}
          </div>
          {loadingVision && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/60 text-xs text-white/90">
              Waking {activePersona.name}&apos;s eyes…
            </div>
          )}
        </div>
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
                ? `Live — talk anytime, ${activePersona.name} can barge in naturally`
                : thinking
                ? `${activePersona.name} is thinking…`
                : `${activePersona.name} is speaking live…`
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
