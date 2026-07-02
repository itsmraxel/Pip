"use client";

import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import { MicIcon, SquareIcon } from "lucide-react";
import type { ComponentProps } from "react";
import { useCallback, useEffect, useRef, useState } from "react";

interface SpeechRecognition extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  onstart: ((this: SpeechRecognition, ev: Event) => void) | null;
  onend: ((this: SpeechRecognition, ev: Event) => void) | null;
  onresult:
    | ((this: SpeechRecognition, ev: SpeechRecognitionEvent) => void)
    | null;
  onerror:
    | ((this: SpeechRecognition, ev: SpeechRecognitionErrorEvent) => void)
    | null;
}

interface SpeechRecognitionEvent extends Event {
  results: SpeechRecognitionResultList;
  resultIndex: number;
}

interface SpeechRecognitionResultList {
  readonly length: number;
  item(index: number): SpeechRecognitionResult;
  [index: number]: SpeechRecognitionResult;
}

interface SpeechRecognitionResult {
  readonly length: number;
  item(index: number): SpeechRecognitionAlternative;
  [index: number]: SpeechRecognitionAlternative;
  isFinal: boolean;
}

interface SpeechRecognitionAlternative {
  transcript: string;
  confidence: number;
}

interface SpeechRecognitionErrorEvent extends Event {
  error: string;
}

declare global {
  interface Window {
    SpeechRecognition: new () => SpeechRecognition;
    webkitSpeechRecognition: new () => SpeechRecognition;
  }
}

type SpeechInputMode = "speech-recognition" | "media-recorder" | "none";

export type SpeechInputProps = ComponentProps<typeof Button> & {
  onTranscriptionChange?: (text: string) => void;
  /**
   * Callback for when audio is recorded using MediaRecorder fallback.
   * This is called in browsers that don't support the Web Speech API (Firefox, Safari).
   * The callback receives an audio Blob that should be sent to a transcription service.
   * Return the transcribed text, which will be passed to onTranscriptionChange.
   */
  onAudioRecorded?: (audioBlob: Blob) => Promise<string>;
  /** Fired whenever the mic starts/stops actively listening. */
  onListeningChange?: (listening: boolean) => void;
  lang?: string;
};

const detectSpeechInputMode = (): SpeechInputMode => {
  if (typeof window === "undefined") {
    return "none";
  }

  if ("SpeechRecognition" in window || "webkitSpeechRecognition" in window) {
    return "speech-recognition";
  }

  if ("MediaRecorder" in window && "mediaDevices" in navigator) {
    return "media-recorder";
  }

  return "none";
};

export const SpeechInput = ({
  className,
  onTranscriptionChange,
  onAudioRecorded,
  onListeningChange,
  lang = "en-US",
  ...props
}: SpeechInputProps) => {
  const [isListening, setIsListening] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [mode] = useState<SpeechInputMode>(() => {
    // Prefer server-side transcription (via onAudioRecorded) when it's available:
    // the browser Web Speech API streams to a cloud service that frequently fails
    // with a "network" error, whereas the MediaRecorder path uses our own STT.
    if (
      onAudioRecorded &&
      typeof window !== "undefined" &&
      "MediaRecorder" in window &&
      "mediaDevices" in navigator
    ) {
      return "media-recorder";
    }
    return detectSpeechInputMode();
  });
  const [isRecognitionReady, setIsRecognitionReady] = useState(false);
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const onTranscriptionChangeRef = useRef<
    SpeechInputProps["onTranscriptionChange"]
  >(onTranscriptionChange);
  const onAudioRecordedRef =
    useRef<SpeechInputProps["onAudioRecorded"]>(onAudioRecorded);
  const onListeningChangeRef =
    useRef<SpeechInputProps["onListeningChange"]>(onListeningChange);

  // Keep refs in sync
  onTranscriptionChangeRef.current = onTranscriptionChange;
  onAudioRecordedRef.current = onAudioRecorded;

  useEffect(() => {
    onListeningChangeRef.current = onListeningChange;
  });

  // Notify the parent whenever the active-listening state changes.
  useEffect(() => {
    onListeningChangeRef.current?.(isListening);
  }, [isListening]);

  // Initialize Speech Recognition when mode is speech-recognition
  useEffect(() => {
    if (mode !== "speech-recognition") {
      return;
    }

    const SpeechRecognition =
      window.SpeechRecognition || window.webkitSpeechRecognition;
    const speechRecognition = new SpeechRecognition();

    speechRecognition.continuous = true;
    speechRecognition.interimResults = true;
    speechRecognition.lang = lang;

    const handleStart = () => {
      // #region agent log
      fetch('http://127.0.0.1:7869/ingest/1322e9a3-526c-4f7e-837c-345fe456b255',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'e2db88'},body:JSON.stringify({sessionId:'e2db88',hypothesisId:'A2',location:'speech-input.tsx:onstart',message:'recognition started',data:{},timestamp:Date.now()})}).catch(()=>{});
      // #endregion
      setIsListening(true);
    };

    const handleEnd = () => {
      // #region agent log
      fetch('http://127.0.0.1:7869/ingest/1322e9a3-526c-4f7e-837c-345fe456b255',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'e2db88'},body:JSON.stringify({sessionId:'e2db88',hypothesisId:'A1,A2',location:'speech-input.tsx:onend',message:'recognition ended',data:{},timestamp:Date.now()})}).catch(()=>{});
      // #endregion
      setIsListening(false);
    };

    const handleResult = (event: Event) => {
      const speechEvent = event as SpeechRecognitionEvent;
      let finalTranscript = "";

      for (
        let i = speechEvent.resultIndex;
        i < speechEvent.results.length;
        i += 1
      ) {
        const result = speechEvent.results[i];
        if (result.isFinal) {
          finalTranscript += result[0]?.transcript ?? "";
        }
      }

      // #region agent log
      fetch('http://127.0.0.1:7869/ingest/1322e9a3-526c-4f7e-837c-345fe456b255',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'e2db88'},body:JSON.stringify({sessionId:'e2db88',hypothesisId:'A',location:'speech-input.tsx:handleResult',message:'speech recognition result',data:{results:speechEvent.results.length,finalLen:finalTranscript.length},timestamp:Date.now()})}).catch(()=>{});
      // #endregion
      if (finalTranscript) {
        onTranscriptionChangeRef.current?.(finalTranscript);
      }
    };

    const handleError = (event: Event) => {
      // #region agent log
      fetch('http://127.0.0.1:7869/ingest/1322e9a3-526c-4f7e-837c-345fe456b255',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'e2db88'},body:JSON.stringify({sessionId:'e2db88',hypothesisId:'A1',location:'speech-input.tsx:onerror',message:'recognition error',data:{error:(event as SpeechRecognitionErrorEvent).error},timestamp:Date.now()})}).catch(()=>{});
      // #endregion
      setIsListening(false);
    };

    speechRecognition.addEventListener("start", handleStart);
    speechRecognition.addEventListener("end", handleEnd);
    speechRecognition.addEventListener("result", handleResult);
    speechRecognition.addEventListener("error", handleError);

    recognitionRef.current = speechRecognition;
    setIsRecognitionReady(true);

    return () => {
      speechRecognition.removeEventListener("start", handleStart);
      speechRecognition.removeEventListener("end", handleEnd);
      speechRecognition.removeEventListener("result", handleResult);
      speechRecognition.removeEventListener("error", handleError);
      speechRecognition.stop();
      recognitionRef.current = null;
      setIsRecognitionReady(false);
    };
  }, [mode, lang]);

  // Cleanup MediaRecorder and stream on unmount
  useEffect(
    () => () => {
      if (mediaRecorderRef.current?.state === "recording") {
        mediaRecorderRef.current.stop();
      }
      if (streamRef.current) {
        for (const track of streamRef.current.getTracks()) {
          track.stop();
        }
      }
    },
    []
  );

  // Start MediaRecorder recording
  const startMediaRecorder = useCallback(async () => {
    if (!onAudioRecordedRef.current) {
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mediaRecorder = new MediaRecorder(stream);
      audioChunksRef.current = [];

      const handleDataAvailable = (event: BlobEvent) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      const handleStop = async () => {
        for (const track of stream.getTracks()) {
          track.stop();
        }
        streamRef.current = null;

        const audioBlob = new Blob(audioChunksRef.current, {
          type: "audio/webm",
        });

        if (audioBlob.size > 0 && onAudioRecordedRef.current) {
          setIsProcessing(true);
          try {
            const transcript = await onAudioRecordedRef.current(audioBlob);
            if (transcript) {
              onTranscriptionChangeRef.current?.(transcript);
            }
          } catch {
            // Error handling delegated to the onAudioRecorded caller
          } finally {
            setIsProcessing(false);
          }
        }
      };

      const handleError = () => {
        setIsListening(false);
        for (const track of stream.getTracks()) {
          track.stop();
        }
        streamRef.current = null;
      };

      mediaRecorder.addEventListener("dataavailable", handleDataAvailable);
      mediaRecorder.addEventListener("stop", handleStop);
      mediaRecorder.addEventListener("error", handleError);

      mediaRecorderRef.current = mediaRecorder;
      mediaRecorder.start();
      setIsListening(true);
    } catch {
      setIsListening(false);
    }
  }, []);

  // Stop MediaRecorder recording
  const stopMediaRecorder = useCallback(() => {
    if (mediaRecorderRef.current?.state === "recording") {
      mediaRecorderRef.current.stop();
    }
    setIsListening(false);
  }, []);

  const toggleListening = useCallback(() => {
    // #region agent log
    fetch('http://127.0.0.1:7869/ingest/1322e9a3-526c-4f7e-837c-345fe456b255',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'e2db88'},body:JSON.stringify({sessionId:'e2db88',hypothesisId:'A',location:'speech-input.tsx:toggleListening',message:'mic toggled',data:{mode,isListening,hasRecognition:!!recognitionRef.current},timestamp:Date.now()})}).catch(()=>{});
    // #endregion
    if (mode === "speech-recognition" && recognitionRef.current) {
      if (isListening) {
        recognitionRef.current.stop();
      } else {
        try {
          recognitionRef.current.start();
        } catch (err) {
          // #region agent log
          fetch('http://127.0.0.1:7869/ingest/1322e9a3-526c-4f7e-837c-345fe456b255',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'e2db88'},body:JSON.stringify({sessionId:'e2db88',hypothesisId:'A3',location:'speech-input.tsx:start-throw',message:'recognition.start() threw',data:{name:(err as Error)?.name,msg:(err as Error)?.message},timestamp:Date.now()})}).catch(()=>{});
          // #endregion
        }
      }
    } else if (mode === "media-recorder") {
      if (isListening) {
        stopMediaRecorder();
      } else {
        startMediaRecorder();
      }
    }
  }, [mode, isListening, startMediaRecorder, stopMediaRecorder]);

  // Determine if button should be disabled
  const isDisabled =
    mode === "none" ||
    (mode === "speech-recognition" && !isRecognitionReady) ||
    (mode === "media-recorder" && !onAudioRecorded) ||
    isProcessing;

  return (
    <div className="relative inline-flex items-center justify-center">
      {/* Animated pulse rings */}
      {isListening &&
        [0, 1, 2].map((index) => (
          <div
            className="absolute inset-0 animate-ping rounded-full border-2 border-red-400/30"
            key={index}
            style={{
              animationDelay: `${index * 0.3}s`,
              animationDuration: "2s",
            }}
          />
        ))}

      {/* Main record button */}
      <Button
        className={cn(
          "relative z-10 rounded-full transition-all duration-300",
          isListening
            ? "bg-destructive text-white hover:bg-destructive/80 hover:text-white"
            : "bg-primary text-primary-foreground hover:bg-primary/80 hover:text-primary-foreground",
          className
        )}
        disabled={isDisabled}
        onClick={toggleListening}
        {...props}
      >
        {isProcessing && <Spinner />}
        {!isProcessing && isListening && <SquareIcon className="size-4" />}
        {!(isProcessing || isListening) && <MicIcon className="size-4" />}
      </Button>
    </div>
  );
};
