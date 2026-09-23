import { useState } from 'react'
import './App.css'

const starters = [
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
    choices: ['choice', 'score', 'noul'],
    steps: [
      'Name the state Jev should inspect and the finite answer space it should return.',
      'Keep a general LLM for open-ended reasoning, explanations, and unusual cases.',
      'Route low-confidence results to a stronger model or a human instead of forcing automation.',
    ],
  },
  support: {
    fit: 'Strong fit',
    fitClass: 'green',
    summary:
      'Use Jev as the first-pass router for repetitive support decisions. It can classify each ticket quickly, then reserve a full LLM for nuanced replies.',
    decision: 'Which team should handle this ticket?',
    choices: ['billing', 'technical', 'sales', 'account'],
    steps: [
      'Send the ticket text and recent customer context as the state.',
      'Ask Jev for department, urgency, and escalation as separate questions.',
      'Auto-route high-confidence results; send the middle band to review.',
    ],
  },
  safety: {
    fit: 'Strong fit',
    fitClass: 'green',
    summary:
      'Jev is useful as a fast safety gate before an agent executes a command. It should classify risk, not generate or rewrite the command.',
    decision: 'Is this command safe to execute automatically?',
    choices: ['safe', 'needs_review', 'destructive'],
    steps: [
      'Provide the command, working directory, and task context as the state.',
      'Block destructive decisions by default and show the user the exact command.',
      'Log the decision, confidence, and final human override for evaluation.',
    ],
  },
  routing: {
    fit: 'Strong fit',
    fitClass: 'green',
    summary:
      'Use Jev as a cheap complexity classifier before the request reaches a model. It can keep simple work on a fast model and escalate only when needed.',
    decision: 'What level of reasoning does this task need?',
    choices: ['fast', 'deep', 'research'],
    steps: [
      'Define what each reasoning tier means in observable terms.',
      'Start with conservative escalation thresholds while collecting outcomes.',
      'Measure routing accuracy against task success, not just model preference.',
    ],
  },
}

function pickAdvice(text) {
  const normalized = text.toLowerCase()
  if (normalized.includes('support') || normalized.includes('ticket')) return advice.support
  if (normalized.includes('safe') || normalized.includes('command') || normalized.includes('terminal')) return advice.safety
  if (normalized.includes('route') || normalized.includes('model')) return advice.routing
  return advice.default
}

function SparkIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="m12 2 1.7 7.1L21 11l-7.3 1.9L12 20l-1.7-7.1L3 11l7.3-1.9L12 2Z" />
      <path d="m19.5 16 .7 2.8L23 20l-2.8.7-.7 2.8-.7-2.8L16 20l2.8-1.2.7-2.8Z" />
    </svg>
  )
}

function ArrowIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5 12h13M13 6l6 6-6 6" />
    </svg>
  )
}

function App() {
  const [input, setInput] = useState('')
  const [messages, setMessages] = useState([])
  const [isThinking, setIsThinking] = useState(false)

  function submit(text = input) {
    const trimmed = text.trim()
    if (!trimmed || isThinking) return

    setInput('')
    setMessages((current) => [...current, { role: 'user', text: trimmed }])
    setIsThinking(true)

    window.setTimeout(() => {
      setMessages((current) => [
        ...current,
        { role: 'assistant', text: trimmed, advice: pickAdvice(trimmed) },
      ])
      setIsThinking(false)
    }, 650)
  }

  function handleKeyDown(event) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      submit()
    }
  }

  const hasConversation = messages.length > 0

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand-lockup">
          <div className="brand-mark"><SparkIcon /></div>
          <div>
            <p className="brand-name">Jev Godfather</p>
            <p className="brand-kicker">Decision architect</p>
          </div>
        </div>

        <button className="new-chat" type="button" onClick={() => setMessages([])}>
          <span>+</span> New conversation
        </button>

        <div className="sidebar-note">
          <span className="eyebrow">THE HOUSE RULE</span>
          <p>Bring the messy project. Leave with the decision boundary.</p>
        </div>

        <div className="sidebar-footer">
          <span className="status-dot" />
          <span>Advisor mode</span>
          <span className="version">v0.1</span>
        </div>
      </aside>

      <main className="conversation">
        <header className="topbar">
          <div className="mobile-brand"><div className="brand-mark"><SparkIcon /></div><span>Jev Godfather</span></div>
          <div className="topbar-meta"><span className="live-dot" /> Local prototype <span className="slash">/</span> Jev patterns</div>
          <button className="topbar-button" type="button" onClick={() => setMessages([])}>Clear</button>
        </header>

        <section className={`chat-stage ${hasConversation ? 'has-conversation' : ''}`}>
          {!hasConversation ? (
            <div className="welcome">
              <div className="welcome-seal"><SparkIcon /></div>
              <p className="eyebrow">THE JEV ADVISOR</p>
              <h1>Tell me what you&apos;re building.<br /><em>I&apos;ll find the decision.</em></h1>
              <p className="welcome-copy">Describe your product, workflow, or problem in plain language. No prompt engineering. No need to ask whether Jev belongs.</p>
              <div className="starter-list">
                {starters.map((starter) => (
                  <button key={starter} type="button" onClick={() => submit(starter)}>
                    <span>{starter}</span><ArrowIcon />
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="message-list" aria-live="polite">
              {messages.map((message, index) => (
                message.role === 'user' ? (
                  <div className="message user-message" key={`${message.text}-${index}`}>
                    <span className="message-label">YOU</span>
                    <p>{message.text}</p>
                  </div>
                ) : (
                  <article className="advisor-card" key={`${message.text}-${index}`}>
                    <div className="advisor-heading">
                      <div className="advisor-avatar"><SparkIcon /></div>
                      <div><span className="message-label">JEV GODFATHER</span><p className="response-lede">Here&apos;s where Jev fits.</p></div>
                    </div>
                    <div className="fit-row"><span className={`fit-pill ${message.advice.fitClass}`}><span />{message.advice.fit}</span><span className="confidence">Pattern match · 0.91</span></div>
                    <p className="summary">{message.advice.summary}</p>
                    <div className="decision-block"><span className="eyebrow">THE DECISION</span><p>{message.advice.decision}</p><div className="choice-row">{message.advice.choices.map((choice) => <span key={choice}>{choice}</span>)}</div></div>
                    <div className="steps-block"><span className="eyebrow">HOW TO USE IT</span><ol>{message.advice.steps.map((step) => <li key={step}>{step}</li>)}</ol></div>
                    <button className="continue-button" type="button" onClick={() => setInput('Show me the TypeSafe request schema for this.')}>Continue with implementation <ArrowIcon /></button>
                  </article>
                )
              ))}
              {isThinking && <div className="thinking"><span /><span /><span /> Mapping the decision boundary</div>}
            </div>
          )}
        </section>

        <form className="composer-wrap" onSubmit={(event) => { event.preventDefault(); submit() }}>
          <div className="composer">
            <textarea value={input} onChange={(event) => setInput(event.target.value)} onKeyDown={handleKeyDown} placeholder="Describe what you&apos;re building..." rows="1" aria-label="Describe what you are building" />
            <button className="send-button" type="submit" aria-label="Send request" disabled={!input.trim() || isThinking}><ArrowIcon /></button>
          </div>
          <p className="composer-hint">Jev is strongest when the answer space is bounded. <span>Shift + Enter</span> for a new line.</p>
        </form>
      </main>
    </div>
  )
}

export default App
