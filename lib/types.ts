// Shared types for Pip's students and conversation.

import type { Expression, EmoteType, Mood } from "./pipEngine";

export type { Expression, EmoteType, Mood };

export interface Student {
  id: string;
  name: string;
  /** Face embedding from Human (used to recognize on sight). */
  faceEmbedding: number[] | null;
  /** Base64-encoded Picovoice Eagle voice profile (recognize by voice). */
  voiceProfile: string | null;
  /** Pip's feeling toward this student, -100 (cool) .. 100 (adores). */
  affinity: number;
  /** Short traits / running jokes / nicknames Pip has invented. */
  traits: string[];
  /** Summarized memory bullets from past conversations. */
  memory: string[];
  createdAt: string;
  lastSeenAt: string;
}

export interface ChatTurn {
  role: "user" | "assistant";
  text: string;
}

export interface ChatRequest {
  text: string;
  student: Pick<Student, "name" | "affinity" | "traits" | "memory"> | null;
  presence: { faces: number; studentEmotion?: string | null };
  mood: Mood;
  history: ChatTurn[];
}

export interface ChatResponse {
  reply: string;
  emotion: Expression;
  emote: EmoteType | null;
  /** Nudge to Pip's affinity toward this student for this turn, -10..10. */
  affinityDelta: number;
  /** A short new thing worth remembering about the student, if any. */
  memoryNote: string | null;
  /** A stable personality trait, preference, nickname, or running joke to keep. */
  traitNote: string | null;
  /** True if Pip should ask the (unknown) speaker for their name. */
  askName: boolean;
  /** The mood Pip should carry into the next turn. */
  nextMood: Mood;
  /** Name captured from an unknown student introducing themselves. */
  learnedName: string | null;
}
