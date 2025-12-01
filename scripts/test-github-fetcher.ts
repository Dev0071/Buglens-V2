#!/usr/bin/env node
/**
 * GitHub Code Fetcher Direct Test
 *
 * Tests the CodeFetcher service directly without going through the webhook.
 * Useful for testing GitHub App integration in isolation.
 *
 * Prerequisites:
 * - Docker services running: npm run docker:up
 * - GitHub App configured in environment:
 *   - GITHUB_APP_ID: Your GitHub App ID
 *   - GITHUB_APP_PRIVATE_KEY: PEM private key (or base64 encoded)
 * - A GitHub installation for your test repo
 *
 * Usage:
 *   # Test with environment variables
 *   GITHUB_APP_ID=123456 GITHUB_APP_PRIVATE_KEY="..." \
 *   TEST_INSTALLATION_ID=12345678 TEST_REPO="owner/repo" \
 *   npx tsx scripts/test-github-fetcher.ts
 *
 *   # Or run the compiled version
 *   node scripts/test-github-fetcher.cjs
 */

import { codeFetcherService } from "../src/services/code-fetcher.js";
import { getCacheStats, resetCacheStats } from "../src/services/cache.js";
import {
  checkGitHubRateLimit,
  getInstallationOctokit,
} from "../src/services/github.js";
import type { StackFrame } from "../src/types/github.js";

// Configuration from environment
const TEST_INSTALLATION_ID = process.env.TEST_INSTALLATION_ID || "";
const TEST_REPO = process.env.TEST_REPO || "Dev0071/Buglens-V2";
const TEST_REF = process.env.TEST_REF || "main";
const TEST_ORG_ID =
  process.env.TEST_ORG_ID || "00000000-0000-0000-0000-000000000000";

// Colors
const colors = {
  reset: "\x1b[0m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
  dim: "\x1b[2m",
};

function log(message: string, color = colors.reset) {
  console.log(`${color}${message}${colors.reset}`);
}

function logSection(title: string) {
  console.log();
  log(`${"=".repeat(60)}`, colors.cyan);
  log(`  ${title}`, colors.cyan);
  log(`${"=".repeat(60)}`, colors.cyan);
}

async function testGitHubConnection() {
  logSection("Test 1: GitHub App Connection");

  if (!TEST_INSTALLATION_ID) {
    log(`⚠ TEST_INSTALLATION_ID not set`, colors.yellow);
    log("Set it to test with a real GitHub App installation", colors.dim);
    return { success: true, skipped: true };
  }

  try {
    const octokit = await getInstallationOctokit(TEST_INSTALLATION_ID);
    const { data: installation } = await octokit.rest.apps.getAuthenticated();
    log(
      `✓ Connected to GitHub App: ${installation?.name || "Unknown"}`,
      colors.green
    );
    return { success: true, skipped: false };
  } catch (error) {
    log(`✗ GitHub connection failed: ${(error as Error).message}`, colors.red);
    return { success: false, skipped: false };
  }
}

async function testRateLimitCheck() {
  logSection("Test 2: Rate Limit Check");

  try {
    const rateLimit = await checkGitHubRateLimit(TEST_ORG_ID, "free");
    log(`Rate limit status:`, colors.dim);
    log(`  Allowed: ${rateLimit.allowed}`, colors.dim);
    log(`  Remaining: ${rateLimit.remaining}/${rateLimit.limit}`, colors.dim);
    log(`✓ Rate limit check working`, colors.green);
    return { success: true, skipped: false };
  } catch (error) {
    log(`✗ Rate limit check failed: ${(error as Error).message}`, colors.red);
    return { success: false, skipped: false };
  }
}

async function testCodeFetching() {
  logSection("Test 3: Code Fetching");

  if (!TEST_INSTALLATION_ID) {
    log("⚠ Skipping - no installation ID", colors.yellow);
    return { success: true, skipped: true };
  }

  // Create a test stack frame pointing to a real file in the repo
  const testFrame: StackFrame = {
    filename: "src/api/app.ts",
    abs_path: "/app/src/api/app.ts",
    lineno: 10,
    colno: 1,
    function: "buildApp",
    context_line: null,
    pre_context: null,
    post_context: null,
    in_app: true,
  };

  log(`Fetching: ${testFrame.filename}:${testFrame.lineno}`, colors.dim);
  log(`Repo: ${TEST_REPO}`, colors.dim);
  log(`Ref: ${TEST_REF}`, colors.dim);

  try {
    resetCacheStats();

    const result = await codeFetcherService.fetchCodeForFrame(testFrame, {
      orgId: TEST_ORG_ID,
      installationId: TEST_INSTALLATION_ID,
      repo: TEST_REPO,
      ref: TEST_REF,
    });

    if (result) {
      log(`✓ File fetched successfully`, colors.green);
      log(`  Path: ${result.file.path}`, colors.dim);
      log(`  Size: ${result.file.size} bytes`, colors.dim);
      log(`  Language: ${result.file.language}`, colors.dim);
      log(`  Cache hit: ${result.cacheHit}`, colors.dim);
      log(`  Minified: ${result.wasMinified}`, colors.dim);
      log(`  Source map applied: ${result.sourceMapApplied}`, colors.dim);
      log(``, colors.reset);
      log(
        `Code context (lines ${result.context.snippet_start_line}-${result.context.snippet_end_line}):`,
        colors.dim
      );
      log(`${"─".repeat(40)}`, colors.dim);
      const lines = result.context.snippet.split("\n");
      lines.forEach((line, i) => {
        const lineNum = result.context.snippet_start_line + i;
        const marker = lineNum === testFrame.lineno ? "→" : " ";
        log(
          `${marker} ${lineNum.toString().padStart(3)}: ${line}`,
          lineNum === testFrame.lineno ? colors.yellow : colors.dim
        );
      });
      log(`${"─".repeat(40)}`, colors.dim);

      return { success: true, skipped: false, result };
    } else {
      log(`✗ File not found`, colors.red);
      return { success: false, skipped: false };
    }
  } catch (error) {
    log(`✗ Fetch failed: ${(error as Error).message}`, colors.red);
    return { success: false, skipped: false };
  }
}

async function testCacheHit() {
  logSection("Test 4: Cache Hit (Second Fetch)");

  if (!TEST_INSTALLATION_ID) {
    log("⚠ Skipping - no installation ID", colors.yellow);
    return { success: true, skipped: true };
  }

  const testFrame: StackFrame = {
    filename: "src/api/app.ts",
    abs_path: "/app/src/api/app.ts",
    lineno: 10,
    colno: 1,
    function: "buildApp",
    context_line: null,
    pre_context: null,
    post_context: null,
    in_app: true,
  };

  try {
    // Second fetch should hit cache
    const result = await codeFetcherService.fetchCodeForFrame(testFrame, {
      orgId: TEST_ORG_ID,
      installationId: TEST_INSTALLATION_ID,
      repo: TEST_REPO,
      ref: TEST_REF,
    });

    if (result?.cacheHit) {
      log(`✓ Cache hit! Tier: ${result.cacheTier}`, colors.green);
    } else {
      log(`⚠ No cache hit (expected on second fetch)`, colors.yellow);
    }

    const stats = getCacheStats();
    log(`Cache statistics:`, colors.dim);
    log(`  Redis hits: ${stats.redis_hits}`, colors.dim);
    log(`  S3 hits: ${stats.s3_hits}`, colors.dim);
    log(`  Database hits: ${stats.database_hits}`, colors.dim);
    log(`  GitHub fetches: ${stats.github_fetches}`, colors.dim);
    log(`  Hit rate: ${(stats.hit_rate * 100).toFixed(1)}%`, colors.dim);

    return { success: true, skipped: false };
  } catch (error) {
    log(`✗ Cache test failed: ${(error as Error).message}`, colors.red);
    return { success: false, skipped: false };
  }
}

async function testMultipleFrames() {
  logSection("Test 5: Fetch Multiple Stack Frames");

  if (!TEST_INSTALLATION_ID) {
    log("⚠ Skipping - no installation ID", colors.yellow);
    return { success: true, skipped: true };
  }

  const frames: StackFrame[] = [
    {
      filename: "src/api/app.ts",
      abs_path: "/app/src/api/app.ts",
      lineno: 5,
      colno: 1,
      function: "imports",
      context_line: null,
      pre_context: null,
      post_context: null,
      in_app: true,
    },
    {
      filename: "src/utils/logger.ts",
      abs_path: "/app/src/utils/logger.ts",
      lineno: 1,
      colno: 1,
      function: "logger",
      context_line: null,
      pre_context: null,
      post_context: null,
      in_app: true,
    },
    {
      filename: "src/utils/config.ts",
      abs_path: "/app/src/utils/config.ts",
      lineno: 1,
      colno: 1,
      function: "config",
      context_line: null,
      pre_context: null,
      post_context: null,
      in_app: true,
    },
  ];

  log(`Fetching ${frames.length} files in parallel...`, colors.dim);

  try {
    const results = await codeFetcherService.fetchCodeForStackTrace(frames, {
      orgId: TEST_ORG_ID,
      installationId: TEST_INSTALLATION_ID,
      repo: TEST_REPO,
      ref: TEST_REF,
    });

    log(`✓ Fetched ${results.size}/${frames.length} files`, colors.green);

    for (const [key, result] of results) {
      log(
        `  ${key}: ${result.cacheHit ? "cached" : "fetched"} (${result.file.size} bytes)`,
        colors.dim
      );
    }

    return { success: true, skipped: false };
  } catch (error) {
    log(`✗ Multi-fetch failed: ${(error as Error).message}`, colors.red);
    return { success: false, skipped: false };
  }
}

async function main() {
  console.log();
  log(
    "╔═══════════════════════════════════════════════════════════════╗",
    colors.cyan
  );
  log(
    "║   Buglens GitHub Code Fetcher Direct Test                     ║",
    colors.cyan
  );
  log(
    "╚═══════════════════════════════════════════════════════════════╝",
    colors.cyan
  );

  log(`\nConfiguration:`, colors.dim);
  log(`  Test Repo: ${TEST_REPO}`, colors.dim);
  log(`  Test Ref: ${TEST_REF}`, colors.dim);
  log(`  Test Org ID: ${TEST_ORG_ID}`, colors.dim);
  log(`  Installation ID: ${TEST_INSTALLATION_ID || "(not set)"}`, colors.dim);

  const results = {
    total: 0,
    passed: 0,
    failed: 0,
    skipped: 0,
  };

  const tests = [
    testGitHubConnection,
    testRateLimitCheck,
    testCodeFetching,
    testCacheHit,
    testMultipleFrames,
  ];

  for (const test of tests) {
    const result = await test();
    results.total++;
    if (result.skipped) results.skipped++;
    else if (result.success) results.passed++;
    else results.failed++;
  }

  // Summary
  logSection("Test Summary");
  log(`Total: ${results.total}`, colors.reset);
  log(`Passed: ${results.passed}`, colors.green);
  if (results.skipped > 0) {
    log(`Skipped: ${results.skipped}`, colors.yellow);
  }
  if (results.failed > 0) {
    log(`Failed: ${results.failed}`, colors.red);
  }

  if (results.failed === 0 && results.passed > 0) {
    log("\n🎉 All tests passed!", colors.green);
  } else if (results.skipped === results.total) {
    log("\n⚠ All tests skipped - configure GitHub App to run", colors.yellow);
  } else if (results.failed > 0) {
    log("\n❌ Some tests failed", colors.red);
    process.exit(1);
  }
}

main().catch(console.error);
