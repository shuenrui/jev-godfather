import { useState } from 'react'
import { pickAdvice, starters } from './adviceLibrary'
import './App.css'

const STORAGE_KEY = 'jev-godfather-keys'

function loadKeys() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : {}
  } catch {
    return {}
  }
}

function saveKeys(keys) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(keys))
  } catch {
    // Private browsing: keys stay in memory for this tab only.
  }
}

function buildHeaders(keys) {
  const headers = { 'Content-Type': 'application/json' }
  if (keys.llmKey) headers['x-llm-api-key'] = keys.llmKey
  if (keys.llmBaseUrl) headers['x-llm-base-url'] = keys.llmBaseUrl
  if (keys.llmModel) headers['x-llm-model'] = keys.llmModel
  if (keys.typesafeKey) headers['x-typesafe-api-key'] = keys.typesafeKey
  return headers
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

function KeyIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="8" cy="12" r="4" />
      <path d="M12 12h9M17 12v4M20 12v3" />
    </svg>
  )
}

function modeNote(advice, hasOwnKey) {
  if (advice.mode === 'demo') return 'Demo response · add your LLM key in Keys'
  if (advice.mode === 'offline') return `Offline fallback · ${advice.error || 'advisor unreachable'}`
  const parts = []
  if (advice.jevEvaluated) parts.push('Jev evaluated')
  if (hasOwnKey) parts.push('your token')
  return parts.length ? parts.join(' · ') : null
}

function formatMs(ms) {
  if (!Number.isFinite(ms)) return '—'
  if (ms < 1000) return `${Math.round(ms)}ms`
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`
  return `${(ms / 60000).toFixed(1)}m`
}

function formatUsd(value) {
  if (!Number.isFinite(value)) return '—'
  if (value >= 10) return `$${value.toFixed(0)}`
  if (value >= 0.01) return `$${value.toFixed(2)}`
  return `$${value.toFixed(4)}`
}

function WhoBadge({ who }) {
  return <span className={`who who-${who}`}>{who}</span>
}

function WorkflowTrack({ label, steps, variant, totalNote, lastBranches }) {
  return (
    <div className={`wf-track ${variant || ''}`}>
      <div className="wf-track-head">
        <span className="wf-track-name">{label}</span>
        <span className="wf-total">{totalNote}</span>
      </div>
      {steps.map((step, index) => (
        <div
          className={`wf-step ${lastBranches && step.who === 'llm' ? 'escalate' : ''}`}
          key={`${label}-${step.label}-${index}`}
        >
          <span className="wf-num">{index + 1}</span>
          <div className="wf-body">
            <span className="wf-label">{step.label}</span>
            <div className="wf-meta">
              <WhoBadge who={step.who} />
              <span className={`wf-time ${step.measured ? 'measured' : ''}`}>
                {formatMs(step.estMs)}{step.measured ? ' · measured' : ' · est.'}
              </span>
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}

function DisruptionReport({ report }) {
  const { workflow, speed, price, coverage } = report
  const withoutSteps = workflow.without
  const withSteps = workflow.with
  const withHasEscalate = withSteps.some((step) => step.who === 'llm')

  const speedMax = Math.max(speed.llmMs, speed.jevMs, 1)
  const jevBarPct = Math.max((speed.jevMs / speedMax) * 100, 4)
  const priceMax = price.known ? Math.max(price.per1kWithout, price.per1kWith, 0.0001) : 1
  const withPricePct = price.known ? Math.max((price.per1kWith / priceMax) * 100, 4) : 0

  return (
    <section className="disruption" aria-label="Disruption report">
      <span className="eyebrow">The disruption</span>

      <div className="dis-block">
        <p className="dis-title">Same decision, two paths</p>
        <div className="workflow">
          <WorkflowTrack
            label="Without Jev"
            steps={withoutSteps}
            totalNote={`${formatMs(workflow.totals.withoutMs)} machine`}
          />
          <WorkflowTrack
            label="With Jev"
            steps={withSteps}
            variant="with"
            totalNote={`${formatMs(workflow.totals.withFastMs)} fast`}
            lastBranches={withHasEscalate}
          />
        </div>
        <p className="dis-fn">
          human review excluded from totals · with Jev, including escalations, ~{formatMs(workflow.totals.withBlendedMs)} expected
        </p>
      </div>

      <div className="dis-block">
        <p className="dis-title">Speed · measured on this request</p>
        <div className="bar-row">
          <span className="bar-label">Full LLM</span>
          <div className="bar-track" aria-hidden="true"><div className="bar-fill muted" style={{ width: '100%' }} /></div>
          <span className="bar-value">{formatMs(speed.llmMs)} · measured</span>
        </div>
        <div className="bar-row">
          <span className="bar-label">Jev gate</span>
          <div className="bar-track" aria-hidden="true"><div className="bar-fill accent" style={{ width: `${jevBarPct}%` }} /></div>
          <span className="bar-value">
            {formatMs(speed.jevMs)}{speed.speedup ? ` · ${speed.speedup}× faster` : ''}
          </span>
        </div>
      </div>

      <div className="dis-block">
        <p className="dis-title">Price · LLM spend per 1,000 decisions</p>
        {price.known ? (
          <>
            <div className="bar-row">
              <span className="bar-label">Without Jev</span>
              <div className="bar-track" aria-hidden="true"><div className="bar-fill muted" style={{ width: '100%' }} /></div>
              <span className="bar-value">{formatUsd(price.per1kWithout)} / 1k</span>
            </div>
            <div className="bar-row">
              <span className="bar-label">With Jev</span>
              <div className="bar-track" aria-hidden="true"><div className="bar-fill accent" style={{ width: `${withPricePct}%` }} /></div>
              <span className="bar-value">{formatUsd(price.per1kWith)} / 1k</span>
            </div>
            <p className="dis-fn">
              {formatUsd(price.per1kWithout * 1000)} / 1,000 → {formatUsd(price.per1kWith * 1000)} · with Jev assumes {coverage.escalatePct}% escalate to the LLM · {price.model}
            </p>
          </>
        ) : (
          <p className="dis-fn">
            {price.tokens
              ? `usage this call · ${price.tokens.in} in / ${price.tokens.out} out tokens · pricing unknown for this model`
              : 'no usage data returned for this call'}
          </p>
        )}
      </div>

      <div className="dis-block">
        <p className="dis-title">Accuracy · where decisions land</p>
        <div
          className="stacked"
          role="img"
          aria-label={`${coverage.autoPct} percent auto-decide, ${coverage.escalatePct} percent escalate`}
        >
          <div className="stack-auto" style={{ width: `${coverage.autoPct}%` }} />
          <div className="stack-esc" style={{ width: `${coverage.escalatePct}%` }} />
        </div>
        <div className="stacked-legend">
          <span><span className="legend-dot dot-gold" />auto-decide {coverage.autoPct}%</span>
          <span><span className="legend-dot dot-red" />escalate {coverage.escalatePct}% → LLM / human</span>
        </div>
        <p className="calib">
          self-reported {coverage.llmConfidence != null ? coverage.llmConfidence.toFixed(2) : '—'}
          <span className="arrow"> → </span>
          calibrated {coverage.jevConfidence != null ? coverage.jevConfidence.toFixed(2) : '—'}
        </p>
        <p className="dis-fn">escalation share estimated from Jev&apos;s fit distribution (top choice {coverage.topProb})</p>
      </div>
    </section>
  )
}

function SettingsPanel({ keys, onSave, onClose }) {
  const [draft, setDraft] = useState(keys)

  function update(field, value) {
    setDraft((current) => ({ ...current, [field]: value }))
  }

  function submit(event) {
    event.preventDefault()
    const cleaned = {}
    for (const [field, value] of Object.entries(draft)) {
      const trimmed = String(value || '').trim()
      if (trimmed) cleaned[field] = trimmed
    }
    onSave(cleaned)
  }

  return (
    <div
      className="settings-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') onClose()
      }}
    >
      <form className="settings-panel" onSubmit={submit} role="dialog" aria-modal="true" aria-labelledby="keys-title">
        <div className="settings-head">
          <div className="brand-mark"><KeyIcon /></div>
          <div>
            <p id="keys-title" className="settings-title">Your API keys</p>
            <p className="settings-sub">Used for your requests only.</p>
          </div>
          <button className="settings-close" type="button" onClick={onClose} aria-label="Close keys panel">×</button>
        </div>

        <label className="settings-field">
          <span>LLM API key</span>
          <input type="password" autoComplete="off" spellCheck="false" placeholder="sk-…" value={draft.llmKey || ''} onChange={(event) => update('llmKey', event.target.value)} autoFocus />
        </label>

        <div className="settings-grid">
          <label className="settings-field">
            <span>LLM base URL</span>
            <input type="text" autoComplete="off" spellCheck="false" placeholder="https://api.openai.com/v1" value={draft.llmBaseUrl || ''} onChange={(event) => update('llmBaseUrl', event.target.value)} />
          </label>
          <label className="settings-field">
            <span>Model</span>
            <input type="text" autoComplete="off" spellCheck="false" placeholder="gpt-4o-mini" value={draft.llmModel || ''} onChange={(event) => update('llmModel', event.target.value)} />
          </label>
        </div>

        <label className="settings-field">
          <span>TypeSafe / Jev API key <em>optional · enables Jev evaluation</em></span>
          <input type="password" autoComplete="off" spellCheck="false" placeholder="tsk_…" value={draft.typesafeKey || ''} onChange={(event) => update('typesafeKey', event.target.value)} />
        </label>

        <p className="settings-note">
          Keys are saved in this browser&apos;s local storage and sent as headers with your requests.
          They are never written to disk by this app. Base URLs must be https or localhost.
        </p>

        <div className="settings-actions">
          <button className="settings-clear" type="button" onClick={() => onSave({})}>Clear all</button>
          <button className="settings-save" type="submit">Save keys</button>
        </div>
      </form>
    </div>
  )
}

function App() {
  const [input, setInput] = useState('')
  const [messages, setMessages] = useState([])
  const [isThinking, setIsThinking] = useState(false)
  const [keys, setKeys] = useState(loadKeys)
  const [settingsOpen, setSettingsOpen] = useState(false)

  const hasOwnKey = Boolean(keys.llmKey)

  function persistKeys(next) {
    setKeys(next)
    saveKeys(next)
    setSettingsOpen(false)
  }

  async function submit(text = input) {
    const trimmed = text.trim()
    if (!trimmed || isThinking) return

    setInput('')
    setMessages((current) => [...current, { role: 'user', text: trimmed }])
    setIsThinking(true)

    try {
      const response = await fetch('/api/advice', {
        method: 'POST',
        headers: buildHeaders(keys),
        body: JSON.stringify({ message: trimmed }),
      })
      const data = await response.json()
      if (!response.ok || data.error) throw new Error(data.error || `HTTP ${response.status}`)

      setMessages((current) => [...current, { role: 'assistant', text: trimmed, advice: data }])
    } catch (error) {
      setMessages((current) => [
        ...current,
        {
          role: 'assistant',
          text: trimmed,
          advice: { ...pickAdvice(trimmed), mode: 'offline', error: error?.message || 'request failed' },
        },
      ])
    } finally {
      setIsThinking(false)
    }
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
          <span>{hasOwnKey ? 'Own token active' : 'Advisor mode'}</span>
          <span className="version">v0.3</span>
        </div>
      </aside>

      <main className="conversation">
        <header className="topbar">
          <div className="mobile-brand"><div className="brand-mark"><SparkIcon /></div><span>Jev Godfather</span></div>
          <div className="topbar-meta"><span className="live-dot" /> Advisor API <span className="slash">/</span> Jev patterns</div>
          <button className={`keys-button ${hasOwnKey ? 'has-keys' : ''}`} type="button" onClick={() => setSettingsOpen(true)}>
            <KeyIcon /> Keys
          </button>
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
                    <div className="fit-row">
                      <span className={`fit-pill ${message.advice.fitClass}`}><span />{message.advice.fit}</span>
                      <span className="confidence">
                        {message.advice.confidence != null
                          ? `Confidence · ${Number(message.advice.confidence).toFixed(2)}`
                          : 'Pattern match'}
                      </span>
                    </div>
                    <p className="summary">{message.advice.summary}</p>
                    {message.advice.report && <DisruptionReport report={message.advice.report} />}
                    <div className="decision-block">
                      <span className="eyebrow">THE DECISION · {message.advice.questionType || 'choice'}</span>
                      <p>{message.advice.decision}</p>
                      <div className="choice-row">{message.advice.choices.map((choice) => <span key={choice}>{choice}</span>)}</div>
                    </div>
                    {!message.advice.report && (
                      <div className="steps-block">
                        <span className="eyebrow">HOW TO USE IT</span>
                        <ol>{message.advice.steps.map((step) => <li key={step}>{step}</li>)}</ol>
                      </div>
                    )}
                    {message.advice.schema && (
                      <details className="schema-details">
                        <summary>View TypeSafe request</summary>
                        <pre>{JSON.stringify(message.advice.schema, null, 2)}</pre>
                      </details>
                    )}
                    <div className="card-foot">
                      <button className="continue-button" type="button" onClick={() => setInput('Show me the TypeSafe request schema for this.')}>Continue with implementation <ArrowIcon /></button>
                      {modeNote(message.advice, hasOwnKey) && <span className="mode-note">{modeNote(message.advice, hasOwnKey)}</span>}
                    </div>
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

      {settingsOpen && <SettingsPanel keys={keys} onSave={persistKeys} onClose={() => setSettingsOpen(false)} />}
    </div>
  )
}

export default App
