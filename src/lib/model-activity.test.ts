import { describe, expect, it } from 'vitest'

import { beginModelActivity } from './model-activity'

describe('model request activity', () => {
  it('starts an honest browser-side request timer', () => {
    expect(beginModelActivity('division', 1_000)).toEqual({
      operation: 'division',
      status: 'active',
      startedAt: 1_000,
      lastUpdatedAt: 1_000,
    })
  })

  it('does not accept model text or invent server milestones', () => {
    expect(Object.keys(beginModelActivity('answer', 2_000))).toEqual([
      'operation',
      'status',
      'startedAt',
      'lastUpdatedAt',
    ])
    expect(beginModelActivity('answer', 2_000)).not.toHaveProperty(
      'reasoning',
    )
    expect(beginModelActivity('answer', 2_000)).not.toHaveProperty(
      'phase',
    )
  })
})
