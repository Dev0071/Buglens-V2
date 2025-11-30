export const RATE_LIMITS = {
  free: {
    events_per_hour: 100,
    rca_jobs_per_day: 50,
    llm_tokens_per_day: 100_000,
    github_api_calls_per_hour: 500,
  },
  pro: {
    events_per_hour: 1000,
    rca_jobs_per_day: 500,
    llm_tokens_per_day: 1_000_000,
    github_api_calls_per_hour: 2000,
  },
  enterprise: {
    events_per_hour: 10000,
    rca_jobs_per_day: 5000,
    llm_tokens_per_day: 10_000_000,
    github_api_calls_per_hour: 5000,
  },
} as const;

export type OrgPlan = keyof typeof RATE_LIMITS;
