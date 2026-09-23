import { createHash } from 'node:crypto'
import { pickAdvice } from '../src/adviceLibrary.js'

// Keep enough budget for a compact recovery pass plus the optional Jev call.
const LLM_TIMEOUT_MS = 30000
const COMPACT_LLM_TIMEOUT_MS = 18000
const JEV_TIMEOUT_MS = 5000
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

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
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
  const candidatesRaw = Array.isArray(raw?.candidates) ? raw.candidates.slice(0, 4) : []
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

async function askLlm(message, config, { compact = false } = {}) {
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
        { role: 'user', content: message.slice(0, 4000) },
      ],
      max_tokens: compact ? 1200 : 1800,
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

function demoCard(message) {
  const card = { ...pickAdvice(message) }
  return { ...card, mode: 'demo', jevEvaluated: false }
}

function degradedCard(message, error) {
  const card = { ...pickAdvice(message) }
  return {
    ...card,
    mode: 'degraded',
    jevEvaluated: false,
    error: `Live advisor timed out; showing a bounded starting pattern instead. ${error}`,
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

  if (!config.llmKey) {
    const card = demoCard(message)
    return json({ ...card, schema: typeSafeExample(card, message) })
  }

  try {
    let result
    let compactRecovery = false
    try {
      result = await askLlm(message, config)
    } catch (error) {
      const timedOut = error?.name === 'TimeoutError' || error?.name === 'AbortError'
      if (!timedOut) throw error
      result = await askLlm(message, config, { compact: true })
      compactRecovery = true
    }
    const card = result.card
    let jevEvaluated = false

    try {
      const jev = await askJev(message, card, config)
      if (jev) {
        Object.assign(card, applyJev(card, jev))
        jevEvaluated = true
      }
    } catch {
      // Jev evaluation is optional; the LLM recommendation still stands.
    }

    return json({
      ...card,
      mode: compactRecovery ? 'live-compact' : 'live',
      jevEvaluated,
      schema: typeSafeExample(card, message),
    })
  } catch (error) {
    const timedOut = error?.name === 'TimeoutError' || error?.name === 'AbortError'
    const detail = timedOut
      ? `the LLM and compact recovery pass did not answer within the release budget — please try again`
      : error?.message || error
    return json(degradedCard(message, detail), 200)
  }
}
