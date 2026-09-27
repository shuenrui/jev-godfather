# Jev Godfather

Jev Godfather is a web advisor that turns a messy project description into one
narrow, bounded, testable decision that Jev can own. It does not let Jev design
products, write arbitrary prose, execute actions, or replace a general LLM — it
decides whether a project has a useful place for Jev at all.

Live site: <https://jev-godfather.innstance.app>
(`https://jev-godfather.fly.dev` now redirects here.)

## Architecture

The core rule: **every verdict is tailored.** The AI breaks *your* described
workflow into concrete steps; Jev screens those steps; code turns the scores
into a verdict. No hand-written pattern takes a vote on your request while the
providers are available — a rejection means Jev rejected the actual steps of
your pipeline, not a generic placeholder.

```text
User request
    ↓
LLM step decomposition        compact call: 5–7 operational steps of YOUR
    ↓                           pipeline, in your own vocabulary — structure
    ↓                           only, no fit verdict
Jev screening                 TypeSafe /systemone scores every step
    ↓                           (bounded? observable? repeated? high-consequence?)
Application policy            server/advice.js maps scores to verdicts;
    ↓                           all-steps-rejected = honest "Do not use Jev yet"
LLM explanation               constrained by the screen; cannot reverse it
    ↓
Rendered recommendation       stage events stream live, then collapse into
                              the single React advisor card
```

Earlier designs are retired: LLM-first (the generative model chose what Jev
judged) and seed-first (hand-written keyword patterns were screened and could
override your specifics). Both generalized your request before judgment. The
current flow keeps LLM creativity in the one safe place — naming candidate
*steps from your description* — while the fit decision stays entirely with
Jev and code.

`POST /api/advice` in `server/advice.js`:

1. **Decomposition** (both LLM and TypeSafe keys): a `reasoning_effort:
   "none"` LLM call lists 5–7 decision-critical steps of the described
   pipeline, each a bounded question with its own state fields and ownership
   lines. Budget: 90s, plus one 60s retry asking for only the 3 most
   decision-critical steps. The request's own vocabulary is mandatory —
   placeholder options like `act/defer/escalate` are banned in the prompt.
2. **Jev screening**: one `/systemone` call (6s deadline) scores every step —
   bounded, observable, repeated, high-consequence — and picks the best, or
   `none`. If it picks the best step, the verdict is `Use Jev` / `Use Jev
   narrowly` per fixed score thresholds; if it picks `none`, the verdict is a
   *tailored* `Do not use Jev yet` ("Jev screened all N steps taken from your
   description and found none…"). The response carries a `decomposition`
   object: `applied | rejected | failed | not-configured`, the steps, the
   chosen index, and its score.
3. **Explanation** (optional polish, 6s deadline): the LLM explains around
   the final boundary with the screening marked authoritative. If it misses
   its window the screened card ships anyway (`jev-screened` mode).
4. **Failure is honest, never generic**: if both decomposition attempts fail,
   the user gets a visible `No recommendation` card saying the provider never
   answered and to try again — no analysis is presented, because nothing was
   judged. Hand-written patterns survive **only** where providers cannot
   exist: no-key `demo` mode and the browser's `offline` cache, both badged as
   generic.
5. Degraded paths without a TypeSafe key (LLM-only) keep the earlier single
   advisor flow (10s + compact 5s).

Responses stream as **NDJSON** (`Content-Type: application/x-ndjson`):
`{"type":"stage",…}` events (`decomposing`, `waiting` heartbeats every 15s,
`steps`, `screened`, `chosen`) followed by exactly one terminal
`{"type":"result",…}` event. The client renders stages in a live process
panel and collapses it into the single recommendation card on result. Plain
JSON remains for validation errors and non-streaming clients. Waiting is a
deliberate trade: worst case ~156s (90+60+6+6) with heartbeats and a working
panel, median ~8–20s on the live provider, because a tailored answer you can
watch forming beats a fast generic one. Budgets reflect the provider's
measured ~25 tokens/s and its reasoning-mode trap (hidden thinking once ate
the entire token budget and returned empty content — hence the explicit
`reasoning_effort: "none"`).

## Response modes

| `mode` | Meaning |
| --- | --- |
| `live` | LLM answered (after Jev screening of your steps, or `llm-only` when no TypeSafe key) |
| `live-compact` | LLM-only path: main call timed out, smaller recovery prompt succeeded |
| `jev-screened` | Your steps were screened successfully but the explanation missed its window; the screened card ships anyway |
| `degraded` | No usable analysis: either an honest `No recommendation` failure card (provider never answered) or, in the LLM-only path, a bounded local fallback |
| `demo` | No LLM key; generic local patterns only, visibly badged |
| `offline` | Client-side only: the browser could not reach the API, so it renders a generic local fallback card |

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
  "jevEvaluated": true,
  "decomposition": {
    "status": "applied",
    "steps": ["Which label does this incoming email belong to?", "…"],
    "chosenStepIndex": 0,
    "minScoreBefore": 0.31,
    "minScoreAfter": 0.78
  }
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
   estimates yet. The decomposition pass needs the same paired evaluation
   (does re-screening rescue the generic-seed cases in practice?).
2. The labelled dataset is small (15 scenarios); screening accuracy and
   rejection quality need more labelled cases to be meaningful.
3. Provider latency is often high enough that the LLM follow-up falls back to
   the Jev-screened result; if the hosting gateway buffers NDJSON responses,
   stage events arrive in one burst (behaviour stays correct, pacing is lost —
   verify with `curl -N` after deploy).
4. Speed/cost charts on the site are still directional estimates (see above).
5. Browser-level interaction testing is scripted but run manually per session.
