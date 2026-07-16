import {
  useState,
  lazy,
  Suspense,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Minus, X } from "lucide-react";
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

type HubWindowControlsProps = {
  closeLabel: string;
  minimizeLabel: string;
  onClose: () => void;
  onMinimize: () => void;
};

export function stopHubWindowControlPropagation(
  event: Pick<ReactMouseEvent<HTMLButtonElement>, "stopPropagation">,
) {
  event.stopPropagation();
}

export function HubWindowControls({
  closeLabel,
  minimizeLabel,
  onClose,
  onMinimize,
}: HubWindowControlsProps) {
  return (
    <div className="hub-window-actions">
      <button
        type="button"
        className="hub-window-control hub-minimize"
        onMouseDown={stopHubWindowControlPropagation}
        onClick={onMinimize}
        aria-label={minimizeLabel}
        title={minimizeLabel}
      >
        <Minus size={13} strokeWidth={1.8} aria-hidden="true" />
      </button>
      <button
        type="button"
        className="hub-window-control hub-close"
        onMouseDown={stopHubWindowControlPropagation}
        onClick={onClose}
        aria-label={closeLabel}
        title={closeLabel}
      >
        <X size={12} strokeWidth={1.8} aria-hidden="true" />
      </button>
    </div>
  );
}

export function HubLayout() {
  const [active, setActive] = useState<Module>("humi");
  const { t } = useTranslation();
  const subtitle = t("hub.subtitle");

  const startDragging = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    getCurrentWindow().startDragging().catch(() => {});
  };

  const closeHub = () => {
    getCurrentWindow().hide().catch((error) => {
      console.error("[Hub] Failed to close window:", error);
    });
  };

  const minimizeHub = () => {
    getCurrentWindow().minimize().catch((error) => {
      console.error("[Hub] Failed to minimize window:", error);
    });
  };

  return (
    <div className="hub-panel">
      {/* Title bar — draggable */}
      <div
        className="hub-titlebar"
        onMouseDown={startDragging}
      >
        <div className="hub-title-stack">
          <span className="hub-title">{t("hub.title")}</span>
          {subtitle && <span className="hub-subtitle">{subtitle}</span>}
        </div>
        <HubWindowControls
          closeLabel={t("hub.close")}
          minimizeLabel={t("hub.minimize")}
          onClose={closeHub}
          onMinimize={minimizeHub}
        />
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
