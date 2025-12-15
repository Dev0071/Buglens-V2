export interface RepoReference {
  repoFullName: string;
  commitSha?: string;
}

const RELEASE_PATTERN = /^(?<repo>[^@]+)@(?<sha>[0-9a-f]{7,40})$/i;

const EVENT_SENTINEL_KEYS = [
  "exception",
  "contexts",
  "tags",
  "release",
  "platform",
];

type GenericPayload = Record<string, unknown>;

const isRecord = (value: unknown): value is GenericPayload => {
  return Boolean(value && typeof value === "object");
};

const looksLikeSentryEvent = (payload: GenericPayload): boolean => {
  return EVENT_SENTINEL_KEYS.some((key) => key in payload);
};

export function extractEventPayload(payload: unknown): GenericPayload | null {
  if (!isRecord(payload)) {
    return null;
  }

  if (looksLikeSentryEvent(payload)) {
    return payload;
  }

  const maybeData = payload.data;
  if (isRecord(maybeData)) {
    const maybeError = maybeData.error;
    if (isRecord(maybeError) && looksLikeSentryEvent(maybeError)) {
      return maybeError;
    }
  }

  return null;
}

const normalizeTags = (
  rawTags: unknown
): Record<string, string> | undefined => {
  if (!rawTags) {
    return undefined;
  }

  if (Array.isArray(rawTags)) {
    const normalized: Record<string, string> = {};
    for (const entry of rawTags) {
      if (Array.isArray(entry) && entry.length >= 2) {
        const [key, value] = entry;
        if (typeof key === "string" && typeof value === "string") {
          normalized[key] = value;
        }
      }
    }
    return Object.keys(normalized).length > 0 ? normalized : undefined;
  }

  if (isRecord(rawTags)) {
    const normalized: Record<string, string> = {};
    for (const [key, value] of Object.entries(rawTags)) {
      if (typeof value === "string") {
        normalized[key] = value;
      }
    }
    return Object.keys(normalized).length > 0 ? normalized : undefined;
  }

  return undefined;
};

export function parseReleaseString(
  release?: string | null
): RepoReference | null {
  if (!release) {
    return null;
  }

  const match = release.match(RELEASE_PATTERN);
  if (!match || !match.groups) {
    return null;
  }

  return {
    repoFullName: match.groups.repo,
    commitSha: match.groups.sha,
  };
}

/** Shape of context objects that may contain repo/commit info */
interface ContextObject {
  repository?: string;
  commit?: string;
}

export function extractRepoFromPayload(payload: unknown): RepoReference | null {
  const eventPayload = extractEventPayload(payload);
  if (!eventPayload) {
    return null;
  }

  const contexts = eventPayload.contexts as
    | Record<string, ContextObject | undefined>
    | undefined;
  const tags = normalizeTags(eventPayload.tags);

  const repoCandidate =
    contexts?.github?.repository ||
    contexts?.app?.repository ||
    tags?.repo ||
    tags?.github_repo;

  if (!repoCandidate || typeof repoCandidate !== "string") {
    return null;
  }

  const commitCandidate =
    contexts?.github?.commit ||
    contexts?.app?.commit ||
    tags?.commit ||
    tags?.git_sha;

  return {
    repoFullName: repoCandidate,
    commitSha: commitCandidate || undefined,
  };
}
