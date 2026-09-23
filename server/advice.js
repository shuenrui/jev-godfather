import { pickAdvice } from '../src/adviceLibrary.js'

const LLM_TIMEOUT_MS = 30000
const JEV_TIMEOUT_MS = 10000

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
  "summary": string (2-3 sentences explaining where Jev fits or why it does not),
  "decision": string (the exact bounded decision to give Jev, phrased as a question),
  "questionType": "choice" | "score" | "noul",
  "choices": string[] (2-6 finite options; for noul return ["true","false"]; for score return ordered low to high levels),
  "steps": string[] (2-4 concrete implementation steps),
  "confidence": number between 0 and 1
}
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

async function askLlm(message) {
  const key = process.env.LLM_API_KEY
  const baseUrl = (process.env.LLM_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '')
  const model = process.env.LLM_MODEL || 'gpt-4o-mini'

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
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
  return normalizeCard(extractJson(content))
}

async function askJev(message, card) {
  const key = process.env.TYPESAFE_API_KEY
  if (!key) return null
  const baseUrl = (process.env.TYPESAFE_BASE_URL || 'https://api.typesafe.ai/v1').replace(/\/$/, '')

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

  if (!process.env.LLM_API_KEY) {
    const card = demoCard(message)
    return json({ ...card, schema: typeSafeExample(card, message) })
  }

  try {
    const card = await askLlm(message)
    let jevEvaluated = false

    try {
      const jev = await askJev(message, card)
      if (jev) {
        Object.assign(card, applyJev(card, jev))
        jevEvaluated = true
      }
    } catch {
      // Jev evaluation is optional; the LLM card still stands.
    }

    return json({
      ...card,
      mode: 'live',
      jevEvaluated,
      schema: typeSafeExample(card, message),
    })
  } catch (error) {
    return json({ error: `Advisor request failed: ${error?.message || error}` }, 502)
  }
}
