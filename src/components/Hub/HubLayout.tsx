import { useState, lazy, Suspense } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useTranslation } from "../../lib/i18n/react";

const HumiModule = lazy(() => import("./HumiModule").then((m) => ({ default: m.HumiModule })));
const HexaModule = lazy(() => import("./HexaModule").then((m) => ({ default: m.HexaModule })));
const KnowledgeModule = lazy(() => import("./KnowledgeModule").then((m) => ({ default: m.KnowledgeModule })));
const HushModule = lazy(() => import("./HushModule").then((m) => ({ default: m.HushModule })));

type Module = "humi" | "hype" | "hush" | "hexa";

const MODULES: { id: Module; icon: string; labelKey: string }[] = [
  { id: "humi", icon: "H", labelKey: "hub.nav.humi" },
  { id: "hype", icon: "Y", labelKey: "hub.nav.hype" },
  { id: "hush", icon: "S", labelKey: "hub.nav.hush" },
  { id: "hexa", icon: "X", labelKey: "hub.nav.hexa" },
];

export function HubLayout() {
  const [active, setActive] = useState<Module>("humi");
  const { t } = useTranslation();
  const subtitle = t("hub.subtitle");

  return (
    <div className="hub-panel">
      {/* Title bar — draggable */}
      <div
        className="hub-titlebar"
        onMouseDown={() => getCurrentWindow().startDragging().catch(() => {})}
      >
        <div className="hub-title-stack">
          <span className="hub-title">{t("hub.title")}</span>
          {subtitle && <span className="hub-subtitle">{subtitle}</span>}
        </div>
        <button
          className="hub-close"
          onClick={() => getCurrentWindow().hide()}
          aria-label={t("hub.close")}
        >
          ✕
        </button>
      </div>

      <div className="hub-body">
        {/* Sidebar */}
        <nav className="hub-sidebar">
          {MODULES.map((m) => (
            <button
              key={m.id}
              className={`hub-sidebar-item ${active === m.id ? "active" : ""}`}
              onClick={() => setActive(m.id)}
              title={t(m.labelKey)}
            >
              <span className="hub-sidebar-icon">{m.icon}</span>
              <span className="hub-sidebar-label">{t(m.labelKey)}</span>
            </button>
          ))}
        </nav>

        {/* Content */}
        <main className="hub-content">
          <Suspense fallback={<div className="hub-loading" />}>
            {active === "humi" && <HumiModule />}
            {active === "hexa" && <HexaModule />}
            {active === "hype" && <KnowledgeModule />}
            {active === "hush" && <HushModule />}
          </Suspense>
        </main>
      </div>
    </div>
  );
}
