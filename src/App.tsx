import { useState, useEffect } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { PetView } from "./components/Pet/PetView";
import { SettingsPanel } from "./components/Settings/SettingsPanel";
import { initBootstrap } from "./lib/bootstrap";

/**
 * Root App component — detects which window it's in and renders accordingly.
 * - "main" window: renders the desktop pet (small, draggable, transparent)
 * - "settings" window: renders the settings panel
 */
export default function App() {
  const [windowLabel, setWindowLabel] = useState<string>("main");

  useEffect(() => {
    const win = getCurrentWindow();
    setWindowLabel(win.label);
  }, []);

  if (windowLabel === "settings") {
    return <SettingsWindow />;
  }

  return <PetWindow />;
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
      <PetView />
    </div>
  );
}

// ===== Settings Window =====

function SettingsWindow() {
  return (
    <div className="w-full h-full settings-panel">
      <SettingsPanel onClose={() => getCurrentWindow().hide()} />
    </div>
  );
}
