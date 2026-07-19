import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import postcss, { type Container, type Declaration } from "postcss";
import { describe, expect, it } from "vitest";
import { HubRoom } from "./HubRoom";

const globalStyleRoot = postcss.parse(
  readFileSync(new URL("../../styles/global.css", import.meta.url), "utf8"),
);
const characterRoomStyleRoot = postcss.parse(
  readFileSync(
    new URL("../../styles/hub-character-rooms.css", import.meta.url),
    "utf8",
  ),
);

function reducedMotionDeclaration(
  root: Container,
  selector: string,
  property: string,
): Declaration | undefined {
  let match: Declaration | undefined;

  root.walkAtRules("media", (media) => {
    if (media.params !== "(prefers-reduced-motion: reduce)") return;

    media.walkRules((rule) => {
      if (!rule.selectors.includes(selector)) return;
      rule.walkDecls(property, (declaration) => {
        match ??= declaration;
      });
    });
  });

  return match;
}

describe("HubRoom", () => {
  it("renders a decorative Humi room background around its content", () => {
    const html = renderToStaticMarkup(
      <HubRoom room="humi">
        <p>Welcome back</p>
      </HubRoom>,
    );

    expect(html).toContain('data-room="humi"');
    expect(html).toContain('/mascots/hub-backgrounds/humi-room.webp');
    expect(html).toContain('alt=""');
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain('<div class="hub-room-content"><p>Welcome back</p></div>');
  });

  it("uses the dedicated Hexa diagnostics blueprint background", () => {
    const html = renderToStaticMarkup(
      <HubRoom room="hexa">
        <p>Agent diagnostics</p>
      </HubRoom>,
    );

    expect(html).toContain('data-room="hexa"');
    expect(html).toContain(
      '/mascots/hub-backgrounds/hexa-room-v2.png',
    );
    expect(html).not.toContain(
      '/mascots/hub-backgrounds/hexa-room.webp',
    );
  });

  it("disables Hub room entrance motion at the reduced-motion selector", () => {
    expect(
      reducedMotionDeclaration(globalStyleRoot, ".hub-module", "animation")
        ?.value,
    ).toBe("none");
    expect(
      reducedMotionDeclaration(globalStyleRoot, ".hub-module", "transition")
        ?.value,
    ).toBe("none");
  });

  it("disables motion for every Hub room descendant and pseudo-element", () => {
    const selectors = [
      ".hub-room",
      ".hub-room::before",
      ".hub-room::after",
      ".hub-room *",
      ".hub-room *::before",
      ".hub-room *::after",
    ];

    for (const selector of selectors) {
      for (const [property, value] of [
        ["animation", "none"],
        ["transition", "none"],
        ["scroll-behavior", "auto"],
      ] as const) {
        const declaration = reducedMotionDeclaration(
          characterRoomStyleRoot,
          selector,
          property,
        );

        expect(declaration?.value, `${selector} ${property}`).toBe(value);
        expect(declaration?.important, `${selector} ${property} priority`).toBe(
          true,
        );
      }
    }
  });
});
