import http from "k6/http";
import { check, sleep } from "k6";
import crypto from "k6/crypto";
import { Counter, Rate } from "k6/metrics";

// Custom metric for unexpected failures (not 200/429)
const unexpectedFailures = new Rate("unexpected_failures");

export const options = {
  vus: Number(__ENV.K6_VUS || 25),
  duration: __ENV.K6_DURATION || "1m",
  thresholds: {
    unexpected_failures: [{ threshold: "rate<0.01", abortOnFail: true }],
    http_req_duration: [{ threshold: "p(95)<500" }],
    sentry_rate_limit_hits: ["count>=0"],
  },
};

const ORG_ID = __ENV.ORG_ID;
const BASE_URL = __ENV.BASE_URL || "http://localhost:3000";
const WEBHOOK_URL = `${BASE_URL}/api/v1/webhooks/sentry/${ORG_ID}`;
const SCENARIO_SECRET = __ENV.SENTRY_WEBHOOK_SECRET;
const rateLimitHits = new Counter("sentry_rate_limit_hits");

if (!ORG_ID) {
  throw new Error("ORG_ID environment variable is required");
}

if (!SCENARIO_SECRET) {
  throw new Error("SENTRY_WEBHOOK_SECRET environment variable is required");
}

function buildPayload(counter) {
  return JSON.stringify({
    event_id: `k6-event-${__VU}-${counter}-${Date.now()}`,
    platform: "javascript",
    timestamp: Date.now() / 1000,
    exception: {
      values: [
        {
          type: "TypeError",
          value: "Cannot read property 'foo' of undefined",
          stacktrace: {
            frames: [
              {
                filename: "app.js",
                function: "processUser",
                lineno: 42,
                colno: 15,
              },
            ],
          },
        },
      ],
    },
    environment: "production",
  });
}

function signPayload(payload) {
  const raw = crypto.hmac("sha256", SCENARIO_SECRET, payload, "hex");
  return String(raw).trim();
}

export default function () {
  const payload = buildPayload(__ITER);
  const signature = signPayload(payload);

  const res = http.post(WEBHOOK_URL, payload, {
    headers: {
      "Content-Type": "application/json",
      "sentry-hook-signature": signature,
    },
    tags: { test: "sentry-rate-limit" },
  });

  const isExpectedStatus = res.status === 200 || res.status === 429;

  if (!isExpectedStatus) {
    console.error(
      `VU ${__VU}: Unexpected status ${res.status} - Body: ${res.body}`
    );
  }

  check(res, {
    "status 200 or 429": () => isExpectedStatus,
  });

  // Track unexpected failures (anything other than 200/429)
  unexpectedFailures.add(!isExpectedStatus);

  if (res.status === 429) {
    rateLimitHits.add(1);
  }

  sleep(0.1);
}
