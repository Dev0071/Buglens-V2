/**
 * Backend Sentry Test Script
 * Tests both automatic and manual error capturing
 *
 * Run with: npx tsx scripts/test-sentry.ts
 */

import * as Sentry from "@sentry/node";
import dotenv from "dotenv";

dotenv.config();

const dsn = process.env.SENTRY_DSN;

if (!dsn) {
  console.error("❌ SENTRY_DSN not set in .env");
  process.exit(1);
}

console.log("🔧 DSN:", dsn.substring(0, 60) + "...");

Sentry.init({
  dsn,
  environment: "test",
  release: "buglens-backend@1.0.0",
  debug: true,

  // Capture uncaught exceptions automatically
  integrations: [
    Sentry.captureConsoleIntegration({
      levels: ["error"],
    }),
  ],

  // Log before sending to confirm event is being sent
  beforeSend(event) {
    console.log("📤 beforeSend triggered - event ID:", event.event_id);
    console.log("   Type:", event.exception?.values?.[0]?.type);
    console.log("   Message:", event.exception?.values?.[0]?.value);
    return event;
  },
});

async function runTests() {
  console.log("\n=== Backend Sentry Test Suite ===\n");

  // Test 1: Manual capture
  console.log("Test 1: Manual capture with Sentry.captureException()");
  const manualError = new Error(
    "🔴 MANUAL: Test error captured manually at " + new Date().toISOString()
  );
  Sentry.captureException(manualError, {
    extra: {
      testType: "manual",
      timestamp: Date.now(),
    },
  });
  console.log("✅ Manual error captured\n");

  await new Promise((resolve) => setTimeout(resolve, 1000));

  // Test 2: Automatic capture with try-catch
  console.log("Test 2: Automatic capture in try-catch block");
  try {
    throw new Error(
      "🟡 AUTOMATIC (try-catch): Error thrown inside try-catch at " +
        new Date().toISOString()
    );
  } catch (error) {
    console.log("   Caught error, sending to Sentry...");
    Sentry.captureException(error);
    console.log("✅ Try-catch error captured\n");
  }

  await new Promise((resolve) => setTimeout(resolve, 1000));

  // Test 3: Automatic capture with unhandled promise rejection
  console.log("Test 3: Automatic capture of unhandled promise rejection");
  console.log("   Creating unhandled promise rejection...");
  Promise.reject(
    new Error(
      "🟠 AUTOMATIC (promise): Unhandled promise rejection at " +
        new Date().toISOString()
    )
  ).catch((error) => {
    console.log("   Promise rejection caught, sending to Sentry...");
    Sentry.captureException(error);
    console.log("✅ Promise rejection captured\n");
  });

  await new Promise((resolve) => setTimeout(resolve, 1000));

  // Test 4: Message capture
  console.log("Test 4: Capturing a message (not an error)");
  Sentry.captureMessage(
    "🔵 MESSAGE: Test message from backend at " + new Date().toISOString(),
    "info"
  );
  console.log("✅ Message captured\n");

  await new Promise((resolve) => setTimeout(resolve, 1000));

  // Test 5: Error with context
  console.log("Test 5: Error with additional context");
  Sentry.withScope((scope) => {
    scope.setTag("test_type", "with_context");
    scope.setUser({ id: "test-user-123", email: "test@example.com" });
    scope.setExtra("custom_data", { foo: "bar", timestamp: Date.now() });
    Sentry.captureException(
      new Error("🟣 CONTEXT: Error with context at " + new Date().toISOString())
    );
  });
  console.log("✅ Error with context captured\n");

  // Wait for Sentry to flush all events
  console.log("\n⏳ Waiting for Sentry to flush all events...");

  await Sentry.close(5000);

  console.log("✅ All tests complete! Check your Sentry dashboard.");
  console.log("   You should see 5 events (4 errors + 1 message)");
  console.log("\n📊 Summary:");
  console.log("   - 1 manual capture (red circle)");
  console.log("   - 1 try-catch automatic (yellow circle)");
  console.log("   - 1 promise rejection (orange circle)");
  console.log("   - 1 message (blue circle)");
  console.log("   - 1 error with context (purple circle)\n");
}

runTests()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("❌ Test suite failed:", err);
    process.exit(1);
  });
