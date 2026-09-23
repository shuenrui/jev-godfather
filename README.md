# Jev Godfather

Jev Godfather is a focused advisor interface for turning a project idea into a
clear, bounded decision that Jev can handle.

Describe a project in plain language. The advisor proposes several materially
different decision boundaries, asks Jev which one is actually bounded,
observable, and repeated, then returns a sharp recommendation: what Jev owns,
what code or a generative model must own, the input state, a starting policy,
fallback behavior, missing evidence, and a ready-to-use TypeSafe request.

## Architecture

```text
Browser  →  POST /api/advice
              ├─ general LLM   (proposes 2–4 concrete decision boundaries)
              ├─ TypeSafe/Jev  (selects and tests the strongest boundary)
              └─ application   (applies fit, risk, and abstention policy)
```

API keys live only on the server. The browser never receives them.

- `LLM_API_KEY` unset → **demo mode**, local heuristic advice with a visible badge.
- LLM configured, `TYPESAFE_API_KEY` unset → live advice from the LLM only.
- Both configured → Jev selects among candidate boundaries and independently
  judges whether the selected boundary is bounded, observable, and repeated.

## Using your own keys

Open **Keys** in the header to paste your own tokens:

- LLM API key, base URL, and model
- TypeSafe / Jev API key (optional)

Keys are stored in this browser's `localStorage` only, sent as `x-*-api-key`
headers with your requests, and never written to disk by the app. Per-request
keys override the server's env defaults, so one deployment can serve many
people with their own tokens. User-supplied base URLs must be `https` (or
`http://localhost` for local testing).

## Run locally

```bash
cp .env.example .env   # add your keys
npm install
npm run dev
```

Open http://localhost:5173.

## Environment variables

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `LLM_API_KEY` | for live advice | — | OpenAI-compatible chat completions key |
| `LLM_BASE_URL` | no | `https://api.openai.com/v1` | Any OpenAI-compatible endpoint |
| `LLM_MODEL` | no | `gpt-4o-mini` | Model used to generate advice |
| `TYPESAFE_API_KEY` | no | — | Enables Jev fit evaluation |
| `TYPESAFE_MODEL` | no | `jev-latest` | TypeSafe model id |
| `TYPESAFE_BASE_URL` | no | `https://api.typesafe.ai/v1` | TypeSafe endpoint override |

## API

`POST /api/advice`

```json
{ "message": "I am building a support triage tool" }
```

Response:

```json
{
  "fit": "Strong fit",
  "fitClass": "green",
  "verdict": "Use Jev",
  "headline": "Use Jev to choose the owning support queue—not to write the reply.",
  "summary": "…",
  "decision": "Which team should handle this ticket?",
  "questionType": "choice",
  "choices": ["billing", "technical", "sales", "account"],
  "stateFields": ["subject", "message_body", "customer_plan"],
  "jevOwns": "Choose the owning queue and score explicit urgency.",
  "codeOwns": "Apply overrides, assign the queue, and record outcomes.",
  "avoid": "Do not ask Jev to compose the support reply.",
  "threshold": "Starting policy: validate a threshold on historical tickets.",
  "fallback": "Send uncertain or no-match cases to triage.",
  "successTest": "Measure first-route accuracy and reassignment rate.",
  "missingEvidence": ["Historical reassignment labels"],
  "steps": ["…"],
  "confidence": 0.91,
  "schema": { "model": "jev-latest", "state": { }, "questions": { } },
  "mode": "live",
  "jevEvaluated": true
}
```

Errors return `{ "error": "…" }` with a non-2xx status; the UI falls back to
local advice and shows the failure inline.

## Deploying

The handler is `adviceHandler(request) → Response` in `server/advice.js`. For
serverless hosts, wrap it as a function at `/api/advice` and set the same
environment variables. The Vite plugin only wires it into `dev` and `preview`.

## Product direction

The advisor should accept any plain-language project request and return:

- A decisive `use`, `use narrowly`, or `do not use yet` verdict
- The exact bounded decision and the observable state it requires
- Explicit ownership boundaries for Jev, code, and generative models
- A starting threshold policy, fallback, and success test
- Missing evidence that could change the recommendation
- The closest proven Jev patterns and an example TypeSafe request

The general LLM proposes candidate boundaries. Jev judges the candidates. The
application applies the policy. No model-generated latency, cost, accuracy, or
coverage estimate is presented as measured evidence.
