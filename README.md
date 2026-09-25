# Jev Godfather

Jev Godfather is a web advisor that turns a messy project description into one
narrow, bounded, testable decision that Jev can own. It does not let Jev design
products, write arbitrary prose, execute actions, or replace a general LLM — it
decides whether a project has a useful place for Jev at all.

Live site: <https://jev-godfather.innstance.app>
(`https://jev-godfather.fly.dev` now redirects here.)

## Architecture

The core rule: **Jev screens first, the LLM explains next.** If Jev rejects a
boundary, the LLM is not allowed to reverse that verdict into a Jev
recommendation.

```text
User request
    ↓
Local pattern seed          src/adviceLibrary.js → seedCard()
    ↓
Jev screening               TypeSafe /systemone judges the seeded boundary
    ↓                         (bounded? observable? repeated? high-consequence?)
LLM explanation             constrained by the screening; cannot reverse it
    ↓
Application policy          server/advice.js enforces verdicts and deadlines
    ↓
Rendered recommendation     React advisor card
```

Previously the flow was LLM-first (the LLM invented candidate boundaries and
Jev evaluated them). That inverted the ownership model — a generative model was
choosing what Jev should judge. The current flow seeds the boundary
deterministically, screens it with Jev, and only then pays the LLM to explain
implementation details.

`POST /api/advice` in `server/advice.js`:

1. Build a local seed card from the matching pattern (support triage, command
   safety, model routing, frontend design pipelines, or a default).
2. If a TypeSafe key is configured, screen the seed with Jev under a 2s
   deadline. Jev answers typed questions: is the boundary bounded, observable,
   repeated, and is a wrong auto-decision high-consequence.
3. If screening succeeds, ask the LLM (6s deadline) to explain around that
   exact boundary, with an instruction that the screening is authoritative.
4. If there is no screen (no key, or Jev timed out), ask the LLM normally (10s
   deadline); on timeout, try a compact recovery pass (5s deadline).
5. Apply policy, generate comparison data and a TypeSafe request example, and
   return JSON. Every provider call is wrapped in a hard promise-level deadline
   so a slow provider becomes a labelled bounded response, never a browser-level
   timeout.

## Response modes

| `mode` | Meaning |
| --- | --- |
| `live` | LLM answered, optionally after Jev screening (`screening: "jev-first"` or `"llm-only"`) |
| `live-compact` | Main LLM call timed out; the smaller recovery prompt succeeded |
| `jev-screened` | Jev produced a valid screen but the LLM follow-up missed its window; the Jev-screened recommendation is returned without waiting |
| `jev-screened-demo` | No LLM key; Jev screened the local seed |
| `degraded` | Live paths failed; a bounded local pattern is returned (still carrying the Jev verdict if a screen existed) |
| `demo` | No LLM or TypeSafe key; local patterns only |
| `offline` | Client-side only: the browser could not reach the API, so it renders a local fallback card |

The configured provider is reachable but often slow for full generations, which
is why the short `jev-screened` path exists.

## What Jev owns

Jev is a System One typed-decision model: it answers bounded choice/score/noul
questions over observable state. In this product it owns judgments such as:

- Is this decision bounded? Is the required state observable?
- Does the decision repeat often enough to deserve a dedicated layer?
- Should Jev be used, used narrowly, or not used yet?

Jev does **not** own: open-ended interpretation, UI or CSS, workflow
generation, command execution, permissions, verification, final human approval,
or prose. The card makes this explicit with `JEV OWNS`, `CODE / LLM OWNS`,
`INPUT STATE`, `STARTING POLICY`, `FALLBACK`, `KEEP JEV OUT OF`, and
`PROVE IT WORKS` sections.

## API

```text
POST /api/advice     { "message": "I am building a support triage tool" }
GET  /healthz        { "ok": true }
```

A successful response includes (among other fields):

```json
{
  "fit": "Strong fit",
  "fitClass": "green",
  "verdict": "Use Jev",
  "headline": "…",
  "decision": "…",
  "questionType": "choice",
  "choices": ["…"],
  "stateFields": ["…"],
  "jevOwns": "…",
  "codeOwns": "…",
  "avoid": "…",
  "threshold": "…",
  "fallback": "…",
  "successTest": "…",
  "missingEvidence": [],
  "referencePatterns": [],
  "steps": [],
  "schema": { "model": "jev-latest", "state": {}, "questions": {} },
  "comparison": {},
  "mode": "jev-screened",
  "screening": "jev-first",
  "jevEvaluated": true
}
```

Errors return `{ "error": "…" }` with a non-2xx status; the UI falls back to
local advice and shows the failure inline.

## Comparison estimates — read this

Each card includes a workflow comparison (architectural, and accurate as
described) plus speed and cost bars:

```text
Without Jev              1.0×
With Jev · accepted      ~1.1–1.4× time   ~1.0–1.3× cost
With Jev · rejected      ~0.1–0.3× time   ~0.1–0.2× cost
```

These are **directional estimates, not measured benchmarks**. The assumptions:
accepted cases pay for a Jev call plus the LLM; rejected cases can stop before
the LLM; the LLM request dominates cost; exact provider pricing is not
asserted. They should be replaced with measured numbers from the paired
benchmark harness (`npm run bench`) once labelled scenario data exists.

## Using your own keys

The server reads environment keys; the browser **Keys** panel also accepts:

- LLM API key, base URL, and model
- TypeSafe / Jev API key

Browser keys live in `localStorage` only and are sent as `x-llm-api-key`,
`x-llm-base-url`, `x-llm-model`, `x-typesafe-api-key` headers with each request.
They are never written to disk by the app. Per-request keys override server env
defaults, so one deployment can serve many people with their own tokens.
User-supplied base URLs must be `https` (`http://localhost` is allowed for
local testing).

## Run locally

```bash
cp .env.example .env   # add your keys
npm install
npm run dev            # Vite + API middleware
npm run build && node server/index.js   # production server (:8080)
```

## Environment variables

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `LLM_API_KEY` | for live advice | — | OpenAI-compatible chat completions key |
| `LLM_BASE_URL` | no | `https://api.openai.com/v1` | Any OpenAI-compatible endpoint |
| `LLM_MODEL` | no | `gpt-4o-mini` | Model used to generate advice |
| `TYPESAFE_API_KEY` | no | — | Enables Jev screening; without it the flow degrades to LLM-only |
| `TYPESAFE_MODEL` | no | `jev-latest` | TypeSafe model id |
| `TYPESAFE_BASE_URL` | no | `https://api.typesafe.ai/v1` | TypeSafe endpoint override |

## Deployment

Target: ifhost / Innstance, app `jev-godfather`, public URL
<https://jev-godfather.innstance.app> (the legacy `…fly.dev` hostname
308-redirects to it). `deploy.sh` uploads `dist/`, `server/`,
`src/adviceLibrary.js`, and `package.json`; the live process runs
`node server/index.js`. The handler is also wired into `vite dev`/`preview` by
`vite.config.js`, so it can be wrapped for any host that accepts a
`Request → Response` function at `/api/advice`.

The deploy warning “`.ifhost-state-paths` is empty or missing” is expected: the
app is intentionally stateless. Add an explicit `.ifhost-state-paths` file only
if runtime persistence is introduced.

## Benchmark harness

`eval/run-benchmark.js` runs every labelled scenario in `eval/scenarios.json`
through `adviceHandler` twice — once Jev-first, once LLM-only (TypeSafe key
suppressed) — and reports paired wall latency, provider-call counts, token
usage, verdict accuracy, false-Jev rate, and over-reject rate. Degraded/demo
runs are excluded from quality scoring but counted in mode statistics.

```bash
LLM_API_KEY=... TYPESAFE_API_KEY=... npm run bench            # all scenarios
npm run bench -- --filter support-triage --repeats 3          # subset
npm run bench -- --out eval/results/latest.json
```

Provider calls are measured via fetch instrumentation at the harness level; the
server code is unchanged. Results are written to `eval/results/` (gitignored).
Add scenarios by appending labelled entries to `eval/scenarios.json`
(`expect` + `acceptable` buckets: `use` / `narrow` / `avoid`).

## Current status and known gaps

Deployed, functional, Jev-first, and fallback-protected. Open items:

1. The benchmark harness exists but has not yet been run against real
   providers at scale — no measured speed/cost data to replace the directional
   estimates yet.
2. The labelled dataset is small (12 scenarios); screening accuracy and
   rejection quality need more labelled cases to be meaningful.
3. Provider latency is often high enough that the LLM follow-up falls back to
   the Jev-screened result.
4. Speed/cost charts on the site are still directional estimates (see above).
5. Browser-level interaction testing is still manual.
