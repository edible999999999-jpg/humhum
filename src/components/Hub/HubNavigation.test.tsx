import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { HubNavigationItem } from "./HubNavigation";

const rooms = ["humi", "hype", "hush", "hexa"] as const;

function renderNavigationItem(room: (typeof rooms)[number], active = false) {
  return renderToStaticMarkup(
    <HubNavigationItem
      room={room}
      label={`${room} room`}
      active={active}
      signalActive={room === "hype"}
      onSelect={vi.fn()}
    />,
  );
}

describe("HubNavigationItem", () => {
  it("uses a microphone for Humi", () => {
    expect(renderNavigationItem("humi")).toContain("lucide-mic-vocal");
  });

  it("keeps Hype's antenna and alert symbols in a stable wrapper", () => {
    const html = renderNavigationItem("hype");

    expect(html).toContain('class="hub-nav-symbol hub-nav-symbol-hype"');
    expect(html).toContain("lucide-antenna");
    expect(html).toContain("lucide-circle-alert");
  });

  it("clips Hush's eye at the rail edge", () => {
    const html = renderNavigationItem("hush");

    expect(html).toContain('class="hub-nav-symbol hub-nav-symbol-hush"');
    expect(html).toContain("lucide-eye");
  });

  it("uses a wrench for Hexa", () => {
    expect(renderNavigationItem("hexa")).toContain("lucide-wrench");
  });

  it.each(rooms)("renders an accessible, labelled button with a state dot for %s", (room) => {
    const label = `${room} room`;
    const html = renderNavigationItem(room);

    expect(html).toContain('type="button"');
    expect(html).toContain(`aria-label="${label}"`);
    expect(html).toContain(`>${label}</span>`);
    expect(html).toContain("hub-nav-state-dot");
  });

  it("marks the active item as the current page", () => {
    expect(renderNavigationItem("humi", true)).toContain('aria-current="page"');
    expect(renderNavigationItem("humi")).not.toContain("aria-current");
  });

  it("does not render a portrait image or text monogram", () => {
    const html = renderNavigationItem("humi");

    expect(html).not.toContain("<img");
    expect(html).not.toContain("hub-navigation-monogram");
  });
});
