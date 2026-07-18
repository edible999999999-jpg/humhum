import type { ReactNode } from "react";

export type HubRoomId = "humi" | "hype" | "hush" | "hexa";

export interface HubRoomProps {
  room: HubRoomId;
  children: ReactNode;
  className?: string;
}

const ROOM_BACKGROUNDS: Record<HubRoomId, string> = {
  humi: "/mascots/hub-backgrounds/humi-room.webp",
  hype: "/mascots/hub-backgrounds/hype-room.webp",
  hush: "/mascots/hub-backgrounds/hush-room.webp",
  hexa: "/mascots/hub-backgrounds/hexa-room.webp",
};

export function HubRoom({ room, children, className }: HubRoomProps) {
  return (
    <section className={["hub-room", className].filter(Boolean).join(" ")} data-room={room}>
      <img
        className="hub-room-background"
        src={ROOM_BACKGROUNDS[room]}
        alt=""
        aria-hidden="true"
      />
      <div className="hub-room-content">{children}</div>
    </section>
  );
}
