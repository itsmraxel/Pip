"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { SpeechInput } from "@/components/ai-elements/speech-input";
import { Pip, type PipHandle } from "@/components/Pip";
import { Vision, type VisionFrame } from "@/lib/vision";
import { matchByFace } from "@/lib/identity";
import { applyAffinity } from "@/lib/personality";
import { sounds } from "@/lib/sounds";
import type { ChatRequest, ChatResponse, ChatTurn, Expression, Mood, Student } from "@/lib/types";

// Flip so Pip lines up with the mirrored camera box the teacher sees.
const MIRROR = true;

// Map a detected face emotion to one of Pip's expressions (mirrors the room).
const EMOTION_MAP: Record<string, Expression> = {
  happy: "happy",
  surprise: "surprised",
  sad: "sad",
  angry: "unimpressed",
  fear: "surprised",
  disgust: "unimpressed",
  neutral: "curious",
};

function appendUnique(list: string[], value: string | null, limit: number) {
  const next = value?.trim();
  if (!next || list.some((item) => item.toLowerCase() === next.toLowerCase())) return list;
  return [...list, next].slice(-limit);
}

function cleanLearnedName(value: string | null) {
  const name = value?.trim().replace(/\s+/g, " ").replace(/[.!?]+$/g, "");
  if (!name || name.length > 40) return null;
  return name;
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

  // Conversation state (kept in refs so the async loop always sees the latest).
  const historyRef = useRef<ChatTurn[]>([]);
  const lastEmbeddingRef = useRef<number[] | null>(null);
  const currentEmotionRef = useRef<string | null>(null);
  const facesRef = useRef(0);
  const moodRef = useRef<Mood>("neutral");
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const busyRef = useRef(false);

  const [started, setStarted] = useState(false);
  const [loadingVision, setLoadingVision] = useState(false);
  const [faces, setFaces] = useState(0);
  const [thinking, setThinking] = useState(false);
  const [listening, setListening] = useState(false);
  const [caption, setCaption] = useState("");

  useEffect(() => {
    return () => {
      visionRef.current?.stop();
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      audioRef.current?.pause();
    };
  }, []);

  const onVisionFrame = useCallback((f: VisionFrame) => {
    setFaces(f.faces);
    facesRef.current = f.faces;
    lastEmbeddingRef.current = f.embedding ?? null;
    currentEmotionRef.current = f.emotion ?? null;
    const pip = pipRef.current;
    if (!pip) return;

    if (f.nearest) {
      const { width } = pip.stageSize();
      const nx = MIRROR ? 1 - f.nearest.x : f.nearest.x;
      pip.setFollow(nx * width);

      // Mirror the person's emotion occasionally, so Pip feels aware.
      const now = Date.now();
      if (f.emotion && (f.emotion !== lastEmotionRef.current.label || now - lastEmotionRef.current.at > 4000)) {
        lastEmotionRef.current = { label: f.emotion, at: now };
        const expr = EMOTION_MAP[f.emotion];
        if (expr) pip.setExpression(expr, 2000);
      }
    } else {
      pip.setFollow(null);
    }

    // React when someone new appears; greet a recognized student by name.
    if (f.faces > lastFaceCountRef.current) {
      const match = matchByFace(f.embedding, studentsRef.current);
      const now = Date.now();
      if (match && now - (lastGreetRef.current[match.student.id] ?? 0) > 30000) {
        lastGreetRef.current[match.student.id] = now;
        pip.react("love", "happy");
        pip.setBubble(`Hi ${match.student.name}!`);
        sounds.play("greet");
        setTimeout(() => pipRef.current?.hideBubble(), 2400);
      } else {
        pip.react("sparkle", "excited");
        sounds.play("surprise");
      }
    }
    lastFaceCountRef.current = f.faces;
  }, []);

  // Turn Pip's reply into speech via Deepgram Aura and play it, driving the
  // talking animation. Falls back to a timed "mouth moving" if TTS is
  // unavailable so the bubble still reads naturally.
  const speak = useCallback(async (text: string) => {
    const pip = pipRef.current;
    try {
      const res = await fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      // #region agent log
      fetch('http://127.0.0.1:7869/ingest/1322e9a3-526c-4f7e-837c-345fe456b255',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'e2db88'},body:JSON.stringify({sessionId:'e2db88',hypothesisId:'D',location:'PipStage.tsx:tts-response',message:'tts fetch returned',data:{status:res.status,ok:res.ok,contentType:res.headers.get('content-type')},timestamp:Date.now()})}).catch(()=>{});
      // #endregion
      if (!res.ok) throw new Error(`tts ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);

      audioRef.current?.pause();
      const audio = new Audio(url);
      audioRef.current = audio;

      pip?.setSpeaking(true);
      const done = () => {
        pip?.setSpeaking(false);
        URL.revokeObjectURL(url);
        window.setTimeout(() => pipRef.current?.hideBubble(), 1600);
      };
      audio.onended = done;
      audio.onerror = done;
      await audio.play();
      // #region agent log
      fetch('http://127.0.0.1:7869/ingest/1322e9a3-526c-4f7e-837c-345fe456b255',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'e2db88'},body:JSON.stringify({sessionId:'e2db88',hypothesisId:'D',location:'PipStage.tsx:audio-play',message:'audio.play() resolved',data:{paused:audio.paused,duration:audio.duration},timestamp:Date.now()})}).catch(()=>{});
      // #endregion
    } catch (err) {
      console.warn("tts failed, using timed fallback", err);
      pip?.setSpeaking(true);
      window.setTimeout(() => {
        pipRef.current?.setSpeaking(false);
        pipRef.current?.hideBubble();
      }, Math.min(7000, 1400 + text.length * 45));
    }
  }, []);

  // The full loop: a student's utterance -> who they are -> Gemini -> Pip
  // shows/says the reply -> remember affinity + new facts.
  const handleUtterance = useCallback(
    async (raw: string) => {
      const text = raw.trim();
      // #region agent log
      fetch('http://127.0.0.1:7869/ingest/1322e9a3-526c-4f7e-837c-345fe456b255',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'e2db88'},body:JSON.stringify({sessionId:'e2db88',hypothesisId:'A,E',location:'PipStage.tsx:handleUtterance',message:'utterance received',data:{textLen:text.length,busy:busyRef.current},timestamp:Date.now()})}).catch(()=>{});
      // #endregion
      if (!text || busyRef.current) return;
      busyRef.current = true;
      setThinking(true);
      setCaption(`You: “${text}”`);
      const pip = pipRef.current;

      try {
        pip?.setListening(false);
        pip?.setExpression("curious", 1500);

        // Identify the speaker by the most recent face we saw.
        const faceMatch = matchByFace(lastEmbeddingRef.current, studentsRef.current);
        const student = faceMatch?.student ?? null;

        historyRef.current = [...historyRef.current, { role: "user" as const, text }].slice(-12);

        const payload: ChatRequest = {
          text,
          student: student
            ? { name: student.name, affinity: student.affinity, traits: student.traits, memory: student.memory }
            : null,
          presence: { faces: facesRef.current, studentEmotion: currentEmotionRef.current },
          mood: moodRef.current,
          history: historyRef.current.slice(0, -1),
        };

        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const reply = (await res.json()) as ChatResponse;
        // #region agent log
        fetch('http://127.0.0.1:7869/ingest/1322e9a3-526c-4f7e-837c-345fe456b255',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'e2db88'},body:JSON.stringify({sessionId:'e2db88',hypothesisId:'C',location:'PipStage.tsx:chat-response',message:'chat reply received',data:{status:res.status,replyLen:reply?.reply?.length??0,emotion:reply?.emotion,isFallback:/brain isn't plugged|thoughts got tangled/.test(reply?.reply??''),hasStudent:!!student},timestamp:Date.now()})}).catch(()=>{});
        // #endregion

        historyRef.current = [...historyRef.current, { role: "assistant" as const, text: reply.reply }].slice(-12);

        pip?.setBubble(reply.reply);
        pip?.setExpression(reply.emotion, 4000);
        if (reply.emote) pip?.react(reply.emote, reply.emotion);
        setCaption(`Pip: “${reply.reply}”`);

        moodRef.current = reply.nextMood ?? "neutral";

        // Remember: nudge affinity + store any new facts for known students.
        if (student) {
          const nextAffinity = applyAffinity(student.affinity, reply.affinityDelta);
          const nextMemory = appendUnique(student.memory, reply.memoryNote, 20);
          const nextTraits = appendUnique(student.traits, reply.traitNote, 12);
          student.affinity = nextAffinity;
          student.memory = nextMemory;
          student.traits = nextTraits;
          fetch("/api/students", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id: student.id, affinity: nextAffinity, memory: nextMemory, traits: nextTraits }),
          }).catch(() => {});
        } else {
          const learnedName = cleanLearnedName(reply.learnedName);
          const faceEmbedding = lastEmbeddingRef.current;
          if (learnedName && faceEmbedding) {
            const newStudent: Partial<Student> & { name: string } = {
              name: learnedName,
              faceEmbedding,
              affinity: applyAffinity(0, reply.affinityDelta),
              traits: appendUnique([], reply.traitNote, 12),
              memory: appendUnique([], reply.memoryNote, 20),
            };
            fetch("/api/students", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(newStudent),
            })
              .then(async (r) => {
                if (!r.ok) throw new Error(`student ${r.status}`);
                const d = (await r.json()) as { student?: Student };
                if (d.student) {
                  studentsRef.current = [d.student, ...studentsRef.current];
                  lastGreetRef.current[d.student.id] = Date.now();
                  pipRef.current?.react("love", "happy");
                  toast.success(`Pip will remember ${d.student.name}.`);
                }
              })
              .catch((err) => {
                console.warn("student enrollment failed", err);
                toast.error("Pip heard the name, but couldn't save the face.");
              });
          } else if (learnedName && !faceEmbedding) {
            toast.message("Pip heard the name, but needs a clear face in view to remember it.");
          }
        }

        await speak(reply.reply);
      } catch (err) {
        console.error("conversation error", err);
        toast.error("Pip couldn't respond just now.");
        pipRef.current?.setSpeaking(false);
      } finally {
        setThinking(false);
        busyRef.current = false;
      }
    },
    [speak]
  );

  // MediaRecorder fallback (Firefox/Safari): send the recorded clip to Deepgram.
  const transcribeAudio = useCallback(async (blob: Blob): Promise<string> => {
    try {
      const res = await fetch("/api/stt", { method: "POST", body: blob });
      const d = (await res.json()) as { transcript?: string; error?: string };
      // #region agent log
      fetch('http://127.0.0.1:7869/ingest/1322e9a3-526c-4f7e-837c-345fe456b255',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'e2db88'},body:JSON.stringify({sessionId:'e2db88',hypothesisId:'B',location:'PipStage.tsx:transcribeAudio',message:'stt result',data:{status:res.status,transcriptLen:(d.transcript??'').length,error:d.error??null,blobSize:blob.size},timestamp:Date.now()})}).catch(()=>{});
      // #endregion
      return d.transcript ?? "";
    } catch (err) {
      console.warn("stt failed", err);
      return "";
    }
  }, []);

  const start = useCallback(async () => {
    try {
      sounds.init(); // preload squawks now that we have a user gesture
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => {});
      }
      setStarted(true);

      // Load known students (so Pip can recognize faces on sight).
      try {
        const r = await fetch("/api/students");
        const d = (await r.json()) as { students: Student[] };
        studentsRef.current = d.students ?? [];
      } catch { /* ignore */ }

      // Load + start vision.
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
  }, [onVisionFrame]);

  return (
    <div className="relative h-full w-full overflow-hidden bg-background">
      {/* The parrot — the whole stage is Pip's. */}
      <Pip
        ref={pipRef}
        onPoke={() => {
          pipRef.current?.react("annoyed", "unimpressed");
          sounds.play("surprise");
        }}
        onHover={() => pipRef.current?.react("music", "happy")}
      />

      {/* The box: what Pip is seeing. */}
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

      {/* Subtitles: show what the student said and what Pip says back. */}
      {started && (listening || thinking || caption) && (
        <div className="pointer-events-none absolute bottom-28 left-1/2 z-40 w-[min(92vw,720px)] -translate-x-1/2 text-center">
          <p className="inline-block max-w-full rounded-2xl bg-black/70 px-4 py-2 text-base leading-snug text-white shadow-lg">
            {listening ? "🎤 Listening…" : caption || (thinking ? "…" : "")}
          </p>
        </div>
      )}

      {/* Talk to Pip: tap the mic, speak, and Pip listens + replies aloud. */}
      {started && (
        <div className="absolute bottom-6 left-1/2 z-40 flex -translate-x-1/2 flex-col items-center gap-2">
          <SpeechInput
            size="lg"
            aria-label="Talk to Pip"
            onListeningChange={(on) => {
              setListening(on);
              pipRef.current?.setListening(on);
              if (on) setCaption("");
            }}
            onTranscriptionChange={handleUtterance}
            onAudioRecorded={transcribeAudio}
          />
          <span className="rounded-full bg-black/50 px-3 py-1 text-xs text-white/90">
            {listening ? "Listening — tap again when done" : thinking ? "Pip is thinking…" : "Tap and talk to Pip"}
          </span>
        </div>
      )}

      {/* Start overlay (needed once for camera permission). */}
      {!started && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-background/70 backdrop-blur-sm">
          <Button size="lg" onClick={start}>Wake up Pip 🦜</Button>
        </div>
      )}
    </div>
  );
}
