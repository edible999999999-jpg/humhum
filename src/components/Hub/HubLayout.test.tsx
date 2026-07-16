import {
  Children,
  type ButtonHTMLAttributes,
  type MouseEvent as ReactMouseEvent,
  type ReactElement,
} from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  HubWindowControls,
  stopHubWindowControlPropagation,
} from "./HubLayout";

describe("HubWindowControls", () => {
  it("renders accessible close and minimize controls", () => {
    const html = renderToStaticMarkup(
        <HubWindowControls
          closeLabel="关闭"
          minimizeLabel="最小化到任务栏"
        onClose={vi.fn()}
        onMinimize={vi.fn()}
      />,
    );

    expect(html).toContain('aria-label="关闭"');
    expect(html).toContain('aria-label="最小化到任务栏"');
    expect(html.match(/type="button"/g)).toHaveLength(2);
  });

  it("stops titlebar drag before either control runs its action", () => {
    const onClose = vi.fn();
    const onMinimize = vi.fn();
    const controls = HubWindowControls({
      closeLabel: "关闭",
      minimizeLabel: "最小化到任务栏",
      onClose,
      onMinimize,
    });
    const buttons = Children.toArray(controls.props.children) as ReactElement<
      ButtonHTMLAttributes<HTMLButtonElement>
    >[];

    expect(buttons).toHaveLength(2);

    for (const button of buttons) {
      const stopPropagation = vi.fn();
      button.props.onMouseDown?.({
        stopPropagation,
      } as unknown as ReactMouseEvent<HTMLButtonElement>);
      expect(stopPropagation).toHaveBeenCalledOnce();

      button.props.onClick?.({} as ReactMouseEvent<HTMLButtonElement>);
    }

    expect(onMinimize).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledOnce();
  });
});

describe("stopHubWindowControlPropagation", () => {
  it("stops mouse-down bubbling", () => {
    const stopPropagation = vi.fn();

    stopHubWindowControlPropagation({ stopPropagation });

    expect(stopPropagation).toHaveBeenCalledOnce();
  });
});
