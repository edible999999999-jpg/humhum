import { describe, expect, it } from "vitest";
import { interventionReducer, initialInterventionState } from "./interventionState";

describe("interventionReducer", () => {
  it("retains the draft when delivery fails", () => {
    const drafted = interventionReducer(initialInterventionState, { type: "draft", value: "检查测试" });
    const sending = interventionReducer(drafted, { type: "send" });
    const failed = interventionReducer(sending, { type: "failed", error: "thread unavailable" });

    expect(failed.status).toBe("failed");
    expect(failed.draft).toBe("检查测试");
    expect(failed.error).toBe("thread unavailable");
  });

  it("clears the draft only after successful delivery", () => {
    const drafted = interventionReducer(initialInterventionState, { type: "draft", value: "继续" });
    const delivered = interventionReducer(
      interventionReducer(drafted, { type: "send" }),
      { type: "delivered" },
    );

    expect(delivered).toEqual({ status: "delivered", draft: "", error: null });
  });

  it("clears an accepted draft when it is queued behind an earlier message", () => {
    const drafted = interventionReducer(initialInterventionState, { type: "draft", value: "second" });
    const queued = interventionReducer(
      interventionReducer(drafted, { type: "send" }),
      { type: "queued" },
    );

    expect(queued).toEqual({ status: "queued", draft: "", error: null });
  });
});
