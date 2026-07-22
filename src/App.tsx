import { Suspense, lazy, useState, useEffect } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { ErrorBoundary } from "./components/common/ErrorBoundary";
import { IntroPage } from "./components/Intro/IntroPage";
import { initBootstrap } from "./lib/bootstrap";
import { isTauriRuntime } from "./lib/tauriRuntime";

const PetView = lazy(() =>
  import("./components/Pet/PetView").then((mod) => ({ default: mod.PetView }))
);
const SettingsPanel = lazy(() =>
  import("./components/Settings/SettingsPanel").then((mod) => ({ default: mod.SettingsPanel }))
);
const HubLayout = lazy(() =>
  import("./components/Hub/HubLayout").then((mod) => ({ default: mod.HubLayout }))
);

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
    initBootstrap()
      .then(() => setReady(true))
      .catch((e) => {
        console.error("[App] Bootstrap failed:", e);
        setReady(true);
      });
  }, []);

  if (!ready) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-transparent">
        <div className="w-8 h-8 rounded-full bg-indigo-500/20 animate-pulse" />
      </div>
    );
  }

  return (
    <div className="w-full h-full flex items-center justify-center bg-transparent">
      <Suspense fallback={null}>
        <PetView />
      </Suspense>
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
