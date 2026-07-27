export interface DivisionQualityFacet {
  id: number
  title: string
  focus: string
  question: string
  keyword: string
}

const TEXT_FIELDS = ['title', 'focus', 'question', 'keyword'] as const
type TextField = (typeof TEXT_FIELDS)[number]

const GENERIC_TITLE_PATTERN =
  /^(?:facet|concern|item|part|aspect|issue|factor|point|topic|square)\s*[-:#]?\s*\d+\b/iu

const STOP_WORDS = new Set([
  'about',
  'across',
  'after',
  'again',
  'against',
  'also',
  'among',
  'because',
  'before',
  'being',
  'between',
  'could',
  'does',
  'each',
  'every',
  'from',
  'have',
  'into',
  'itself',
  'might',
  'must',
  'only',
  'other',
  'should',
  'that',
  'their',
  'them',
  'then',
  'there',
  'these',
  'they',
  'this',
  'through',
  'under',
  'until',
  'very',
  'what',
  'when',
  'where',
  'which',
  'while',
  'with',
  'would',
  'your',
  'aspect',
  'clarify',
  'concern',
  'concrete',
  'consider',
  'decision',
  'examine',
  'facet',
  'factor',
  'focus',
  'issue',
  'number',
  'numbered',
  'part',
  'problem',
  'question',
  'situation',
  'specific',
])

export const DIVISION_QUALITY_THRESHOLDS = Object.freeze({
  dominantTemplateMinimumCount: 16,
  dominantTemplateRatio: 0.5,
  genericNumberedTitleRatio: 0.25,
  idEchoRatio: 0.5,
  highOverlapSimilarity: 0.82,
  highOverlapMinimumTokens: 6,
  highOverlapNeighborRatio: 0.5,
  highOverlapMinimumPairsPerFacet: 0.25,
})

type DivisionQualityThresholds = typeof DIVISION_QUALITY_THRESHOLDS

interface QualityIssue {
  code: string
  message: string
  evidence?: unknown
}

export interface DivisionQualityAssessment {
  ok: boolean
  issues: QualityIssue[]
  metrics: Record<string, unknown>
}

function ratio(count: number, total: number): number {
  return total === 0 ? 0 : Number((count / total).toFixed(4))
}

function normalizedWords(value: unknown): string[] {
  return String(value ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .match(/[\p{L}\p{N}]+/gu) ?? []
}

function templateSkeleton(value: unknown): string {
  return normalizedWords(value)
    .map((word) => /^\d+$/u.test(word) ? '{number}' : word)
    .join(' ')
}

function meaningfulTokenSet(value: unknown): Set<string> {
  return new Set(
    normalizedWords(value)
      .filter((word) =>
        word.length >= 3 &&
        !/^\d+$/u.test(word) &&
        !STOP_WORDS.has(word)),
  )
}

function facetText(facet: DivisionQualityFacet): string {
  return TEXT_FIELDS.map((field) => facet[field]).join(' ')
}

function dominantSkeleton(
  facets: readonly DivisionQualityFacet[],
  field: TextField,
) {
  const groups = new Map<string, {
    skeleton: string
    count: number
    exampleIds: number[]
  }>()

  for (const facet of facets) {
    const skeleton = templateSkeleton(facet[field])
    if (!skeleton) continue

    const group = groups.get(skeleton) ?? {
      skeleton,
      count: 0,
      exampleIds: [],
    }
    group.count += 1
    if (group.exampleIds.length < 5) {
      group.exampleIds.push(facet.id)
    }
    groups.set(skeleton, group)
  }

  const dominant = [...groups.values()]
    .sort((left, right) =>
      right.count - left.count ||
      left.skeleton.localeCompare(right.skeleton))[0] ?? {
    skeleton: '',
    count: 0,
    exampleIds: [],
  }

  return {
    uniqueSkeletons: groups.size,
    dominantSkeleton: dominant.skeleton,
    dominantCount: dominant.count,
    dominantRatio: ratio(dominant.count, facets.length),
    exampleIds: dominant.exampleIds,
  }
}

function jaccardSimilarity(left: Set<string>, right: Set<string>): number {
  if (left.size === 0 || right.size === 0) return 0

  let intersection = 0
  for (const token of left) {
    if (right.has(token)) intersection += 1
  }
  const union = left.size + right.size - intersection
  return union === 0 ? 0 : intersection / union
}

function overlapMetrics(
  facets: readonly DivisionQualityFacet[],
  thresholds: DivisionQualityThresholds,
) {
  const tokenSets = facets.map((facet) => meaningfulTokenSet(facetText(facet)))
  const totalPairs = facets.length * (facets.length - 1) / 2
  const neighborIndexes = new Set<number>()
  const highOverlapPairs: Array<{
    leftId: number
    rightId: number
    similarity: number
  }> = []
  let strongestPair: {
    leftId: number
    rightId: number
    similarity: number
  } | null = null
  let highOverlapPairCount = 0

  for (let leftIndex = 0; leftIndex < facets.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < facets.length; rightIndex += 1) {
      const leftTokens = tokenSets[leftIndex]
      const rightTokens = tokenSets[rightIndex]
      if (
        leftTokens.size < thresholds.highOverlapMinimumTokens ||
        rightTokens.size < thresholds.highOverlapMinimumTokens
      ) {
        continue
      }

      const similarity = jaccardSimilarity(leftTokens, rightTokens)
      if (!strongestPair || similarity > strongestPair.similarity) {
        strongestPair = {
          leftId: facets[leftIndex]?.id ?? leftIndex + 1,
          rightId: facets[rightIndex]?.id ?? rightIndex + 1,
          similarity,
        }
      }
      if (similarity < thresholds.highOverlapSimilarity) continue

      highOverlapPairCount += 1
      neighborIndexes.add(leftIndex)
      neighborIndexes.add(rightIndex)
      if (highOverlapPairs.length < 8) {
        highOverlapPairs.push({
          leftId: facets[leftIndex]?.id ?? leftIndex + 1,
          rightId: facets[rightIndex]?.id ?? rightIndex + 1,
          similarity: Number(similarity.toFixed(4)),
        })
      }
    }
  }

  return {
    similarityThreshold: thresholds.highOverlapSimilarity,
    highOverlapPairCount,
    highOverlapPairRatio: ratio(highOverlapPairCount, totalPairs),
    facetsWithHighOverlapNeighbor: neighborIndexes.size,
    highOverlapNeighborRatio: ratio(neighborIndexes.size, facets.length),
    strongestPair: strongestPair
      ? {
          ...strongestPair,
          similarity: Number(strongestPair.similarity.toFixed(4)),
        }
      : null,
    examplePairs: highOverlapPairs,
  }
}

function problemMetrics(
  problem: string,
  facets: readonly DivisionQualityFacet[],
) {
  const problemTerms = [...meaningfulTokenSet(problem)].sort()
  const divisionTerms = new Set(
    facets.flatMap((facet) => [...meaningfulTokenSet(facetText(facet))]),
  )
  const referencedTerms = problemTerms.filter((term) => divisionTerms.has(term))

  return {
    termCount: problemTerms.length,
    referencedTermCount: referencedTerms.length,
    referencedTermRatio: ratio(referencedTerms.length, problemTerms.length),
    terms: problemTerms,
    referencedTerms,
    note: 'Lexical overlap is reported for review only; paraphrases make it unsafe as a rejection rule.',
  }
}

/**
 * Preserve the existing bounded quality checks. Passing them catches obvious
 * boilerplate; it is not presented as proof of semantic completeness.
 */
export function assessDivisionQuality(
  facets: readonly DivisionQualityFacet[],
  options: {
    problem?: string
    thresholds?: Partial<DivisionQualityThresholds>
  } = {},
): DivisionQualityAssessment {
  const thresholds = {
    ...DIVISION_QUALITY_THRESHOLDS,
    ...options.thresholds,
  }
  const facetCount = facets.length
  const templateFields = Object.fromEntries(
    TEXT_FIELDS.map((field) => [field, dominantSkeleton(facets, field)]),
  ) as Record<TextField, ReturnType<typeof dominantSkeleton>>
  const genericNumberedTitleCount = facets.filter((facet) =>
    GENERIC_TITLE_PATTERN.test(facet.title.trim())).length
  const idEchoCount = facets.filter((facet) =>
    TEXT_FIELDS.some((field) =>
      normalizedWords(facet[field]).includes(String(facet.id))),
  ).length
  const overlap = overlapMetrics(facets, thresholds)

  const metrics = {
    facetCount,
    genericNumberedTitleCount,
    genericNumberedTitleRatio: ratio(genericNumberedTitleCount, facetCount),
    idEchoCount,
    idEchoRatio: ratio(idEchoCount, facetCount),
    templateFields,
    overlap,
    problem: problemMetrics(options.problem ?? '', facets),
  }
  const issues: QualityIssue[] = []

  if (
    metrics.genericNumberedTitleRatio >= thresholds.genericNumberedTitleRatio ||
    metrics.idEchoRatio >= thresholds.idEchoRatio
  ) {
    issues.push({
      code: 'generic-numbered-facets',
      message: 'Too many facets use their grid ID as content or a generic numbered label.',
      evidence: {
        genericNumberedTitleRatio: metrics.genericNumberedTitleRatio,
        idEchoRatio: metrics.idEchoRatio,
      },
    })
  }

  const dominantFields = TEXT_FIELDS.filter((field) => {
    const fieldMetrics = templateFields[field]
    return (
      fieldMetrics.dominantCount >= thresholds.dominantTemplateMinimumCount &&
      fieldMetrics.dominantRatio >= thresholds.dominantTemplateRatio
    )
  })
  if (dominantFields.length > 0) {
    issues.push({
      code: 'dominant-text-template',
      message: `Number substitution reveals one repeated template across too many ${dominantFields.join(', ')} values.`,
      evidence: Object.fromEntries(
        dominantFields.map((field) => [field, templateFields[field]]),
      ),
    })
  }

  const minimumHighOverlapPairs = Math.ceil(
    facetCount * thresholds.highOverlapMinimumPairsPerFacet,
  )
  if (
    overlap.facetsWithHighOverlapNeighbor >=
      Math.ceil(facetCount * thresholds.highOverlapNeighborRatio) &&
    overlap.highOverlapPairCount >= minimumHighOverlapPairs
  ) {
    issues.push({
      code: 'high-overlap-facets',
      message: 'Too many facets are near-duplicates after boilerplate and numbering are removed.',
      evidence: {
        similarityThreshold: overlap.similarityThreshold,
        highOverlapPairCount: overlap.highOverlapPairCount,
        highOverlapNeighborRatio: overlap.highOverlapNeighborRatio,
        examplePairs: overlap.examplePairs,
      },
    })
  }

  return {
    ok: issues.length === 0,
    issues,
    metrics,
  }
}
