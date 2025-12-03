import { describe, it, expect } from "vitest";
import { normalizeBundlerPath } from "../../src/services/code-fetcher.js";

describe("normalizeBundlerPath", () => {
  it("strips custom schemes like app://", () => {
    expect(normalizeBundlerPath("app:///_next/dev/server/chunks/file.js")).toBe(
      "_next/dev/server/chunks/file.js"
    );
  });

  it("strips webpack scheme and leading slashes", () => {
    expect(normalizeBundlerPath("webpack:///./app/routes/home.ts")).toBe(
      "./app/routes/home.ts"
    );
  });

  it("collapses duplicate slashes after scheme removal", () => {
    expect(normalizeBundlerPath("app:////_next//server//file.js")).toBe(
      "_next/server/file.js"
    );
  });

  it("returns original path when no scheme present", () => {
    expect(normalizeBundlerPath("src/app/routes/index.ts")).toBe(
      "src/app/routes/index.ts"
    );
  });
});
