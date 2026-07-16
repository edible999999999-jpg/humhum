import { describe, expect, it } from "vitest";
import { compactFilePath, getPathBasename } from "./path-display";

describe("path display helpers", () => {
  it("extracts file names from POSIX and Windows paths", () => {
    expect(getPathBasename("/Users/ruby/project/src/main.ts")).toBe("main.ts");
    expect(getPathBasename("C:\\Users\\ruby\\project\\src\\main.ts")).toBe("main.ts");
  });

  it("ignores trailing separators when extracting a name", () => {
    expect(getPathBasename("C:\\Users\\ruby\\project\\")).toBe("project");
    expect(getPathBasename("/Users/ruby/project/")).toBe("project");
  });

  it("compacts either path style to the final segments", () => {
    expect(compactFilePath("/Users/ruby/project/src/main.ts")).toBe(".../project/src/main.ts");
    expect(compactFilePath("C:\\Users\\ruby\\project\\src\\main.ts")).toBe(".../project/src/main.ts");
  });

  it("keeps short paths unchanged", () => {
    expect(compactFilePath("src/main.ts")).toBe("src/main.ts");
    expect(compactFilePath("src\\main.ts")).toBe("src\\main.ts");
  });
});
