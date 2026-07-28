import { useState, useEffect, useRef, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { t } from "@/lib/i18n";
import { compactFilePath } from "@/lib/path-display";
import type { HookEvent } from "@/types";

interface ConfirmToastProps {
  event: HookEvent;
  onConfirm: (behavior: "allow" | "deny" | "allowAlways") => void;
}

export function ConfirmToast({ event, onConfirm }: ConfirmToastProps) {
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

  const handleClick = async (behavior: "allow" | "deny" | "allowAlways") => {
    setStatus("sending");
    setErrorMsg("");
    console.log(`[ConfirmToast] Button clicked: ${behavior}, event_id: ${event.id}`);

    try {
      await invoke("respond_to_permission", { eventId: event.id, behavior });
      console.log("[ConfirmToast] IPC respond succeeded");
      setStatus("sent");
      dismiss(behavior);
    } catch (e) {
      console.error("[ConfirmToast] IPC respond failed:", e);
      setStatus("error");
      setErrorMsg(`Response failed: ${String(e)}`);
    }
  };

  const detail = getToolDetail(toolName, toolInput);
  const timeLabel = elapsed < 60 ? `<${elapsed + 1}s` : `${Math.floor(elapsed / 60)}m`;

  return (
    <div className="confirm-card toast-enter pointer-events-auto">
      {/* Header */}
      <div className="flex items-center justify-between px-3 pt-2.5 pb-1.5">
        <div className="flex items-center gap-2">
          <img
            src="/mascots/expr/hexa/confirm.png"
            alt="Hexa"
            className="module-face"
            style={{ width: 28, height: 28 }}
            draggable={false}
          />
          <span className="font-semibold text-[13px]" style={{ color: "#334155" }}>{t("confirm.title")}</span>
          <span className="confirm-tag confirm-tag-time">{timeLabel}</span>
          <span className="confirm-tag confirm-tag-client">{event.client_type || "CC"}</span>
        </div>
        <button
          type="button"
          onClick={() => handleClick("deny")}
          disabled={status === "sending" || status === "sent"}
          className="text-xs transition-colors leading-none"
          style={{ color: "#94a3b8" }}
          aria-label={t("confirm.deny")}
        >
          ✕
        </button>
      </div>

      {/* Tool info */}
      <div className="px-3 pb-2">
        <div className="text-amber-400/80 font-bold text-[13px] mb-1">{toolName}</div>
        {detail && (
          <div className="confirm-detail-box" style={{ maxHeight: 72 }}>
            <code className="text-[11px] leading-snug break-all whitespace-pre-wrap" style={{ color: "#64748b" }}>
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
          type="button"
          onClick={() => handleClick("deny")}
          disabled={status === "sending" || status === "sent"}
          className="confirm-btn confirm-btn-deny text-xs py-1.5"
        >
          {t("confirm.deny")} <kbd className="confirm-kbd ml-1">N</kbd>
        </button>
        <button
          type="button"
          onClick={() => handleClick("allowAlways")}
          disabled={status === "sending" || status === "sent"}
          className="confirm-btn confirm-btn-always text-xs py-1.5"
        >
          {t("confirm.always")} <kbd className="confirm-kbd ml-1">A</kbd>
        </button>
        <button
          type="button"
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
      return compactFilePath(fp);
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
