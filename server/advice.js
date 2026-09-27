import { createHash } from 'node:crypto'
import { pickAdvice } from '../src/adviceLibrary.js'

// Keep enough budget for a compact recovery pass plus the optional Jev call.
// Keep the API inside a browser-friendly budget. A slow provider should become
// a labelled bounded response, not an apparent offline failure in the client.
const LLM_TIMEOUT_MS = 30000
const COMPACT_LLM_TIMEOUT_MS = 5000
const JEV_TIMEOUT_MS = 2000
const SCREENED_LLM_TIMEOUT_MS = 30000
// The tailored path may wait long: a slow provider is worth waiting for
// rather than failing or substituting generic advice. Heartbeat stage events
// keep the stream (and the user) alive through the wait.
const DECOMPOSE_LLM_TIMEOUT_MS = 90000
const DECOMPOSE_RETRY_TIMEOUT_MS = 60000
const RECHECK_JEV_TIMEOUT_MS = 6000
const USER_AGENT = 'jev-godfather-advisor/1.0'

const FIT_LABELS = {
  'Strong fit': 'green',
  'Promising fit': 'amber',
  'Poor fit': 'red',
}

const SYSTEM_PROMPT = `You are Jev Godfather, a blunt decision-architecture advisor. The user describes a project or workflow. Your job is to locate the narrowest valuable decision that TypeSafe's Jev can own, or say that Jev should not be used yet.

Jev is a System One typed-decision model. You send it a state plus typed questions (choice, score, noul) and it returns structured answers with probabilities and confidence. It does not generate free text.

Strong fits: bounded answer spaces, repeated decisions, observable input state, a useful confidence threshold, and outcomes that can be checked. Proven patterns: selecting browser actions from currently valid controls, context retention, model routing, code-review prioritisation, semantic CLI predicates, MCP judgment tools, agent completion checks, graph traversal, dataset filtering, and tactical decisions inside deterministic control loops.

Poor fits: open-ended creative writing, long-horizon planning with deep branching (Jev's admitted weak spot), unbounded research, no enumerable answer space, no ground truth for evaluation, high-risk automation without human review.

Architecture rule: ordinary code observes state, validates candidates, executes actions, enforces permissions, and verifies outcomes. Jev only judges among bounded alternatives. A general LLM may interpret an open-ended request, generate text, explain results, and handle unusual cases.

Do not write generic advice such as "use Jev for routing", "define a bounded answer space", "keep a human in the loop", or "start with conservative thresholds" unless you immediately specify the exact state, alternatives, threshold, fallback, and owner. Never invent measured latency, cost, accuracy, or calibration. If the request lacks a fact required for a sharp recommendation, name that fact under missingEvidence.

Return ONLY valid JSON with exactly these keys:
{
  "fit": "Strong fit" | "Promising fit" | "Poor fit",
  "verdict": "Use Jev" | "Use Jev narrowly" | "Do not use Jev yet",
  "headline": string (one decisive sentence naming the exact boundary),
  "summary": string (2-3 specific sentences; include why this boundary is valuable),
  "candidates": [
    {
      "decision": string (an exact bounded question),
      "questionType": "choice" | "score" | "noul",
      "choices": string[] (2-6 finite options),
      "why": string (why this is a better boundary than adjacent work),
      "stateFields": string[] (3-8 concrete fields available before the decision),
      "jevOwns": string,
      "codeOwns": string,
      "avoid": string,
      "threshold": string (a proposed policy labelled as a starting threshold, never a measured claim),
      "fallback": string,
      "successTest": string
    }
  ] (2-3 materially different candidate boundaries, best first),
  "missingEvidence": string[] (0-4 facts that could change the recommendation),
  "referencePatterns": string[] (1-3 closest patterns from the proven pattern list, with a one-line connection),
  "steps": string[] (3 concrete implementation steps),
  "confidence": number between 0 and 1
}
No markdown, no comments, no text outside the JSON object.`

const COMPACT_SYSTEM_PROMPT = `You are Jev Godfather. Return a concise JSON recommendation for how Jev should be used in the user's project.

Jev only chooses among finite alternatives or answers a narrow yes/no or score question. Code must own observation, candidate validation, permissions, execution, and verification. A general LLM owns open-ended explanation and generation. Be decisive and specific; do not invent measured performance claims.

Return ONLY valid JSON with exactly these keys:
{
  "fit": "Strong fit" | "Promising fit" | "Poor fit",
  "verdict": "Use Jev" | "Use Jev narrowly" | "Do not use Jev yet",
  "headline": string,
  "summary": string,
  "candidates": [{
    "decision": string,
    "questionType": "choice" | "score" | "noul",
    "choices": string[],
    "why": string,
    "stateFields": string[],
    "jevOwns": string,
    "codeOwns": string,
    "avoid": string,
    "threshold": string,
    "fallback": string,
    "successTest": string
  }],
  "missingEvidence": string[],
  "referencePatterns": string[],
  "steps": string[],
  "confidence": number
}

Return one or two candidate boundaries. Keep every string short and operational. No markdown or text outside JSON.`

const DECOMPOSE_SYSTEM_PROMPT = `You are a workflow analyst. Decompose the user's project description into at least 5 concrete operational steps in execution order that together cover the WHOLE described pipeline — intake, each judgment, each action, each check the user mentions. Each step names one repeated decision the running system makes every time it runs. Omit a stage only if the user truly has none.

Vocabulary rules — these matter most:
- Use the user's own nouns, labels, queues, thresholds, and categories verbatim.
- Every decision must be self-contained: name the platform, entity, or artifact explicitly (e.g. "the LinkedIn company profile", not "raw profile text" or "the item"). A step must be understandable with no other context.
- Every decision must name its real subject (the ticket, the email, the comment, the drone), never a vague placeholder like "the item".
- If the user enumerates options (e.g. four email categories), put those exact options into the choices of ONE "choice" question. Do not split one enumerated set into several yes/no steps.
- Never use placeholder options like act/defer/escalate unless the user used those words.

Field rules:
- decision: the exact question, 12 words or fewer.
- questionType: "choice" when options are enumerable, otherwise "noul" or "score".
- choices: the user's own labels, 2-6 items.
- stateFields: 2-5 inputs observably available at the moment the step runs, named concretely.
- jevOwns: one short sentence (10 words or fewer) naming exactly what this step picks.
- codeOwns: one short sentence (12 words or fewer) naming what deterministic code does around this step.
- avoid: one short sentence (14 words or fewer) naming the ONE thing most likely to be wrongly asked of Jev in this specific step.
- threshold: one short sentence (14 words or fewer) proposing a starting confidence rule for acting on this step's answer.
- fallback: one short sentence (12 words or fewer) stating what happens when Jev is unsure or unavailable for this step.
- successTest: one short sentence (14 words or fewer) naming the historical data that would prove this step's decision quality.

Return ONLY valid JSON:
{
  "steps": [
    {
      "decision": string,
      "questionType": "choice" | "score" | "noul",
      "choices": string[],
      "stateFields": string[],
      "jevOwns": string,
      "codeOwns": string,
      "avoid": string,
      "threshold": string,
      "fallback": string,
      "successTest": string
    }
  ]
}
Steps are structural decomposition only; you are not deciding whether any step needs Jev. No markdown, no text outside the JSON object.`

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function withDeadline(promise, milliseconds, label) {
  let timer
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const error = new Error(`${label} exceeded ${milliseconds}ms`)
      error.name = 'TimeoutError'
      reject(error)
    }, milliseconds)
  })
  return Promise.race([promise, deadline]).finally(() => clearTimeout(timer))
}

function slug(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 48) || 'option'
}

function normalizeChoices(raw, questionType) {
  if (questionType === 'noul') return ['true', 'false']
  const fallback = questionType === 'noul' ? ['true', 'false'] : questionType === 'score' ? ['low', 'medium', 'high'] : ['yes', 'no']
  if (!Array.isArray(raw)) return fallback
  const choices = raw
    .filter((item) => typeof item === 'string' && item.trim())
    .map((item) => item.trim())
    .slice(0, 6)
  return choices.length >= 2 ? choices : fallback
}

function cleanText(value, fallback, max = 500) {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : fallback
}

function cleanList(raw, fallback = [], limit = 8) {
  if (!Array.isArray(raw)) return fallback
  const values = raw.filter((item) => typeof item === 'string' && item.trim()).map((item) => item.trim()).slice(0, limit)
  return values.length ? values : fallback
}

function normalizeCandidate(raw, index) {
  const questionType = ['choice', 'score', 'noul'].includes(raw?.questionType) ? raw.questionType : 'choice'
  return {
    id: `boundary_${index + 1}`,
    decision: cleanText(raw?.decision, 'Which valid next action should the system take?'),
    questionType,
    choices: normalizeChoices(raw?.choices, questionType),
    why: cleanText(raw?.why, 'This isolates one repeated judgment while leaving observation, execution, and verification in deterministic code.'),
    stateFields: cleanList(raw?.stateFields, ['current_state', 'valid_options', 'recent_outcome']),
    jevOwns: cleanText(raw?.jevOwns, 'Select one bounded outcome and return its probability.'),
    codeOwns: cleanText(raw?.codeOwns, 'Construct valid candidates, enforce hard rules, execute the result, and verify the outcome.'),
    avoid: cleanText(raw?.avoid, 'Do not ask Jev to generate prose, invent actions, or bypass deterministic safety checks.'),
    threshold: cleanText(raw?.threshold, 'Starting policy: auto-act only above a threshold chosen on a labelled validation set; otherwise escalate.'),
    fallback: cleanText(raw?.fallback, 'On uncertainty or provider failure, preserve the current state and send the case to the existing fallback.'),
    successTest: cleanText(raw?.successTest, 'Replay labelled cases and measure decision accuracy, abstention quality, and downstream task success.'),
  }
}

function extractJson(text) {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text)
  const candidate = fenced ? fenced[1] : text
  const start = candidate.indexOf('{')
  const end = candidate.lastIndexOf('}')
  if (start === -1 || end <= start) throw new Error('Model returned no JSON object')
  return JSON.parse(candidate.slice(start, end + 1))
}

function normalizeCard(raw) {
  const fit = Object.hasOwn(FIT_LABELS, raw?.fit) ? raw.fit : 'Promising fit'
  const candidatesRaw = Array.isArray(raw?.candidates) ? raw.candidates.slice(0, 7) : []
  const candidates = (candidatesRaw.length ? candidatesRaw : [raw]).map(normalizeCandidate)
  const selected = candidates[0]
  const steps = Array.isArray(raw?.steps)
    ? raw.steps.filter((step) => typeof step === 'string' && step.trim()).map((step) => step.trim()).slice(0, 4)
    : []
  const confidence = typeof raw?.confidence === 'number' && raw.confidence >= 0 && raw.confidence <= 1 ? raw.confidence : null

  return {
    fit,
    fitClass: FIT_LABELS[fit],
    verdict: ['Use Jev', 'Use Jev narrowly', 'Do not use Jev yet'].includes(raw?.verdict) ? raw.verdict : 'Use Jev narrowly',
    headline: cleanText(raw?.headline, `Use Jev only for: ${selected.decision}`),
    summary: cleanText(raw?.summary, selected.why, 900),
    candidates,
    selectedBoundaryId: selected.id,
    ...selected,
    missingEvidence: cleanList(raw?.missingEvidence, [], 4),
    referencePatterns: cleanList(raw?.referencePatterns, [], 3),
    steps:
      steps.length >= 2
        ? steps
        : [
            'Name the state Jev should inspect and the finite answer space it should return.',
            'Keep a general LLM for open-ended reasoning and explanations.',
            'Send low-confidence results to review instead of forcing automation.',
          ],
    confidence,
  }
}

function screenInstruction(screen) {
  if (!screen) return ''
  return `
Jev has already screened the request before you. Treat this screening as authoritative:
${JSON.stringify({ verdict: screen.verdict, fit: screen.fit, decision: screen.decision, selectionBasis: screen.selectionBasis })}
Do not reverse a Jev rejection into a Jev recommendation. If Jev rejected the boundary, explain what evidence is missing and keep the answer LLM-only. If Jev approved it, explain implementation around that exact boundary rather than inventing a broader one.`
}

function typeSafeExample(card, message) {
  const state = Object.fromEntries(
    (card.stateFields || ['project_request']).map((field) => [slug(field), `<${field}>`]),
  )
  state.project_request = message.slice(0, 600)

  let question
  if (card.questionType === 'noul') {
    question = { type: 'noul', instructions: card.decision }
  } else if (card.questionType === 'score') {
    question = { type: 'score', instructions: card.decision, criteria: card.choices }
  } else {
    question = {
      type: 'choice',
      instructions: card.decision,
      criteria: Object.fromEntries(card.choices.map((choice, index) => [`${slug(choice)}_${index + 1}`, choice])),
    }
  }

  return { model: 'jev-latest', state, questions: { decision: question } }
}

function buildComparison(card) {
  return {
    decision: card.decision,
    withoutJev: {
      label: 'Without Jev',
      steps: [
        'General LLM interprets the request and picks a direction.',
        'The workflow and decision policy stay implicit in the response.',
        'A human or downstream code checks whether the result is usable.',
      ],
    },
    withJev: {
      label: 'With Jev',
      steps: [
        'Code assembles observable state and valid alternatives.',
        `Jev answers one bounded question: ${card.decision}`,
        'Code applies the threshold, executes, and verifies the outcome.',
      ],
    },
    speed: {
      status: 'estimated',
      unit: 'relative time · without Jev = 100',
      bars: [
        { label: 'Without Jev', value: 100, display: '1.0× baseline' },
        { label: 'With Jev · accepted', value: 125, display: '~1.1–1.4×' },
        { label: 'With Jev · rejected', value: 20, display: '~0.1–0.3×' },
      ],
      note: 'Directional estimate: accepted cases add a Jev call; rejected cases can stop before the LLM. Validate with paired runs.',
    },
    cost: {
      status: 'estimated',
      unit: 'relative cost · without Jev = 100',
      bars: [
        { label: 'Without Jev', value: 100, display: '1.0× baseline' },
        { label: 'With Jev · accepted', value: 115, display: '~1.0–1.3×' },
        { label: 'With Jev · rejected', value: 15, display: '~0.1–0.2×' },
      ],
      note: 'Directional estimate: accepted cases pay for Jev plus the LLM; rejected cases avoid the LLM. Provider pricing is not asserted.',
    },
    evidence: 'Workflow is architectural; speed and cost are directional estimates that should be calibrated with a paired benchmark.',
  }
}

function sanitizeBaseUrl(raw, { strict }) {
  const value = String(raw || '').trim().slice(0, 512)
  if (!value) return null
  let url
  try {
    url = new URL(value)
  } catch {
    return null
  }
  if (url.protocol === 'https:') return value.replace(/\/$/, '')
  if (url.protocol === 'http:') {
    const local = ['localhost', '127.0.0.1', '::1'].includes(url.hostname)
    if (!strict || local) return value.replace(/\/$/, '')
  }
  return null
}

// Per-request keys (from the user's browser) win over server env config.
function readConfig(request) {
  const header = (name) => {
    const value = request.headers.get(name)
    return typeof value === 'string' ? value.trim().slice(0, 2048) : ''
  }
  const pick = (headerName, envName) => header(headerName) || (process.env[envName] || '').trim()

  return {
    llmKey: pick('x-llm-api-key', 'LLM_API_KEY').slice(0, 512),
    llmBaseUrl:
      sanitizeBaseUrl(header('x-llm-base-url'), { strict: true }) ||
      sanitizeBaseUrl(process.env.LLM_BASE_URL, { strict: false }) ||
      'https://api.openai.com/v1',
    llmModel: pick('x-llm-model', 'LLM_MODEL').slice(0, 128) || 'gpt-4o-mini',
    typesafeKey: pick('x-typesafe-api-key', 'TYPESAFE_API_KEY').slice(0, 512),
    typesafeBaseUrl:
      sanitizeBaseUrl(header('x-typesafe-base-url'), { strict: true }) ||
      sanitizeBaseUrl(process.env.TYPESAFE_BASE_URL, { strict: false }) ||
      'https://api.typesafe.ai/v1',
  }
}

async function askLlm(message, config, { compact = false, screen = null } = {}) {
  const { llmKey: key, llmBaseUrl: baseUrl, llmModel: model } = config
  // OpenCode Go rejects requests without a session id; hash keeps it stable per message.
  const session = createHash('sha256').update(message).digest('hex').slice(0, 64)

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      'User-Agent': USER_AGENT,
      'x-opencode-session': session,
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      messages: [
        { role: 'system', content: compact ? COMPACT_SYSTEM_PROMPT : SYSTEM_PROMPT },
        { role: 'user', content: `${message.slice(0, 3600)}${screenInstruction(screen)}` },
      ],
      max_tokens: compact ? 900 : 1400,
      // Same reasoning-token trap as decomposition: hidden thinking ate the
      // entire budget and the content came back empty.
      reasoning_effort: 'none',
    }),
    signal: AbortSignal.timeout(compact ? COMPACT_LLM_TIMEOUT_MS : LLM_TIMEOUT_MS),
  })

  if (!response.ok) throw new Error(`LLM returned HTTP ${response.status}`)
  const data = await response.json()
  const content = data?.choices?.[0]?.message?.content
  if (typeof content !== 'string') throw new Error('LLM returned no content')
  const raw = extractJson(content)
  return {
    card: normalizeCard(raw),
  }
}

async function askDecompose(message, config, { lite = false, refine = false, timeoutMs = DECOMPOSE_LLM_TIMEOUT_MS } = {}) {
  const { llmKey: key, llmBaseUrl: baseUrl, llmModel: model } = config
  const session = createHash('sha256').update(`decompose:${message}`).digest('hex').slice(0, 64)

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      'User-Agent': USER_AGENT,
      'x-opencode-session': session,
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      messages: [
        { role: 'system', content: DECOMPOSE_SYSTEM_PROMPT },
        { role: 'user', content: refine
          ? `${message.slice(0, 3600)}\n\nThis breakdown has too few steps. List at least 6 of the most granular repeated decisions the running system makes — include validation, error handling, deduplication, rate limits, scheduling, and storage decisions where they plausibly exist.`
          : lite
            ? `${message.slice(0, 3600)}\n\nList only the 3 most decision-critical steps.`
            : message.slice(0, 3600) },
      ],
      // Reasoning models (e.g. glm-5.3-flash) burn max_tokens on hidden
      // thinking; default thinking produced zero content. reasoning_effort
      // "none" answers directly at 60-72 tok/s; the full ten-field step
      // schema needs this budget given the generous deadline.
      max_tokens: lite ? 700 : 2200,
      reasoning_effort: 'none',
    }),
    signal: AbortSignal.timeout(timeoutMs),
  })

  if (!response.ok) throw new Error(`Decomposition LLM returned HTTP ${response.status}`)
  const data = await response.json()
  const content = data?.choices?.[0]?.message?.content
  if (typeof content !== 'string') throw new Error('Decomposition LLM returned no content')
  const raw = extractJson(content)
  if (!Array.isArray(raw?.steps)) throw new Error('Decomposition returned no steps array')
  const usable = raw.steps
    .filter((step) => step && typeof step.decision === 'string' && step.decision.trim())
    .slice(0, lite ? 3 : 7)
    .map((step, index) => normalizeCandidate(step, index + 1))
  return usable.length >= 2 ? usable : null
}

function withHeartbeat(promise, emit) {
  const started = Date.now()
  const timer = setInterval(() => {
    emit({ type: 'stage', stage: 'waiting', seconds: Math.round((Date.now() - started) / 1000) })
  }, 15000)
  return Promise.resolve(promise).finally(() => clearInterval(timer))
}

async function attemptDecompose(message, config, emit) {
  let steps = null
  try {
    steps = await withHeartbeat(askDecompose(message, config), emit)
  } catch {
    steps = null
  }
  if (!steps) {
    emit({ type: 'stage', stage: 'decomposing', retry: true })
    try {
      return await withHeartbeat(askDecompose(message, config, { lite: true, timeoutMs: DECOMPOSE_RETRY_TIMEOUT_MS }), emit)
    } catch {
      return null
    }
  }
  if (steps.length < 5) {
    emit({ type: 'stage', stage: 'decomposing', refine: true })
    try {
      const refined = await withHeartbeat(askDecompose(message, config, { refine: true, timeoutMs: DECOMPOSE_RETRY_TIMEOUT_MS }), emit)
      if (refined && refined.length > steps.length) return refined
    } catch { /* keep the shallower breakdown */ }
  }
  return steps
}

async function askJevTimed(message, card, config, timeoutMs) {
  if (!config.typesafeKey) return null
  try {
    return await withDeadline(askJev(message, card, config), timeoutMs, 'Jev screening')
  } catch {
    return null
  }
}

function minScreenScore(jev, candidateId) {
  const metrics = jev?.metrics?.[candidateId]
  if (!metrics) return null
  return Math.min(metrics.bounded, metrics.observable, metrics.repeated)
}

function formatScore(value) {
  return typeof value === 'number' ? Number(value.toFixed(2)) : null
}

async function askJev(message, card, config) {
  const key = config.typesafeKey
  if (!key) return null
  const baseUrl = config.typesafeBaseUrl

  const candidateCriteria = Object.fromEntries([
    ...card.candidates.map((candidate) => [
      candidate.id,
      `${candidate.decision} | state: ${candidate.stateFields.join(', ')} | Jev owns: ${candidate.jevOwns}`,
    ]),
    ['none', 'None of these is a sufficiently bounded, observable, repeated decision for Jev.'],
  ])

  const candidateQuestions = Object.fromEntries(
    card.candidates.flatMap((candidate) => [
      [`${candidate.id}_bounded`, {
        type: 'noul',
        instructions: `The decision "${candidate.decision}" has a finite answer space that contains the real operational outcomes, including a no-match or escalation path when needed.`,
      }],
      [`${candidate.id}_observable`, {
        type: 'noul',
        instructions: `The listed state fields are available before this decision and contain enough observable evidence to make it without inventing facts.`,
      }],
      [`${candidate.id}_repeated`, {
        type: 'noul',
        instructions: 'This exact judgment recurs often enough that a dedicated fast decision layer is more useful than handling it ad hoc.',
      }],
    ]),
  )

  const body = {
    model: process.env.TYPESAFE_MODEL || 'jev-latest',
    state: JSON.stringify({
      project_request: message.slice(0, 1500),
      candidate_boundaries: card.candidates,
    }),
    questions: {
      best_boundary: {
        type: 'choice',
        instructions: 'Which candidate is the sharpest useful boundary for Jev rather than ordinary code or a generative model?',
        criteria: candidateCriteria,
      },
      ...candidateQuestions,
      high_consequence: {
        type: 'noul',
        instructions: 'A wrong automatic decision here could directly cause irreversible, financial, safety, permission, privacy, or production harm.',
      },
    },
  }

  const response = await fetch(`${baseUrl}/systemone`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(JEV_TIMEOUT_MS),
  })

  if (!response.ok) return null
  const data = await response.json()
  const choice = data?.answers?.best_boundary?.choice
  if (!choice) return null

  const metrics = Object.fromEntries(card.candidates.map((candidate) => [candidate.id, {
    bounded: Number(data?.answers?.[`${candidate.id}_bounded`]?.noul ?? 0),
    observable: Number(data?.answers?.[`${candidate.id}_observable`]?.noul ?? 0),
    repeated: Number(data?.answers?.[`${candidate.id}_repeated`]?.noul ?? 0),
  }]))

  return {
    choice,
    metrics,
    highConsequence: Number(data?.answers?.high_consequence?.noul ?? 0),
    confidence: Number(data?.answers?.best_boundary?.confidence ?? 0) || null,
    probabilities: data?.answers?.best_boundary?.probabilities || null,
  }
}

function applyJev(card, jev) {
  if (jev.choice === 'none') {
    return {
      ...card,
      fit: 'Poor fit',
      fitClass: 'red',
      verdict: 'Do not use Jev yet',
      headline: 'Do not add Jev until you can name a repeated decision with observable state and finite outcomes.',
      confidence: jev.confidence ?? card.confidence,
      selectionBasis: 'Jev rejected every proposed boundary.',
    }
  }

  const selected = card.candidates.find((candidate) => candidate.id === jev.choice) || card.candidates[0]
  const metric = jev.metrics[selected.id] || { bounded: 0, observable: 0, repeated: 0 }
  const weakest = Math.min(metric.bounded, metric.observable, metric.repeated)
  const strong = weakest >= 0.6
  const highConsequence = jev.highConsequence >= 0.6
  const fit = strong ? (highConsequence ? 'Promising fit' : 'Strong fit') : 'Promising fit'
  const verdict = strong && !highConsequence ? 'Use Jev' : 'Use Jev narrowly'

  return {
    ...card,
    ...selected,
    selectedBoundaryId: selected.id,
    fit,
    fitClass: FIT_LABELS[fit],
    verdict,
    headline: `${verdict} for this boundary: ${selected.decision}`,
    confidence: jev.confidence ?? card.confidence,
    selectionBasis: `bounded ${metric.bounded.toFixed(2)} · observable ${metric.observable.toFixed(2)} · repeated ${metric.repeated.toFixed(2)}${highConsequence ? ' · consequential action requires an external gate' : ''}`,
  }
}

function degradedCard(message, error) {
  const card = { ...pickAdvice(message) }
  return {
    ...card,
    comparison: buildComparison(card),
    mode: 'degraded',
    jevEvaluated: false,
    error: `Live advisor timed out; showing a bounded starting pattern instead. ${error}`,
  }
}

function fieldOverrides(card) {
  return {
    fit: card.fit,
    fitClass: card.fitClass,
    verdict: card.verdict,
    decision: card.decision,
    questionType: card.questionType,
    choices: card.choices,
    stateFields: card.stateFields,
    jevOwns: card.jevOwns,
    codeOwns: card.codeOwns,
    avoid: card.avoid,
    threshold: card.threshold,
    fallback: card.fallback,
    successTest: card.successTest,
    selectionBasis: card.selectionBasis,
  }
}

function failedCard(why = 'the AI provider never returned your workflow steps') {
  return {
    fit: 'Promising fit',
    fitClass: 'amber',
    verdict: 'No recommendation',
    headline: `Couldn't analyze your workflow — ${why}. Try again.`,
    summary: 'Nothing was screened, so nothing was recommended. This advisor only judges steps taken from your own description — it will not substitute a generic guess.',
    decision: '',
    questionType: null,
    choices: [],
    stateFields: [],
    jevOwns: '',
    codeOwns: '',
    avoid: '',
    threshold: '',
    fallback: '',
    successTest: '',
    missingEvidence: [],
    referencePatterns: [],
    steps: ['Send the request again.', 'If retries keep failing, try a shorter description of the workflow.'],
    confidence: null,
    candidates: [],
    comparison: null,
    mode: 'degraded',
    jevEvaluated: false,
    error: `analysis failed: ${why}`,
  }
}

// Runs the fully tailored ladder: decompose → Jev screens the user's own
// steps → optional LLM explanation. No generic seed participates in the
// verdict. Long waits are allowed (heartbeats keep the stream alive) because
// a tailored answer is worth the clock; only a genuinely unreachable provider
// produces an honest failure, never a substituted guess.
async function produceAdvice(message, config, emit) {
  const decomposition = { status: 'not-configured', steps: [], chosenStepIndex: null, minScoreBefore: null, minScoreAfter: null }

  if (!config.llmKey) {
    const pattern = pickAdvice(message)
    const card = { ...pattern, candidates: [{ id: 'boundary_1', decision: pattern.decision }] }
    emit({
      type: 'result',
      ...card,
      comparison: buildComparison(card),
      mode: 'demo',
      screening: null,
      jevEvaluated: false,
      schema: typeSafeExample(card, message),
      decomposition,
    })
    return
  }

  if (!config.typesafeKey) {
    try {
      let result
      let compactRecovery = false
      try {
        result = await withDeadline(askLlm(message, config), LLM_TIMEOUT_MS, 'LLM request')
      } catch (error) {
        const timedOut = error?.name === 'TimeoutError' || error?.name === 'AbortError'
        if (!timedOut) throw error
        result = await withDeadline(askLlm(message, config, { compact: true }), COMPACT_LLM_TIMEOUT_MS, 'Compact LLM request')
        compactRecovery = true
      }
      emit({
        type: 'result',
        ...result.card,
        comparison: buildComparison(result.card),
        mode: compactRecovery ? 'live-compact' : 'live',
        jevEvaluated: false,
        screening: 'llm-only',
        schema: typeSafeExample(result.card, message),
        decomposition,
      })
    } catch (error) {
      emit({ type: 'result', ...degradedCard(message, error?.message || String(error)), decomposition })
    }
    return
  }

  emit({ type: 'stage', stage: 'decomposing' })
  const steps = await attemptDecompose(message, config, emit)
  if (!steps) {
    decomposition.status = 'failed'
    emit({ type: 'result', ...failedCard(), decomposition })
    return
  }
  decomposition.steps = steps.map((step) => step.decision)
  emit({ type: 'stage', stage: 'steps', steps: decomposition.steps })

  const pseudo = normalizeCard({ candidates: steps })
  const jev = await askJevTimed(message, pseudo, config, RECHECK_JEV_TIMEOUT_MS)
  if (!jev) {
    decomposition.status = 'failed'
    emit({ type: 'result', ...failedCard('Jev did not answer the screening'), decomposition })
    return
  }

  const chosen = jev.choice === 'none' ? null : pseudo.candidates.find((candidate) => candidate.id === jev.choice) || null
  decomposition.status = chosen ? 'applied' : 'rejected'
  decomposition.chosenStepIndex = chosen ? pseudo.candidates.indexOf(chosen) : null
  decomposition.minScoreAfter = chosen ? formatScore(minScreenScore(jev, chosen.id)) : null

  const final = applyJev(pseudo, jev)
  if (chosen) {
    final.summary = `The chosen step repeats one question: ${chosen.decision} ${chosen.jevOwns}`
  } else {
    final.summary = `Jev screened all ${steps.length} steps taken from your description and found none bounded, observable, and repeated enough — use code or a general LLM for this pipeline for now.`
  }
  emit({ type: 'stage', stage: 'screened', verdict: final.verdict, selectionBasis: final.selectionBasis })

  try {
    let result
    try {
      result = await withDeadline(askLlm(message, config, { screen: final }), SCREENED_LLM_TIMEOUT_MS, 'Screened LLM request')
    } catch (error) {
      const timedOut = error?.name === 'TimeoutError' || error?.name === 'AbortError'
      if (!timedOut) throw error
      emit({
        type: 'result',
        ...final,
        comparison: buildComparison(final),
        mode: 'jev-screened',
        jevEvaluated: true,
        screening: 'jev-first',
        llmStatus: 'timed_out_after_screen',
        schema: typeSafeExample(final, message),
        decomposition,
      })
      return
    }
    const card = { ...result.card, ...fieldOverrides(final), screenedDecision: final.decision }
    emit({
      type: 'result',
      ...card,
      comparison: buildComparison(card),
      mode: 'live',
      jevEvaluated: true,
      screening: 'jev-first',
      schema: typeSafeExample(card, message),
      decomposition,
    })
  } catch (error) {
    emit({
      type: 'result',
      ...degradedCard(message, error?.message || String(error)),
      ...fieldOverrides(final),
      jevEvaluated: true,
      screening: 'jev-first',
      decomposition,
    })
  }
}

export async function adviceHandler(request) {
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  let body
  try {
    body = await request.json()
  } catch {
    return json({ error: 'Request body must be valid JSON' }, 400)
  }

  const message = typeof body?.message === 'string' ? body.message.trim() : ''
  if (!message) return json({ error: 'A non-empty message is required' }, 400)
  if (message.length > 4000) return json({ error: 'Message must be 4000 characters or fewer' }, 400)

  const config = readConfig(request)

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder()
      const emit = (event) => controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`))
      try {
        await produceAdvice(message, config, emit)
      } catch (error) {
        try {
          emit({ type: 'result', ...degradedCard(message, error?.message || String(error)) })
        } catch {
          /* stream already closed */
        }
      } finally {
        controller.close()
      }
    },
  })

  return new Response(stream, { status: 200, headers: { 'Content-Type': 'application/x-ndjson' } })
}
