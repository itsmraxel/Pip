"use client";

import dynamic from "next/dynamic";

// Load the stage client-side only: it uses the webcam, canvas sprite engine,
// and dynamically-imported browser ML (Human/Eagle) that must not run in SSR.
const JarvisStage = dynamic(() => import("@/components/JarvisStage").then((m) => m.JarvisStage), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
      Loading Jarvis…
    </div>
  ),
});

export function JarvisStageClient() {
  return <JarvisStage />;
}
