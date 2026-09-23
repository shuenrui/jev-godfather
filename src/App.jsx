import { useState } from 'react'
import { pickAdvice, starters } from './adviceLibrary'
import './App.css'

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

function modeNote(advice) {
  if (advice.mode === 'demo') return 'Demo response · set LLM_API_KEY for live advice'
  if (advice.mode === 'offline') return `Offline fallback · ${advice.error || 'advisor unreachable'}`
  if (advice.jevEvaluated) return 'Jev evaluated'
  return null
}

function App() {
  const [input, setInput] = useState('')
  const [messages, setMessages] = useState([])
  const [isThinking, setIsThinking] = useState(false)

  async function submit(text = input) {
    const trimmed = text.trim()
    if (!trimmed || isThinking) return

    setInput('')
    setMessages((current) => [...current, { role: 'user', text: trimmed }])
    setIsThinking(true)

    try {
      const response = await fetch('/api/advice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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
          <span>Advisor mode</span>
          <span className="version">v0.2</span>
        </div>
      </aside>

      <main className="conversation">
        <header className="topbar">
          <div className="mobile-brand"><div className="brand-mark"><SparkIcon /></div><span>Jev Godfather</span></div>
          <div className="topbar-meta"><span className="live-dot" /> Advisor API <span className="slash">/</span> Jev patterns</div>
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
                    <div className="decision-block">
                      <span className="eyebrow">THE DECISION · {message.advice.questionType || 'choice'}</span>
                      <p>{message.advice.decision}</p>
                      <div className="choice-row">{message.advice.choices.map((choice) => <span key={choice}>{choice}</span>)}</div>
                    </div>
                    <div className="steps-block">
                      <span className="eyebrow">HOW TO USE IT</span>
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
                      {modeNote(message.advice) && <span className="mode-note">{modeNote(message.advice)}</span>}
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
    </div>
  )
}

export default App
