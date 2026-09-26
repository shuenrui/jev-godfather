import { useRef, useState } from 'react'
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
  if (advice.mode === 'live-compact') return 'Live response · compact recovery pass'
  if (advice.mode === 'degraded') return `Bounded fallback · ${advice.error || 'live advisor timed out'}`
  if (advice.mode === 'offline') return `Offline fallback · ${advice.error || 'advisor unreachable'}`
  const parts = []
  if (advice.jevEvaluated) parts.push('Jev evaluated')
  if (advice.decomposition?.status === 'applied' && advice.decomposition.steps?.length) parts.push(`screened ${advice.decomposition.steps.length} steps`)
  if (hasOwnKey) parts.push('your token')
  return parts.length ? parts.join(' · ') : null
}

async function readStageStream(body, onStage) {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let result = null
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    let newline
    while ((newline = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, newline).trim()
      buffer = buffer.slice(newline + 1)
      if (!line) continue
      let event = null
      try {
        event = JSON.parse(line)
      } catch {
        continue
      }
      if (event?.type === 'result') result = event
      else if (event?.type === 'stage') onStage(event)
    }
  }
  if (!result) throw new Error('advisor stream ended without a result')
  const { type: _type, ...payload } = result
  return payload
}

function stageLines(stages) {
  const lines = []
  for (const event of stages) {
    if (event.stage === 'screening') lines.push(`Seed boundary · ${event.decision}`)
    else if (event.stage === 'screened') lines.push(`Jev screened · ${event.verdict}`)
    else if (event.stage === 'decomposing') lines.push('Decomposing the workflow into steps…')
    else if (event.stage === 'steps') (event.steps || []).forEach((step, index) => lines.push(`${index + 1}. ${step}`))
    else if (event.stage === 'chosen') lines.push(event.chosenStepIndex == null ? 'Jev kept the seed boundary' : `Jev chose step ${event.chosenStepIndex + 1}`)
  }
  return lines
}

function fallbackComparison(advice) {
  return {
    withoutJev: {
      label: 'Without Jev',
      steps: ['General LLM interprets the request and picks a direction.', 'The policy stays implicit in the response.', 'A human or code path checks the result.'],
    },
    withJev: {
      label: 'With Jev',
      steps: ['Code assembles observable state and valid alternatives.', `Jev answers one bounded question: ${advice.decision}`, 'Code applies the threshold and verifies the outcome.'],
    },
    speed: {
      status: 'estimated',
      unit: 'relative time · without Jev = 100',
      bars: [{ label: 'Without Jev', value: 100, display: '1.0× baseline' }, { label: 'With Jev · accepted', value: 125, display: '~1.1–1.4×' }, { label: 'With Jev · rejected', value: 20, display: '~0.1–0.3×' }],
      note: 'Directional estimate; validate with paired runs.',
    },
    cost: {
      status: 'estimated',
      unit: 'relative cost · without Jev = 100',
      bars: [{ label: 'Without Jev', value: 100, display: '1.0× baseline' }, { label: 'With Jev · accepted', value: 115, display: '~1.0–1.3×' }, { label: 'With Jev · rejected', value: 15, display: '~0.1–0.2×' }],
      note: 'Directional estimate; provider pricing is not asserted.',
    },
    evidence: 'Workflow is architectural; speed and cost are directional estimates that should be calibrated with a paired benchmark.',
  }
}

function RecommendationDetails({ advice }) {
  if (!advice.jevOwns) return null

  return (
    <section className="recommendation-details" aria-label="Decision boundary">
      <div className="ownership-grid">
        <div className="ownership-card owns-jev">
          <span className="eyebrow">JEV OWNS</span>
          <p>{advice.jevOwns}</p>
        </div>
        <div className="ownership-card">
          <span className="eyebrow">CODE / LLM OWNS</span>
          <p>{advice.codeOwns}</p>
        </div>
      </div>

      <div className="boundary-row">
        <span className="eyebrow">INPUT STATE</span>
        <div className="choice-row">
          {(advice.stateFields || []).map((field) => <span key={field}>{field}</span>)}
        </div>
      </div>

      <div className="sharp-grid">
        <div>
          <span className="eyebrow">STARTING POLICY</span>
          <p>{advice.threshold}</p>
        </div>
        <div>
          <span className="eyebrow">FALLBACK</span>
          <p>{advice.fallback}</p>
        </div>
        <div>
          <span className="eyebrow">KEEP JEV OUT OF</span>
          <p>{advice.avoid}</p>
        </div>
        <div>
          <span className="eyebrow">PROVE IT WORKS</span>
          <p>{advice.successTest}</p>
        </div>
      </div>

      {advice.selectionBasis && <p className="selection-basis">Jev selection · {advice.selectionBasis}</p>}

      {(advice.missingEvidence?.length > 0 || advice.referencePatterns?.length > 0) && (
        <div className="evidence-grid">
          {advice.missingEvidence?.length > 0 && (
            <div>
              <span className="eyebrow">WHAT COULD CHANGE THIS</span>
              <ul>{advice.missingEvidence.map((item) => <li key={item}>{item}</li>)}</ul>
            </div>
          )}
          {advice.referencePatterns?.length > 0 && (
            <div>
              <span className="eyebrow">CLOSEST PROVEN PATTERNS</span>
              <ul>{advice.referencePatterns.map((item) => <li key={item}>{item}</li>)}</ul>
            </div>
          )}
        </div>
      )}
    </section>
  )
}

function ComparisonBars({ metric, title }) {
  const bars = metric.bars || []
  return (
    <div className="dis-block comparison-chart">
      <p className="dis-title">{title} · directional estimate</p>
      <div className="bar-chart" role="img" aria-label={`${title} comparison: directional estimate`}>
        {bars.map((bar) => (
          <div className="bar-row" key={bar.label}>
            <span className="bar-label">{bar.label}</span>
            <div className="bar-track"><span className="bar-fill" style={{ width: `${Math.min(bar.value || 0, 100)}%` }} /></div>
            <span className="bar-value">{bar.display}</span>
          </div>
        ))}
      </div>
      <p className="dis-fn">{metric.note}</p>
    </div>
  )
}

function ComparisonReport({ comparison }) {
  if (!comparison) return null

  return (
    <section className="disruption" aria-label="Without Jev versus with Jev">
      <span className="eyebrow">THE COMPARISON</span>
      <div className="dis-block">
        <p className="dis-title">Same decision, two paths</p>
      <div className="workflow" aria-label="Workflow timeline">
        {[comparison.withoutJev, comparison.withJev].map((path) => (
          <div className={`wf-track ${path.label === 'With Jev' ? 'with' : ''}`} key={path.label}>
            <div className="wf-track-head"><span className="wf-track-name">{path.label}</span><span className="wf-total">{path.label === 'With Jev' ? 'boundary path' : 'general path'}</span></div>
            <div className="wf-steps">
              {path.steps.map((step, index) => (
                <div className="wf-step" key={step}>
                  <span className="wf-num">{index + 1}</span>
                  <p className="wf-label">{step}</p>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
      <p className="dis-fn">workflow view · with Jev separates screening, execution, and verification</p>
      </div>

      <ComparisonBars metric={comparison.speed} title="Speed" />
      <ComparisonBars metric={comparison.cost} title="Cost" />

      <p className="dis-fn">{comparison.evidence}</p>
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
  const [stages, setStages] = useState([])
  const [keys, setKeys] = useState(loadKeys)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const activeRequest = useRef(null)
  const conversationGeneration = useRef(0)

  const hasOwnKey = Boolean(keys.llmKey)

  function persistKeys(next) {
    setKeys(next)
    saveKeys(next)
    setSettingsOpen(false)
  }

  function clearConversation() {
    conversationGeneration.current += 1
    activeRequest.current?.abort()
    activeRequest.current = null
    setInput('')
    setMessages([])
    setIsThinking(false)
    window.location.reload()
  }

  async function submit(text = input) {
    const trimmed = text.trim()
    if (!trimmed || isThinking) return
    const generation = conversationGeneration.current

    setInput('')
    setStages([])
    setMessages((current) => [...current, { role: 'user', text: trimmed }])
    setIsThinking(true)
    const controller = new AbortController()
    activeRequest.current = controller

    try {
      const response = await fetch('/api/advice', {
        method: 'POST',
        headers: buildHeaders(keys),
        body: JSON.stringify({ message: trimmed }),
        signal: controller.signal,
      })
      const contentType = response.headers.get('content-type') || ''
      let data = null
      if (response.ok && contentType.includes('x-ndjson') && response.body) {
        data = await readStageStream(response.body, (event) => {
          if (generation === conversationGeneration.current) setStages((current) => [...current, event])
        })
      } else {
        const text = await response.text()
        try {
          data = JSON.parse(text)
        } catch {
          // Gateway or proxy answered with non-JSON (e.g. plain-text 502).
        }
        if (!response.ok || data?.error) {
          const detail = data?.error || (text && text.length < 200 ? text.trim() : `HTTP ${response.status}`)
          throw new Error(detail)
        }
      }
      if (!data) throw new Error('advisor returned no result')

      if (generation !== conversationGeneration.current) return
      setMessages((current) => [...current, { role: 'assistant', text: trimmed, advice: data }])
    } catch (error) {
      if (error?.name === 'AbortError') return
      if (generation !== conversationGeneration.current) return
      setMessages((current) => [
        ...current,
        {
          role: 'assistant',
          text: trimmed,
          advice: { ...pickAdvice(trimmed), mode: 'offline', error: error?.message || 'request failed' },
        },
      ])
    } finally {
      if (activeRequest.current === controller) activeRequest.current = null
      setStages([])
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

        <button className="new-chat" type="button" onClick={clearConversation}>
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
          <button className="topbar-button" type="button" onClick={clearConversation}>Clear</button>
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
                      <div><span className="message-label">JEV GODFATHER</span><p className="response-lede">{message.advice.headline || 'Here’s where Jev fits.'}</p></div>
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
                    <ComparisonReport comparison={message.advice.comparison || fallbackComparison(message.advice)} />
                    <div className="decision-block">
                      <span className="eyebrow">THE DECISION · {message.advice.questionType || 'choice'}</span>
                      <p>{message.advice.decision}</p>
                      <div className="choice-row">{message.advice.choices.map((choice) => <span key={choice}>{choice}</span>)}</div>
                    </div>
                    <RecommendationDetails advice={message.advice} />
                    <div className="steps-block">
                      <span className="eyebrow">IMPLEMENTATION ORDER</span>
                      <ol>{message.advice.steps.map((step) => <li key={step}>{step}</li>)}</ol>
                    </div>
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
              {isThinking && (stages.length > 0 ? (
                <div className="stage-log" aria-live="polite" aria-label="Screening stages">
                  {stageLines(stages).map((line, index, arr) => (
                    <p key={`${line}-${index}`} className={index === arr.length - 1 ? 'stage current' : 'stage'}>
                      <span className="stage-icon">{index === arr.length - 1 ? '●' : '✓'}</span> {line}
                    </p>
                  ))}
                </div>
              ) : (
                <div className="thinking"><span /><span /><span /> Mapping the decision boundary</div>
              ))}
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
