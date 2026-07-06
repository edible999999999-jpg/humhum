import { useSyncExternalStore } from "react";
import { subscribe, getLanguage, t } from "./index";

export function useTranslation() {
  const lang = useSyncExternalStore(subscribe, getLanguage, getLanguage);
  return { t, lang };
}
