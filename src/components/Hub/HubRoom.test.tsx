import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { HubRoom } from "./HubRoom";

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
});
