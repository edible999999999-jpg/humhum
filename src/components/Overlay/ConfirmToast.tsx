import { useState, useEffect, useRef, useCallback } from "react";
import { t } from "@/lib/i18n";
import type { HookEvent } from "@/types";

interface ConfirmToastProps {
  event: HookEvent;
  onConfirm: (behavior: "allow" | "deny" | "allowAlways") => void;
  onDismiss: () => void;
}

export function ConfirmToast({ event, onConfirm, onDismiss }: ConfirmToastProps) {
  const payload = event.payload as Record<string, unknown>;
  const toolName = (payload.tool_name as string) ?? "Unknown";
  const toolInput = (payload.tool_input as Record<string, unknown>) ?? {};
  const [elapsed, setElapsed] = useState(0);
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const onConfirmRef = useRef(onConfirm);
  onConfirmRef.current = onConfirm;

  const dismiss = useCallback((behavior: "allow" | "deny" | "allowAlways") => {
    onConfirmRef.current(behavior);
  }, []);

  useEffect(() => {
    const timer = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(timer);
  }, []);

  // Force-dismiss after status becomes "sent" — safety net
  useEffect(() => {
    if (status !== "sent") return;
    const timer = setTimeout(() => {
      console.log("[ConfirmToast] Force-dismiss after sent");
      dismiss("allow");
    }, 1500);
    return () => clearTimeout(timer);
  }, [status, dismiss]);

  const handleClick = async (behavior: "allow" | "deny" | "allowAlways") => {
    setStatus("sending");
    console.log(`[ConfirmToast] Button clicked: ${behavior}, event_id: ${event.id}`);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    try {
      const res = await fetch("http://localhost:31275/respond", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ event_id: event.id, behavior }),
        signal: controller.signal,
      });
      clearTimeout(timeout);
      const data = await res.json();
      console.log("[ConfirmToast] HTTP respond result:", res.status, data);

      if (res.ok) {
        setStatus("sent");
        setTimeout(() => dismiss(behavior), 300);
        return;
      }
      // Stale request (receiver dropped) — auto-dismiss
      if (res.status === 404 || res.status === 500 || res.status === 409) {
        console.warn("[ConfirmToast] Stale request, auto-dismissing:", data);
        dismiss(behavior);
        return;
      }
      setErrorMsg(`HTTP ${res.status}: ${JSON.stringify(data)}`);
    } catch (e) {
      clearTimeout(timeout);
      console.warn("[ConfirmToast] HTTP failed:", e);
      setErrorMsg(`HTTP failed: ${e}`);
    }

    // Fallback to IPC
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("respond_to_permission", { eventId: event.id, behavior });
      console.log("[ConfirmToast] IPC respond succeeded");
      setStatus("sent");
      setTimeout(() => dismiss(behavior), 300);
    } catch (e) {
      console.error("[ConfirmToast] IPC also failed:", e);
      setStatus("error");
      setErrorMsg(`Both HTTP and IPC failed`);
      setTimeout(() => dismiss(behavior), 2000);
    }
  };

  const detail = getToolDetail(toolName, toolInput);
  const timeLabel = elapsed < 60 ? `<${elapsed + 1}s` : `${Math.floor(elapsed / 60)}m`;

  return (
    <div className="confirm-card toast-enter pointer-events-auto">
      {/* Header */}
      <div className="flex items-center justify-between px-3 pt-2.5 pb-1.5">
        <div className="flex items-center gap-2">
          <div className="w-5 h-5 rounded-full flex items-center justify-center bg-amber-400/10 text-amber-400/80">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 9v4M12 17h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
            </svg>
          </div>
          <span className="text-white/80 font-semibold text-[13px]">{t("confirm.title")}</span>
          <span className="confirm-tag confirm-tag-time">{timeLabel}</span>
          <span className="confirm-tag confirm-tag-client">{event.client_type || "CC"}</span>
        </div>
        <button onClick={onDismiss} className="text-white/20 hover:text-white/50 text-xs transition-colors leading-none">✕</button>
      </div>

      {/* Tool info */}
      <div className="px-3 pb-2">
        <div className="text-amber-400/80 font-bold text-[13px] mb-1">{toolName}</div>
        {detail && (
          <div className="confirm-detail-box" style={{ maxHeight: 72 }}>
            <code className="text-[11px] text-white/55 leading-snug break-all whitespace-pre-wrap">
              {detail}
            </code>
          </div>
        )}
      </div>

      {/* Status feedback */}
      {status !== "idle" && (
        <div className={`px-3 pb-1.5 text-[10px] font-semibold ${
          status === "sending" ? "text-amber-300/80" :
          status === "sent" ? "text-emerald-400/80" : "text-red-400/80"
        }`}>
          {status === "sending" && t("confirm.sending")}
          {status === "sent" && t("confirm.sent")}
          {status === "error" && errorMsg}
        </div>
      )}

      {/* Action buttons */}
      <div className="flex gap-1.5 px-3 pb-2.5">
        <button
          onClick={() => handleClick("deny")}
          disabled={status === "sending" || status === "sent"}
          className="confirm-btn confirm-btn-deny text-xs py-1.5"
        >
          {t("confirm.deny")} <kbd className="confirm-kbd ml-1">N</kbd>
        </button>
        <button
          onClick={() => handleClick("allowAlways")}
          disabled={status === "sending" || status === "sent"}
          className="confirm-btn confirm-btn-always text-xs py-1.5"
        >
          {t("confirm.always")} <kbd className="confirm-kbd ml-1">A</kbd>
        </button>
        <button
          onClick={() => handleClick("allow")}
          disabled={status === "sending" || status === "sent"}
          className="confirm-btn confirm-btn-allow text-xs py-1.5"
        >
          {t("confirm.allow")} <kbd className="confirm-kbd ml-1">Y</kbd>
        </button>
      </div>
    </div>
  );
}

function getToolDetail(toolName: string, input: Record<string, unknown>): string {
  switch (toolName) {
    case "Bash": {
      const cmd = input.command as string;
      if (!cmd) return "";
      return cmd.slice(0, 200) + (cmd.length > 200 ? "..." : "");
    }
    case "Write":
    case "Edit":
    case "Read": {
      const fp = input.file_path as string;
      if (!fp) return "";
      const parts = fp.split("/");
      return parts.length > 3 ? `.../${parts.slice(-3).join("/")}` : fp;
    }
    case "WebFetch":
    case "WebSearch": {
      const url = (input.url ?? input.query ?? "") as string;
      return url.slice(0, 150);
    }
    case "Agent": {
      const desc = (input.description ?? input.prompt ?? "") as string;
      return desc.slice(0, 150) + (desc.length > 150 ? "..." : "");
    }
    default: {
      const desc = (input.description ?? input.command ?? input.file_path ?? input.query ?? "") as string;
      if (desc) return desc.slice(0, 150) + (desc.length > 150 ? "..." : "");
      const keys = Object.keys(input).filter((k) => k !== "cwd" && k !== "hook_event_name" && k !== "effort");
      if (keys.length === 0) return "";
      const first = input[keys[0]!];
      return typeof first === "string" ? first.slice(0, 150) : "";
    }
  }
}
