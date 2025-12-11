import { z } from 'zod';
import { EnvelopeSuccessSchema, EnvelopeErrorSchema } from './envelope.schema.js';

/**
 * Test Analysis Schemas
 *
 * Zod validation schemas for the Test Failure Analysis API.
 * Used to validate responses from /admin/api/test-analysis/:runId
 */

// Classification enum - computed deterministically from history
const ClassificationSchema = z.enum([
  'always_passes',
  'always_fails',
  'flaky',
  'recent_regression',
  'new_failure'
]);

// Root cause type enum
const RootCauseTypeSchema = z.enum([
  'code_logic',
  'test_bug',
  'env_config',
  'external_service'
]);

// Confidence level enum
const ConfidenceSchema = z.enum(['low', 'medium', 'high']);

// Investigation details
const InvestigationSchema = z.object({
  files_examined: z.array(z.string()),
  git_commits_reviewed: z.array(z.string()),
  pattern_observed: z.string(),
  classification_reason: z.string().optional()
}).nullable();

// Hypothesis attempt record
const HypothesisAttemptSchema = z.object({
  hypothesis: z.string(),
  change_type: z.string(),
  target_files: z.array(z.string()),
  proposed_diff: z.string().nullable().optional(),
  test_result: z.enum(['PASSED', 'FAILED_ASSERTION', 'TIMED_OUT', 'INFRA_ERROR', 'NOT_RUN']),
  confidence: z.string(),
  rejected_reason: z.string().nullable().optional()
});

// Recommendation record
const RecommendationSchema = z.object({
  type: z.enum(['code_change', 'test_change', 'config_change', 'manual_review']),
  description: z.string(),
  files: z.array(z.string()),
  confidence: ConfidenceSchema
}).nullable();

// Single test analysis record (matches test_analysis table)
export const TestAnalysisRecordSchema = z.object({
  id: z.string().uuid(),
  run_id: z.string().uuid(),
  failure_key: z.string(),
  classification: ClassificationSchema.nullable(),
  root_cause_type: RootCauseTypeSchema.nullable(),
  investigation: InvestigationSchema,
  hypotheses_tested: z.array(HypothesisAttemptSchema).nullable(),
  recommendation: RecommendationSchema,
  analysis_duration_ms: z.number().nullable(),
  resolved: z.boolean(),
  human_review_needed: z.boolean(),
  model_used: z.string().nullable(),
  created_at: z.string()
});

// Summary statistics
export const TestAnalysisSummarySchema = z.object({
  total: z.number(),
  resolved: z.number(),
  human_review_needed: z.number(),
  by_classification: z.record(z.string(), z.number()),
  by_root_cause: z.record(z.string(), z.number())
});

// Full response data structure
export const TestAnalysisDataSchema = z.object({
  byFailureKey: z.record(z.string(), TestAnalysisRecordSchema),
  summary: TestAnalysisSummarySchema
});

// Request params schema
export const TestAnalysisParamsSchema = z.object({
  runId: z.string().uuid()
});

// Full response envelope
export const TestAnalysisResponseEnvelope = z.union([
  EnvelopeSuccessSchema.extend({ data: TestAnalysisDataSchema }),
  EnvelopeErrorSchema
]);
