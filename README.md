# Jev Godfather

Jev Godfather is a focused advisor interface for turning a project idea into a
clear, bounded decision that Jev can handle.

Describe a project in plain language. The advisor returns whether Jev is a good
fit, the exact bounded decision to give Jev, suggested `choice` / `score` /
`noul` questions, implementation steps, and a ready-to-use TypeSafe request.

## Architecture

```text
Browser  →  POST /api/advice
              ├─ general LLM   (interprets the request, writes the explanation)
              └─ TypeSafe/Jev  (optional: evaluates fit as a typed decision)
```

API keys live only on the server. The browser never receives them.

- `LLM_API_KEY` unset → **demo mode**, local heuristic advice with a visible badge.
- LLM configured, `TYPESAFE_API_KEY` unset → live advice from the LLM only.
- Both configured → Jev evaluates fit and overrides the label, marked **Jev evaluated**.

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
  "summary": "…",
  "decision": "Which team should handle this ticket?",
  "questionType": "choice",
  "choices": ["billing", "technical", "sales", "account"],
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

- Whether Jev is a good fit
- The exact bounded decision to give Jev
- Suggested choices, scores, or yes/no questions
- Where Jev belongs in the architecture
- Confidence and escalation rules
- An example TypeSafe request

The general LLM should handle open-ended interpretation and explanations. Jev
should handle structured suitability and routing decisions.
