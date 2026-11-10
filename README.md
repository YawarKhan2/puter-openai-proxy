# Puter Claude Gateway

One small Node server (no Express) that exposes Claude models from Puter as:

| Endpoint | Format | Used by |
|---|---|---|
| `POST /v1/chat/completions` | OpenAI (streaming + tool calling) | OmniRoute custom provider, any OpenAI client |
| `POST /v1/messages` | Anthropic (streaming + tool use) | Claude Code directly |
| `POST /v1/messages/count_tokens` | Anthropic (estimate) | Claude Code |
| `GET /v1/models` | OpenAI list | OmniRoute model sync |

**Accounts:** the Puter token is read from every request
(`x-puter-token`, `Authorization: Bearer`, or `x-api-key`). Each OmniRoute
connection's "API key" is just a different Puter token. `PUTER_AUTH_TOKEN`
in the environment is only a fallback.

## 1. Run

```bash
npm install
npm test          # offline tests with a fake Puter
npm start         # http://127.0.0.1:3000
```

Optional environment variables: `PORT`, `HOST` (default `127.0.0.1`),
`DEFAULT_MODEL`, `PUTER_AUTH_TOKEN` (fallback), and `MODEL_ALIASES`, e.g.
`MODEL_ALIASES='{"claude-sonnet-4-5":"claude-sonnet-5-5"}'`.

**Spending guard (recommended):** expensive models can burn credits fast in a coding agent
(each step resends the whole context). Block or restrict them:

```bash
BLOCKED_MODELS="claude-opus*,claude-fable*,gpt-6-astra*" npm start   # block these (trailing * = prefix)
ALLOWED_MODELS="deepseek/*,claude-haiku-5-5" npm start               # or allow only these
```

Blocked models answer HTTP 400 and disappear from `/v1/models`. Every request also logs a
`done ... in= out= cost=$` line (cost as reported by Puter) so you can see what each step costs.

## 2. Get a Puter token (one per account)

puter.com/dashboard -> API token -> **Create token**.
Treat tokens like passwords, and revoke any that were ever pasted in public.

## 3. Test with curl

```bash
TOKEN=your_puter_token

# OpenAI format
curl http://127.0.0.1:3000/v1/chat/completions \
  -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" \
  -d '{"model":"claude-sonnet-5-5","messages":[{"role":"user","content":"Say hi"}]}'

# OpenAI streaming
curl -N http://127.0.0.1:3000/v1/chat/completions \
  -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" \
  -d '{"model":"claude-haiku-5-5","stream":true,"messages":[{"role":"user","content":"Count to 5"}]}'

# OpenAI tool calling (should answer with finish_reason "tool_calls")
curl http://127.0.0.1:3000/v1/chat/completions \
  -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" \
  -d '{"model":"claude-sonnet-5-5","messages":[{"role":"user","content":"What is the weather in Paris?"}],
       "tools":[{"type":"function","function":{"name":"get_weather","description":"Get weather","parameters":{"type":"object","properties":{"city":{"type":"string"}},"required":["city"]}}}]}'

# Anthropic format
curl http://127.0.0.1:3000/v1/messages \
  -H "Content-Type: application/json" -H "x-api-key: $TOKEN" \
  -d '{"model":"claude-sonnet-5-5","max_tokens":200,"messages":[{"role":"user","content":"Say hi"}]}'
```

## 4. Add it to OmniRoute (custom provider, multi-account)

1. Dashboard -> Providers -> add an **OpenAI-compatible** provider.
2. Base URL: `http://127.0.0.1:3000/v1` (if OmniRoute runs in Docker, use
   `http://host.docker.internal:3000/v1` and start this server with `HOST=0.0.0.0`).
3. API key: your first Puter token.
4. Add the same provider again as another **connection** with the second
   account's token, and so on. OmniRoute's account rotation / combos then
   spread requests over your Puter accounts.
5. Sync models (it reads `/v1/models`) or type them manually, e.g. `claude-sonnet-5-5`.

Dashboard labels may differ slightly between OmniRoute versions.

Errors such as `401` (bad token) or `429` (no credits) are returned as real
HTTP status codes, *before* any streaming starts, so OmniRoute can fail over
to the next account.

## 5. Claude Code

**Through OmniRoute (recommended):** follow OmniRoute's own Claude Code setup
(its CLI Tools page). Claude Code talks to OmniRoute, and OmniRoute talks to
this gateway.

**Directly to this gateway:**

```bash
export ANTHROPIC_BASE_URL=http://127.0.0.1:3000
export ANTHROPIC_AUTH_TOKEN=your_puter_token
export ANTHROPIC_MODEL=claude-sonnet-5-5
export ANTHROPIC_SMALL_FAST_MODEL=claude-haiku-5-5
claude
```

## Thinking and reasoning effort

- **Effort is forwarded, never invented.** `reasoning_effort` (on `/v1/chat/completions`, what OmniRoute sends)
  and `output_config.effort` (on `/v1/messages`, what Claude Code sends) are passed to Puter as `reasoning_effort`,
  clamped to the values each model accepts (Gemini 4 Argon: low/medium/high; Kimi K3.1 Pro: low/high/max;
  MiniMax M3.1 Flash: low to max). If the client sends nothing, the gateway sends nothing.
- **Never sent to Claude models,** and never to Gemini models other than the three Puter documents. Puter would turn it
  into extended thinking, and signed thinking blocks are not replayed in tool loops.
- **Claude's own `thinking` setting is ignored** on both endpoints, so Claude runs without extended thinking.
  Puter streams signed `reasoning_detail` blocks that could be replayed; this is not implemented.
- **Some models always think** (Kimi K3, MiniMax M3.1 Flash, GLM 5.3 Flash) whatever is sent, and that costs output tokens.
- Every request logs `reasoning_effort=<received> -> sent=<forwarded>`, and `done ... cost=$` after it finishes.

### Showing thinking in Claude Code

- **Direct (`/v1/messages`):** when the model streams reasoning, it is sent to Claude Code as a live `thinking` block, which
  Claude Code can show, count and expand. Turn it off with `EMIT_THINKING=0`; it is also skipped when the client sends
  `thinking: {type: "disabled"}`. The block carries an unsigned placeholder signature and is dropped again when Claude Code
  sends the history back, so it is never forwarded to Puter.
- **Through OmniRoute (`/v1/chat/completions`):** reasoning is sent as `reasoning_content` deltas, the field OmniRoute reads.
  Whether it turns them into thinking blocks for Claude Code is OmniRoute's behaviour.
- **Is the model reasoning at all?** Each finished request logs
  `done model=... in= out= think=<reasoning tokens> cost=$ chunks=text:N,reasoning:N,usage:1`.
  `reasoning:0` means Puter did not stream any reasoning for that request; `think=` is Puter's own count of reasoning tokens.

## Known limits

- Built against Puter's docs and tested offline with a mock; **run it against the
  real Puter once** and report any error.
- Images are replaced by a text placeholder. Extended thinking is not forwarded
  (thinking blocks are dropped), so Claude runs without it.
- Tool arguments arrive as one complete chunk, not token by token.
- If Puter doesn't report usage, token counts are estimates (about 4 chars per token).
- All usage is billed to whichever Puter account's token is sent.
  The server binds to `127.0.0.1` by default; don't expose it publicly with a fallback token set.
