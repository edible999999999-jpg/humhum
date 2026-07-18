import {
  useState,
  lazy,
  Suspense,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Minus, X } from "lucide-react";
import { useTranslation } from "../../lib/i18n/react";
import "../../styles/hub-character-rooms.css";
import { HubNavigationItem } from "./HubNavigation";
import { HubRoom, type HubRoomId } from "./HubRoom";

const HumiModule = lazy(() => import("./HumiModule").then((m) => ({ default: m.HumiModule })));
const HexaModule = lazy(() => import("./HexaModule").then((m) => ({ default: m.HexaModule })));
const KnowledgeModule = lazy(() => import("./KnowledgeModule").then((m) => ({ default: m.KnowledgeModule })));
const HushModule = lazy(() => import("./HushModule").then((m) => ({ default: m.HushModule })));

type Module = HubRoomId;

const MODULES: { id: Module; labelKey: string }[] = [
  { id: "humi", labelKey: "hub.nav.humi" },
  { id: "hype", labelKey: "hub.nav.hype" },
  { id: "hush", labelKey: "hub.nav.hush" },
  { id: "hexa", labelKey: "hub.nav.hexa" },
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
  const [humiActivity, setHumiActivity] = useState(false);
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
    <div className="hub-panel" data-active-room={active}>
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
        <nav className="hub-sidebar" aria-label={t("hub.title")}>
          {MODULES.map((m) => (
            <HubNavigationItem
              key={m.id}
              room={m.id}
              label={t(m.labelKey)}
              active={active === m.id}
              signalActive={m.id === "humi" && humiActivity}
              onSelect={() => setActive(m.id)}
            />
          ))}
        </nav>

        {/* Content */}
        <main className="hub-content">
          <HubRoom room={active}>
            <Suspense fallback={<div className="hub-loading" />}>
              {active === "humi" && <HumiModule onActivityChange={setHumiActivity} />}
              {active === "hexa" && <HexaModule />}
              {active === "hype" && <KnowledgeModule />}
              {active === "hush" && <HushModule />}
            </Suspense>
          </HubRoom>
        </main>
      </div>
    </div>
  );
}
