import type { AnalyzerResult } from "./analyzer.js";

export interface Organization {
  id: string;
  name: string;
  slug: string;
  plan: "free" | "pro" | "enterprise";
  settings: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
}

export interface Event {
  id: string;
  org_id: string;
  source: string;
  sentry_event_id?: string;
  signature: string;
  message?: string;
  stack_trace?: unknown;
  breadcrumbs?: unknown;
  context?: unknown;
  environment?: string;
  release?: string;
  timestamp: Date;
  status: "received" | "queued" | "processing" | "done" | "failed";
  raw_payload?: unknown;
  created_at: Date;
  updated_at: Date;
}

export interface RCAJob {
  id: string;
  org_id: string;
  event_id: string;
  status:
    | "pending"
    | "fetching_code"
    | "analyzing"
    | "deterministic_complete"
    | "reasoning"
    | "done"
    | "failed";
  code_context_s3_url?: string;
  deterministic_findings?: AnalyzerResult | null;
  error_message?: string;
  retry_count: number;
  started_at?: Date;
  completed_at?: Date;
  created_at: Date;
  updated_at: Date;
}

export interface RCAResult {
  id: string;
  org_id: string;
  event_id: string;
  job_id: string;
  title: string;
  summary: string;
  root_cause: string;
  causal_chain: Array<{
    step: string;
    evidence: string;
    confidence: number;
  }>;
  suggested_fix?: {
    description: string;
    patch?: string;
    file_path?: string;
  };
  test_intentions?: Array<{
    description: string;
    rationale: string;
  }>;
  evidence: {
    code?: unknown;
    logs?: unknown;
    commits?: unknown;
    deterministic_findings?: AnalyzerResult | null;
  };
  confidence: number;
  llm_model: string;
  llm_tokens_used?: number;
  processing_time_ms?: number;
  user_feedback?: "useful" | "not_useful" | "partially_useful";
  user_notes?: string;
  created_at: Date;
  updated_at: Date;
}

export interface User {
  id: string;
  org_id: string;
  email: string;
  name?: string;
  role: "owner" | "admin" | "member";
  slack_user_id?: string;
  github_username?: string;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface Integration {
  id: string;
  org_id: string;
  type: "sentry" | "github" | "slack";
  config: Record<string, unknown>;
  secret_id?: string;
  is_active: boolean;
  last_verified_at?: Date;
  created_at: Date;
  updated_at: Date;
}

export interface Repository {
  id: string;
  org_id: string;
  provider: string;
  owner: string;
  name: string;
  full_name: string;
  default_branch: string;
  installation_id?: string;
  secret_id: string;
  is_active: boolean;
  last_synced_at?: Date;
  created_at: Date;
  updated_at: Date;
}

export interface CodeSnapshot {
  id: string;
  org_id: string;
  repo_id: string;
  file_path: string;
  commit_sha: string;
  content: string;
  language?: string;
  size_bytes?: number;
  created_at: Date;
}

export interface CostMetric {
  id: string;
  org_id: string;
  date: Date;
  llm_tokens_used: number;
  llm_cost_usd: number;
  github_api_calls: number;
  s3_storage_gb: number;
  created_at: Date;
}
