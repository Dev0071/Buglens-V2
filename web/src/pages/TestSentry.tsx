/**
 * Frontend Sentry Test Page
 * Tests both automatic and manual error capturing in the browser
 */

import { useState } from "react";
import * as Sentry from "@sentry/react";

export default function TestSentry() {
  const [results, setResults] = useState<string[]>([]);

  const addResult = (message: string) => {
    setResults((prev) => [
      ...prev,
      `${new Date().toLocaleTimeString()}: ${message}`,
    ]);
  };

  // Test 1: Manual capture
  const testManualCapture = () => {
    try {
      const error = new Error(
        "🔴 MANUAL: Test error captured manually from frontend"
      );
      Sentry.captureException(error, {
        extra: {
          testType: "manual",
          timestamp: Date.now(),
        },
      });
      addResult("✅ Manual error captured and sent to Sentry");
    } catch (err) {
      addResult("❌ Failed to capture manual error");
    }
  };

  // Test 2: Automatic capture - throw error in event handler
  const testAutomaticCapture = () => {
    addResult("🟡 Throwing error in click handler (will be auto-captured)...");
    // This will be automatically caught by Sentry's error boundary
    throw new Error("🟡 AUTOMATIC: Error thrown in click handler");
  };

  // Test 3: Automatic capture - async error
  const testAsyncError = async () => {
    addResult("🟠 Creating async error...");
    try {
      await Promise.reject(new Error("🟠 AUTOMATIC: Async promise rejection"));
    } catch (error) {
      Sentry.captureException(error);
      addResult("✅ Async error captured");
    }
  };

  // Test 4: Undefined property access (common React error)
  const testUndefinedAccess = () => {
    addResult("🟣 Attempting to access property of undefined...");
    try {
      // @ts-expect-error - intentional error for testing
      const obj = undefined;
      // @ts-expect-error - intentional error for testing
      console.log(obj.property.nested);
    } catch (error) {
      Sentry.captureException(error);
      addResult("✅ Undefined access error captured");
    }
  };

  // Test 5: Network error simulation
  const testNetworkError = async () => {
    addResult("🔵 Simulating network error...");
    try {
      const response = await fetch("https://api.example.com/nonexistent");
      if (!response.ok) {
        throw new Error(
          `🔵 NETWORK: HTTP ${response.status} - ${response.statusText}`
        );
      }
    } catch (error) {
      Sentry.captureException(error);
      addResult("✅ Network error captured");
    }
  };

  // Test 6: Message capture
  const testMessageCapture = () => {
    Sentry.captureMessage("🟢 MESSAGE: Test message from frontend", "info");
    addResult("✅ Message sent to Sentry");
  };

  // Test 7: Error with user context
  const testErrorWithContext = () => {
    Sentry.withScope((scope) => {
      scope.setTag("test_type", "with_context");
      scope.setUser({
        id: "test-user-frontend",
        email: "frontend-test@example.com",
        username: "test_user",
      });
      scope.setExtra("custom_data", {
        page: "TestSentry",
        timestamp: Date.now(),
        userAgent: navigator.userAgent,
      });
      Sentry.captureException(
        new Error("⚫ CONTEXT: Error with user context from frontend")
      );
    });
    addResult("✅ Error with context sent to Sentry");
  };

  // Test 8: Simulated rendering error (will be caught by ErrorBoundary)
  const [shouldThrow, setShouldThrow] = useState(false);

  if (shouldThrow) {
    throw new Error("⚠️ RENDER ERROR: Error thrown during component render");
  }

  const testRenderError = () => {
    addResult(
      "⚠️ Triggering render error (will be caught by ErrorBoundary)..."
    );
    setShouldThrow(true);
  };

  const clearResults = () => {
    setResults([]);
  };

  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4">
      <div className="max-w-4xl mx-auto">
        <div className="bg-white rounded-lg shadow-lg p-6">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">
            Sentry Frontend Test Suite
          </h1>
          <p className="text-gray-600 mb-6">
            Test automatic and manual error capturing in the browser. Check your
            Sentry dashboard after running tests.
          </p>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
            <button
              onClick={testManualCapture}
              className="px-4 py-3 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors font-medium"
            >
              1️⃣ Manual Capture
            </button>

            <button
              onClick={testAutomaticCapture}
              className="px-4 py-3 bg-yellow-600 text-white rounded-lg hover:bg-yellow-700 transition-colors font-medium"
            >
              2️⃣ Automatic (Click Handler)
            </button>

            <button
              onClick={testAsyncError}
              className="px-4 py-3 bg-orange-600 text-white rounded-lg hover:bg-orange-700 transition-colors font-medium"
            >
              3️⃣ Async Error
            </button>

            <button
              onClick={testUndefinedAccess}
              className="px-4 py-3 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors font-medium"
            >
              4️⃣ Undefined Access
            </button>

            <button
              onClick={testNetworkError}
              className="px-4 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium"
            >
              5️⃣ Network Error
            </button>

            <button
              onClick={testMessageCapture}
              className="px-4 py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors font-medium"
            >
              6️⃣ Message Capture
            </button>

            <button
              onClick={testErrorWithContext}
              className="px-4 py-3 bg-gray-800 text-white rounded-lg hover:bg-gray-900 transition-colors font-medium"
            >
              7️⃣ Error with Context
            </button>

            <button
              onClick={testRenderError}
              className="px-4 py-3 bg-pink-600 text-white rounded-lg hover:bg-pink-700 transition-colors font-medium"
            >
              8️⃣ Render Error (ErrorBoundary)
            </button>
          </div>

          <div className="flex gap-2 mb-4">
            <button
              onClick={clearResults}
              className="px-4 py-2 bg-gray-200 text-gray-700 rounded hover:bg-gray-300 transition-colors font-medium"
            >
              Clear Results
            </button>
          </div>

          {results.length > 0 && (
            <div className="bg-gray-900 text-green-400 rounded-lg p-4 font-mono text-sm">
              <h3 className="text-white font-bold mb-2">Test Results:</h3>
              {results.map((result, index) => (
                <div key={index} className="mb-1">
                  {result}
                </div>
              ))}
            </div>
          )}

          <div className="mt-6 p-4 bg-blue-50 border border-blue-200 rounded-lg">
            <h3 className="font-bold text-blue-900 mb-2">📊 What to expect:</h3>
            <ul className="text-sm text-blue-800 space-y-1">
              <li>
                • <strong>Manual Capture:</strong> Explicitly sent via
                captureException()
              </li>
              <li>
                • <strong>Automatic (Click Handler):</strong> Uncaught error in
                event handler
              </li>
              <li>
                • <strong>Async Error:</strong> Promise rejection caught and
                sent
              </li>
              <li>
                • <strong>Undefined Access:</strong> Common TypeError caught
              </li>
              <li>
                • <strong>Network Error:</strong> Fetch error captured
              </li>
              <li>
                • <strong>Message:</strong> Info-level message (not an error)
              </li>
              <li>
                • <strong>With Context:</strong> Error with user tags and
                metadata
              </li>
              <li>
                • <strong>Render Error:</strong> Caught by React ErrorBoundary
              </li>
            </ul>
          </div>

          <div className="mt-4 p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
            <h3 className="font-bold text-yellow-900 mb-2">⚠️ Note:</h3>
            <p className="text-sm text-yellow-800">
              Events are sent through the tunnel at{" "}
              <code className="bg-yellow-100 px-1 py-0.5 rounded">
                /api/sentry-tunnel
              </code>{" "}
              to bypass ad blockers. Check your Sentry dashboard and browser
              DevTools Network tab to verify events are being sent.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
