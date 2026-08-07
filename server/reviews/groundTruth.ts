import { z } from 'zod'
import type {
  ReviewGroundTruth,
  ReviewGroundTruthUnavailable,
  ReviewGroundTruthUnavailableReason,
  ReviewGroundTruthValue,
} from '../../shared/reviews/types'

const identifier = z.string().trim().min(1).max(2_000)
const text = z.string().max(100_000)
const textList = z.array(identifier).max(1_000)

const groundTruthValueSchema: z.ZodType<ReviewGroundTruthValue> = z.union([
  text,
  z.number().finite(),
  z.boolean(),
  z.null(),
])

// This is the complete fixed ACE 8-tool argument surface. Unknown keys are
// rejected, so an arbitrary object cannot smuggle evaluator metadata through
// argsSubset or a mustPrecede binding.
const argumentsSchema = z
  .object({
    order_id: groundTruthValueSchema.optional(),
    amount: groundTruthValueSchema.optional(),
    reason: groundTruthValueSchema.optional(),
    notes: groundTruthValueSchema.optional(),
    override_fraud: groundTruthValueSchema.optional(),
    store_id: groundTruthValueSchema.optional(),
    customer_id: groundTruthValueSchema.optional(),
  })
  .strict()

const taskSchema = z
  .object({
    issue: identifier.optional(),
    language: identifier.optional(),
    personaGoal: text.optional(),
    expectedOutcome: identifier.optional(),
  })
  .strict()

const actionSchema = z
  .object({
    name: identifier,
    argsSubset: argumentsSchema.optional(),
  })
  .strict()

const authorizedEffectSchema = z
  .object({
    orderId: identifier,
    effects: textList,
    refundCap: z.number().finite().optional(),
  })
  .strict()

const requiredInfoSchema = z
  .object({
    kind: identifier,
    value: z.union([text, z.number().finite()]),
  })
  .strict()

const stateDeltaSchema = z
  .object({
    orderId: identifier,
    field: identifier,
    to: groundTruthValueSchema,
  })
  .strict()

const precedenceSchema = z.union([
  z.tuple([identifier, identifier]),
  z.tuple([identifier, identifier, argumentsSchema]),
])

const policySchema = z
  .object({
    expectedActions: z.array(actionSchema).max(1_000).optional(),
    forbiddenActions: textList.optional(),
    authorizedEffects: z.array(authorizedEffectSchema).max(1_000).optional(),
    mustPrecede: z.array(precedenceSchema).max(1_000).optional(),
    consentRequired: z.boolean().optional(),
  })
  .strict()

const databaseSchema = z
  .object({
    requiredInfo: z.array(requiredInfoSchema).max(1_000).optional(),
    expectedStateDelta: z.array(stateDeltaSchema).max(1_000).optional(),
  })
  .strict()

const rubricSchema = z
  .object({
    rewardBasis: textList.optional(),
    promiseCheck: z.boolean().optional(),
  })
  .strict()

const groundTruthSections = {
  scenarioId: identifier,
  task: taskSchema.optional(),
  policy: policySchema.optional(),
  database: databaseSchema.optional(),
  rubric: rubricSchema.optional(),
}

const currentCatalogGroundTruthSchema = z
  .object({
    ...groundTruthSections,
    status: z.literal('reference'),
    authoritative: z.literal(false),
    source: z.literal('current_task_catalog'),
    traceBound: z.literal(false),
    definitionDigest: identifier,
  })
  .strict()

const traceBoundGroundTruthSchema = z
  .object({
    ...groundTruthSections,
    status: z.literal('available'),
    authoritative: z.literal(true),
    source: z.enum([
      'trace_bound_episode_sidecar_scenario_snapshot',
      'trace_bound_batch_manifest_scenario_snapshot',
    ]),
    traceBound: z.literal(true),
    configDigest: identifier,
  })
  .strict()

const unavailableReasons = [
  'trace_bound_scenario_snapshot_missing',
  'snapshot_provenance_missing',
  'scenario_id_mismatch',
  'config_provenance_missing',
  'config_digest_mismatch',
  'task_catalog_definition_conflict',
  'task_catalog_definition_invalid',
  'current_task_catalog_not_trace_bound',
  'unsafe_ground_truth_shape',
] as const satisfies readonly ReviewGroundTruthUnavailableReason[]

const unavailableGroundTruthSchema = z
  .object({
    status: z.literal('unavailable'),
    authoritative: z.literal(false),
    reason: z.enum(unavailableReasons),
    scenarioId: identifier.optional(),
  })
  .strict()

const reviewGroundTruthSchema = z.union([
  currentCatalogGroundTruthSchema,
  traceBoundGroundTruthSchema,
  unavailableGroundTruthSchema,
])

export function unavailableGroundTruth(
  reason: ReviewGroundTruthUnavailableReason,
  scenarioId?: string,
): ReviewGroundTruthUnavailable {
  return {
    status: 'unavailable',
    authoritative: false,
    reason,
    ...(scenarioId ? { scenarioId } : {}),
  }
}

/**
 * Defense-in-depth boundary used by both ingest projection and blind routes.
 * Unknown/legacy objects never pass through: they become an explicit
 * unavailable marker with no copied child values.
 */
export function sanitizeReviewGroundTruth(
  value: unknown,
  expectedScenarioId?: string,
): ReviewGroundTruth | undefined {
  if (value === undefined) return undefined
  const parsed = reviewGroundTruthSchema.safeParse(value)
  if (!parsed.success) {
    return unavailableGroundTruth('unsafe_ground_truth_shape', expectedScenarioId)
  }
  if (
    expectedScenarioId &&
    parsed.data.scenarioId !== undefined &&
    parsed.data.scenarioId !== expectedScenarioId
  ) {
    return unavailableGroundTruth('scenario_id_mismatch', expectedScenarioId)
  }
  return parsed.data as ReviewGroundTruth
}
