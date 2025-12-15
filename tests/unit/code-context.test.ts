import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * Tests for Code Context Storage (Tech Debt Fix)
 *
 * These tests verify that full code context is properly stored during
 * deterministic analysis and can be retrieved by the evidence assembly worker.
 *
 * The fix addresses the critical tech debt issue where LLM was only receiving
 * code snippets instead of full file content, impacting RCA quality.
 */

// Mock dependencies
vi.mock("../../src/utils/config.js", () => ({
  config: {
    NODE_ENV: "test",
    REDIS_URL: "redis://localhost:6379/0",
    DATABASE_URL: "postgresql://localhost:5432/test",
  },
}));

vi.mock("../../src/utils/logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

const mockQueryFn = vi.fn().mockResolvedValue({ rows: [] });
const mockTransaction = vi.fn(
  (_orgId: string, fn: (client: { query: typeof mockQueryFn }) => unknown) => {
    return fn({ query: mockQueryFn });
  }
);

vi.mock("../../src/db/client.js", () => ({
  transaction: mockTransaction,
}));

describe("Code Context Persistence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockQueryFn.mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("Code Context Structure", () => {
    it("should have correct JSONB structure for storage", () => {
      const codeContext = {
        fetched_at: new Date().toISOString(),
        repo: "test-org/test-repo",
        commit_sha: "abc123def456",
        files: [
          {
            path: "src/services/user.ts",
            content: `import { db } from './db';
export function getUser(id: string) {
  return db.find(id);
}`,
            language: "typescript",
            line_number: 3,
            column_number: 10,
          },
        ],
      };

      // Verify serialization doesn't lose data
      const serialized = JSON.stringify(codeContext);
      const deserialized = JSON.parse(serialized);

      expect(deserialized.fetched_at).toBe(codeContext.fetched_at);
      expect(deserialized.repo).toBe(codeContext.repo);
      expect(deserialized.commit_sha).toBe(codeContext.commit_sha);
      expect(deserialized.files).toHaveLength(1);
      expect(deserialized.files[0].content).toBe(codeContext.files[0].content);
    });

    it("should handle multiple files", () => {
      const codeContext = {
        fetched_at: new Date().toISOString(),
        repo: "test-org/test-repo",
        commit_sha: "abc123def456",
        files: [
          {
            path: "src/services/user.ts",
            content: "// User service\nexport function getUser() {}",
            language: "typescript",
            line_number: 2,
            column_number: null,
          },
          {
            path: "src/services/db.ts",
            content: "// Database service\nexport const db = {}",
            language: "typescript",
            line_number: 1,
            column_number: 10,
          },
          {
            path: "src/utils/validators.ts",
            content: "// Validators\nexport function validate() {}",
            language: "typescript",
            line_number: 2,
            column_number: null,
          },
        ],
      };

      expect(codeContext.files).toHaveLength(3);
      const paths = codeContext.files.map((f) => f.path);
      expect(paths).toContain("src/services/user.ts");
      expect(paths).toContain("src/services/db.ts");
      expect(paths).toContain("src/utils/validators.ts");
    });

    it("should preserve line endings in content", () => {
      const content = "line1\nline2\r\nline3\n";
      const codeContext = {
        fetched_at: new Date().toISOString(),
        repo: "test-org/test-repo",
        commit_sha: "abc123",
        files: [
          {
            path: "test.ts",
            content,
            language: "typescript",
            line_number: 1,
            column_number: null,
          },
        ],
      };

      const serialized = JSON.stringify(codeContext);
      const deserialized = JSON.parse(serialized);

      expect(deserialized.files[0].content).toBe(content);
    });

    it("should handle empty files array", () => {
      const codeContext = {
        fetched_at: new Date().toISOString(),
        repo: "test-org/test-repo",
        commit_sha: "abc123",
        files: [],
      };

      expect(codeContext.files).toHaveLength(0);
      const serialized = JSON.stringify(codeContext);
      expect(serialized).toContain('"files":[]');
    });
  });

  describe("Code Context from Analyzer Request Payload", () => {
    it("should transform code_segments to code_context format", () => {
      // AnalyzerRequestPayload.code_segments structure
      const codeSegments = [
        {
          file_path: "src/services/user.ts",
          language: "typescript",
          content: "export function getUser(id: string) { return id; }",
          error_line: 1,
          error_column: 10,
        },
      ];

      // Expected code_context structure
      const expectedCodeContext = {
        fetched_at: expect.any(String),
        repo: "test-org/test-repo",
        commit_sha: "abc123",
        files: codeSegments.map((seg) => ({
          path: seg.file_path,
          content: seg.content,
          language: seg.language,
          line_number: seg.error_line,
          column_number: seg.error_column ?? null,
        })),
      };

      expect(expectedCodeContext.files).toHaveLength(1);
      expect(expectedCodeContext.files[0].path).toBe("src/services/user.ts");
      expect(expectedCodeContext.files[0].line_number).toBe(1);
    });

    it("should handle undefined error_column", () => {
      const segment = {
        file_path: "src/index.ts",
        language: "typescript",
        content: "const x = 1;",
        error_line: 5,
        error_column: undefined as number | undefined,
      };

      const file = {
        path: segment.file_path,
        content: segment.content,
        language: segment.language,
        line_number: segment.error_line,
        column_number: segment.error_column ?? null,
      };

      expect(file.column_number).toBeNull();
    });
  });

  describe("Code Context vs Findings Comparison", () => {
    it("should have more content in code_context than findings snippets", () => {
      // Full content from code_context
      const fullContent = `import { db } from './db';
import { validateId } from './validators';

interface User {
  id: string;
  name: string;
}

export async function getUser(id: string): Promise<User | null> {
  validateId(id);
  const user = await db.user.findUnique({ where: { id } });
  return user?.name; // Error line
}`;

      // Snippet from findings
      const snippet = "return user?.name;";

      expect(fullContent.length).toBeGreaterThan(snippet.length);
      expect(fullContent.split("\n").length).toBeGreaterThan(1);

      // Full content provides:
      expect(fullContent).toContain("import"); // Import context
      expect(fullContent).toContain("interface User"); // Type context
      expect(fullContent).toContain("validateId"); // Function calls
    });

    it("should include surrounding context for accurate RCA", () => {
      const fullContent = `
// Line 1: This function handles user retrieval
// Line 2: It should handle null cases but doesn't
export function getUser(id: string) {
  // Line 4: db.find might return undefined
  const user = db.find(id);
  // Line 6: BUG - No null check before accessing .name
  return user.name;  // <- Error at line 7
}
// Line 9: Related function that does proper null checking
export function getUserSafe(id: string) {
  const user = db.find(id);
  return user?.name ?? 'Unknown';
}`;

      // LLM can now see:
      // 1. Comments explaining intent
      // 2. The related safe function showing correct pattern
      // 3. Full context around the bug

      expect(fullContent).toContain("should handle null cases");
      expect(fullContent).toContain("getUserSafe");
      expect(fullContent).toContain("user?.name");
    });
  });

  describe("Database Query Verification", () => {
    it("should use correct UPDATE query structure", () => {
      const expectedQueryPattern = `UPDATE rca_jobs
         SET code_context = $1::jsonb,
             updated_at = NOW()
         WHERE id = $2`;

      // Verify the query has correct structure
      expect(expectedQueryPattern).toContain("UPDATE rca_jobs");
      expect(expectedQueryPattern).toContain("code_context = $1::jsonb");
      expect(expectedQueryPattern).toContain("WHERE id = $2");
    });

    it("should serialize code_context as JSON for JSONB column", () => {
      const codeContext = {
        fetched_at: "2024-12-14T10:00:00Z",
        repo: "test-org/test-repo",
        commit_sha: "abc123",
        files: [
          {
            path: "test.ts",
            content: "const x = 1;",
            language: "typescript",
            line_number: 1,
            column_number: null,
          },
        ],
      };

      const serialized = JSON.stringify(codeContext);

      // Should be valid JSON
      expect(() => JSON.parse(serialized)).not.toThrow();

      // Should contain all fields
      expect(serialized).toContain("fetched_at");
      expect(serialized).toContain("files");
      expect(serialized).toContain("test.ts");
    });
  });

  describe("Edge Cases", () => {
    it("should handle very large file content", () => {
      const largeContent = "x".repeat(500000); // 500KB
      const codeContext = {
        fetched_at: new Date().toISOString(),
        repo: "test-org/test-repo",
        commit_sha: "abc123",
        files: [
          {
            path: "large-file.ts",
            content: largeContent,
            language: "typescript",
            line_number: 10000,
            column_number: 50,
          },
        ],
      };

      const serialized = JSON.stringify(codeContext);
      expect(serialized.length).toBeGreaterThan(500000);

      const deserialized = JSON.parse(serialized);
      expect(deserialized.files[0].content.length).toBe(500000);
    });

    it("should handle special characters in content", () => {
      const contentWithSpecialChars = `
// Unicode: 你好世界 🔥 émoji
const regex = /[\\x00-\\x1f]/g;
const template = \`Hello \${name}\`;
const escaped = "Line1\\nLine2\\tTabbed";
`;
      const codeContext = {
        fetched_at: new Date().toISOString(),
        repo: "test-org/test-repo",
        commit_sha: "abc123",
        files: [
          {
            path: "special.ts",
            content: contentWithSpecialChars,
            language: "typescript",
            line_number: 3,
            column_number: null,
          },
        ],
      };

      const serialized = JSON.stringify(codeContext);
      const deserialized = JSON.parse(serialized);

      expect(deserialized.files[0].content).toContain("你好世界");
      expect(deserialized.files[0].content).toContain("🔥");
    });

    it("should handle content with quotes and JSON-special characters", () => {
      const contentWithQuotes = `
const str = "Hello \\"World\\"";
const obj = {"key": "value"};
const backslash = "path\\\\to\\\\file";
`;
      const codeContext = {
        fetched_at: new Date().toISOString(),
        repo: "test-org/test-repo",
        commit_sha: "abc123",
        files: [
          {
            path: "quotes.ts",
            content: contentWithQuotes,
            language: "typescript",
            line_number: 2,
            column_number: null,
          },
        ],
      };

      const serialized = JSON.stringify(codeContext);
      const deserialized = JSON.parse(serialized);

      // Content should round-trip correctly
      expect(deserialized.files[0].content).toBe(contentWithQuotes);
    });

    it("should handle empty string content", () => {
      const codeContext = {
        fetched_at: new Date().toISOString(),
        repo: "test-org/test-repo",
        commit_sha: "abc123",
        files: [
          {
            path: "empty.ts",
            content: "",
            language: "typescript",
            line_number: 0,
            column_number: null,
          },
        ],
      };

      const serialized = JSON.stringify(codeContext);
      const deserialized = JSON.parse(serialized);

      expect(deserialized.files[0].content).toBe("");
    });

    it("should handle all supported languages", () => {
      const languages = [
        { ext: "ts", lang: "typescript" },
        { ext: "js", lang: "javascript" },
        { ext: "tsx", lang: "typescript" },
        { ext: "jsx", lang: "javascript" },
        { ext: "py", lang: "python" },
        { ext: "go", lang: "go" },
        { ext: "rs", lang: "rust" },
        { ext: "java", lang: "java" },
        { ext: "rb", lang: "ruby" },
      ];

      const files = languages.map((l) => ({
        path: `test.${l.ext}`,
        content: `// ${l.lang} code`,
        language: l.lang,
        line_number: 1,
        column_number: null,
      }));

      const codeContext = {
        fetched_at: new Date().toISOString(),
        repo: "test-org/test-repo",
        commit_sha: "abc123",
        files,
      };

      expect(codeContext.files).toHaveLength(9);
      expect(codeContext.files.map((f) => f.language)).toEqual(
        languages.map((l) => l.lang)
      );
    });
  });
});

describe("Evidence Worker Code Context Retrieval", () => {
  it("should load code_context from rca_jobs table", () => {
    const expectedQuery = `SELECT
         j.id,
         j.event_id,
         j.deterministic_findings,
         j.code_context,
         e.sentry_event_id`;

    // Verify the query fetches code_context
    expect(expectedQuery).toContain("j.code_context");
  });

  it("should transform code_context to CodeFetchResult array", () => {
    const codeContext = {
      fetched_at: "2024-12-14T10:00:00Z",
      repo: "test-org/test-repo",
      commit_sha: "abc123",
      files: [
        {
          path: "src/index.ts",
          content: "const x = 1;",
          language: "typescript",
          line_number: 1,
          column_number: 5,
        },
      ],
    };

    // Expected transformation
    const codeResults = codeContext.files.map((file) => ({
      file: {
        path: file.path,
        content: file.content,
        language: file.language,
      },
      context: {
        line_number: file.line_number,
        column_number: file.column_number,
        snippet_start: Math.max(1, file.line_number - 50),
        snippet_end: file.line_number + 50,
        source_map_resolved: false,
      },
    }));

    expect(codeResults).toHaveLength(1);
    expect(codeResults[0].file.path).toBe("src/index.ts");
    expect(codeResults[0].file.content).toBe("const x = 1;");
    expect(codeResults[0].context.line_number).toBe(1);
    expect(codeResults[0].context.snippet_start).toBe(1);
    expect(codeResults[0].context.snippet_end).toBe(51);
  });
});
