"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { PipController } from "@/lib/pipEngine";
import type { EmoteType, Expression, Mood } from "@/lib/pipEngine";

export interface PipHandle {
  speak: (text: string) => void;
  setBubble: (text: string) => void;
  hideBubble: () => void;
  setExpression: (expr: Expression | null, ms?: number) => void;
  react: (emote: EmoteType, expr?: Expression) => void;
  setSpeaking: (on: boolean) => void;
  setListening: (on: boolean) => void;
  setThinking: (on: boolean) => void;
  speakingPulse: () => void;
  lookAt: (x: number | null, y?: number) => void;
  setFollow: (x: number | null, y?: number) => void;
  setTarget: (x: number | null, y?: number) => void;
  lookAround: () => void;
  nap: () => void;
  setCursor: (x: number | null, y?: number) => void;
  setFollowCursor: (on: boolean) => void;
  setMood: (mood: Mood) => void;
  /** Stage element bounds, for mapping normalized coords → local pixels. */
  stageSize: () => { width: number; height: number };
}

interface PipProps {
  onPoke?: () => void;
  onHover?: () => void;
  className?: string;
}

export const Pip = forwardRef<PipHandle, PipProps>(function Pip(
  { onPoke, onHover, className },
  ref
) {
  const stageRef = useRef<HTMLDivElement>(null);
  const controllerRef = useRef<PipController | null>(null);
  const cbRef = useRef({ onPoke, onHover });
  cbRef.current = { onPoke, onHover };

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const controller = new PipController({
      scale: 2.6,
      onPoke: () => cbRef.current.onPoke?.(),
      onHoverStart: () => cbRef.current.onHover?.(),
    });
    controller.mount(stage);
    controllerRef.current = controller;

    const onMove = (e: MouseEvent) => {
      const rect = stage.getBoundingClientRect();
      controller.setCursor(e.clientX - rect.left, e.clientY - rect.top);
    };
    const onLeave = () => controller.setCursor(null);
    stage.addEventListener("mousemove", onMove);
    stage.addEventListener("mouseleave", onLeave);

    return () => {
      stage.removeEventListener("mousemove", onMove);
      stage.removeEventListener("mouseleave", onLeave);
      controller.destroy();
      controllerRef.current = null;
    };
  }, []);

  useImperativeHandle(ref, (): PipHandle => ({
    speak: (t) => controllerRef.current?.speak(t),
    setBubble: (t) => controllerRef.current?.setBubble(t),
    hideBubble: () => controllerRef.current?.hideBubble(),
    setExpression: (e, ms) => controllerRef.current?.setExpression(e, ms),
    react: (e, expr) => controllerRef.current?.react(e, expr),
    setSpeaking: (on) => controllerRef.current?.setSpeaking(on),
    setListening: (on) => controllerRef.current?.setListening(on),
    setThinking: (on) => controllerRef.current?.setThinking(on),
    speakingPulse: () => controllerRef.current?.speakingPulse(),
    lookAt: (x, y) => controllerRef.current?.lookAt(x, y),
    setFollow: (x, y) => controllerRef.current?.setFollow(x, y),
    setTarget: (x, y) => controllerRef.current?.setTarget(x, y),
    lookAround: () => controllerRef.current?.lookAround(),
    nap: () => controllerRef.current?.nap(),
    setCursor: (x, y) => controllerRef.current?.setCursor(x, y),
    setFollowCursor: (on) => controllerRef.current?.setFollowCursor(on),
    setMood: (m) => controllerRef.current?.setMood(m),
    stageSize: () => {
      const r = stageRef.current?.getBoundingClientRect();
      return { width: r?.width ?? 0, height: r?.height ?? 0 };
    },
  }));

  return <div ref={stageRef} className={className} style={{ position: "relative", width: "100%", height: "100%", overflow: "hidden" }} />;
});
