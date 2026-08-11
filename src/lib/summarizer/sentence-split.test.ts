import { describe, expect, it } from "vitest";
import { SentenceSplitter } from "./sentence-split";

// Feed a whole string one code point at a time (matching the real char-by-char
// summarizer stream) and collect every emitted chunk plus the final flush.
function drain(input: string, opts?: { firstSentenceMaxChars?: number; maxChars?: number }): string[] {
  const splitter = new SentenceSplitter(opts);
  const out: string[] = [];
  for (const ch of input) {
    for (const chunk of splitter.feed(ch)) out.push(chunk.text);
  }
  const last = splitter.flush();
  if (last) out.push(last.text);
  return out;
}

describe("SentenceSplitter speakable-content guard", () => {
  it("emits Chinese sentences", () => {
    expect(drain("任务完成了。")).toEqual(["任务完成了。"]);
  });

  it("emits English sentences", () => {
    expect(drain("Build passed.")).toEqual(["Build passed."]);
  });

  it("no longer drops Japanese kana sentences", () => {
    // Kana falls outside the old /\w|[一-鿿]/ guard and was silently swallowed.
    expect(drain("こんにちは。").join("")).toContain("こんにちは");
  });

  it("no longer drops accented-Latin-only sentences", () => {
    expect(drain("Éàü ëï.").join("")).toContain("Éàü");
  });

  it("still discards punctuation-only fragments", () => {
    expect(drain("。。")).toEqual([]);
  });
});

describe("SentenceSplitter hard-cut safety", () => {
  it("never splits a UTF-16 surrogate pair on a boundary-free run", () => {
    // A long boundary-free run of emoji (each a surrogate pair). The hard cut
    // must not orphan a half-surrogate; every emitted chunk must be well formed.
    const input = "😀".repeat(80);
    for (const chunk of drain(input)) {
      // A lone surrogate survives a round-trip through encode/decode as U+FFFD.
      expect(chunk).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
      expect(chunk).not.toMatch(/(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/);
    }
  });
});
