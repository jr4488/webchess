const WORKSHOP_DIMENSIONS = [
  {
    title: 'Worthwhile growth',
    focus: 'the capacity gain that would make workshop expansion worthwhile',
    question: 'the outcome that would justify taking on more work',
    keyword: 'worthwhile capacity',
  },
  {
    title: 'Team continuity',
    focus: 'the conditions that help experienced makers stay healthy and committed',
    question: 'the people whose knowledge or energy is most exposed',
    keyword: 'team continuity',
  },
  {
    title: 'Available capacity',
    focus: 'the actual time, tooling, cash, and supervision available for growth',
    question: 'the resource bottleneck most likely to constrain delivery',
    keyword: 'available capacity',
  },
  {
    title: 'Expansion timing',
    focus: 'the signals that distinguish a ready expansion from a premature one',
    question: 'the timing evidence that would support or delay expansion',
    keyword: 'timing signals',
  },
  {
    title: 'Failure exposure',
    focus: 'the ways extra demand could damage quality, safety, or trust',
    question: 'the downside that deserves an explicit safeguard',
    keyword: 'failure exposure',
  },
  {
    title: 'Nonnegotiable craft',
    focus: 'the working principles and relationships growth must not erode',
    question: 'the boundary that defines responsible growth',
    keyword: 'craft boundaries',
  },
  {
    title: 'Demand evidence',
    focus: 'the difference between demonstrated customer demand and hopeful assumptions',
    question: 'the fact that would most change confidence in the plan',
    keyword: 'demand evidence',
  },
  {
    title: 'Alternative scale',
    focus: 'ways to improve reach or resilience without simply increasing workload',
    question: 'the overlooked option that could create capacity differently',
    keyword: 'alternative scale',
  },
]

const WORKSHOP_MOVEMENTS = [
  {
    title: 'first signal',
    focus: 'identifying the smallest early signal that can guide a next step',
    question: 'What first observation could illuminate',
    keyword: 'first signal',
  },
  {
    title: 'listening point',
    focus: 'learning from the people closest to the work before choosing',
    question: 'Whose direct experience would clarify',
    keyword: 'listening point',
  },
  {
    title: 'decision line',
    focus: 'drawing a distinction that makes the choice less ambiguous',
    question: 'Which distinction would sharpen',
    keyword: 'decision line',
  },
  {
    title: 'useful connection',
    focus: 'linking two constraints or opportunities that are usually considered apart',
    question: 'What relationship could change',
    keyword: 'useful connection',
  },
  {
    title: 'stress test',
    focus: 'challenging the assumption most capable of distorting the plan',
    question: 'Which small test could challenge',
    keyword: 'stress test',
  },
  {
    title: 'adaptive move',
    focus: 'changing the approach when feedback reveals a poor fit',
    question: 'What adjustment could improve',
    keyword: 'adaptive move',
  },
  {
    title: 'durable support',
    focus: 'protecting what works by turning it into a repeatable practice',
    question: 'What should become durable around',
    keyword: 'durable support',
  },
  {
    title: 'space to release',
    focus: 'removing an obligation or habit that consumes capacity without enough value',
    question: 'What could be released to make room for',
    keyword: 'space to release',
  },
]

const COSMETIC_SUFFIXES = [
  'amber',
  'birch',
  'cedar',
  'delta',
  'ember',
  'fable',
  'grove',
  'harbor',
  'iris',
  'juniper',
  'keystone',
  'lantern',
  'meadow',
  'north',
  'orchard',
  'prairie',
  'quartz',
  'river',
  'summit',
  'timber',
  'upland',
  'violet',
  'willow',
  'xenon',
  'yarrow',
  'zephyr',
  'acorn',
  'brook',
  'canyon',
  'dawn',
  'elm',
  'fern',
  'glade',
  'hearth',
  'island',
  'jade',
  'kestrel',
  'lagoon',
  'maple',
  'nectar',
  'oasis',
  'pebble',
  'quill',
  'ridge',
  'spruce',
  'thicket',
  'umber',
  'valley',
  'wren',
  'xylem',
  'yucca',
  'zinnia',
  'alder',
  'beacon',
  'clover',
  'drift',
  'equinox',
  'flint',
  'garden',
  'horizon',
  'indigo',
  'jasmine',
  'knoll',
  'lotus',
]

function makeWorkshopFacets() {
  return WORKSHOP_DIMENSIONS.flatMap((dimension, dimensionIndex) =>
    WORKSHOP_MOVEMENTS.map((movement, movementIndex) => ({
      id: dimensionIndex * WORKSHOP_MOVEMENTS.length + movementIndex + 1,
      title: `${dimension.title}: ${movement.title}`,
      focus: `Examine ${dimension.focus} by ${movement.focus}.`,
      question: `${movement.question} ${dimension.question}?`,
      keyword: `${dimension.keyword} · ${movement.keyword}`,
    })),
  )
}

function makeNumberedTemplateFacets() {
  return Array.from({ length: 64 }, (_, index) => ({
    id: index + 1,
    title: `Facet ${index + 1}`,
    focus: `Examine the concrete consequence numbered ${index + 1} for this decision.`,
    question: `What observable evidence would clarify concern ${index + 1}?`,
    keyword: `concern ${index + 1}`,
  }))
}

function makeCosmeticParaphraseFacets() {
  return COSMETIC_SUFFIXES.map((suffix, index) => ({
    id: index + 1,
    title: `Workshop hiring pace ${suffix}`,
    focus: `Examine whether workshop hiring pace protects the team from exhaustion while expansion proceeds, viewed as ${suffix}.`,
    question: `What evidence would show whether workshop hiring pace protects the team from exhaustion through ${suffix}?`,
    keyword: `hiring pace ${suffix}`,
  }))
}

function makeLocalizedSimilarityFacets() {
  const facets = makeWorkshopFacets()
  facets[0] = {
    ...facets[0],
    title: 'Worthwhile growth: early capacity signal',
    focus: 'Examine the first workshop capacity signal that could make expansion worthwhile.',
    question: 'What first workshop capacity signal could justify exploring expansion?',
    keyword: 'early capacity signal',
  }
  facets[1] = {
    ...facets[1],
    title: 'Worthwhile growth: initial capacity signal',
    focus: 'Examine the initial workshop capacity signal that could make expansion worthwhile.',
    question: 'What initial workshop capacity signal could justify exploring expansion?',
    keyword: 'initial capacity signal',
  }
  return facets
}

export const WORKSHOP_PROBLEM =
  'How can I grow the workshop without exhausting the people who make it special?'

export const DIVISION_QUALITY_FIXTURES = [
  {
    name: 'specific workshop map',
    description: 'Varied, problem-grounded cross-product language should pass the bounded checks.',
    problem: WORKSHOP_PROBLEM,
    expectedOk: true,
    expectedIssueCodes: [],
    facets: makeWorkshopFacets(),
  },
  {
    name: 'localized parallel wording',
    description: 'One similar pair should not cause a whole division to fail.',
    problem: WORKSHOP_PROBLEM,
    expectedOk: true,
    expectedIssueCodes: [],
    facets: makeLocalizedSimilarityFacets(),
  },
  {
    name: 'generic numbered scaffold',
    description: 'IDs used as content and repeated number-substitution templates should fail.',
    problem: WORKSHOP_PROBLEM,
    expectedOk: false,
    expectedIssueCodes: ['generic-numbered-facets', 'dominant-text-template'],
    facets: makeNumberedTemplateFacets(),
  },
  {
    name: 'cosmetic paraphrase cluster',
    description: 'Alphabetic decorations around one repeated idea should fail the overlap check.',
    problem: WORKSHOP_PROBLEM,
    expectedOk: false,
    expectedIssueCodes: ['high-overlap-facets'],
    facets: makeCosmeticParaphraseFacets(),
  },
]
