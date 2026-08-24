import { z } from 'zod'

import { RESEARCH_CONSENT_VERSION } from '../../lib/research'

export const MAX_JSON_BODY_BYTES = 16 * 1024

export const idempotencyKeySchema = z.string().uuid()
export const gameIdSchema = z.string().uuid()

const expectedRevisionSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)

export const divideBodySchema = z
  .object({
    problem: z
      .string()
      .transform((value) => value.replace(/\s+/gu, ' ').trim())
      .pipe(z.string().min(12).max(240)),
    memoryObservationIds: z.array(z.string().uuid()).max(8).default([])
      .refine((ids) => new Set(ids).size === ids.length, 'Observation ids must be unique.'),
    researchConsent: z.strictObject({
      version: z.literal(RESEARCH_CONSENT_VERSION),
      decision: z.enum([
        'allow_search_and_page_fetch',
        'no_external_research',
      ]),
    }),
  })
  .strict()

export const revisionBodySchema = z
  .object({
    expectedRevision: expectedRevisionSchema,
  })
  .strict()

export const moveBodySchema = z
  .object({
    expectedRevision: expectedRevisionSchema,
    pieceId: z.string().min(1).max(128).regex(/^[A-Za-z0-9_-]+$/),
    to: z
      .object({
        ring: z.number().int().min(0).max(7),
        sector: z.number().int().min(0).max(7),
      })
      .strict(),
  })
  .strict()

export const deleteAccountBodySchema = z
  .object({
    confirmation: z.literal('DELETE MY WEBCHESS DATA'),
  })
  .strict()

const lifecycleText = (minimum: number, maximum: number) =>
  z.string().transform((value) => value.replace(/\s+/gu, ' ').trim())
    .pipe(z.string().min(minimum).max(maximum))

const exactLifecycleText = (minimum: number, maximum: number) =>
  z.string().transform((value) => value.trim())
    .pipe(z.string().min(minimum).max(maximum))

export const createWilburActionBodySchema = z.strictObject({
  charlotteActionIndex: z.number().int().min(0).max(2),
  actor: exactLifecycleText(2, 240),
  action: exactLifecycleText(8, 2_000),
  testedAssumption: exactLifecycleText(8, 1_000),
  expectedObservation: exactLifecycleText(8, 1_000),
  decisionThreshold: exactLifecycleText(8, 1_000),
  reviewHorizon: exactLifecycleText(2, 240),
  followUpAt: z.iso.datetime({ offset: true }).nullable(),
})

export const updateWilburActionBodySchema = z.strictObject({
  expectedRevision: expectedRevisionSchema,
  status: z.enum([
    'planned',
    'in_progress',
    'completed',
    'abandoned',
    'inconclusive',
  ]),
  followUpAt: z.iso.datetime({ offset: true }).nullable(),
})

export const appendWilburObservationBodySchema = z.strictObject({
  observedAt: z.iso.datetime({ offset: true }),
  observation: lifecycleText(3, 4_000),
  evidenceClassification: lifecycleText(3, 240),
  expectedEffect: lifecycleText(1, 2_000),
  unexpectedEffect: lifecycleText(1, 2_000),
  stakeholderResponse: lifecycleText(1, 2_000),
  assumptionResult: z.enum(['supported', 'rejected', 'unresolved']),
  nextDecision: lifecycleText(3, 2_000),
})

export type DivideBody = z.infer<typeof divideBodySchema>
export type RevisionBody = z.infer<typeof revisionBodySchema>
export type MoveBody = z.infer<typeof moveBodySchema>
export type CreateWilburActionBody = z.infer<
  typeof createWilburActionBodySchema
>
export type UpdateWilburActionBody = z.infer<
  typeof updateWilburActionBodySchema
>
export type AppendWilburObservationBody = z.infer<
  typeof appendWilburObservationBodySchema
>
