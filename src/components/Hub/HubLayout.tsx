import {
  useState,
  lazy,
  Suspense,
} from "react";
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

export function HubLayout() {
  const [active, setActive] = useState<Module>("humi");
  const [humiActivity, setHumiActivity] = useState(false);
  const [hexaFocusGoalId, setHexaFocusGoalId] = useState<string | null>(null);
  const { t } = useTranslation();
  const subtitle = t("hub.subtitle");
  const activeLabel = t(MODULES.find((module) => module.id === active)?.labelKey ?? "hub.title");

  const openHexaGoal = (goalId: string | null) => {
    setHexaFocusGoalId(goalId);
    setActive("hexa");
  };

  return (
    <div className="hub-panel" data-active-room={active}>
      <div className="hub-titlebar" data-tauri-drag-region>
        <div className="hub-title-stack">
          <span className="hub-title">{activeLabel} · {t("hub.title")}</span>
          {subtitle && <span className="hub-subtitle">{subtitle}</span>}
        </div>
      </div>

      <div className="hub-body">
        <nav className="hub-module-nav" aria-label={t("hub.title")}>
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
              <div hidden={active !== "humi"} aria-hidden={active !== "humi"}>
                <HumiModule
                  onActivityChange={setHumiActivity}
                  onOpenHexa={openHexaGoal}
                />
              </div>
              {active === "hexa" && <HexaModule focusGoalId={hexaFocusGoalId} />}
              {active === "hype" && <KnowledgeModule />}
              {active === "hush" && <HushModule />}
            </Suspense>
          </HubRoom>
        </main>
      </div>
    </div>
  );
}
