import { z } from "zod";

// ============================================
// Database Row
// ============================================

export interface Deployment {
  id: string;
  org_id: string;
  repo_full_name: string;
  commit_sha: string;
  branch: string | null;
  environment: string;
  deployed_at: Date;
  status: "active" | "superseded" | "rolled_back";
  source: "api" | "github_deployments_api";
  deployer: string | null;
  deploy_url: string | null;
  metadata: Record<string, unknown>;
  created_at: Date;
}

// ============================================
// API Input — POST /api/v1/track-deploy
// ============================================

export const trackDeploySchema = z.object({
  repo:        z.string().regex(/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/, "Must be owner/repo format"),
  sha:         z.string().regex(/^[a-f0-9]{7,40}$/i, "Must be a valid git SHA (7-40 hex chars)"),
  environment: z.string().min(1).max(64).default("production"),
  branch:      z.string().max(255).optional(),
  deployer:    z.string().max(255).optional(),
  deploy_url:  z.string().url().optional(),
  deployed_at: z.string().datetime().optional(), // ISO 8601 — defaults to NOW() if omitted
  metadata:    z.record(z.unknown()).optional(),
});

export type TrackDeployInput = z.infer<typeof trackDeploySchema>;

// ============================================
// Resolver result — what the event extractor gets back
// ============================================

export interface DeploymentMatch {
  commit_sha: string;
  repo_full_name: string;
  environment: string;
  deployed_at: Date;
  source: "api" | "github_deployments_api";
}
