// Paired without-Jev vs with-Jev benchmark for POST /api/advice.
//
// Runs every labelled scenario through adviceHandler twice:
//   arm "jev-first"  — TYPESAFE_API_KEY present (screening runs first)
//   arm "llm-only"   — TYPESAFE_API_KEY suppressed (pure LLM recommendation)
//
// Providers are measured, not asserted: global fetch is instrumented to record
// per-call latency and chat-completions token usage, and each run records its
// own wall time. Quality metrics are scored against eval/scenarios.json labels.
//
// Usage:
//   LLM_API_KEY=... [TYPESAFE_API_KEY=...] node --env-file-if-exists=.env eval/run-benchmark.js [options]
// Options:
//   --repeats N     runs per scenario per arm (default 1)
//   --filter ids    comma-separated scenario ids or substring to include
//   --out path      JSON results path (default eval/results/<timestamp>.json)
//   --quiet         only print the summary

import { mkdir, writeFile, readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { adviceHandler } from '../server/advice.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const VERDICT_BUCKETS = {
  'Use Jev': 'use',
  'Use Jev narrowly': 'narrow',
  'Do not use Jev yet': 'avoid',
}
// Modes where a live provider actually answered; degraded/demo cards reuse
// local patterns and must not pollute quality scoring.
const LIVE_MODES = new Set(['live', 'live-compact', 'jev-screened', 'jev-screened-demo'])

function parseArgs(argv) {
  const args = { repeats: 1, filter: null, out: null, quiet: false }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    const eq = arg.indexOf('=')
    const key = eq === -1 ? arg : arg.slice(0, eq)
    const inline = eq === -1 ? undefined : arg.slice(eq + 1)
    const takeValue = () => (inline !== undefined ? inline : argv[++i])
    if (key === '--repeats') args.repeats = Math.max(1, Number(takeValue()) || 1)
    else if (key === '--filter') args.filter = takeValue() || null
    else if (key === '--out') args.out = takeValue() || null
    else if (key === '--quiet') args.quiet = true
    else throw new Error(`Unknown option: ${arg}`)
  }
  return args
}

// ---- provider-call instrumentation -----------------------------------------

const realFetch = globalThis.fetch
let callLog = []

function classifyUrl(url) {
  if (url.includes('/chat/completions')) return 'llm'
  if (url.includes('/systemone')) return 'jev'
  return 'other'
}

globalThis.fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : input?.url ?? String(input)
  const kind = classifyUrl(url)
  const started = performance.now()
  let tokens = null
  let status = null
  try {
    const response = await realFetch(input, init)
    status = response.status
    if (response.ok && (kind === 'llm' || kind === 'jev')) {
      try {
        const body = await response.clone().json()
        if (body?.usage) {
          tokens = {
            prompt: Number(body.usage.prompt_tokens ?? 0) || 0,
            completion: Number(body.usage.completion_tokens ?? 0) || 0,
            total: Number(body.usage.total_tokens ?? 0) || 0,
          }
        }
      } catch {
        /* body not JSON or already consumed; usage stays null */
      }
    }
    return response
  } finally {
    if (kind !== 'other') {
      callLog.push({ kind, status, ms: Math.round(performance.now() - started), tokens })
    }
  }
}

// ---- single run -------------------------------------------------------------

async function runOnce(message, arm) {
  const savedTypesafe = process.env.TYPESAFE_API_KEY
  if (arm === 'llm-only') delete process.env.TYPESAFE_API_KEY
  callLog = []
  const started = performance.now()
  try {
    const request = new Request('http://benchmark.internal/api/advice', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message }),
    })
    const response = await adviceHandler(request)
    const card = await response.json()
    return {
      arm,
      wallMs: Math.round(performance.now() - started),
      httpStatus: response.status,
      mode: card?.mode ?? null,
      screening: card?.screening ?? null,
      jevEvaluated: Boolean(card?.jevEvaluated),
      verdict: card?.verdict ?? null,
      fit: card?.fit ?? null,
      decision: card?.decision ?? null,
      confidence: card?.confidence ?? null,
      calls: callLog.map((call) => ({ ...call })),
    }
  } finally {
    if (arm === 'llm-only') {
      if (savedTypesafe === undefined) delete process.env.TYPESAFE_API_KEY
      else process.env.TYPESAFE_API_KEY = savedTypesafe
    }
    callLog = []
  }
}

// ---- aggregation ------------------------------------------------------------

function percentile(values, p) {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)
  return sorted[Math.max(0, index)]
}

function sumTokens(runs, kind, field) {
  let total = 0
  let seen = false
  for (const run of runs) {
    for (const call of run.calls) {
      if (call.kind === kind && call.tokens) {
        total += call.tokens[field]
        seen = true
      }
    }
  }
  return seen ? total : null
}

function scoreRun(run, scenario) {
  const bucket = VERDICT_BUCKETS[run.verdict] ?? null
  return {
    bucket,
    exact: bucket === scenario.expect,
    acceptable: bucket ? scenario.acceptable.includes(bucket) : false,
    falseJev: scenario.expect === 'avoid' && bucket === 'use',
    overReject: scenario.expect === 'use' && bucket === 'avoid',
  }
}

function summarizeArm(runs, scenariosById) {
  const live = runs.filter((r) => LIVE_MODES.has(r.mode))
  const buckets = ['use', 'narrow', 'avoid']
  const confusion = Object.fromEntries(buckets.map((e) => [e, Object.fromEntries(buckets.map((a) => [a, 0]))]))
  let scored = 0
  let exact = 0
  let acceptable = 0
  let falseJev = 0
  let overReject = 0
  for (const run of live) {
    const scenario = scenariosById.get(run.scenarioId)
    if (!scenario) continue
    const s = scoreRun(run, scenario)
    if (!s.bucket) continue
    scored += 1
    if (s.exact) exact += 1
    if (s.acceptable) acceptable += 1
    if (s.falseJev) falseJev += 1
    if (s.overReject) overReject += 1
    confusion[scenario.expect][s.bucket] += 1
  }
  const walls = runs.map((r) => r.wallMs)
  return {
    runs: runs.length,
    liveRuns: live.length,
    modeCounts: runs.reduce((acc, r) => ({ ...acc, [r.mode ?? 'unknown']: (acc[r.mode ?? 'unknown'] || 0) + 1 }), {}),
    wallMs: { p50: percentile(walls, 50), p95: percentile(walls, 95), max: walls.length ? Math.max(...walls) : null },
    llm: {
      calls: runs.reduce((n, r) => n + r.calls.filter((c) => c.kind === 'llm').length, 0),
      promptTokens: sumTokens(runs, 'llm', 'prompt'),
      completionTokens: sumTokens(runs, 'llm', 'completion'),
      totalTokens: sumTokens(runs, 'llm', 'total'),
    },
    jev: {
      calls: runs.reduce((n, r) => n + r.calls.filter((c) => c.kind === 'jev').length, 0),
      p50Ms: percentile(runs.flatMap((r) => r.calls.filter((c) => c.kind === 'jev').map((c) => c.ms)), 50),
    },
    quality: scored
      ? {
          scored,
          exactAccuracy: Number((exact / scored).toFixed(3)),
          acceptableAccuracy: Number((acceptable / scored).toFixed(3)),
          falseJevRate: Number((falseJev / scored).toFixed(3)),
          overRejectRate: Number((overReject / scored).toFixed(3)),
          confusionExpectedToActual: confusion,
        }
      : null,
  }
}

function pairedDeltas(byArm) {
  const base = byArm['llm-only'] || []
  const test = byArm['jev-first'] || []
  const avg = (runs) => runs.reduce((n, r) => n + r.wallMs, 0) / runs.length
  const tokenAvg = (runs, kind, field) => {
    const totals = runs.map((r) => r.calls.filter((c) => c.kind === kind).reduce((n, c) => n + (c.tokens?.[field] || 0), 0))
    const present = totals.filter((_, i) => runs.some((r, j) => j === i && r.calls.some((c) => c.kind === kind && c.tokens)))
    return present.length ? present.reduce((a, b) => a + b, 0) / present.length : null
  }
  if (!base.length || !test.length) return null
  const wallRatio = avg(test) / Math.max(1, avg(base))
  const llmTokensBase = tokenAvg(base, 'llm', 'total')
  const llmTokensTest = tokenAvg(test, 'llm', 'total')
  return {
    wallRatioJevFirstVsLlmOnly: Number(wallRatio.toFixed(3)),
    llmTokensPerRun: { llmOnly: llmTokensBase, jevFirst: llmTokensTest },
    note: 'Ratios from this run only; provider latency varies — repeat before drawing conclusions.',
  }
}

// ---- main -------------------------------------------------------------------

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const dataset = JSON.parse(await readFile(resolve(HERE, 'scenarios.json'), 'utf8'))
  let scenarios = dataset.scenarios
  if (args.filter) {
    const wanted = args.filter.split(',').map((s) => s.trim()).filter(Boolean)
    scenarios = scenarios.filter((s) => wanted.some((w) => s.id === w || s.id.includes(w)))
  }
  if (!scenarios.length) throw new Error('No scenarios matched')

  if (!process.env.LLM_API_KEY) {
    console.warn('WARNING: LLM_API_KEY is unset — every run will return demo/degraded cards and quality metrics will be empty.')
  }
  const hasJev = Boolean(process.env.TYPESAFE_API_KEY)
  if (!hasJev) {
    console.warn('WARNING: TYPESAFE_API_KEY is unset — the jev-first arm cannot screen and will behave like llm-only.')
  }

  const arms = hasJev ? ['llm-only', 'jev-first'] : ['llm-only']
  const allRuns = []
  const startedAt = new Date()

  for (const arm of arms) {
    for (const scenario of scenarios) {
      for (let i = 0; i < args.repeats; i += 1) {
        if (!args.quiet) process.stdout.write(`${arm} · ${scenario.id} · ${i + 1}/${args.repeats} … `)
        const t0 = performance.now()
        let run
        try {
          run = await runOnce(scenario.message, arm)
        } catch (error) {
          run = { arm, scenarioId: scenario.id, wallMs: Math.round(performance.now() - t0), mode: 'harness-error', error: String(error?.message || error), calls: [] }
        }
        run.scenarioId = scenario.id
        run.repeat = i + 1
        allRuns.push(run)
        if (!args.quiet) console.log(`${run.mode} · ${run.wallMs}ms · ${run.verdict ?? '—'}`)
      }
    }
  }

  const scenariosById = new Map(scenarios.map((s) => [s.id, s]))
  const byArm = Object.fromEntries(arms.map((arm) => [arm, allRuns.filter((r) => r.arm === arm)]))
  const report = {
    generatedAt: startedAt.toISOString(),
    config: {
      repeats: args.repeats,
      scenarios: scenarios.map((s) => s.id),
      arms,
      llmModel: process.env.LLM_MODEL || 'gpt-4o-mini',
      llmBaseUrl: process.env.LLM_BASE_URL || 'https://api.openai.com/v1',
      typesafeModel: process.env.TYPESAFE_MODEL || 'jev-latest',
      providerPrices: 'not asserted — token counts only, no dollar figures',
    },
    summary: Object.fromEntries(arms.map((arm) => [arm, summarizeArm(byArm[arm], scenariosById)])),
    paired: summarizeArm(byArm['jev-first'] || [], scenariosById) && byArm['llm-only']?.length
      ? pairedDeltas(byArm)
      : null,
    runs: allRuns,
  }

  const outPath = resolve(args.out || resolve(HERE, 'results', `${startedAt.toISOString().replace(/[:.]/g, '-')}.json`))
  await mkdir(dirname(outPath), { recursive: true })
  await writeFile(outPath, JSON.stringify(report, null, 2))

  console.log(`\n================ BENCHMARK SUMMARY ================`)
  for (const arm of arms) {
    const s = report.summary[arm]
    console.log(`\n[${arm}]  runs=${s.runs} live=${s.liveRuns}  modes=${JSON.stringify(s.modeCounts)}`)
    console.log(`  wall p50/p95/max: ${s.wallMs.p50}/${s.wallMs.p95}/${s.wallMs.max} ms`)
    console.log(`  llm: ${s.llm.calls} calls, tokens ${s.llm.totalTokens ?? 'n/a'} (prompt ${s.llm.promptTokens ?? 'n/a'} / completion ${s.llm.completionTokens ?? 'n/a'})`)
    console.log(`  jev: ${s.jev.calls} calls, p50 ${s.jev.p50Ms ?? 'n/a'} ms`)
    if (s.quality) {
      console.log(`  verdict accuracy: exact ${(s.quality.exactAccuracy * 100).toFixed(0)}% · acceptable ${(s.quality.acceptableAccuracy * 100).toFixed(0)}%`)
      console.log(`  false-Jev rate ${(s.quality.falseJevRate * 100).toFixed(0)}% · over-reject rate ${(s.quality.overRejectRate * 100).toFixed(0)}%`)
      console.log(`  confusion (expected → actual): ${JSON.stringify(s.quality.confusionExpectedToActual)}`)
    } else {
      console.log('  quality: no live runs scored (providers unavailable or all degraded)')
    }
  }
  if (report.paired) console.log(`\npaired: ${JSON.stringify(report.paired, null, 2)}`)
  console.log(`\nresults → ${outPath}`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
