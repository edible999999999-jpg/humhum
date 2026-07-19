import { CircleAlert, Eye, Mic2, RadioTower, Wrench } from "lucide-react";
import type { HubRoomId } from "./HubRoom";

export interface HubNavigationItemProps {
  room: HubRoomId;
  label: string;
  active: boolean;
  signalActive?: boolean;
  onSelect: () => void;
}

function RoomSymbol({ room, signalActive = false }: Pick<HubNavigationItemProps, "room" | "signalActive">) {
  switch (room) {
    case "humi":
      return (
        <span
          className={`hub-nav-symbol hub-nav-symbol-humi${signalActive ? " is-signaled" : ""}`}
          aria-hidden="true"
        >
          <Mic2 size={18} strokeWidth={1.9} />
        </span>
      );
    case "hype":
      return (
        <span
          className={`hub-nav-symbol hub-nav-symbol-hype${signalActive ? " is-signaled" : ""}`}
          aria-hidden="true"
        >
          <RadioTower
            className="hub-nav-hype-icon hub-nav-hype-antenna"
            size={18}
            strokeWidth={1.9}
          />
          <CircleAlert
            className="hub-nav-hype-icon hub-nav-hype-alert"
            size={18}
            strokeWidth={1.9}
          />
        </span>
      );
    case "hush":
      return (
        <span className="hub-nav-symbol hub-nav-symbol-hush" aria-hidden="true">
          <Eye className="hub-nav-hush-eye" size={18} strokeWidth={1.9} />
        </span>
      );
    case "hexa":
      return (
        <span className="hub-nav-symbol hub-nav-symbol-hexa" aria-hidden="true">
          <Wrench size={18} strokeWidth={1.9} />
        </span>
      );
  }
}

export function HubNavigationItem({
  room,
  label,
  active,
  signalActive,
  onSelect,
}: HubNavigationItemProps) {
  return (
    <button
      type="button"
      className={`hub-sidebar-item hub-nav-item hub-nav-item-${room} ${active ? "active" : ""}`}
      onClick={onSelect}
      aria-label={label}
      aria-current={active ? "page" : undefined}
      title={label}
    >
      <span className="hub-nav-rail-accent" aria-hidden="true" />
      <span className="hub-nav-symbol-stack">
        <RoomSymbol room={room} signalActive={signalActive} />
      </span>
      <span className="hub-sidebar-label">{label}</span>
    </button>
  );
}
