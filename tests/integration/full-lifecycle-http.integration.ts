import { createServer } from "node:http";
import type { IncomingHttpHeaders, Server } from "node:http";
import type { AddressInfo } from "node:net";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getLegalMoves, getPieceAt } from "../../src/lib/game";
import { deriveDivisionCastAssignments } from "../../src/lib/division";
import {
  CURRENT_LIFECYCLE_VERSIONS,
  PORTIA_ATTACK_TYPES,
} from "../../src/lib/lifecycle";
import type {
  CharlotteResult,
  LifecycleAggregate,
  PortiaReview,
  WilburAction,
  WilburObservation,
} from "../../src/lib/lifecycle";
import { RESEARCH_CONSENT_VERSION } from "../../src/lib/research";
import type { DurableGame } from "../../src/lib/webchess-api";
import {
  countCharlotteWords,
  generateAnswer,
  generateCharlotteSynthesis,
  generateDivision,
  generatePortiaReview,
  normalizeWebChessAnswer,
  orderPortiaCandidates,
  renderCharlotteResult,
} from "../../src/server/openai";
import type {
  PortiaInput,
  PortiaRequestContext,
} from "../../src/server/openai";
import { DurableGameRepository } from "../../src/server/games";
import { createApiServicesWithDependencies } from "../../src/server/http/service-adapter";
import {
  handleAccountExportRequest,
  handleAnswerRequest,
  handleAppendWilburObservationRequest,
  handleCharlotteRequest,
  handleCreateWilburActionRequest,
  handleCurrentGameRequest,
  handleDivideRequest,
  handleGetGameRequest,
  handleLifecycleRequest,
  handleMoveRequest,
  handlePortiaRequest,
  handleProvenanceRequest,
  handleReplayRequest,
  handleRetryLifecycleRequest,
  handleStartGameRequest,
} from "../../src/server/http";
import type {
  HttpDependencies,
  WebChessApiServices,
} from "../../src/server/http";
import { DurableLifecycleRepository } from "../../src/server/lifecycle";
import { createUsageController } from "../../src/server/usage";
import type { UsageConfig } from "../../src/server/usage";
import { makeProblemFacets } from "../../src/test/fixtures";
import { createPostgresTestDatabase } from "./postgres-test-database";
import type { PostgresTestDatabase } from "./postgres-test-database";

// This is a clean-room systems test, not a claim about model efficacy or a
// real OpenAI/OpenClaw run. Contract-valid deterministic provider stubs cross
// the same HTTP, service, usage-ledger, repository, and PostgreSQL boundaries.
// Injected owner authentication verifies scoped serialization, not production
// OpenClaw auth selection or exposure of the account-export route to OpenClaw.
const NOW = new Date("2026-08-23T20:00:00.000Z");
const OWNER = "user_full_lifecycle_http_integration";
const IP_ADDRESS = "203.0.113.91";
const PROBLEM =
  "Which small, reversible step should this end-to-end lifecycle preserve and test?";
const MODEL = "deterministic-lifecycle-provider-stub";
const SOFTWARE_VERSION = "full-lifecycle-http-integration";
const HMAC_SECRET = "full-lifecycle-http-hmac-material".repeat(2);
const DELETION_HMAC_SECRET = "full-lifecycle-http-deletion-material".repeat(2);

function fixtureWords(word: string, count: number): string {
  return Array.from({ length: count }, () => word).join(" ");
}

const USAGE_CONFIG: UsageConfig = {
  hmacSecret: HMAC_SECRET,
  deletionHmacSecret: DELETION_HMAC_SECRET,
  dailyGameLimit: 20,
  dailyModelRequestLimit: 40,
  dailyGlobalModelRequestLimit: 80,
  hourlyModelRequestLimit: 40,
  hourlyIpModelRequestLimit: 80,
  hourlyGameStartLimit: 40,
  hourlyIpGameStartLimit: 80,
  hourlyGameMoveLimit: 1_000,
  hourlyIpGameMoveLimit: 2_000,
  hourlyAccountExportLimit: 10,
  hourlyIpAccountExportLimit: 20,
  hourlyWilburActionLimit: 120,
  hourlyIpWilburActionLimit: 240,
  hourlyWilburObservationLimit: 60,
  hourlyIpWilburObservationLimit: 120,
  concurrentModelLimit: 1,
  globalModelConcurrentLimit: 4,
  modelLeaseSeconds: 180,
};

const ANSWER_RESULT = normalizeWebChessAnswer({
  answer: `Run one bounded observation before expanding the commitment. Keep the protected outcome and a real stop path visible.\n\n${fixtureWords("context", 80)}`,
  what_the_conflicts_emphasized: fixtureWords("conflict", 100),
  the_tension_to_hold: fixtureWords("tension", 90),
  three_next_moves: [
    fixtureWords("observe", 40),
    fixtureWords("compare", 40),
    fixtureWords("revisit", 40),
  ],
  what_could_change_the_answer: fixtureWords("condition", 90),
});

type PortiaMode = "pass" | "retry-game";

interface ProviderStubs {
  readonly answerGenerator: typeof generateAnswer;
  readonly charlotteGenerator: typeof generateCharlotteSynthesis;
  readonly divisionGenerator: typeof generateDivision;
  readonly portiaGenerator: typeof generatePortiaReview;
}

interface HttpHarness {
  readonly baseUrl: string;
  replaceServices(services: WebChessApiServices): void;
  close(): Promise<void>;
}

interface HttpResult<T> {
  readonly data: T;
  readonly response: Response;
}

interface AccountExport {
  readonly format: string;
  readonly games: readonly Record<string, unknown>[];
  readonly events: readonly Record<string, unknown>[];
  readonly modelRequests: readonly Record<string, unknown>[];
  readonly gameStartRequests: readonly Record<string, unknown>[];
  readonly lifecycleRuns: readonly Record<string, unknown>[];
  readonly portiaReviews: readonly Record<string, unknown>[];
  readonly gateDecisions: readonly Record<string, unknown>[];
  readonly charlotteResults: readonly Record<string, unknown>[];
  readonly wilburActions: readonly Record<string, unknown>[];
  readonly wilburObservations: readonly Record<string, unknown>[];
  readonly lifecycleActivities: readonly Record<string, unknown>[];
}

let database: PostgresTestDatabase;
let harness: HttpHarness | null;
let infrastructureSequence: number;
let operationSequence: number;

function infrastructureId(): string {
  infrastructureSequence += 1;
  return `52000000-0000-4000-8000-${String(infrastructureSequence).padStart(12, "0")}`;
}

function operationId(): string {
  operationSequence += 1;
  return `51000000-0000-4000-8000-${String(operationSequence).padStart(12, "0")}`;
}

function requireState(game: DurableGame) {
  if (!game.state) {
    throw new Error(`Game ${game.id} has no replayable state.`);
  }
  return game.state;
}

function nextDeterministicMove(game: DurableGame): {
  readonly pieceId: string;
  readonly to: { readonly ring: number; readonly sector: number };
} {
  const state = requireState(game);
  const candidates = state.pieces
    .filter((piece) => piece.side === state.turn)
    .flatMap((piece) =>
      getLegalMoves(piece, state.pieces).map((to) => {
        const captured = getPieceAt(state.pieces, to);
        const promotes =
          piece.kind === "pawn" &&
          ((piece.side === "white" && to.ring === 0) ||
            (piece.side === "black" && to.ring === 7));
        return {
          pieceId: piece.id,
          score:
            captured?.kind === "king" ? 3 : captured ? 2 : promotes ? 1 : 0,
          to,
        };
      }),
    )
    .sort(
      (left, right) =>
        right.score - left.score ||
        left.pieceId.localeCompare(right.pieceId) ||
        left.to.ring - right.to.ring ||
        left.to.sector - right.to.sector,
    );
  const selected = candidates[0];
  if (!selected) {
    throw new Error(`No legal ${state.turn} lifecycle move was available.`);
  }
  return { pieceId: selected.pieceId, to: selected.to };
}

function portiaReview(input: PortiaInput, mode: PortiaMode): PortiaReview {
  const orderedSurvivors = orderPortiaCandidates(input.survivors);
  if (orderedSurvivors.length < 3) {
    throw new Error(
      "The full lifecycle fixture requires at least three survivors.",
    );
  }
  const directionalRecord =
    input.answerPromptPackage.trajectoryDirectionalRecord;
  if (!directionalRecord) {
    throw new Error(
      "The current full lifecycle fixture requires a trajectory directional record.",
    );
  }
  const usableLimit = mode === "pass" ? orderedSurvivors.length : 2;
  const coverageTags = [
    "protected_outcome",
    "evidence_or_reality",
    "risk_or_countercase",
    "agency_or_action",
  ] as const;
  const assessments = orderedSurvivors.map((candidate, index) => {
    const usable = index < usableLimit;
    return {
      candidateId: candidate.candidateId,
      disposition: usable ? ("preserved" as const) : ("consumed" as const),
      survivingInterpretation: usable
        ? "This candidate remains useful only as a bounded interpretation."
        : null,
      requiredQualification: null,
      redundancyClusterId: null,
      coverageTags: index === 0 ? [...coverageTags] : [],
      missingEvidence: [
        "One direct observation remains necessary before expanding scope.",
      ],
      countercase:
        "A contradictory direct observation would reverse this interpretation.",
      reversalCondition:
        "Stop when the protected outcome or declared evidence threshold fails.",
      attackFindings: PORTIA_ATTACK_TYPES.map((attackType) => ({
        attackType,
        outcome: usable ? ("passed" as const) : ("failed" as const),
        severity: usable ? ("low" as const) : ("moderate" as const),
        finding: `The ${attackType} review preserves a bounded uncertainty.`,
        consequence:
          "The recommendation must remain conditional and reversible.",
        requiredRevision: usable
          ? null
          : "Do not use this consumed candidate as support.",
      })),
      directionalRecordDigest: directionalRecord.digest,
      directionalSignalKeys: [
        directionalRecord.survivingDirectionKeys[
          index % directionalRecord.survivingDirectionKeys.length
        ]!,
      ],
      directionalInterpretation:
        `The exact ordered route and material pressure make this surviving direction relevant to candidate ${candidate.candidateId}.`,
      directionalAmendment:
        `Carry the trajectory-qualified direction for candidate ${candidate.candidateId} into synthesis without treating it as factual evidence.`,
    };
  });
  return {
    contractVersion: CURRENT_LIFECYCLE_VERSIONS.portiaContract,
    reviewedAnswerPromptDigest: input.answerPromptDigest,
    directionalRecordVersion: directionalRecord.version,
    directionalRecordDigest: directionalRecord.digest,
    directionalSummary:
      "The complete ordered game trajectory changed which cast-qualified directions survived scrutiny while remaining distinct from external factual evidence.",
    promptDecision: "permit",
    promptDecisionRationale:
      "The exact board-derived prompt is permitted only under the recorded boundaries.",
    runSummary:
      "The deterministic Portia stub assessed every terminal survivor without claiming efficacy.",
    assessments,
    crossCandidateContradictions: [],
    redundancyClusters: [],
    missingCoverage: [],
    unresolvedQuestions: [
      "Which direct observation would reduce uncertainty fastest?",
    ],
    recommendedGateInputs: {
      tensionCandidatePairs: [
        [orderedSurvivors[0]!.candidateId, orderedSurvivors[1]!.candidateId],
      ],
      fatalContradictionIds: [],
      fieldRepairReasons: [],
    },
  };
}

function charlotteResult(portia: PortiaReview): CharlotteResult {
  const supportingCandidateIds = portia.assessments
    .filter((assessment) => assessment.disposition === "preserved")
    .slice(0, 4)
    .map((assessment) => assessment.candidateId);
  return {
    contractVersion: CURRENT_LIFECYCLE_VERSIONS.charlotteContract,
    protectedOutcome:
      "Protect the declared outcome while learning from a bounded direct observation.",
    directAnswer:
      "Run one small reversible observation before making the larger commitment, record what actually happens, and compare that result with the predeclared threshold before deciding whether to stop, revise, or continue.",
    supportingCandidateIds,
    qualificationsByCandidateId: {},
    centralTension:
      "Learn promptly while protecting affected people and preserving a credible stopping path.",
    valueConstraints: [
      "Keep uncertainty visible and do not weaken the protected outcome.",
    ],
    stakeholderConsequences: [
      "The accountable owner records impact while affected people retain agency.",
    ],
    recommendation:
      "Authorize only the smallest reversible experiment, record the direct observation, and use the declared decision threshold to stop, revise, or continue without silently expanding scope.",
    communicationStrategy:
      "State the tested assumption, evidence boundary, and stopping rule consistently.",
    uncertainties: ["The direct observation has not yet been collected."],
    whatCouldChangeTheAnswer: [
      "A contradictory signal or unacceptable harm reverses the recommendation.",
    ],
    exactlyThreeNextActions: Array.from({ length: 3 }, (_, index) => ({
      title: `Bounded action ${index + 1}`,
      actor: "The accountable decision owner",
      assumptionBeingTested:
        "A bounded action can generate useful decision evidence safely.",
      smallestAction:
        "Run one limited observation without expanding the committed scope.",
      expectedObservation:
        "A direct signal appears inside the declared review horizon.",
      decisionThreshold:
        "Continue only when the declared signal appears without unacceptable harm.",
      reviewHorizon: "Within fourteen days",
      reversibility: "Stop the test and restore the prior operating state.",
      risksOrAffectedParties:
        "Record affected parties and stop when the protected outcome is threatened.",
      decisionRule: "revise" as const,
    })),
  };
}

function createProviderStubs(mode: PortiaMode): ProviderStubs {
  const divisionGenerator: typeof generateDivision = vi.fn(async (input) => {
    const divisionSeed = typeof input === "string"
      ? null
      : input.divisionSeed ?? null;
    const assignments = divisionSeed
      ? new Map(deriveDivisionCastAssignments(divisionSeed).map(
          (assignment) => [assignment.id, assignment],
        ))
      : new Map();
    return {
      providerId: `stub-division-${mode}`,
      model: MODEL,
      prompt: "Deterministic full-lifecycle division prompt.",
      result: {
        facets: makeProblemFacets("HTTP lifecycle facet").map((facet) => ({
          ...facet,
          ...(divisionSeed
            ? {
                castApplication: `Use ${
                  assignments.get(facet.id)?.directionalCue ?? "the fixed cast"
                } to shape this exact HTTP lifecycle facet during scrutiny.`,
              }
            : {}),
        })),
      },
      usage: {
        reported: true,
        inputTokens: 64,
        outputTokens: 64,
        totalTokens: 128,
        cachedInputTokens: 0,
        cacheWriteInputTokens: 0,
        reasoningOutputTokens: 16,
      },
    };
  });
  const answerGenerator: typeof generateAnswer = vi.fn(
    async (_input, context) => {
      await context.onProviderTurnStart?.();
      return {
        providerId: `stub-answer-${mode}`,
        model: MODEL,
        prompt: "Deterministic Portia-approved full-lifecycle Answer prompt.",
        result: ANSWER_RESULT,
        usage: {
          reported: true,
          inputTokens: 96,
          outputTokens: 96,
          totalTokens: 192,
          cachedInputTokens: 0,
          cacheWriteInputTokens: 0,
          reasoningOutputTokens: 24,
        },
      };
    },
  );
  const portiaGenerator: typeof generatePortiaReview = vi.fn(
    async (input: PortiaInput, context: PortiaRequestContext) => {
      const result = portiaReview(input, mode);
      await context.onProgress?.({
        currentCandidateId: null,
        completedCandidateIds: result.assessments.map(
          (assessment) => assessment.candidateId,
        ),
        completedAssessments: result.assessments,
        totalCandidateCount: input.survivors.length,
      });
      return {
        providerId: `stub-portia-${mode}`,
        model: MODEL,
        prompt: "Deterministic full-lifecycle Portia prompt.",
        result,
        usage: {
          reported: true,
          inputTokens: 128,
          outputTokens: 128,
          totalTokens: 256,
          cachedInputTokens: 0,
          cacheWriteInputTokens: 0,
          reasoningOutputTokens: 32,
        },
      };
    },
  );
  const charlotteGenerator: typeof generateCharlotteSynthesis = vi.fn(
    async (input) => {
      const structured = charlotteResult(input.portia);
      const renderedAnswer = renderCharlotteResult(structured);
      return {
        providerId: `stub-charlotte-${mode}`,
        model: MODEL,
        prompt: "Deterministic full-lifecycle Charlotte prompt.",
        result: {
          structured,
          renderedAnswer,
          wordCount: countCharlotteWords(renderedAnswer),
        },
        usage: {
          reported: true,
          inputTokens: 96,
          outputTokens: 80,
          totalTokens: 176,
          cachedInputTokens: 0,
          cacheWriteInputTokens: 0,
          reasoningOutputTokens: 20,
        },
      };
    },
  );
  return {
    answerGenerator,
    charlotteGenerator,
    divisionGenerator,
    portiaGenerator,
  };
}

function createServices(stubs: ProviderStubs): WebChessApiServices {
  const repository = new DurableGameRepository(database.adapter);
  return createApiServicesWithDependencies({
    accountExportMaxBytes: 8_000_000,
    answerGenerator: stubs.answerGenerator,
    charlotteGenerator: stubs.charlotteGenerator,
    database: database.adapter,
    divisionGenerator: stubs.divisionGenerator,
    hmacSecret: HMAC_SECRET,
    lifecycleRepository: new DurableLifecycleRepository(database.adapter),
    modelName: MODEL,
    modelProvider: "deterministic-test-stub",
    portiaGenerator: stubs.portiaGenerator,
    repository,
    softwareVersion: SOFTWARE_VERSION,
    usage: createUsageController({
      db: database.adapter,
      config: USAGE_CONFIG,
      now: () => new Date(NOW),
      randomUuid: infrastructureId,
    }),
    wilburStorageRowLimit: 500,
    wilburStorageTextBytesLimit: 250_000,
  });
}

function requestHeaders(headers: IncomingHttpHeaders): Headers {
  const result = new Headers();
  for (const [name, value] of Object.entries(headers)) {
    if (Array.isArray(value)) {
      for (const item of value) result.append(name, item);
    } else if (value !== undefined) {
      result.set(name, value);
    }
  }
  return result;
}

async function dispatch(
  request: Request,
  services: WebChessApiServices,
): Promise<Response> {
  const dependencies: Partial<HttpDependencies> = {
    authenticate: async () => ({ userId: OWNER, source: "local-e2e" }),
    services,
    verifySameOrigin: () => null,
  };
  const parts = new URL(request.url).pathname.split("/").filter(Boolean);
  const method = request.method.toUpperCase();

  if (method === "POST" && parts.join("/") === "api/divide") {
    return handleDivideRequest(request, dependencies);
  }
  if (method === "GET" && parts.join("/") === "api/games/current") {
    return handleCurrentGameRequest(request, dependencies);
  }
  if (method === "POST" && parts.join("/") === "api/account/export") {
    return handleAccountExportRequest(request, dependencies);
  }
  if (parts[0] !== "api" || parts[1] !== "games" || !parts[2]) {
    return Response.json({ error: "not found" }, { status: 404 });
  }

  const gameId = parts[2];
  if (method === "GET" && parts.length === 3) {
    return handleGetGameRequest(request, gameId, dependencies);
  }
  if (method === "POST" && parts[3] === "start" && parts.length === 4) {
    return handleStartGameRequest(request, gameId, dependencies);
  }
  if (method === "POST" && parts[3] === "moves" && parts.length === 4) {
    return handleMoveRequest(request, gameId, dependencies);
  }
  if (method === "GET" && parts[3] === "lifecycle" && parts.length === 4) {
    return handleLifecycleRequest(request, gameId, dependencies);
  }
  if (method === "POST" && parts[3] === "portia" && parts.length === 4) {
    return handlePortiaRequest(request, gameId, dependencies);
  }
  if (method === "POST" && parts[3] === "answer" && parts.length === 4) {
    return handleAnswerRequest(request, gameId, dependencies);
  }
  if (method === "POST" && parts[3] === "charlotte" && parts.length === 4) {
    return handleCharlotteRequest(request, gameId, dependencies);
  }
  if (method === "POST" && parts[3] === "retry" && parts.length === 4) {
    return handleRetryLifecycleRequest(request, gameId, dependencies);
  }
  if (method === "POST" && parts[3] === "replay" && parts.length === 4) {
    return handleReplayRequest(request, gameId, dependencies);
  }
  if (method === "GET" && parts[3] === "provenance" && parts.length === 4) {
    return handleProvenanceRequest(request, gameId, dependencies);
  }
  if (
    method === "POST" &&
    parts[3] === "wilbur" &&
    parts[4] === "actions" &&
    parts.length === 5
  ) {
    return handleCreateWilburActionRequest(request, gameId, dependencies);
  }
  if (
    method === "POST" &&
    parts[3] === "wilbur" &&
    parts[4] === "actions" &&
    parts[5] &&
    parts[6] === "observations" &&
    parts.length === 7
  ) {
    return handleAppendWilburObservationRequest(
      request,
      gameId,
      parts[5],
      dependencies,
    );
  }
  return Response.json({ error: "not found" }, { status: 404 });
}

async function startHttpHarness(
  initialServices: WebChessApiServices,
): Promise<HttpHarness> {
  let services = initialServices;
  const server: Server = createServer((incoming, outgoing) => {
    void (async () => {
      try {
        const chunks: Buffer[] = [];
        for await (const chunk of incoming) {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        }
        const address = server.address() as AddressInfo;
        const body = Buffer.concat(chunks).toString("utf8");
        const request = new Request(
          `http://127.0.0.1:${String(address.port)}${incoming.url ?? "/"}`,
          {
            method: incoming.method ?? "GET",
            headers: requestHeaders(incoming.headers),
            ...(body ? { body } : {}),
          },
        );
        const response = await dispatch(request, services);
        outgoing.statusCode = response.status;
        response.headers.forEach((value, name) =>
          outgoing.setHeader(name, value),
        );
        outgoing.end(Buffer.from(await response.arrayBuffer()));
      } catch (error) {
        outgoing.statusCode = 500;
        outgoing.end(error instanceof Error ? error.stack : String(error));
      }
    })();
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${String(address.port)}`,
    replaceServices(replacement) {
      services = replacement;
    },
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}

async function httpJson<T>(
  method: "GET" | "POST",
  path: string,
  body: unknown,
  expectedStatus = 200,
  idempotencyKey?: string,
): Promise<HttpResult<T>> {
  if (!harness) throw new Error("The HTTP lifecycle harness is not running.");
  const response = await fetch(`${harness.baseUrl}${path}`, {
    method,
    headers: {
      ...(method === "POST"
        ? {
            "content-type": "application/json",
            "idempotency-key": idempotencyKey ?? operationId(),
          }
        : {}),
      "x-forwarded-for": IP_ADDRESS,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  if (response.status !== expectedStatus) {
    throw new Error(
      `${method} ${path} returned ${String(response.status)}: ${text}`,
    );
  }
  expect(response.headers.get("cache-control")).toContain("no-store");
  return {
    data: (text ? JSON.parse(text) : null) as T,
    response,
  };
}

async function divideAndPlayToTerminal(): Promise<{
  readonly mapped: DurableGame;
  readonly terminal: DurableGame;
  readonly clientMoveCount: number;
}> {
  const divided = await httpJson<{ game: DurableGame }>(
    "POST",
    "/api/divide",
    {
      problem: PROBLEM,
      memoryObservationIds: [],
      researchConsent: {
        version: RESEARCH_CONSENT_VERSION,
        decision: "no_external_research",
      },
    },
    201,
  );
  const mapped = divided.data.game;
  expect(mapped).toMatchObject({ status: "mapped", problem: PROBLEM });
  expect(mapped.division?.facets).toHaveLength(64);

  const started = await httpJson<{ game: DurableGame }>(
    "POST",
    `/api/games/${mapped.id}/start`,
    { expectedRevision: mapped.revision },
  );
  let game = started.data.game;
  expect(game.status).toBe("playing");
  expect(requireState(game)).toMatchObject({
    completedPlies: 0,
    turn: "white",
  });
  expect(requireState(game).pieces).toHaveLength(32);

  let clientMoveCount = 0;
  while (!requireState(game).outcome) {
    const move = nextDeterministicMove(game);
    const moved = await httpJson<{ game: DurableGame }>(
      "POST",
      `/api/games/${mapped.id}/moves`,
      {
        expectedRevision: game.revision,
        pieceId: move.pieceId,
        to: move.to,
      },
    );
    game = moved.data.game;
    clientMoveCount += 1;
    if (clientMoveCount > 270) {
      throw new Error("The HTTP lifecycle game exceeded its bounded replay.");
    }
  }
  expect(game.status).toBe("completed");
  expect(requireState(game).events.length).toBeGreaterThanOrEqual(
    clientMoveCount,
  );
  return { mapped, terminal: game, clientMoveCount };
}

beforeEach(async () => {
  database = await createPostgresTestDatabase("full_lifecycle_http");
  const version = await database.adapter.query({
    text: "SHOW server_version_num",
  });
  expect(String(version.rows[0]?.server_version_num)).toMatch(/^17\d{4}$/u);
  await database.migrate();
  harness = null;
  infrastructureSequence = 0;
  operationSequence = 0;
});

afterEach(async () => {
  try {
    if (harness) await harness.close();
  } finally {
    harness = null;
    await database.dispose();
  }
});

describe("real HTTP + PostgreSQL lifecycle with deterministic provider stubs (not real OpenAI efficacy)", () => {
  it("plays a canonical terminal game through Portia, Gate, Answer, Charlotte, Wilbur, reload, export, and replay", async () => {
    const stubs = createProviderStubs("pass");
    harness = await startHttpHarness(createServices(stubs));
    const { mapped, terminal, clientMoveCount } =
      await divideAndPlayToTerminal();

    const portia = await httpJson<{ lifecycle: LifecycleAggregate }>(
      "POST",
      `/api/games/${mapped.id}/portia`,
      { expectedRevision: terminal.revision },
    );
    expect(portia.data.lifecycle).toMatchObject({
      state: "gate_passed",
      gate: { passed: true, recommendedNextTransition: "answer" },
      answerPromptDigest: expect.stringMatching(/^[0-9a-f]{64}$/u),
      answerUserPromptSha256: expect.stringMatching(/^[0-9a-f]{64}$/u),
    });
    expect(portia.data.lifecycle.portia?.assessments).toHaveLength(
      portia.data.lifecycle.survivors.length,
    );

    const answered = await httpJson<{
      game: DurableGame;
      answer: DurableGame["answer"];
    }>("POST", `/api/games/${mapped.id}/answer`, {
      expectedRevision: terminal.revision,
    });
    expect(answered.data.game.status).toBe("answered");
    expect(answered.data.answer?.answer).toBe(ANSWER_RESULT.answer);

    const qualified = await httpJson<{ lifecycle: LifecycleAggregate }>(
      "POST",
      `/api/games/${mapped.id}/charlotte`,
      { expectedRevision: answered.data.game.revision },
    );
    expect(qualified.data.lifecycle.state).toBe("charlotte_complete");
    expect(
      qualified.data.lifecycle.charlotte?.exactlyThreeNextActions,
    ).toHaveLength(3);
    const suggestion =
      qualified.data.lifecycle.charlotte?.exactlyThreeNextActions[0];
    if (!suggestion)
      throw new Error("Charlotte returned no Wilbur suggestion.");

    const action = await httpJson<{ action: WilburAction }>(
      "POST",
      `/api/games/${mapped.id}/wilbur/actions`,
      {
        charlotteActionIndex: 0,
        actor: suggestion.actor,
        action: suggestion.smallestAction,
        testedAssumption: suggestion.assumptionBeingTested,
        expectedObservation: suggestion.expectedObservation,
        decisionThreshold: suggestion.decisionThreshold,
        reviewHorizon: suggestion.reviewHorizon,
        followUpAt: null,
      },
      201,
    );
    expect(action.data.action).toMatchObject({
      charlotteActionIndex: 0,
      status: "planned",
    });

    const observation = await httpJson<{ observation: WilburObservation }>(
      "POST",
      `/api/games/${mapped.id}/wilbur/actions/${action.data.action.id}/observations`,
      {
        observedAt: NOW.toISOString(),
        observation: "The bounded test produced one direct, recorded signal.",
        evidenceClassification: "Direct observation by the accountable owner.",
        expectedEffect: "A direct signal appeared inside the review horizon.",
        unexpectedEffect: "No unexpected effect was recorded.",
        stakeholderResponse: "Affected participants retained the stop path.",
        assumptionResult: "supported",
        nextDecision:
          "Continue only inside the original bounded scope and review again.",
      },
      201,
    );
    expect(observation.data.observation.assumptionResult).toBe("supported");

    harness.replaceServices(createServices(stubs));
    const reloaded = await httpJson<{ game: DurableGame }>(
      "GET",
      `/api/games/${mapped.id}`,
      undefined,
    );
    expect(reloaded.data.game).toMatchObject({
      id: mapped.id,
      revision: answered.data.game.revision,
      status: "answered",
      answer: answered.data.answer,
    });
    expect(reloaded.data.game.state?.events).toEqual(
      requireState(terminal).events,
    );
    const reloadedLifecycle = await httpJson<{ lifecycle: LifecycleAggregate }>(
      "GET",
      `/api/games/${mapped.id}/lifecycle`,
      undefined,
    );
    expect(reloadedLifecycle.data.lifecycle).toMatchObject({
      state: "wilbur_observed",
      charlotte: {
        contractVersion: CURRENT_LIFECYCLE_VERSIONS.charlotteContract,
      },
    });
    expect(reloadedLifecycle.data.lifecycle.wilburActions).toHaveLength(1);
    expect(reloadedLifecycle.data.lifecycle.wilburObservations).toHaveLength(1);
    const provenance = await httpJson<{ activities: readonly unknown[] }>(
      "GET",
      `/api/games/${mapped.id}/provenance`,
      undefined,
    );
    expect(provenance.data.activities.length).toBeGreaterThan(10);

    const replayIdempotencyKey = operationId();
    const replayed = await httpJson<{ game: DurableGame }>(
      "POST",
      `/api/games/${mapped.id}/replay`,
      { expectedRevision: answered.data.game.revision },
      201,
      replayIdempotencyKey,
    );
    expect(replayed.data.game).toMatchObject({
      id: replayIdempotencyKey,
      sourceGameId: mapped.id,
      status: "mapped",
      revision: 0,
    });
    expect(replayed.data.game.division).toEqual(mapped.division);
    const replayReload = await httpJson<{ game: DurableGame }>(
      "GET",
      `/api/games/${replayed.data.game.id}`,
      undefined,
    );
    expect(replayReload.data.game).toEqual(replayed.data.game);

    const exported = await httpJson<AccountExport>(
      "POST",
      "/api/account/export",
      undefined,
    );
    expect(exported.response.headers.get("content-disposition")).toContain(
      'attachment; filename="webchess-export-',
    );
    expect(exported.data.format).toBe("webchess-account-export/4");
    expect(exported.data.games.map((game) => game.id)).toEqual(
      expect.arrayContaining([mapped.id, replayed.data.game.id]),
    );
    expect(exported.data.games).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: mapped.id,
          isCurrent: false,
          status: "answered",
        }),
        expect.objectContaining({
          id: replayed.data.game.id,
          isCurrent: true,
          sourceGameId: mapped.id,
          status: "mapped",
        }),
      ]),
    );
    expect(
      exported.data.events.filter((event) => event.gameId === mapped.id),
    ).toHaveLength(requireState(terminal).events.length);
    expect(
      exported.data.modelRequests.map((request) => request.operation).sort(),
    ).toEqual(["answer", "charlotte", "division", "portia"]);
    for (const request of exported.data.modelRequests) {
      expect(request).toMatchObject({
        model: MODEL,
        provider: "deterministic-test-stub",
        status: "succeeded",
      });
    }
    expect(exported.data.portiaReviews).toHaveLength(1);
    expect(exported.data.gateDecisions).toEqual([
      expect.objectContaining({ passed: true }),
    ]);
    expect(exported.data.charlotteResults).toHaveLength(1);
    expect(exported.data.wilburActions).toHaveLength(1);
    expect(exported.data.wilburObservations).toHaveLength(1);
    expect(exported.data.lifecycleActivities.length).toBeGreaterThan(10);
    expect(exported.data.gameStartRequests).toEqual([
      expect.objectContaining({
        idempotencyKey: replayIdempotencyKey,
        kind: "replay",
        sourceGameId: mapped.id,
        expectedRevision: String(answered.data.game.revision),
      }),
    ]);
    const serializedExport = JSON.stringify(exported.data);
    expect(serializedExport).not.toContain(OWNER);
    expect(serializedExport).not.toContain(HMAC_SECRET);
    expect(serializedExport).not.toContain(DELETION_HMAC_SECRET);
    expect(clientMoveCount).toBeGreaterThan(0);
    expect(stubs.divisionGenerator).toHaveBeenCalledOnce();
    expect(stubs.portiaGenerator).toHaveBeenCalledOnce();
    expect(stubs.answerGenerator).toHaveBeenCalledOnce();
    expect(stubs.charlotteGenerator).toHaveBeenCalledOnce();
  });

  it("persists a failed Gate and creates a reloadable same-field Retry child without calling Answer or Charlotte", async () => {
    const stubs = createProviderStubs("retry-game");
    harness = await startHttpHarness(createServices(stubs));
    const { mapped, terminal } = await divideAndPlayToTerminal();

    const failed = await httpJson<{ lifecycle: LifecycleAggregate }>(
      "POST",
      `/api/games/${mapped.id}/portia`,
      { expectedRevision: terminal.revision },
    );
    expect(failed.data.lifecycle).toMatchObject({
      state: "gate_failed",
      gate: { passed: false, recommendedNextTransition: "retry_game" },
    });

    const retried = await httpJson<{
      game: DurableGame;
      lifecycle: LifecycleAggregate;
    }>(
      "POST",
      `/api/games/${mapped.id}/retry`,
      { expectedRevision: terminal.revision },
      201,
    );
    expect(retried.data.game).toMatchObject({
      sourceGameId: mapped.id,
      status: "mapped",
    });
    expect(retried.data.lifecycle).toMatchObject({
      gameId: retried.data.game.id,
      parentRunId: failed.data.lifecycle.id,
      rootRunId: failed.data.lifecycle.rootRunId,
      state: "chess_ready",
      sameFieldRetryCount: 1,
      fieldRegenerationCount: 0,
    });

    harness.replaceServices(createServices(stubs));
    const childReload = await httpJson<{ game: DurableGame }>(
      "GET",
      `/api/games/${retried.data.game.id}`,
      undefined,
    );
    expect(childReload.data.game).toEqual(retried.data.game);
    const lifecycleReload = await httpJson<{ lifecycle: LifecycleAggregate }>(
      "GET",
      `/api/games/${retried.data.game.id}/lifecycle`,
      undefined,
    );
    expect(lifecycleReload.data.lifecycle).toMatchObject({
      parentRunId: failed.data.lifecycle.id,
      state: "chess_ready",
      retryReason: expect.any(String),
    });
    const current = await httpJson<{ game: DurableGame | null }>(
      "GET",
      "/api/games/current",
      undefined,
    );
    expect(current.data.game?.id).toBe(retried.data.game.id);

    const exported = await httpJson<AccountExport>(
      "POST",
      "/api/account/export",
      undefined,
    );
    expect(exported.data.gateDecisions).toEqual([
      expect.objectContaining({ passed: false }),
    ]);
    expect(exported.data.lifecycleRuns).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ gameId: mapped.id }),
        expect.objectContaining({
          gameId: retried.data.game.id,
          parentRunId: failed.data.lifecycle.id,
          sameFieldRetryCount: 1,
        }),
      ]),
    );
    expect(
      exported.data.modelRequests.map((request) => request.operation).sort(),
    ).toEqual(["division", "portia"]);
    expect(stubs.answerGenerator).not.toHaveBeenCalled();
    expect(stubs.charlotteGenerator).not.toHaveBeenCalled();
  });
});
