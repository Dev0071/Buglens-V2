/**
 * Source Map E2E Integration Tests
 *
 * Tests the full source map resolution flow using real bundled fixtures:
 * - webpack bundles (webpack:// protocol)
 * - Vite bundles (absolute paths)
 * - Rollup bundles (relative paths)
 *
 * These tests validate that Buglens can correctly map minified stack frames
 * back to original source locations across different bundler outputs.
 */

import { describe, it, expect, beforeAll } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { SourceMapConsumer } from "source-map";

// ============================================================================
// Fixture Loading
// ============================================================================

const FIXTURES_DIR = path.join(__dirname, "../fixtures/source-maps");

interface _BundleFixture {
  name: string;
  minifiedCode: string;
  sourceMap: object;
  expectedSourceFile: string;
  testCases: Array<{
    description: string;
    minifiedLine: number;
    minifiedColumn: number;
    expectedOriginalLine: number;
    expectedOriginalColumn?: number;
    expectedSymbol?: string;
  }>;
}

function loadFixture(baseName: string): { code: string; map: object } | null {
  try {
    const codeFile = path.join(FIXTURES_DIR, baseName);
    const mapFile = path.join(FIXTURES_DIR, `${baseName}.map`);

    if (!fs.existsSync(codeFile) || !fs.existsSync(mapFile)) {
      return null;
    }

    return {
      code: fs.readFileSync(codeFile, "utf-8"),
      map: JSON.parse(fs.readFileSync(mapFile, "utf-8")),
    };
  } catch {
    return null;
  }
}

// ============================================================================
// Source Map Resolution Tests
// ============================================================================

describe("Source Map E2E Integration", () => {
  describe("Webpack Bundle Resolution", () => {
    let fixture: { code: string; map: any } | null;

    beforeAll(() => {
      fixture = loadFixture("webpack-bundle.js");
    });

    it("should load webpack fixture successfully", () => {
      expect(fixture).not.toBeNull();
      expect(fixture!.code).toContain("sourceMappingURL=webpack-bundle.js.map");
      expect(fixture!.map.version).toBe(3);
    });

    it("should have webpack:// protocol in sources", () => {
      expect(fixture!.map.sources).toBeDefined();
      expect(fixture!.map.sources.length).toBeGreaterThan(0);
      expect(fixture!.map.sources[0]).toMatch(/webpack:\/\//);
    });

    it("should contain original source content", () => {
      expect(fixture!.map.sourcesContent).toBeDefined();
      expect(fixture!.map.sourcesContent[0]).toContain("getUserData");
      expect(fixture!.map.sourcesContent[0]).toContain("processUser");
    });

    it("should resolve minified position to original source", async () => {
      const consumer = await new SourceMapConsumer(fixture!.map);
      try {
        // Test mapping a position - the exact line depends on the bundle
        const original = consumer.originalPositionFor({
          line: 1,
          column: 100,
        });

        // Should map to somewhere in the original source
        expect(original.source).toMatch(/webpack:\/\/.*user-module\.ts/);
      } finally {
        consumer.destroy();
      }
    });

    it("should extract original source path correctly", () => {
      const rawSource = fixture!.map.sources[0];
      // webpack://buglens-demo/./src/user-module.ts -> src/user-module.ts
      const normalized = rawSource
        .replace(/^webpack:\/\/[^/]+\/\.\//, "")
        .replace(/^webpack:\/\/[^/]+\//, "");

      expect(normalized).toBe("src/user-module.ts");
    });
  });

  describe("Vite Bundle Resolution", () => {
    let fixture: { code: string; map: any } | null;

    beforeAll(() => {
      fixture = loadFixture("vite-bundle.js");
    });

    it("should load vite fixture successfully", () => {
      expect(fixture).not.toBeNull();
      expect(fixture!.code).toContain("sourceMappingURL=vite-bundle.js.map");
      expect(fixture!.map.version).toBe(3);
    });

    it("should have absolute paths in sources", () => {
      expect(fixture!.map.sources).toBeDefined();
      expect(fixture!.map.sources[0]).toMatch(/^\/Users\/.*\.ts$/);
    });

    it("should contain ApiClient class in original source", () => {
      expect(fixture!.map.sourcesContent[0]).toContain("class ApiClient");
      expect(fixture!.map.sourcesContent[0]).toContain("async get");
    });

    it("should resolve minified class to original", async () => {
      const consumer = await new SourceMapConsumer(fixture!.map);
      try {
        // The 'o' in the minified code is ApiClient
        // Find where the class is defined
        const original = consumer.originalPositionFor({
          line: 1,
          column: 200,
        });

        // Should map back to the original file
        expect(original.source).toContain("api-client.ts");
      } finally {
        consumer.destroy();
      }
    });

    it("should normalize Vite absolute path", () => {
      const rawSource = fixture!.map.sources[0];
      // /Users/dev/project/src/api-client.ts -> src/api-client.ts
      const match = rawSource.match(/\/src\/(.+)$/);
      const normalized = match ? `src/${match[1]}` : rawSource;

      expect(normalized).toBe("src/api-client.ts");
    });
  });

  describe("Rollup Bundle Resolution", () => {
    let fixture: { code: string; map: any } | null;

    beforeAll(() => {
      fixture = loadFixture("rollup-bundle.cjs");
    });

    it("should load rollup fixture successfully", () => {
      expect(fixture).not.toBeNull();
      expect(fixture!.code).toContain("sourceMappingURL=rollup-bundle.cjs.map");
      expect(fixture!.map.version).toBe(3);
    });

    it("should have relative paths in sources", () => {
      expect(fixture!.map.sources).toBeDefined();
      expect(fixture!.map.sources).toContain("../src/logger.ts");
      expect(fixture!.map.sources).toContain("../src/http.ts");
      expect(fixture!.map.sources).toContain("../src/user.ts");
    });

    it("should contain multiple source files", () => {
      expect(fixture!.map.sources.length).toBe(4);
      expect(fixture!.map.sourcesContent.length).toBe(4);
    });

    it("should contain the bug potential in user.ts source", () => {
      const userSource = fixture!.map.sourcesContent[2]; // ../src/user.ts
      expect(userSource).toContain("getUserDisplayName");
      // The user source should access profile.displayName which can throw if profile is null
      expect(userSource).toContain("profile.displayName");
    });

    it("should resolve to correct source file", async () => {
      const consumer = await new SourceMapConsumer(fixture!.map);
      try {
        // Find a position that maps to user.ts
        // The getUserDisplayName function is near the end of the minified bundle
        let foundUserTs = false;

        // Scan through the bundle to find user.ts mapping
        for (let col = 0; col < 500; col += 10) {
          const original = consumer.originalPositionFor({
            line: 1,
            column: col,
          });
          if (original.source?.includes("user.ts")) {
            foundUserTs = true;
            expect(original.source).toBe("../src/user.ts");
            break;
          }
        }

        expect(foundUserTs).toBe(true);
      } finally {
        consumer.destroy();
      }
    });

    it("should normalize rollup relative paths", () => {
      const rawSource = fixture!.map.sources[2]; // ../src/user.ts
      // Normalize relative path
      const normalized = rawSource.replace(/^\.\.\//, "");

      expect(normalized).toBe("src/user.ts");
    });
  });

  describe("Source Map Detection", () => {
    it("should detect external source map reference", () => {
      const webpackCode = loadFixture("webpack-bundle.js")?.code || "";
      const match = webpackCode.match(/\/\/[#@]\s*sourceMappingURL=(.+)$/m);

      expect(match).not.toBeNull();
      expect(match![1]).toBe("webpack-bundle.js.map");
    });

    it("should detect minified code patterns", () => {
      const viteCode = loadFixture("vite-bundle.js")?.code || "";

      // Minified code characteristics
      const isMinified = (code: string): boolean => {
        const lines = code.split("\n").filter((l) => l.trim());
        const avgLineLength = code.length / lines.length;
        const hasShortVars = /\b[a-z]\s*[=,(]/i.test(code);
        const noComments = !/\/\*[\s\S]*?\*\/|\/\/[^\n]*/.test(
          code.replace(/\/\/[#@]\s*sourceMappingURL/, "")
        );

        return avgLineLength > 100 && hasShortVars && noComments;
      };

      expect(isMinified(viteCode)).toBe(true);
    });
  });

  describe("Path Normalization Patterns", () => {
    const testCases = [
      { input: "webpack://my-app/./src/utils.ts", expected: "src/utils.ts" },
      { input: "webpack://my-app/src/utils.ts", expected: "src/utils.ts" },
      { input: "webpack:///./src/utils.ts", expected: "src/utils.ts" },
      { input: "/Users/dev/project/src/utils.ts", expected: "src/utils.ts" },
      { input: "/home/dev/project/src/utils.ts", expected: "src/utils.ts" },
      { input: "../src/utils.ts", expected: "src/utils.ts" },
      { input: "../../src/utils.ts", expected: "src/utils.ts" },
      { input: "app:///src/utils.ts", expected: "src/utils.ts" },
      {
        input: "node_modules/lodash/index.js",
        expected: "node_modules/lodash/index.js",
      },
    ];

    const normalizeSourcePath = (source: string): string => {
      // Remove webpack:// protocol
      let result = source.replace(/^webpack:\/\/[^/]*\/\.?\//, "");
      result = result.replace(/^webpack:\/\/[^/]*\//, "");

      // Remove app:// protocol (React Native)
      result = result.replace(/^app:\/\/\//, "");

      // Handle absolute paths - extract from /src/
      const srcMatch = result.match(/\/src\/(.+)$/);
      if (srcMatch) {
        return `src/${srcMatch[1]}`;
      }

      // Remove leading ../
      result = result.replace(/^(\.\.\/)+/, "");

      return result;
    };

    testCases.forEach(({ input, expected }) => {
      it(`should normalize "${input}" to "${expected}"`, () => {
        expect(normalizeSourcePath(input)).toBe(expected);
      });
    });
  });

  describe("Error Stack Frame Simulation", () => {
    it("should map minified error stack to original locations", async () => {
      const fixture = loadFixture("rollup-bundle.cjs");
      if (!fixture) return;

      // Simulate a stack frame from a minified error
      const minifiedFrame = {
        file: "dist/rollup-bundle.cjs",
        line: 1,
        column: 400, // Approximate position of getUserDisplayName
        functionName: "s", // Minified function name
      };

      const consumer = await new SourceMapConsumer(fixture.map);
      try {
        const original = consumer.originalPositionFor({
          line: minifiedFrame.line,
          column: minifiedFrame.column,
        });

        // The resolved frame should point to original source
        if (original.source) {
          expect(original.line).toBeGreaterThan(0);
          expect(original.source).toMatch(/\.ts$/);
        }
      } finally {
        consumer.destroy();
      }
    });

    it("should handle inline source maps", async () => {
      // Create a fixture with inline source map
      const originalCode = "function test() { return 42; }";
      const simpleMap = {
        version: 3,
        file: "inline.js",
        sources: ["original.ts"],
        sourcesContent: [originalCode],
        names: ["test"],
        mappings: "AAAA,SAASA,OAAO,OAAO",
      };

      const base64Map = Buffer.from(JSON.stringify(simpleMap)).toString(
        "base64"
      );
      const inlineCode = `function a(){return 42}
//# sourceMappingURL=data:application/json;base64,${base64Map}`;

      // Extract inline map
      const match = inlineCode.match(
        /\/\/[#@]\s*sourceMappingURL=data:application\/json;base64,(.+)$/m
      );

      expect(match).not.toBeNull();

      const extractedMap = JSON.parse(
        Buffer.from(match![1], "base64").toString("utf-8")
      );

      expect(extractedMap.version).toBe(3);
      expect(extractedMap.sources).toContain("original.ts");
      expect(extractedMap.sourcesContent[0]).toBe(originalCode);
    });
  });
});

// ============================================================================
// Performance Tests
// ============================================================================

describe("Source Map Performance", () => {
  it("should resolve 100 positions in under 100ms", async () => {
    const fixture = loadFixture("vite-bundle.js");
    if (!fixture) return;

    const consumer = await new SourceMapConsumer(fixture.map);
    const start = performance.now();

    try {
      for (let i = 0; i < 100; i++) {
        consumer.originalPositionFor({
          line: 1,
          column: i * 5,
        });
      }
    } finally {
      consumer.destroy();
    }

    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(100);
  });

  it("should parse source map in under 50ms", async () => {
    const fixture = loadFixture("rollup-bundle.cjs");
    if (!fixture) return;

    const start = performance.now();
    const consumer = await new SourceMapConsumer(fixture.map);
    const elapsed = performance.now() - start;

    consumer.destroy();

    expect(elapsed).toBeLessThan(50);
  });
});
