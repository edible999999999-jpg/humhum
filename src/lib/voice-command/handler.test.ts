import { describe, expect, it } from "vitest";
import { matchCommand, requiresManualConfirmation } from "./handler";

describe("matchCommand", () => {
  it("approves clear confirmations", () => {
    expect(matchCommand("确认")).toBe("confirm");
    expect(matchCommand("好的")).toBe("confirm");
    expect(matchCommand("允许")).toBe("confirm");
    expect(matchCommand("yes")).toBe("confirm");
    expect(matchCommand("okay")).toBe("confirm");
  });

  it("denies clear rejections", () => {
    expect(matchCommand("拒绝")).toBe("reject");
    expect(matchCommand("取消")).toBe("reject");
    expect(matchCommand("deny")).toBe("reject");
  });

  it("never reads a negated phrase as approval (regression)", () => {
    // "不允许" contains "允许"; the old substring match approved it.
    expect(matchCommand("不允许")).toBe("reject");
    expect(matchCommand("不可以")).toBe("reject");
    expect(matchCommand("don't allow")).toBe("reject");
    expect(matchCommand("no, do not allow that")).toBe("reject");
    // Even if a negation lands on no explicit reject trigger, it must not confirm.
    expect(matchCommand("勿执行")).not.toBe("confirm");
  });

  it("requires ASCII word boundaries so triggers don't fire inside other words", () => {
    expect(matchCommand("yesterday we shipped")).toBe("unknown");
    expect(matchCommand("now what")).not.toBe("reject");
  });

  it("returns unknown for empty or unrelated input", () => {
    expect(matchCommand("")).toBe("unknown");
    expect(matchCommand("今天天气不错")).toBe("unknown");
  });
});

describe("requiresManualConfirmation", () => {
  it("treats high-risk tools as manual-only", () => {
    expect(requiresManualConfirmation("Bash")).toBe(true);
    expect(requiresManualConfirmation("Write")).toBe(true);
    expect(requiresManualConfirmation("Edit")).toBe(true);
  });

  it("treats unknown or missing tools as high-risk by default", () => {
    expect(requiresManualConfirmation(null)).toBe(true);
    expect(requiresManualConfirmation(undefined)).toBe(true);
    expect(requiresManualConfirmation("SomethingNew")).toBe(true);
  });

  it("allows voice approval for low-risk tools", () => {
    expect(requiresManualConfirmation("Read")).toBe(false);
    expect(requiresManualConfirmation("WebSearch")).toBe(false);
  });
});
