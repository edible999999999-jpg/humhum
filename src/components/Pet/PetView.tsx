import { useState, useEffect, useRef, useCallback } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { LogicalSize, PhysicalPosition } from "@tauri-apps/api/dpi";
import { invoke } from "@tauri-apps/api/core";
import { Bubble } from "./Bubble";
import { PetCanvas } from "./PetCanvas";
import { BubbleParticles, useBubbleTrail } from "./BubbleTrail";
import { SessionDashboard } from "./SessionDashboard";
import { ConfirmToast } from "../Overlay/ConfirmToast";
import { NotificationToast } from "../Overlay/NotificationToast";
import { CompletionPanel } from "../Overlay/CompletionPanel";
import { QuestionToast } from "../Overlay/QuestionToast";
import { playSound } from "../../lib/audio/sound-effects";
import { usePetState } from "../../hooks/usePetState";
import { useEventBus } from "../../hooks/useEventBus";
import { useVoiceCommand } from "../../hooks/useVoiceCommand";
import { useKeyboardShortcuts } from "../../hooks/useKeyboardShortcuts";
import { useAudioQueue } from "../../hooks/useAudioQueue";
import { getPipeline } from "../../lib/bootstrap";
import { t } from "../../lib/i18n";
import { setLanguage } from "../../lib/i18n";
import type { PipelineState } from "../../lib/pipeline";
import type { AppConfig, HookEvent, VoiceCommand, TranscriptEntry } from "../../types";

interface SessionInfo {
  session_id: string;
  client_type: string;
}

const PIPELINE_TO_PET: Record<PipelineState, string> = {
  idle: "idle",
  summarizing: "processing",
  speaking: "speaking",
  error: "error",
};

const COMPACT_HEIGHT = 210;
const OVERLAY_HEIGHT = 460;
const PERMISSION_HEIGHT = 650;
const CONTEXT_MENU_WIDTH = 148;
const CONTEXT_MENU_HEIGHT = 42;

const appWindow = getCurrentWindow();

export function PetView() {
  const { petState, setPetState } = usePetState();
  const { latestEvent } = useEventBus();
  const { pause: pauseAudio, play: playAudio, state: audioState } = useAudioQueue();
  const [summaryText, setSummaryText] = useState("");
  const [permissionQueue, setPermissionQueue] = useState<HookEvent[]>([]);
  const [notification, setNotification] = useState<TranscriptEntry | null>(null);
  const [completionEvent, setCompletionEvent] = useState<HookEvent | null>(null);
  const completionSpeaking = useRef(false);
  const [questionEvent, setQuestionEvent] = useState<HookEvent | null>(null);
  const [showDashboard, setShowDashboard] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const [windowReady, setWindowReady] = useState(false);
  const [activeClients, setActiveClients] = useState<string[]>([]);
  const { bubbles, burst: burstBubbles } = useBubbleTrail();
  const dragStartPos = useRef({ x: 0, y: 0 });
  const clickCount = useRef(0);
  const clickTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const configRef = useRef<AppConfig | null>(null);

  useEffect(() => {
    invoke<AppConfig>("get_config").then((cfg) => {
      configRef.current = cfg;
      setLanguage(cfg.ui.language as "zh" | "en");
    }).catch(console.error);
  }, []);

  const pendingPermission = permissionQueue[0] ?? null;
  const queueLength = permissionQueue.length;

  useEffect(() => {
    const poll = async () => {
      try {
        const [sessions, cfg] = await Promise.all([
          invoke<SessionInfo[]>("get_active_sessions"),
          invoke<AppConfig>("get_config"),
        ]);
        const unique = [...new Set(sessions.map((s) => s.client_type))];
        setActiveClients(unique);
        configRef.current = cfg;
        setLanguage(cfg.ui.language as "zh" | "en");
      } catch {
        // ignore
      }
    };
    poll();
    const timer = setInterval(poll, 5000);
    return () => clearInterval(timer);
  }, []);

  const voiceRef = useRef<(cmd: VoiceCommand, text: string) => void>(() => {});
  const { startListening, stopListening } = useVoiceCommand(
    useCallback((cmd: VoiceCommand, text: string) => voiceRef.current(cmd, text), []),
  );

  const dismissPermission = useCallback(() => {
    setPermissionQueue((q) => q.slice(1));
    if (queueLength <= 1) {
      stopListening();
      setPetState("idle");
    }
  }, [queueLength, stopListening, setPetState]);

  const handleConfirm = useCallback(
    (_behavior: "allow" | "deny" | "allowAlways") => {
      // ConfirmToast already sent the respond — just manage queue
      dismissPermission();
    },
    [dismissPermission],
  );

  const handleKeyboardConfirm = useCallback(
    (behavior: "allow" | "deny" | "allowAlways") => {
      if (!pendingPermission) return;
      respondToPermission(pendingPermission.id, behavior);
      dismissPermission();
    },
    [pendingPermission, dismissPermission],
  );

  // Wire voice commands via ref to avoid hook ordering issues
  voiceRef.current = (command: VoiceCommand, _text: string) => {
    if (!pendingPermission) return;
    if (command === "confirm") handleKeyboardConfirm("allow");
    else if (command === "reject") handleKeyboardConfirm("deny");
  };

  const handleDismiss = useCallback(() => {
    setPermissionQueue((q) => q.slice(1));
    if (queueLength <= 1) {
      stopListening();
      setPetState("idle");
    }
  }, [queueLength, stopListening, setPetState]);

  // --- Dynamic window sizing ---
  const currentWindowHeight = useRef(COMPACT_HEIGHT);
  const resizeLock = useRef(false);

  const hasActiveOverlay = showDashboard || !!notification || !!completionEvent || !!questionEvent || !!contextMenu;
  const targetHeight = pendingPermission || questionEvent
    ? PERMISSION_HEIGHT
    : hasActiveOverlay
      ? OVERLAY_HEIGHT
      : COMPACT_HEIGHT;

  useEffect(() => {
    if (resizeLock.current) return;
    const prevH = currentWindowHeight.current;
    if (Math.abs(targetHeight - prevH) < 10) {
      if (targetHeight > COMPACT_HEIGHT) setWindowReady(true);
      return;
    }

    resizeLock.current = true;
    setWindowReady(false);

    (async () => {
      try {
        const pos = await appWindow.outerPosition();
        const sf = (await appWindow.scaleFactor()) || 1;
        const dy = Math.round((targetHeight - prevH) * sf);

        await appWindow.setSize(new LogicalSize(280, targetHeight));
        await appWindow.setPosition(
          new PhysicalPosition(pos.x, Math.max(0, pos.y - dy)),
        );

        currentWindowHeight.current = targetHeight;
        if (targetHeight > COMPACT_HEIGHT) setWindowReady(true);
      } catch (e) {
        console.error("[PetView] Resize failed:", e);
      } finally {
        resizeLock.current = false;
      }
    })();
  }, [targetHeight]);

  // Listen for server-side permission timeout to dismiss from queue
  useEffect(() => {
    let unlisten: (() => void) | null = null;
    (async () => {
      const { listen } = await import("@tauri-apps/api/event");
      unlisten = await listen<string>("humhum://permission-timeout", (event) => {
        console.log("[PetView] Permission timed out:", event.payload);
        setPermissionQueue((q) => q.filter((e) => e.id !== event.payload));
      });
    })();
    return () => {
      if (unlisten) unlisten();
    };
  }, []);

  useEffect(() => {
    let unlisten: (() => void) | null = null;
    let resetTimer: ReturnType<typeof setTimeout> | null = null;
    (async () => {
      const { listen } = await import("@tauri-apps/api/event");
      unlisten = await listen("humhum://awake-mode-pulse", () => {
        setPetState("completed");
        burstBubbles(70, 90);
        setNotification({
          id: `awake-${Date.now()}`,
          text: t("petview.awakePulse"),
          timestamp: new Date(),
          type: "system",
        });
        resetTimer = setTimeout(() => {
          setNotification(null);
          setPetState("idle");
        }, 3200);
      });
    })();
    return () => {
      if (unlisten) unlisten();
      if (resetTimer) clearTimeout(resetTimer);
    };
  }, [burstBubbles, setPetState]);

  useKeyboardShortcuts({
    enabled: !!pendingPermission,
    onConfirm: () => handleKeyboardConfirm("allow"),
    onReject: () => handleKeyboardConfirm("deny"),
    onAlwaysAllow: () => handleKeyboardConfirm("allowAlways"),
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
      if (pendingPermission) {
        if (petTarget === "idle") {
          setPetState("listening");
          startListening();
        } else if (petTarget === "error") {
          setPetState("waiting");
        }
      } else if (completionSpeaking.current) {
        if (state === "idle") {
          completionSpeaking.current = false;
        }
      } else if (petTarget === "error") {
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

    console.log("[PetView] Event received:", eventName, "pipeline:", pipeline ? "OK" : "NULL");

    if (latestEvent.client_type) {
      setActiveClients((prev) =>
        prev.includes(latestEvent.client_type) ? prev : [...prev, latestEvent.client_type],
      );
    }

    if (eventName === "PermissionRequest") {
      const toolName = (payload.tool_name as string) ?? "Unknown";
      const toolInput = (payload.tool_input as Record<string, unknown>) ?? {};

      if (toolName === "AskUserQuestion") {
        // PermissionRequest for AskUserQuestion is auto-allowed on server.
        // The actual question UI is shown when PreToolUse arrives.
        if (pipeline) {
          pipeline.processEvent(latestEvent).catch(console.error);
        }
        return;
      }

      if (configRef.current?.ui?.auto_confirm) {
        if (pipeline) {
          pipeline.processEvent(latestEvent).catch(console.error);
        }
        return;
      }

      playSound("attentionRequired");
      setPermissionQueue((q) => [...q, latestEvent]);
      setPetState("waiting");

      // Auto-dismiss after 120s (matches hook timeout)
      const evtId = latestEvent.id;
      setTimeout(() => {
        setPermissionQueue((q) => q.filter((e) => e.id !== evtId));
      }, 120_000);

      let detail = "";
      if (toolName === "Bash" && toolInput.command) {
        detail = `\n${t("petview.command")}: ${(toolInput.command as string).slice(0, 120)}`;
      } else if (
        (toolName === "Write" || toolName === "Edit" || toolName === "Read") &&
        toolInput.file_path
      ) {
        detail = `\n${t("petview.file")}: ${(toolInput.file_path as string).split("/").pop()}`;
      }

      invoke("send_notification", {
        title: t("petview.needsApproval", { tool: toolName }),
        body: `${t("petview.requestExec", { client: latestEvent.client_type || "Agent", tool: toolName })}${detail}`,
      });

      if (pipeline) {
        pipeline.processEvent(latestEvent).catch(console.error);
      }
    } else if (eventName === "TaskCompleted" || eventName === "Stop") {
      playSound("taskCompleted");
      setPetState("completed");
      setCompletionEvent(latestEvent);
      completionSpeaking.current = true;
      setTimeout(() => {
        setCompletionEvent(null);
        completionSpeaking.current = false;
        setPetState("idle");
      }, 8000);
      if (pipeline) {
        pipeline.processEvent(latestEvent).catch(console.error);
      }
    } else if (eventName === "Notification") {
      playSound("processingStarted");
      const notifText = (payload.message as string) ?? t("petview.gotNotification");
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

      if (eventName === "PreToolUse" && toolName === "AskUserQuestion") {
        playSound("attentionRequired");
        setQuestionEvent(latestEvent);
        setPetState("waiting");
        invoke("send_notification", {
          title: t("petview.needsChoice"),
          body: t("petview.ccWaitingChoice"),
        });
        const evtRef2 = latestEvent;
        setTimeout(() => {
          setQuestionEvent((prev) => {
            if (prev?.id === evtRef2.id) {
              invoke("respond_to_permission", { eventId: evtRef2.id, behavior: "allow" }).catch(() => {});
              return null;
            }
            return prev;
          });
        }, 60000);
      } else {
        const action = eventName === "PreToolUse" ? t("petview.using") : t("petview.done");
        invoke("send_notification", {
          title: toolName,
          body: `${latestEvent.client_type} ${action} ${toolName}`,
        });
      }
    }
  }, [latestEvent, setPetState]);

  const handleMouseDown = useCallback(
    async (e: React.MouseEvent) => {
      if (e.button !== 0) return;
      dragStartPos.current = { x: e.clientX, y: e.clientY };
      burstBubbles(e.clientX, e.clientY + 20);
      try {
        await appWindow.startDragging();
      } catch {
        // Drag might fail
      }
    },
    [burstBubbles],
  );

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
        if (clickCount.current === 1) {
          setShowDashboard((prev) => !prev);
        }
        clickCount.current = 0;
      }, 250);
    }
  }, []);

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setShowDashboard(false);
    setContextMenu({
      x: (140 - CONTEXT_MENU_WIDTH) / 2,
      y: -(CONTEXT_MENU_HEIGHT + 8),
    });
  }, []);

  const handleOpenHub = useCallback(() => {
    setContextMenu(null);
    invoke("toggle_hub").catch((err) =>
      console.error("[PetView] toggle_hub failed:", err),
    );
  }, []);

  const handlePetLeave = useCallback(() => {
    setTimeout(() => setContextMenu(null), 1200);
  }, []);

  const bubbleText =
    petState === "speaking" || petState === "processing"
      ? summaryText || getBubbleText(petState)
      : getBubbleText(petState);

  const hasOverlay = !!pendingPermission || !!notification || !!questionEvent;

  // Ensure cursor events are never ignored at the OS level
  useEffect(() => {
    appWindow.setIgnoreCursorEvents(false).catch(() => {});
  }, []);

  return (
    <div
      className="w-full h-full flex flex-col items-center justify-end pb-6 select-none pointer-events-none"
    >
      {/* Session dashboard — click toggled */}
      {showDashboard && !hasOverlay && (
        <div
          className="inline-flex w-fit max-w-[calc(100vw-24px)] pb-2 pointer-events-auto"
        >
          <SessionDashboard visible={showDashboard} />
        </div>
      )}

      {/* Completion panel */}
      {completionEvent && !pendingPermission && (
        <div className="w-64 mb-3 pointer-events-auto">
          <CompletionPanel
            event={completionEvent}
            onDismiss={() => setCompletionEvent(null)}
          />
        </div>
      )}

      {/* Notification toast */}
      {notification && !pendingPermission && !completionEvent && (
        <div className="w-64 mb-3 pointer-events-auto">
          <NotificationToast
            entry={notification}
            onDismiss={() => setNotification(null)}
          />
        </div>
      )}

      {/* AskUserQuestion — show options, type selection into terminal */}
      {questionEvent && !pendingPermission && windowReady && (
        <div className="w-72 mb-3 pointer-events-auto">
          <QuestionToast
            event={questionEvent}
            onDismiss={() => {
              setQuestionEvent(null);
              setPetState("idle");
            }}
          />
        </div>
      )}

      {/* Permission confirmation — wait for window expansion */}
      {pendingPermission && windowReady && (
        <div className="w-72 mb-3 pointer-events-auto">
          <ConfirmToast
            event={pendingPermission}
            onConfirm={handleConfirm}
            onDismiss={handleDismiss}
          />
          {queueLength > 1 && (
            <div className="text-center mt-1.5 text-[10px] pointer-events-auto" style={{ color: "#64748b" }}>
              {t("petview.pending", { n: queueLength - 1 })}
            </div>
          )}
        </div>
      )}

      {/* Bubble */}
      {!showDashboard && <Bubble state={petState} text={bubbleText} />}

      {/* Pet body — draggable, click → dashboard, right-click → command menu */}
      <div
        className="relative cursor-grab active:cursor-grabbing pointer-events-auto"
        onMouseDown={handleMouseDown}
        onMouseUp={handleMouseUp}
        onMouseLeave={handlePetLeave}
        onContextMenu={handleContextMenu}
      >
        {contextMenu && (
          <div
            className="pet-context-menu"
            style={{ left: contextMenu.x, top: contextMenu.y }}
            onMouseDown={(e) => e.stopPropagation()}
            onMouseUp={(e) => e.stopPropagation()}
          >
            <button type="button" onClick={handleOpenHub}>
              <span>Hub</span>
            </button>
          </div>
        )}
        <PetBody state={petState} activeClients={activeClients} />
        <BubbleParticles bubbles={bubbles} />
      </div>
    </div>
  );
}

async function respondToPermission(eventId: string, behavior: string) {
  console.log("[PetView] Sending permission response:", eventId, behavior);

  // Try direct HTTP to hook server first (bypasses Tauri IPC)
  try {
    const res = await fetch("http://localhost:31275/respond", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event_id: eventId, behavior }),
    });
    const data = await res.json();
    console.log("[PetView] HTTP respond result:", data);
    if (res.ok) return;
  } catch (e) {
    console.warn("[PetView] HTTP respond failed, falling back to IPC:", e);
  }

  // Fallback to Tauri IPC
  try {
    await invoke("respond_to_permission", { eventId, behavior });
    console.log("[PetView] IPC respond succeeded");
  } catch (e) {
    console.error("[PetView] IPC respond also failed:", e);
  }
}

function PetBody({ state, activeClients }: { state: string; activeClients: string[] }) {
  return (
    <PetCanvas
      state={state as import("@/types").PetState}
      size={140}
      activeClients={activeClients}
    />
  );
}

function getBubbleText(state: string): string {
  switch (state) {
    case "processing":
      return "...";
    case "waiting":
      return "!";
    case "listening":
      return "...";
    default:
      return "";
  }
}
