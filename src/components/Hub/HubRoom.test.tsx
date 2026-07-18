import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import postcss from "postcss";
import { describe, expect, it } from "vitest";
import { HubRoom } from "./HubRoom";

const globalStyleRoot = postcss.parse(
  readFileSync(new URL("../../styles/global.css", import.meta.url), "utf8"),
);

function reducedMotionDeclaration(
  selector: string,
  property: string,
): string | undefined {
  let value: string | undefined;

  globalStyleRoot.walkAtRules("media", (media) => {
    if (media.params !== "(prefers-reduced-motion: reduce)") return;

    media.walkRules((rule) => {
      if (!rule.selectors.includes(selector)) return;
      rule.walkDecls(property, (declaration) => {
        value ??= declaration.value;
      });
    });
  });

  return value;
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

  it("disables Hub room entrance motion at the reduced-motion selector", () => {
    expect(reducedMotionDeclaration(".hub-module", "animation")).toBe("none");
    expect(reducedMotionDeclaration(".hub-module", "transition")).toBe("none");
  });
});
