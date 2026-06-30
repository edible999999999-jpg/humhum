import { useState, useEffect, useRef, useCallback } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { invoke } from "@tauri-apps/api/core";
import { Bubble } from "./Bubble";
import { PetMascot } from "./PetMascot";
import { SessionDashboard } from "./SessionDashboard";
import { ConfirmToast } from "../Overlay/ConfirmToast";
import { NotificationToast } from "../Overlay/NotificationToast";
import { CompletionPanel } from "../Overlay/CompletionPanel";
import { playSound } from "../../lib/audio/sound-effects";
import { usePetState } from "../../hooks/usePetState";
import { useEventBus } from "../../hooks/useEventBus";
import { useVoiceCommand } from "../../hooks/useVoiceCommand";
import { useKeyboardShortcuts } from "../../hooks/useKeyboardShortcuts";
import { useAudioQueue } from "../../hooks/useAudioQueue";
import { getPipeline } from "../../lib/bootstrap";
import type { PipelineState } from "../../lib/pipeline";
import type { HookEvent, VoiceCommand, TranscriptEntry } from "../../types";

const PIPELINE_TO_PET: Record<PipelineState, string> = {
  idle: "idle",
  summarizing: "processing",
  speaking: "speaking",
  error: "error",
};

const appWindow = getCurrentWindow();

export function PetView() {
  const { petState, setPetState } = usePetState();
  const { latestEvent } = useEventBus();
  const { pause: pauseAudio, play: playAudio, state: audioState } = useAudioQueue();
  const [summaryText, setSummaryText] = useState("");
  const [pendingPermission, setPendingPermission] = useState<HookEvent | null>(null);
  const [notification, setNotification] = useState<TranscriptEntry | null>(null);
  const [completionEvent, setCompletionEvent] = useState<HookEvent | null>(null);
  const [showDashboard, setShowDashboard] = useState(false);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dragStartPos = useRef({ x: 0, y: 0 });
  const clickCount = useRef(0);
  const clickTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Position window at bottom-right on first mount
  useEffect(() => {
    (async () => {
      try {
        const monitor = await import("@tauri-apps/api/dpi");
        const { availableMonitors } = await import("@tauri-apps/api/window");
        const monitors = await availableMonitors();
        const primary = monitors[0];
        if (primary) {
          const screenW = primary.size.width / primary.scaleFactor;
          const screenH = primary.size.height / primary.scaleFactor;
          const winW = 280;
          const winH = 350;
          await appWindow.setPosition(
            new monitor.LogicalPosition(screenW - winW - 20, screenH - winH - 80)
          );
        }
      } catch {
        // Fallback: leave at default position
      }
    })();
  }, []);

  const handleVoiceCommand = useCallback(
    (command: VoiceCommand, _text: string) => {
      if (!pendingPermission) return;
      if (command === "confirm") {
        respondToPermission(pendingPermission.id, "allow");
        setPendingPermission(null);
        setPetState("idle");
      } else if (command === "reject") {
        respondToPermission(pendingPermission.id, "deny");
        setPendingPermission(null);
        setPetState("idle");
      }
    },
    [pendingPermission, setPetState]
  );

  const { startListening, stopListening } = useVoiceCommand(handleVoiceCommand);

  const handleConfirm = useCallback(
    (behavior: "allow" | "deny" | "allowAlways") => {
      if (!pendingPermission) return;
      respondToPermission(pendingPermission.id, behavior);
      setPendingPermission(null);
      stopListening();
      setPetState("idle");
    },
    [pendingPermission, stopListening, setPetState]
  );

  const handleDismiss = useCallback(() => {
    setPendingPermission(null);
    stopListening();
    setPetState("idle");
  }, [stopListening, setPetState]);

  useKeyboardShortcuts({
    enabled: !!pendingPermission,
    onConfirm: () => handleConfirm("allow"),
    onReject: () => handleConfirm("deny"),
    onAlwaysAllow: () => handleConfirm("allowAlways"),
    onTogglePlayback: () => {
      if (audioState === "playing") pauseAudio();
      else playAudio();
    },
  });

  useEffect(() => {
    const pipeline = getPipeline();
    if (!pipeline) return;

    pipeline.onStateChange((state) => {
      const petTarget = PIPELINE_TO_PET[state];
      if (petTarget === "idle" && pendingPermission) {
        setPetState("listening");
        startListening();
      } else if (petTarget === "error" && !pendingPermission) {
        setPetState("idle");
      } else {
        setPetState(petTarget as ReturnType<typeof usePetState>["petState"]);
      }
    });

    pipeline.onSentence((text) => {
      setSummaryText(text);
    });
  }, [setPetState, pendingPermission, startListening]);

  useEffect(() => {
    if (!latestEvent) return;

    const eventName = latestEvent.hook_event_name;
    const payload = latestEvent.payload as Record<string, unknown>;
    const pipeline = getPipeline();

    if (eventName === "PermissionRequest") {
      playSound("attentionRequired");
      setPendingPermission(latestEvent);
      setPetState("waiting");
      const toolName = (payload.tool_name as string) ?? "Unknown";
      const toolInput = (payload.tool_input as Record<string, unknown>) ?? {};

      let detail = "";
      if (toolName === "Bash" && toolInput.command) {
        detail = `\n命令: ${(toolInput.command as string).slice(0, 120)}`;
      } else if (
        (toolName === "Write" || toolName === "Edit" || toolName === "Read") &&
        toolInput.file_path
      ) {
        detail = `\n文件: ${(toolInput.file_path as string).split("/").pop()}`;
      }

      invoke("send_notification", {
        title: `⚠️ ${toolName} 需要确认`,
        body: `Claude Code 请求执行 ${toolName}${detail}`,
      });

      if (pipeline) {
        pipeline.processEvent(latestEvent).catch(console.error);
      }
    } else if (eventName === "TaskCompleted" || eventName === "Stop") {
      playSound("taskCompleted");
      setPetState("completed");
      setCompletionEvent(latestEvent);
      setTimeout(() => {
        setCompletionEvent(null);
        setPetState("idle");
      }, 8000);
      if (pipeline) {
        pipeline.processEvent(latestEvent).catch(console.error);
      }
    } else if (eventName === "Notification") {
      playSound("processingStarted");
      const notifText = (payload.message as string) ?? "收到通知";
      setNotification({
        id: latestEvent.id,
        text: notifText,
        timestamp: new Date(),
        type: "system",
      });
      setTimeout(() => setNotification(null), 5000);

      if (pipeline) {
        pipeline.processEvent(latestEvent).catch(console.error);
      } else {
        setPetState("processing");
        setTimeout(() => setPetState("idle"), 3000);
      }
    } else if (eventName === "PreToolUse" || eventName === "PostToolUse") {
      const toolName = (payload.tool_name as string) ?? "";
      const action = eventName === "PreToolUse" ? "正在使用" : "已完成";
      invoke("send_notification", {
        title: `🔧 ${toolName}`,
        body: `${latestEvent.client_type} ${action} ${toolName}`,
      });
    }
  }, [latestEvent, setPetState]);

  const handleMouseDown = useCallback(async (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    dragStartPos.current = { x: e.clientX, y: e.clientY };
    try {
      await appWindow.startDragging();
    } catch {
      // Drag might fail
    }
  }, []);

  const handleMouseUp = useCallback(async (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    const dx = Math.abs(e.clientX - dragStartPos.current.x);
    const dy = Math.abs(e.clientY - dragStartPos.current.y);
    if (dx >= 5 || dy >= 5) return;

    clickCount.current++;
    if (clickTimer.current) clearTimeout(clickTimer.current);

    if (clickCount.current >= 2) {
      clickCount.current = 0;
      invoke("focus_terminal").catch(console.error);
    } else {
      clickTimer.current = setTimeout(() => {
        clickCount.current = 0;
      }, 250);
    }
  }, []);

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    invoke("toggle_settings").catch(console.error);
  }, []);

  const handlePetEnter = useCallback(() => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    hoverTimer.current = setTimeout(() => setShowDashboard(true), 300);
  }, []);

  const handlePetLeave = useCallback(() => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    hoverTimer.current = null;
  }, []);

  const handleDashboardLeave = useCallback(() => {
    setShowDashboard(false);
  }, []);

  const bubbleText =
    petState === "speaking" || petState === "processing"
      ? summaryText || getBubbleText(petState)
      : getBubbleText(petState);

  const hasOverlay = !!pendingPermission || !!notification;

  return (
    <div
      className="w-full h-full flex flex-col items-center justify-end pb-6 select-none"
      onContextMenu={handleContextMenu}
    >
      {/* Session dashboard — hover popup */}
      {showDashboard && !hasOverlay && (
        <div
          className="w-64 mb-2"
          onMouseEnter={() => setShowDashboard(true)}
          onMouseLeave={handleDashboardLeave}
        >
          <SessionDashboard visible={showDashboard} />
        </div>
      )}

      {/* Completion panel — richer than toast */}
      {completionEvent && !pendingPermission && (
        <div className="w-64 mb-3">
          <CompletionPanel
            event={completionEvent}
            onDismiss={() => setCompletionEvent(null)}
          />
        </div>
      )}

      {/* Notification toast */}
      {notification && !pendingPermission && !completionEvent && (
        <div className="w-64 mb-3">
          <NotificationToast
            entry={notification}
            onDismiss={() => setNotification(null)}
          />
        </div>
      )}

      {/* Permission confirmation */}
      {pendingPermission && (
        <div className="w-64 mb-3">
          <ConfirmToast
            event={pendingPermission}
            onConfirm={handleConfirm}
            onDismiss={handleDismiss}
          />
        </div>
      )}

      {/* Bubble */}
      {!showDashboard && <Bubble state={petState} text={bubbleText} />}

      {/* Pet body — draggable, hover → dashboard */}
      <div
        className="cursor-grab active:cursor-grabbing"
        onMouseDown={handleMouseDown}
        onMouseUp={handleMouseUp}
        onMouseEnter={handlePetEnter}
        onMouseLeave={handlePetLeave}
      >
        <PetBody state={petState} />
      </div>
    </div>
  );
}

function respondToPermission(eventId: string, behavior: string) {
  invoke("respond_to_permission", { eventId, behavior }).catch((e) =>
    console.error("[PetView] Permission response failed:", e)
  );
}

function PetBody({ state }: { state: string }) {
  return (
    <div className="relative">
      {state === "listening" && (
        <>
          <div className="pulse-ring" />
          <div className="pulse-ring" style={{ animationDelay: "0.5s" }} />
        </>
      )}

      <div
        className={`
          w-14 h-14 rounded-full flex items-center justify-center
          transition-all duration-300 relative overflow-visible
          ${getPetStyle(state)}
        `}
      >
        <PetMascot state={state} size={56} />

        {state === "speaking" && (
          <div className="absolute -bottom-3 left-1/2 -translate-x-1/2 flex gap-0.5 items-end h-3 pointer-events-none">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="waveform-bar" />
            ))}
          </div>
        )}
      </div>

      {state === "waiting" && (
        <div className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 bg-amber-400 rounded-full animate-pulse pointer-events-none" />
      )}
    </div>
  );
}

function getBubbleText(state: string): string {
  switch (state) {
    case "processing":
      return "...";
    case "waiting":
      return "!";
    case "listening":
      return "🎤";
    case "completed":
      return "嘿嘿~";
    default:
      return "";
  }
}

function getPetStyle(state: string): string {
  switch (state) {
    case "idle":
      return "bg-gradient-to-br from-indigo-500/20 to-purple-500/20 backdrop-blur-sm animate-float shadow-lg shadow-indigo-500/10";
    case "processing":
      return "bg-gradient-to-br from-blue-500/30 to-cyan-500/30 backdrop-blur-sm animate-pulse shadow-lg shadow-blue-500/20";
    case "speaking":
      return "bg-gradient-to-br from-indigo-500/30 to-purple-500/30 backdrop-blur-sm shadow-lg shadow-indigo-500/20";
    case "listening":
      return "bg-gradient-to-br from-emerald-500/30 to-teal-500/30 backdrop-blur-sm shadow-lg shadow-emerald-500/20";
    case "waiting":
      return "bg-gradient-to-br from-amber-500/30 to-orange-500/30 backdrop-blur-sm shadow-lg shadow-amber-500/20";
    case "completed":
      return "bg-gradient-to-br from-emerald-500/30 to-lime-500/30 backdrop-blur-sm shadow-lg shadow-emerald-500/30 animate-bounce-subtle";
    case "error":
      return "bg-gradient-to-br from-red-500/30 to-rose-500/30 backdrop-blur-sm shadow-lg shadow-red-500/20";
    default:
      return "bg-gradient-to-br from-indigo-500/20 to-purple-500/20 backdrop-blur-sm";
  }
}

