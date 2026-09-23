import { createHash } from 'node:crypto'
import { pickAdvice } from '../src/adviceLibrary.js'

// Budget must fit inside the edge gateway's ~60s cap: worst case = llm + jev + overhead < 60s.
const LLM_TIMEOUT_MS = 52000
const JEV_TIMEOUT_MS = 5000
const USER_AGENT = 'jev-godfather-advisor/1.0'

const FIT_LABELS = {
  'Strong fit': 'green',
  'Promising fit': 'amber',
  'Poor fit': 'red',
}

const SYSTEM_PROMPT = `You are Jev Godfather, an advisor that determines how TypeSafe's Jev model could be used in a user's project. The user will describe a project or problem without asking any explicit question: always answer as if they asked "how should I use Jev here?"

Jev is a System One typed-decision model. You send it a state plus typed questions (choice, score, noul) and it returns structured answers with probabilities and confidence. It does not generate free text.

Strong fits: bounded answer spaces, frequent decisions, latency sensitivity, need for calibrated confidence, no free-text output needed. Proven patterns: spam and abuse gating, browser or desktop agent action decisions, LLM-as-judge replacement, model routing, code-review risk triage, lead scoring, content authenticity, MCP fact-check filtering, confidence-gated escalation, agent decision layers.

Poor fits: open-ended creative writing, long-horizon planning with deep branching (Jev's admitted weak spot), unbounded research, no enumerable answer space, no ground truth for evaluation, high-risk automation without human review.

Keep a general LLM for open-ended reasoning, explanations, and unusual cases.

Return ONLY valid JSON with exactly these keys:
{
  "fit": "Strong fit" | "Promising fit" | "Poor fit",
  "summary": string (1-2 sentences explaining where Jev fits or why it does not),
  "decision": string (the exact bounded decision to give Jev, phrased as a question),
  "questionType": "choice" | "score" | "noul",
  "choices": string[] (2-6 finite options; for noul return ["true","false"]; for score return ordered low to high levels),
  "steps": string[] (2-3 short implementation steps),
  "confidence": number between 0 and 1,
  "workflow": {
    "without": [4 steps of handling ONE decision without Jev],
    "with": [4 steps of handling the same decision with Jev as the gate]
  }
}
Each workflow step is {"label": at most 8 words, scenario-specific, "who": ..., "estMs": integer milliseconds}.
For "without", who is one of "system" | "llm" | "human" and the track MUST include the full LLM call (who "llm") plus a human double-check (who "human").
For "with", who is one of "system" | "jev" | "llm" and the track MUST include the Jev gate (who "jev") and, when escalation matters, a later low-confidence escalation step (who "llm").
estMs realistic: system steps under 100, human review 30000-300000.
No markdown, no comments, no text outside the JSON object.`

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
  const fallback = questionType === 'noul' ? ['true', 'false'] : questionType === 'score' ? ['low', 'medium', 'high'] : ['yes', 'no']
  if (!Array.isArray(raw)) return fallback
  const choices = raw
    .filter((item) => typeof item === 'string' && item.trim())
    .map((item) => item.trim())
    .slice(0, 6)
  return choices.length >= 2 ? choices : fallback
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
  const questionType = ['choice', 'score', 'noul'].includes(raw?.questionType) ? raw.questionType : 'choice'
  const fit = Object.hasOwn(FIT_LABELS, raw?.fit) ? raw.fit : 'Promising fit'
  const choices = normalizeChoices(raw?.choices, questionType)
  const steps = Array.isArray(raw?.steps)
    ? raw.steps.filter((step) => typeof step === 'string' && step.trim()).map((step) => step.trim()).slice(0, 4)
    : []
  const confidence = typeof raw?.confidence === 'number' && raw.confidence >= 0 && raw.confidence <= 1 ? raw.confidence : null

  return {
    fit,
    fitClass: FIT_LABELS[fit],
    summary:
      typeof raw?.summary === 'string' && raw.summary.trim()
        ? raw.summary.trim()
        : 'Jev could handle a bounded version of this decision. Define the answer space first, then keep a general LLM for everything open-ended.',
    decision:
      typeof raw?.decision === 'string' && raw.decision.trim()
        ? raw.decision.trim()
        : 'What repeated decision here can be expressed as a fixed set of choices?',
    questionType,
    choices,
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
  const state = { project_request: message.slice(0, 600) }

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

// USD per 1M tokens for known models (OpenCode Go docs); unknown models fall back to token counts.
const PRICING = {
  'glm-5.3-flash': { in: 0.15, out: 0.5 },
  'mimo-v2.6-flash': { in: 0.14, out: 0.28 },
  'mimo-v2.6-pro': { in: 0.435, out: 0.87 },
  'mimo-v2.5': { in: 0.14, out: 0.28 },
  'mimo-v2.5-pro': { in: 0.435, out: 0.87 },
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

function normalizeWorkflowSide(raw, allowed) {
  if (!Array.isArray(raw)) return null
  const steps = raw
    .filter((step) => step && typeof step.label === 'string' && step.label.trim())
    .slice(0, 5)
    .map((step) => ({
      label: step.label.trim().slice(0, 140),
      who: allowed.includes(step.who) ? step.who : 'system',
      estMs: Math.round(clamp(Number(step.estMs) || 0, 0, 600000)),
      measured: false,
    }))
  return steps.length >= 3 ? steps : null
}

function fallbackWorkflowWithout() {
  return [
    { label: 'Receive raw request text', who: 'system', estMs: 1, measured: false },
    { label: 'Stuff context into one large prompt', who: 'system', estMs: 50, measured: false },
    { label: 'Full LLM call returns a prose answer', who: 'llm', estMs: 0, measured: false },
    { label: 'Read the answer, no calibration', who: 'system', estMs: 10, measured: false },
    { label: 'Human double-checks the output', who: 'human', estMs: 60000, measured: false },
  ]
}

function fallbackWorkflowWith() {
  return [
    { label: 'Build typed state from the request', who: 'system', estMs: 5, measured: false },
    { label: 'Jev gate answers the typed questions', who: 'jev', estMs: 0, measured: false },
    { label: 'Return typed answer from distribution', who: 'jev', estMs: 10, measured: false },
    { label: 'Escalate low-confidence cases to LLM', who: 'llm', estMs: 0, measured: false },
  ]
}

function markMeasured(steps, who, ms) {
  if (!steps || !Number.isFinite(ms)) return
  let target = -1
  let best = -1
  for (let i = 0; i < steps.length; i += 1) {
    if (steps[i].who === who && steps[i].estMs >= best) {
      best = steps[i].estMs
      target = i
    }
  }
  if (target >= 0) {
    steps[target].estMs = Math.round(ms)
    steps[target].measured = true
  }
}

function sanitizeProbabilities(raw) {
  const pick = (key) => {
    const value = Number(raw?.[key])
    return Number.isFinite(value) && value >= 0 ? value : 0
  }
  let probs = { strong: pick('strong'), promising: pick('promising'), poor: pick('poor') }
  const sum = probs.strong + probs.promising + probs.poor
  if (sum > 0) {
    probs = {
      strong: probs.strong / sum,
      promising: probs.promising / sum,
      poor: probs.poor / sum,
    }
  } else {
    probs = { strong: 1 / 3, promising: 1 / 3, poor: 1 / 3 }
  }
  return probs
}

function buildReport({ workflowRaw, llmMs, jevMs, usage, model, probabilities, llmConfidence, jevConfidence }) {
  const without = normalizeWorkflowSide(workflowRaw?.without, ['system', 'llm', 'human']) || fallbackWorkflowWithout()
  const withJev = normalizeWorkflowSide(workflowRaw?.with, ['system', 'jev', 'llm']) || fallbackWorkflowWith()

  markMeasured(without, 'llm', llmMs)
  markMeasured(withJev, 'jev', jevMs)
  markMeasured(withJev, 'llm', llmMs)

  const sumWhere = (steps, fn) => steps.filter(fn).reduce((total, step) => total + step.estMs, 0)
  const withoutMs = sumWhere(without, (step) => step.who !== 'human')
  const withFastMs = sumWhere(withJev, (step) => step.who !== 'llm')
  const withEscalateMs = sumWhere(withJev, (step) => step.who === 'llm')

  const probabilitiesClean = sanitizeProbabilities(probabilities)
  const topProb = Math.max(probabilitiesClean.strong, probabilitiesClean.promising, probabilitiesClean.poor)
  const escalateRate = clamp(1 - topProb, 0.05, 0.6)
  const blendedMs = Math.round(withFastMs + escalateRate * withEscalateMs)

  const tokens = usage
    ? { in: Math.round(Number(usage.prompt_tokens) || 0), out: Math.round(Number(usage.completion_tokens) || 0) }
    : null
  const rate = PRICING[model]
  let price
  if (rate && tokens) {
    const perCall = (tokens.in * rate.in) / 1e6 + (tokens.out * rate.out) / 1e6
    price = {
      known: true,
      model,
      tokens,
      per1kWithout: Math.round(perCall * 1000 * 10000) / 10000,
      per1kWith: Math.round(perCall * 1000 * escalateRate * 10000) / 10000,
    }
  } else {
    price = { known: false, tokens }
  }

  return {
    workflow: {
      without,
      with: withJev,
      totals: { withoutMs, withFastMs, withBlendedMs: blendedMs },
    },
    speed: {
      llmMs: Math.round(llmMs),
      jevMs: Math.round(jevMs),
      speedup: jevMs > 0 ? Math.round((llmMs / jevMs) * 10) / 10 : null,
      blendedMs,
    },
    price,
    coverage: {
      autoPct: Math.round((1 - escalateRate) * 100),
      escalatePct: Math.round(escalateRate * 100),
      topProb: Math.round(topProb * 100) / 100,
      escalateRate: Math.round(escalateRate * 100) / 100,
      probabilities: probabilitiesClean,
      llmConfidence: typeof llmConfidence === 'number' ? llmConfidence : null,
      jevConfidence: typeof jevConfidence === 'number' ? jevConfidence : null,
    },
  }
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

async function askLlm(message, config) {
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
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: message.slice(0, 4000) },
      ],
    }),
    signal: AbortSignal.timeout(LLM_TIMEOUT_MS),
  })

  if (!response.ok) throw new Error(`LLM returned HTTP ${response.status}`)
  const data = await response.json()
  const content = data?.choices?.[0]?.message?.content
  if (typeof content !== 'string') throw new Error('LLM returned no content')
  const raw = extractJson(content)
  return {
    card: normalizeCard(raw),
    usage: data?.usage && typeof data.usage === 'object' ? data.usage : null,
    workflow: raw?.workflow && typeof raw.workflow === 'object' ? raw.workflow : null,
  }
}

async function askJev(message, card, config) {
  const key = config.typesafeKey
  if (!key) return null
  const baseUrl = config.typesafeBaseUrl

  const body = {
    model: process.env.TYPESAFE_MODEL || 'jev-latest',
    state: JSON.stringify({
      project_request: message.slice(0, 1500),
      proposed_decision: card.decision,
      answer_space: card.choices,
    }),
    questions: {
      fit: {
        type: 'choice',
        criteria: {
          strong: 'Jev is a strong fit: bounded, frequent, latency-sensitive decision with clear ground truth',
          promising: 'Jev could help, but a general LLM must stay in the loop',
          poor: 'Jev is a poor fit: open-ended, long-horizon, or unbounded output',
        },
      },
      bounded: {
        type: 'noul',
        instructions: 'The answer space can be fully enumerated as choices, score levels, or a boolean.',
      },
      long_horizon: {
        type: 'noul',
        instructions: 'Success requires long-horizon multi-step planning or deep branching, where Jev is known to be weak.',
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
  const choice = data?.answers?.fit?.choice
  if (!choice) return null

  return {
    choice,
    bounded: Number(data?.answers?.bounded?.noul ?? 1),
    longHorizon: Number(data?.answers?.long_horizon?.noul ?? 0),
    confidence: Number(data?.answers?.fit?.confidence ?? 0) || null,
    probabilities: data?.answers?.fit?.probabilities || null,
  }
}

function applyJev(card, jev) {
  const labels = {
    strong: ['Strong fit', 'green'],
    promising: ['Promising fit', 'amber'],
    poor: ['Poor fit', 'red'],
  }
  let [fit, fitClass] = labels[jev.choice] || [card.fit, card.fitClass]

  if (jev.bounded < 0.4) {
    fit = 'Poor fit'
    fitClass = 'red'
  } else if (jev.longHorizon > 0.6 && fitClass === 'green') {
    fit = 'Promising fit'
    fitClass = 'amber'
  }

  return { ...card, fit, fitClass, confidence: jev.confidence ?? card.confidence }
}

function demoCard(message) {
  const card = { ...pickAdvice(message) }
  return { ...card, mode: 'demo', jevEvaluated: false }
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
    const llmStarted = Date.now()
    const result = await askLlm(message, config)
    const llmMs = Date.now() - llmStarted
    const card = result.card
    const llmConfidence = card.confidence

    let jevEvaluated = false
    let jevMs = 0
    let probabilities = null
    let jevConfidence = null

    try {
      const jevStarted = Date.now()
      const jev = await askJev(message, card, config)
      jevMs = Date.now() - jevStarted
      if (jev) {
        Object.assign(card, applyJev(card, jev))
        jevEvaluated = true
        probabilities = jev.probabilities
        jevConfidence = jev.confidence
      }
    } catch {
      // Jev evaluation is optional; the LLM card still stands.
    }

    const report = jevEvaluated
      ? buildReport({
          workflowRaw: result.workflow,
          llmMs,
          jevMs,
          usage: result.usage,
          model: config.llmModel,
          probabilities,
          llmConfidence,
          jevConfidence,
        })
      : null

    return json({
      ...card,
      mode: 'live',
      jevEvaluated,
      schema: typeSafeExample(card, message),
      ...(report ? { report } : {}),
    })
  } catch (error) {
    const timedOut = error?.name === 'TimeoutError' || error?.name === 'AbortError'
    const detail = timedOut
      ? `the LLM did not answer within ${LLM_TIMEOUT_MS / 1000}s — please try again`
      : error?.message || error
    return json({ error: `Advisor request failed: ${detail}` }, 502)
  }
}
