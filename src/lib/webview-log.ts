import { invoke } from "@tauri-apps/api/core";

const origLog = console.log.bind(console);
const origError = console.error.bind(console);
const origWarn = console.warn.bind(console);

function fmt(...args: unknown[]): string {
  return args
    .map((a) =>
      typeof a === "string" ? a : JSON.stringify(a, null, 0)?.slice(0, 500) ?? String(a)
    )
    .join(" ");
}

function forward(level: string, ...args: unknown[]) {
  invoke("webview_log", { level, msg: fmt(...args) }).catch(() => {});
}

export function patchConsole() {
  console.log = (...args: unknown[]) => {
    origLog(...args);
    forward("log", ...args);
  };
  console.error = (...args: unknown[]) => {
    origError(...args);
    forward("error", ...args);
  };
  console.warn = (...args: unknown[]) => {
    origWarn(...args);
    forward("warn", ...args);
  };
}
