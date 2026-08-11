import { Suspense, lazy, useState, useEffect } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { invoke } from "@tauri-apps/api/core";
import { ErrorBoundary } from "./components/common/ErrorBoundary";
import { IntroPage } from "./components/Intro/IntroPage";
import { initBootstrap } from "./lib/bootstrap";
import { isTauriRuntime } from "./lib/tauriRuntime";
import { t } from "./lib/i18n";

const PetView = lazy(() =>
  import("./components/Pet/PetView").then((mod) => ({ default: mod.PetView }))
);
const SettingsPanel = lazy(() =>
  import("./components/Settings/SettingsPanel").then((mod) => ({ default: mod.SettingsPanel }))
);
const HubLayout = lazy(() =>
  import("./components/Hub/HubLayout").then((mod) => ({ default: mod.HubLayout }))
);

const PET_BOOTSTRAP_TIMEOUT_MS = 8_000;

async function initializePetWindow(): Promise<void> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      initBootstrap(),
      new Promise<void>((resolve) => {
        timeoutId = setTimeout(resolve, PET_BOOTSTRAP_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

/**
 * Root App component — detects which window it's in and renders accordingly.
 * - "main" window: renders the desktop pet (small, draggable, transparent)
 * - "settings" window: renders the settings panel
 */
export default function App() {
  const isIntroRoute =
    window.location.pathname === "/intro" ||
    window.location.search.includes("intro");
  const runningInTauri = isTauriRuntime();
  const [windowLabel, setWindowLabel] = useState<string>(() => runningInTauri ? "main" : "hub");

  useEffect(() => {
    if (isIntroRoute || !runningInTauri) return;
    const win = getCurrentWindow();
    setWindowLabel(win.label);
  }, [isIntroRoute, runningInTauri]);

  if (isIntroRoute) {
    return <IntroPage />;
  }

  return (
    <ErrorBoundary>
      {windowLabel === "hub" ? (
        <HubWindow />
      ) : windowLabel === "settings" ? (
        <SettingsWindow />
      ) : (
        <PetWindow />
      )}
    </ErrorBoundary>
  );
}

// ===== Pet Window (main) =====

function PetWindow() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    initializePetWindow()
      .then(() => setReady(true))
      .catch((e) => {
        console.error("[App] Bootstrap failed:", e);
        setReady(true);
      });
  }, []);

  if (!ready) {
    return <PetRecoveryShell />;
  }

  return (
    <div className="w-full h-full flex items-center justify-center bg-transparent">
      <Suspense fallback={<PetRecoveryShell />}>
        <PetView />
      </Suspense>
    </div>
  );
}

function PetRecoveryShell() {
  const openHub = () => {
    invoke("toggle_hub").catch((error) => {
      console.error("[App] Failed to open Hub from recovery shell:", error);
    });
  };

  return (
    <div className="w-full h-full flex items-end justify-center bg-transparent pb-5">
      <button
        type="button"
        data-testid="pet-recovery-shell"
        className="group relative flex h-24 w-24 items-center justify-center rounded-full border border-white/70 bg-gradient-to-b from-sky-100 to-violet-200 shadow-[0_12px_30px_rgba(89,109,160,0.28)] transition-transform hover:scale-105 active:scale-95"
        aria-label={t("petRecovery.openHub")}
        title={t("petRecovery.openHub")}
        onClick={openHub}
      >
        <span className="absolute left-[25px] top-[34px] h-2.5 w-2.5 rounded-full bg-slate-700" />
        <span className="absolute right-[25px] top-[34px] h-2.5 w-2.5 rounded-full bg-slate-700" />
        <span className="absolute top-[54px] h-2 w-5 rounded-b-full border-b-2 border-slate-600" />
        <span className="absolute -bottom-2 left-4 h-8 w-5 rounded-b-full bg-violet-200" />
        <span className="absolute -bottom-3 h-9 w-5 rounded-b-full bg-violet-200" />
        <span className="absolute -bottom-2 right-4 h-8 w-5 rounded-b-full bg-violet-200" />
        <span className="absolute -top-3 rounded-full border border-white/80 bg-white/90 px-2 py-1 text-[10px] font-semibold text-slate-600 opacity-0 shadow-sm transition-opacity group-hover:opacity-100">
          Hub
        </span>
      </button>
    </div>
  );
}

// ===== Hub Window =====

function HubWindow() {
  return (
    <Suspense fallback={null}>
      <HubLayout />
    </Suspense>
  );
}

// ===== Settings Window =====

function SettingsWindow() {
  return (
    <div className="w-full h-full settings-panel">
      <Suspense fallback={null}>
        <SettingsPanel onClose={() => getCurrentWindow().hide()} />
      </Suspense>
    </div>
  );
}
