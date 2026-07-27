import { z } from 'zod'

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

export type DivideBody = z.infer<typeof divideBodySchema>
export type RevisionBody = z.infer<typeof revisionBodySchema>
export type MoveBody = z.infer<typeof moveBodySchema>
