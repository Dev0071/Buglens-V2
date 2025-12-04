import { z } from "zod";

export const analyzerEvidenceSchema = z.object({
  file_path: z.string(),
  line_number: z.number().int().nonnegative(),
  column_number: z.number().int().nonnegative().optional(),
  snippet: z.string(),
  snippet_start_line: z.number().int().nonnegative().optional(),
  snippet_end_line: z.number().int().nonnegative().optional(),
  language: z.string().default("text"),
});

export const deterministicFindingSchema = z.object({
  id: z.string(),
  title: z.string(),
  severity: z.enum(["low", "medium", "high", "critical"]),
  confidence: z.number().min(0).max(1),
  message: z.string(),
  evidence: analyzerEvidenceSchema,
  metadata: z.record(z.unknown()).default({}),
});

export const analyzerResultSchema = z.object({
  analyzer: z.object({
    name: z.string(),
    version: z.string(),
    runtime_ms: z.number().int().nonnegative(),
  }),
  findings: z.array(deterministicFindingSchema),
  stats: z.object({
    frames_analyzed: z.number().int().nonnegative(),
    code_segments: z.number().int().nonnegative(),
  }),
});

export type AnalyzerEvidence = z.infer<typeof analyzerEvidenceSchema>;
export type DeterministicFinding = z.infer<typeof deterministicFindingSchema>;
export type AnalyzerResult = z.infer<typeof analyzerResultSchema>;

export interface AnalyzerFrame {
  file_path: string;
  line_number: number;
  column_number?: number;
  function?: string | null;
}

export interface AnalyzerCodeSegment {
  file_path: string;
  language: string;
  content: string;
  error_line: number;
  error_column?: number;
}

export interface AnalyzerRequestPayload {
  org_id: string;
  repo: string;
  commit_sha: string;
  frames: AnalyzerFrame[];
  code_segments: AnalyzerCodeSegment[];
  metadata?: {
    no_user_code?: boolean;
    reason?: string;
  };
}
