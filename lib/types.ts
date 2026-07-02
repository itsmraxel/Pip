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
  student: (Pick<Student, "name" | "affinity" | "traits" | "memory"> & { id?: string }) | null;
  presence: { faces: number; studentEmotion?: string | null };
  mood: Mood;
  history: ChatTurn[];
}

export interface PipMemoryFields {
  emotion: Expression;
  emote: EmoteType | null;
  affinityDelta: number;
  memoryNote: string | null;
  traitNote: string | null;
  askName: boolean;
  nextMood: Mood;
  learnedName: string | null;
}

export interface ChatResponse extends PipMemoryFields {
  reply: string;
}

export interface ReflectionRequest {
  userText: string;
  assistantText: string;
  student: Pick<Student, "id" | "name" | "affinity" | "traits" | "memory"> | null;
  faceEmbedding: number[] | null;
  presence: { faces: number; studentEmotion?: string | null };
  mood: Mood;
  history: ChatTurn[];
}

export interface ReflectionResponse extends PipMemoryFields {
  /** Optional short line Pip might volunteer if the room goes quiet. */
  proactiveCue: string | null;
}

export type RoomState = "empty" | "single" | "multi";
