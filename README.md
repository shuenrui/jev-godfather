# Jev Godfather

Jev Godfather is a focused advisor interface for turning a project idea into a
clear, bounded decision that Jev can handle.

The current prototype is a local React/Vite experience with a demo advisor
flow. It does not call an LLM or TypeSafe yet. Responses are intentionally
local so the interaction and recommendation format can be tested before adding
the API layer.

## Run locally

```bash
npm install
npm run dev
```

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
