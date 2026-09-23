export const starters = [
  'I am building a support triage tool',
  'I want to make my coding agent safer',
  'I need to route tasks to different models',
]

const advice = {
  default: {
    fit: 'Promising fit',
    fitClass: 'amber',
    summary:
      'Jev may belong at the decision boundary here. The next move is to turn the fuzzy part of this request into a small set of choices, scores, or yes/no judgments.',
    decision: 'What decision repeats often enough to deserve its own fast, typed layer?',
    questionType: 'choice',
    choices: ['route', 'review', 'skip'],
    steps: [
      'Name the state Jev should inspect and the finite answer space it should return.',
      'Keep a general LLM for open-ended reasoning, explanations, and unusual cases.',
      'Route low-confidence results to a stronger model or a human instead of forcing automation.',
    ],
    confidence: 0.72,
  },
  support: {
    fit: 'Strong fit',
    fitClass: 'green',
    summary:
      'Use Jev as the first-pass router for repetitive support decisions. It can classify each ticket quickly, then reserve a full LLM for nuanced replies.',
    decision: 'Which team should handle this ticket?',
    questionType: 'choice',
    choices: ['billing', 'technical', 'sales', 'account'],
    steps: [
      'Send the ticket text and recent customer context as the state.',
      'Ask Jev for department, urgency, and escalation as separate questions.',
      'Auto-route high-confidence results; send the middle band to review.',
    ],
    confidence: 0.91,
  },
  safety: {
    fit: 'Strong fit',
    fitClass: 'green',
    summary:
      'Jev is useful as a fast safety gate before an agent executes a command. It should classify risk, not generate or rewrite the command.',
    decision: 'Is this command safe to execute automatically?',
    questionType: 'choice',
    choices: ['safe', 'needs_review', 'destructive'],
    steps: [
      'Provide the command, working directory, and task context as the state.',
      'Block destructive decisions by default and show the user the exact command.',
      'Log the decision, confidence, and final human override for evaluation.',
    ],
    confidence: 0.89,
  },
  routing: {
    fit: 'Strong fit',
    fitClass: 'green',
    summary:
      'Use Jev as a cheap complexity classifier before the request reaches a model. It can keep simple work on a fast model and escalate only when needed.',
    decision: 'What level of reasoning does this task need?',
    questionType: 'choice',
    choices: ['fast', 'deep', 'research'],
    steps: [
      'Define what each reasoning tier means in observable terms.',
      'Start with conservative escalation thresholds while collecting outcomes.',
      'Measure routing accuracy against task success, not just model preference.',
    ],
    confidence: 0.88,
  },
}

export function pickAdvice(text) {
  const normalized = String(text || '').toLowerCase()
  if (normalized.includes('support') || normalized.includes('ticket')) return advice.support
  if (normalized.includes('safe') || normalized.includes('command') || normalized.includes('terminal'))
    return advice.safety
  if (normalized.includes('route') || normalized.includes('model')) return advice.routing
  return advice.default
}
