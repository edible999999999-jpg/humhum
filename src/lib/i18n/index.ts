import { translations } from "./translations";

export type Language = "zh" | "en";

let currentLang: Language = "zh";
const listeners = new Set<() => void>();

export function setLanguage(lang: Language): void {
  if (lang === currentLang) return;
  currentLang = lang;
  listeners.forEach((fn) => fn());
}

export function getLanguage(): Language {
  return currentLang;
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function t(key: string, params?: Record<string, string | number>): string {
  const entry = translations[key];
  let text = entry?.[currentLang] ?? entry?.zh ?? key;
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      text = text.replace(`{${k}}`, String(v));
    }
  }
  return text;
}
