import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { HubNavigationItem } from "./HubNavigation";

const rooms = ["humi", "hype", "hush", "hexa"] as const;
const characterRoomStyles = readFileSync(
  new URL("../../styles/hub-character-rooms.css", import.meta.url),
  "utf8",
);

function renderNavigationItem(
  room: (typeof rooms)[number],
  active = false,
  signalActive?: boolean,
) {
  return renderToStaticMarkup(
    <HubNavigationItem
      room={room}
      label={`${room} room`}
      active={active}
      signalActive={signalActive}
      onSelect={vi.fn()}
    />,
  );
}

function getStyleRule(selector: string) {
  const ruleStart = characterRoomStyles.indexOf(`${selector} {`);
  expect(ruleStart, `Missing style rule for ${selector}`).toBeGreaterThanOrEqual(0);
  const declarationsStart = characterRoomStyles.indexOf("{", ruleStart) + 1;
  const ruleEnd = characterRoomStyles.indexOf("}", declarationsStart);
  return characterRoomStyles.slice(declarationsStart, ruleEnd);
}

describe("HubNavigationItem", () => {
  it("uses a microphone for Humi", () => {
    expect(renderNavigationItem("humi")).toContain("lucide-mic-vocal");
  });

  it("marks Humi's existing 24px symbol wrapper when its activity signal is active", () => {
    const html = renderNavigationItem("humi", false, true);

    expect(html).toContain(
      'class="hub-nav-symbol hub-nav-symbol-humi is-signaled"',
    );
    expect(html).toContain('class="hub-nav-symbol-stack"');
    expect(characterRoomStyles).toMatch(
      /\.hub-nav-symbol\s*\{[^}]*width:\s*24px[^}]*height:\s*24px/,
    );
  });

  it("shows Hype's antenna by default using stable semantic icon classes", () => {
    const html = renderNavigationItem("hype");

    expect(html).toContain('class="hub-nav-symbol hub-nav-symbol-hype"');
    expect(html).toContain("hub-nav-hype-antenna");
    expect(html).toContain("hub-nav-hype-alert");
    expect(html).not.toContain("is-signaled");
  });

  it("marks Hype's stable wrapper when its signal is active", () => {
    const html = renderNavigationItem("hype", false, true);

    expect(html).toContain(
      'class="hub-nav-symbol hub-nav-symbol-hype is-signaled"',
    );
  });

  it("gives Hush's clipped eye a stable hover-animation hook", () => {
    const html = renderNavigationItem("hush");

    expect(html).toContain('class="hub-nav-symbol hub-nav-symbol-hush"');
    expect(html).toContain("hub-nav-hush-eye");
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

describe("Humi conversation room styles", () => {
  it("caps visible structural corner radii at 8px", () => {
    const structuralSelectors = [
      ".humi-message-row-user .humi-message",
      ".humi-composer",
      ".humi-composer-send",
      ".humi-details-panel",
    ];

    for (const selector of structuralSelectors) {
      const radiusMatch = getStyleRule(selector).match(/border-radius:\s*(\d+)px/);
      expect(radiusMatch, `Missing pixel radius for ${selector}`).not.toBeNull();
      expect(Number(radiusMatch?.[1]), selector).toBeLessThanOrEqual(8);
    }
  });
});

describe("Hub navigation motion styles", () => {
  it("crossfades Hype from antenna to alert on hover or signal", () => {
    expect(characterRoomStyles).toMatch(
      /\.hub-nav-hype-antenna\s*\{[^}]*opacity:\s*1/,
    );
    expect(characterRoomStyles).toMatch(
      /\.hub-nav-hype-alert\s*\{[^}]*opacity:\s*0/,
    );
    expect(characterRoomStyles).toMatch(
      /\.hub-nav-item-hype:hover \.hub-nav-hype-antenna,[\s\S]*\.hub-nav-symbol-hype\.is-signaled \.hub-nav-hype-antenna\s*\{[^}]*opacity:\s*0/,
    );
    expect(characterRoomStyles).toMatch(
      /\.hub-nav-item-hype:hover \.hub-nav-hype-alert,[\s\S]*\.hub-nav-symbol-hype\.is-signaled \.hub-nav-hype-alert\s*\{[^}]*opacity:\s*1/,
    );
  });

  it("keeps Hush half-hidden at rest and runs one finite peek only on hover", () => {
    expect(characterRoomStyles).toMatch(
      /\.hub-nav-hush-eye\s*\{[^}]*transform:\s*translateX\(-12px\)/,
    );
    expect(characterRoomStyles).toMatch(
      /\.hub-nav-item-hush:hover \.hub-nav-hush-eye\s*\{[^}]*animation:\s*hub-hush-peek [^;]* 1 forwards/,
    );
    expect(characterRoomStyles).not.toContain("infinite");
  });

  it("keeps Hush static when reduced motion is requested", () => {
    expect(characterRoomStyles).toMatch(
      /@media \(prefers-reduced-motion: reduce\)[\s\S]*\.hub-nav-item-hush:hover \.hub-nav-hush-eye\s*\{[^}]*animation:\s*none/,
    );
  });
});
