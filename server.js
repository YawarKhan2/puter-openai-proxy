"use strict";
/**
 * Puter Claude Gateway
 *
 *  - POST /v1/chat/completions   OpenAI format  (OmniRoute custom provider, any OpenAI client)
 *  - POST /v1/messages           Anthropic format (Claude Code directly)
 *  - POST /v1/messages/count_tokens
 *  - GET  /v1/models
 *
 * The Puter auth token is read from each request, so every OmniRoute
 * connection ("API key") can be a different Puter account:
 *    x-puter-token: <token>   |   Authorization: Bearer <token>   |   x-api-key: <token>
 * PUTER_AUTH_TOKEN in the environment is only a fallback.
 */
const http = require("http");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || "127.0.0.1";
const ENV_TOKEN = process.env.PUTER_AUTH_TOKEN || "";
const DEFAULT_MODEL = process.env.DEFAULT_MODEL || "claude-sonnet-5-5";
const MAX_BODY = 50 * 1024 * 1024;

let MODEL_ALIASES = {};
try {
  MODEL_ALIASES = JSON.parse(process.env.MODEL_ALIASES || "{}");
} catch {
  console.warn("MODEL_ALIASES is not valid JSON, ignoring it");
}

// Chat model IDs from the Puter guides (Claude, OpenAI, DeepSeek, Gemini, Grok).
// Any other ID you send is passed straight through to Puter, so this list
// only controls what GET /v1/models advertises.
// Image-only models (x-ai/grok-imagine-*) are left out: they use txt2img, not chat.
const MODELS = [
  // Claude
  "claude-haiku-5-5",
  "claude-sonnet-5-5",
  "claude-fable-5-1",
  "claude-opus-5-5",
  "claude-opus-5",
  "claude-opus-5-fast",
  "claude-fable-5",
  "claude-sonnet-5",
  "claude-opus-4.8-fast",
  "claude-opus-4-8",
  "claude-opus-4-7",
  "claude-sonnet-4-6",
  "claude-opus-4-6",
  "claude-opus-4-5",
  "claude-haiku-4-5",
  "claude-sonnet-4-5",
  // OpenAI
  "gpt-6.1-sol",
  "gpt-6.1-sol-pro",
  "gpt-6.1-terra",
  "gpt-6-astra",
  "gpt-6-astra-pro",
  "gpt-6-sol",
  "gpt-6-sol-pro",
  "gpt-6-luna",
  "gpt-6-luna-pro",
  "gpt-5.6-sol",
  "gpt-5.6-sol-pro",
  "gpt-5.6-terra",
  "gpt-5.6-terra-pro",
  "gpt-5.6-luna",
  "gpt-5.6-luna-pro",
  "gpt-5.5-pro",
  "gpt-5.5",
  "gpt-5.4-mini",
  "gpt-5.4-nano",
  "gpt-5.4",
  "gpt-5.4-pro",
  "gpt-5.2",
  "gpt-5.2-chat",
  "gpt-5.2-pro",
  "gpt-5.1",
  "gpt-5.1-chat-latest",
  "gpt-5.3-codex",
  "gpt-5.2-codex",
  "gpt-5.1-codex",
  "gpt-5.1-codex-mini",
  "gpt-5.1-codex-max",
  "gpt-5",
  "gpt-5-mini",
  "gpt-5-nano",
  "gpt-5-chat-latest",
  "gpt-4.1",
  "gpt-4.1-mini",
  "gpt-4.1-nano",
  "gpt-4o",
  "gpt-4o-mini",
  "o1",
  "o1-mini",
  "o3",
  "o3-mini",
  "o4-mini",
  "openai/gpt-oss-120b",
  // DeepSeek
  "deepseek/deepseek-v4.1-flash-1017",
  "deepseek/deepseek-v4.1-flash",
  "deepseek/deepseek-v4-flash-vision-exp",
  "deepseek/deepseek-v4-pro-0813",
  "deepseek/deepseek-v4-flash-0731",
  "deepseek/deepseek-chat-v3-0324",
  "deepseek/deepseek-chat-v3.1",
  "deepseek/deepseek-r1-0528",
  "deepseek/deepseek-v3.1-terminus",
  "deepseek/deepseek-v3.1-terminus:exacto",
  "deepseek/deepseek-v3.2",
  "deepseek/deepseek-v3.2-exp",
  "deepseek/deepseek-v4-flash",
  "deepseek/deepseek-v4-pro",
  // Gemini
  "gemini-4-argon",
  "gemini-3.8-flash",
  "gemini-3.7-flash",
  "gemini-3.6-flash",
  "gemini-3.5-flash-lite",
  "gemini-3.5-flash",
  "gemini-3.1-flash-lite",
  "gemini-3.1-pro-preview",
  "gemini-3-flash-preview",
  "gemini-3-pro-preview",
  "gemini-2.5-flash-preview-09-2025",
  "gemini-2.5-flash-lite",
  "gemini-2.5-pro-preview",
  "gemini-2.5-pro-preview-05-06",
  "gemini-2.5-flash",
  "gemini-2.5-pro",
  // Grok
  "x-ai/grok-4.7",
  "x-ai/grok-4.6",
  "x-ai/grok-4.5",
  "x-ai/grok-build-0.1",
  "x-ai/grok-4.3",
  "x-ai/grok-4.20",
  "x-ai/grok-4.20-multi-agent",
  "x-ai/grok-4-1-fast-non-reasoning",
  "x-ai/grok-4-1-fast-reasoning",
  "x-ai/grok-2",
  // Qwen (qwen/qwen-image is image-only, so it is left out)
  "qwen/qwen3.8-max-prime",
  "qwen/qwen3.8-flash",
  "qwen/qwen3.8-max",
  "qwen/qwen3.7-plus",
  "qwen/qwen3.7-max",
  "qwen/qwen3.7-flash",
  "qwen/qwen3.6-max-preview",
  "qwen/qwen3.6-plus",
  "qwen/qwen3.6-flash",
  "qwen/qwen3.6-27b",
  "qwen/qwen3.6-35b-a3b",
  "qwen/qwen3.5-plus",
  "qwen/qwen3.5-plus-20260420",
  "qwen/qwen3.5-122b-a10b",
  "qwen/qwen3.5-27b",
  "qwen/qwen3.5-35b-a3b",
  "qwen/qwen3.5-flash-02-23",
  "qwen/qwen3.5-397b-a17b",
  "qwen/qwen3.5-plus-02-15",
  "qwen/qwen3-coder-next",
  "qwen/qwen3-next-80b-a3b-instruct",
  "qwen/qwen3-next-80b-a3b-thinking",
  "qwen/qwen3-235b-a22b-2507",
  "qwen/qwen3-235b-a22b-thinking-2507",
  "qwen/qwen3-30b-a3b-instruct-2507",
  "qwen/qwen3-30b-a3b-thinking-2507",
  "qwen/qwen3-coder-30b-a3b-instruct",
  "qwen/qwen3-coder-flash",
  "qwen/qwen3-coder-plus",
  "qwen/qwen3-vl-235b-a22b-thinking",
  "qwen/qwen3-vl-30b-a3b-instruct",
  "qwen/qwen3-vl-plus",
  "qwen/qwen3-omni-flash",
  "qwen/qwen3-max",
  "qwen/qwen3-14b",
  "qwen/qwen3-235b-a22b",
  "qwen/qwen3-32b",
  "qwen/qwen3-8b",
  "qwen/qwen-max",
  "qwen/qwen-plus",
  "qwen/qwen-flash",
  "qwen/qwen-mt-plus",
  "qwen/qwen-2.5-coder-32b-instruct",
  // Kimi (Moonshot)
  "moonshotai/kimi-k3",
  "moonshotai/kimi-k2.7-code",
  "moonshotai/kimi-k2.7-code-highspeed",
  "moonshotai/kimi-k2.6",
  "moonshotai/kimi-k2.5",
  "moonshotai/kimi-k2-thinking",
  "moonshotai/kimi-k2-0905",
  "moonshotai/kimi-k2",
  "moonshotai/kimi-v1-128k",
  "moonshotai/kimi-v1-32k",
  // GLM (Z.AI)
  "z-ai/glm-5.3-prime",
  "z-ai/glm-5.3-flashx",
  "z-ai/glm-5.3-flash",
  "z-ai/glm-5.3",
  "z-ai/glm-5.2",
  "z-ai/glm-5.1",
  "z-ai/glm-5-turbo",
  "z-ai/glm-5",
  "z-ai/glm-4.7-flashx",
  "z-ai/glm-4.7-flash",
  "z-ai/glm-4.7",
  "z-ai/glm-4.6v-flashx",
  "z-ai/glm-4.6v-flash",
  "z-ai/glm-4.6",
  "z-ai/glm-4.5x",
  "z-ai/glm-4.5-airx",
  "z-ai/glm-4.5-flash",
  "z-ai/glm-4.5",
  "z-ai/glm-4.5-air",
  "z-ai/glm-4-32b-0414-128k",
  // MiniMax
  "minimax/minimax-m3.1-flash",
  "minimax/minimax-m3",
  "minimax/minimax-m2.7",
  "minimax/minimax-m2.7-highspeed",
  "minimax/minimax-m2.5",
  "minimax/minimax-m2.5-highspeed",
  "minimax/minimax-m2.1",
  "minimax/minimax-m2.1-highspeed",
  "minimax/minimax-m2-her",
  "minimax/minimax-m2",
  "minimax/minimax-m1",
];

// ---------------------------------------------------------------- helpers

function ownerOf(m) {
  if (m.startsWith("claude")) return "anthropic";
  if (m.startsWith("deepseek/")) return "deepseek";
  if (m.startsWith("x-ai/")) return "xai";
  if (m.startsWith("gemini")) return "google";
  if (m.startsWith("qwen/")) return "alibaba";
  if (m.startsWith("moonshotai/")) return "moonshot";
  if (m.startsWith("z-ai/")) return "zai";
  if (m.startsWith("minimax/")) return "minimax";
  return "openai";
}

const rid = (n = 12) => crypto.randomBytes(n).toString("hex");
const fingerprint = (t) => crypto.createHash("sha256").update(t).digest("hex").slice(0, 6);
const estimateTokens = (x) =>
  Math.max(1, Math.ceil((typeof x === "string" ? x : JSON.stringify(x ?? "")).length / 4));

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function toHttpError(e) {
  if (e instanceof HttpError) return e;
  const msg = String(e?.message || e?.error?.message || (typeof e === "string" ? e : "") || "Upstream error");
  let status = Number(e?.status || e?.statusCode) || 0;
  const code = String(e?.code || e?.error?.code || "").toLowerCase();
  if (!status && code) {
    // insufficient funds is reported as 429 (same as OpenAI's insufficient_quota) so routers fail over
    if (/insufficient_funds|subscription_required|too_many_requests|rate_limit|upstream_rate_limited/.test(code)) status = 429;
    else if (/unauthor|token_auth|auth_failed|invalid_token/.test(code)) status = 401;
    else if (/input_too_large|payload_too_large/.test(code)) status = 413;
    else if (/bad_request|invalid_request/.test(code)) status = 400;
    else if (/timeout/.test(code)) status = 504;
    else if (/network_error|invalid_stream|upstream_provider_unavailable|upstream_failed/.test(code)) status = 502;
  }
  if (!status) {
    if (/unauthori|invalid.*token|forbidden|not authenticated/i.test(msg)) status = 401;
    else if (/rate.?limit|too many|insufficient|credit|quota|funds/i.test(msg)) status = 429;
    else if (/unknown model|invalid model|model.*not found|bad_request/i.test(msg)) status = 400;
    else status = 502;
  }
  return new HttpError(status, msg);
}

function errType(status, flavor) {
  const common = { 400: "invalid_request_error", 401: "authentication_error", 429: "rate_limit_error" };
  if (common[status]) return common[status];
  if (flavor === "anthropic") {
    if (status === 403) return "permission_error";
    if (status === 404) return "not_found_error";
    if (status === 413) return "request_too_large";
  }
  return "api_error";
}

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) });
  res.end(body);
}

function sendError(res, flavor, err) {
  const e = toHttpError(err);
  if (res.headersSent) return res.end();
  if (flavor === "anthropic") {
    sendJson(res, e.status, { type: "error", error: { type: errType(e.status, flavor), message: e.message } });
  } else {
    sendJson(res, e.status, {
      error: { message: e.message, type: errType(e.status, flavor), param: null, code: null },
    });
  }
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new HttpError(413, "Request body too large"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => {
      try {
        const raw = Buffer.concat(chunks).toString("utf8");
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        reject(new HttpError(400, "Request body is not valid JSON"));
      }
    });
    req.on("error", reject);
  });
}

function getToken(req) {
  const h = req.headers;
  const bearer = (h.authorization || "").replace(/^Bearer\s+/i, "").trim();
  return (h["x-puter-token"] || bearer || h["x-api-key"] || ENV_TOKEN || "").toString().trim();
}

// reasoning_effort differs per model family (Puter docs, "Model-specific features").
// Wrong values give "400 bad_request", so values are clamped to what each model accepts.
const EFFORT_SCALE = ["none", "minimal", "low", "medium", "high", "xhigh", "max"];
const EFFORT_SETS = [
  [/^gemini-4-argon$/, ["low", "medium", "high"]],
  [/^gemini-(3\.1-flash-lite|3-flash-preview)$/, ["minimal", "low", "medium", "high"]],
  [/^moonshotai\/kimi-k3\.1-pro/, ["low", "high", "max"]],
  [/^minimax\/minimax-m3\.1-flash$/, ["low", "medium", "high", "xhigh", "max"]], // thinking is always on
];
function effortFor(model, effort) {
  if (!effort) return undefined;
  const e = String(effort).toLowerCase();
  const idx = EFFORT_SCALE.indexOf(e);
  if (idx < 0) return undefined;
  const m = String(model).toLowerCase();
  // Claude: Puter would turn this into extended thinking, and thinking blocks are not replayed
  // in tool loops, so it is never forwarded. Other Gemini models: not documented, so not forwarded.
  if (m.startsWith("claude") || m.startsWith("gemini")) {
    if (!EFFORT_SETS.some(([re]) => re.test(m))) return undefined;
  }
  for (const [re, allowed] of EFFORT_SETS) {
    if (!re.test(m)) continue;
    if (allowed.includes(e)) return e;
    let best = allowed[0];
    let bestD = Infinity;
    for (const a of allowed) {
      const d = Math.abs(EFFORT_SCALE.indexOf(a) - idx);
      if (d < bestD || (d === bestD && EFFORT_SCALE.indexOf(a) > EFFORT_SCALE.indexOf(best))) {
        best = a;
        bestD = d;
      }
    }
    return best;
  }
  return e;
}

function resolveModel(m) {
  if (!m) return DEFAULT_MODEL;
  let id = String(m).trim().replace(/\[[^\]]*\]$/, ""); // "model[1m]" -> "model"
  if (MODEL_ALIASES[id]) return MODEL_ALIASES[id];
  id = id.replace(/^(anthropic|puter)\//i, "");
  if (MODEL_ALIASES[id]) return MODEL_ALIASES[id];
  if (!MODELS.includes(id)) {
    const undated = id.replace(/-\d{8}$/, ""); // claude-xxx-20250929 -> claude-xxx
    if (MODELS.includes(undated)) id = undated;
  }
  return id;
}

// ---------------------------------------------------------------- Puter

const puterCache = new Map();
function defaultGetPuter(token) {
  let p = puterCache.get(token);
  if (!p) {
    const { init } = require("@heyputer/puter.js/src/init.cjs"); // Node-only entry
    p = init(token);
    puterCache.set(token, p);
    if (puterCache.size > 100) puterCache.delete(puterCache.keys().next().value);
  }
  return p;
}

function pickUsage(o) {
  // Puter's final usage chunk carries both `usage` and a provider-neutral `usageDetails`
  for (const u of [o?.usage, o?.usageDetails, o]) {
    if (!u || typeof u !== "object") continue;
    const i = u.input_tokens ?? u.prompt_tokens ?? u.inputTokens ?? u.promptTokens;
    const out = u.output_tokens ?? u.completion_tokens ?? u.outputTokens ?? u.completionTokens;
    if (typeof i === "number" || typeof out === "number") return { input: i || 0, output: out || 0 };
  }
  return null;
}

// Gemini attaches extra_content (thought_signature) to tool calls and wants it
// echoed back unchanged. Anthropic-format clients can't carry it, so keep it by tool-call id.
const toolExtras = new Map();
function rememberExtra(id, extra) {
  if (!id || !extra) return;
  toolExtras.set(id, extra);
  if (toolExtras.size > 5000) toolExtras.delete(toolExtras.keys().next().value);
}
const extraFor = (id, given) => given || toolExtras.get(id);

function safeParse(s) {
  if (s && typeof s === "object") return s;
  try {
    return s ? JSON.parse(s) : {};
  } catch {
    return {};
  }
}

function mapFinish(fr, hasTools) {
  if (hasTools) return "tool_calls";
  switch (fr) {
    case "max_tokens":
    case "length":
      return "length";
    case "content_filter":
    case "refusal":
      return "content_filter";
    default:
      return "stop";
  }
}

// Non-streaming Puter result -> { text, toolCalls, finish, usage }
function parseResult(r) {
  if (r && r.success === false) throw toHttpError(r.error || r);
  const msg = r?.message || {};
  let text = "";
  const toolCalls = [];
  const c = msg.content;
  if (typeof c === "string") text = c;
  else if (Array.isArray(c)) {
    for (const b of c) {
      if (b?.type === "text") text += b.text || "";
      else if (b?.type === "tool_use") {
        const id = b.id || "call_" + rid(8);
        rememberExtra(id, b.extra_content);
        toolCalls.push({ id, name: b.name, input: b.input || {} });
      }
    }
  }
  if (Array.isArray(msg.tool_calls)) {
    for (const tc of msg.tool_calls) {
      const id = tc.id || "call_" + rid(8);
      rememberExtra(id, tc.extra_content);
      toolCalls.push({ id, name: tc.function?.name, input: safeParse(tc.function?.arguments) });
    }
  }
  const reasoning = typeof msg.reasoning === "string" ? msg.reasoning : typeof msg.reasoning_content === "string" ? msg.reasoning_content : "";
  return { text, reasoning, toolCalls, finish: mapFinish(r?.finish_reason, toolCalls.length > 0), usage: pickUsage(r) };
}

// Streaming: normalise Puter chunks. Throws on error chunks.
function normalizeChunk(part) {
  if (!part) return null;
  if (part.type === "error") {
    const e = new Error(part.message || "Upstream stream error");
    const n = Number(part.status || part.code);
    if (n >= 400) e.status = n;
    throw e;
  }
  if (part.type === "tool_use") {
    const id = part.id || "call_" + rid(8);
    rememberExtra(id, part.extra_content);
    return { kind: "tool", id, name: part.name, input: part.input ?? {} };
  }
  if (part.type === "reasoning") return { kind: "reasoning", text: part.reasoning ?? part.text ?? "" };
  if (!part.type && typeof part.reasoning === "string" && part.reasoning) return { kind: "reasoning", text: part.reasoning };
  if (part.type === "usage") {
    const u = pickUsage(part);
    return u ? { kind: "usage", usage: u } : null;
  }
  if ((part.type === "text" || !part.type) && typeof part.text === "string" && part.text) {
    return { kind: "text", text: part.text };
  }
  if (!part.type && part.usage) {
    const u = pickUsage(part);
    return u ? { kind: "usage", usage: u } : null;
  }
  return null;
}

// Opens the stream and reads the first event BEFORE any HTTP headers are
// sent, so auth / rate-limit errors become real HTTP errors (lets OmniRoute
// fail over to another account).
async function openStream(puter, messages, opts) {
  const stream = await puter.ai.chat(messages, { ...opts, stream: true });
  const it = stream[Symbol.asyncIterator]();
  const next = async () => {
    for (;;) {
      const r = await it.next();
      if (r.done) return null;
      const ev = normalizeChunk(r.value);
      if (ev) return ev;
    }
  };
  const first = await next();
  return { first, next };
}

// ---------------------------------------------------------------- conversions

function textOf(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return content == null ? "" : String(content);
  return content
    .map((p) => {
      if (!p) return "";
      if (p.type === "text") return p.text || "";
      if (p.type === "image_url" || p.type === "image") return "[image omitted: not supported by this gateway]";
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

function openaiMessagesToPuter(messages) {
  const out = [];
  for (const m of messages) {
    if (m.role === "system" || m.role === "developer") {
      out.push({ role: "system", content: textOf(m.content) });
    } else if (m.role === "tool") {
      out.push({ role: "tool", tool_call_id: m.tool_call_id, content: textOf(m.content) });
    } else if (m.role === "assistant") {
      const msg = { role: "assistant" };
      const t = textOf(m.content);
      if (t) msg.content = t;
      if (Array.isArray(m.tool_calls) && m.tool_calls.length) {
        msg.tool_calls = m.tool_calls.map((tc) => {
          const extra = extraFor(tc.id, tc.extra_content);
          return {
            id: tc.id,
            type: "function",
            function: {
              name: tc.function?.name,
              arguments:
                typeof tc.function?.arguments === "string"
                  ? tc.function.arguments
                  : JSON.stringify(tc.function?.arguments ?? {}),
            },
            ...(extra ? { extra_content: extra } : {}),
          };
        });
      }
      if (msg.content === undefined && !msg.tool_calls) msg.content = "(empty)";
      out.push(msg);
    } else {
      out.push({ role: "user", content: textOf(m.content) || "(empty)" });
    }
  }
  return out;
}

function toolResultText(b) {
  let t = typeof b.content === "string" ? b.content : textOf(b.content);
  if (b.is_error) t = "Error: " + t;
  return t || "(no output)";
}

function anthropicToPuter(body) {
  const out = [];
  const sys = body.system;
  if (sys) {
    let text = "";
    let cache = false;
    if (typeof sys === "string") text = sys;
    else if (Array.isArray(sys)) {
      text = sys.map((b) => b?.text || "").filter(Boolean).join("\n\n");
      cache = sys.some((b) => b?.cache_control);
    }
    if (text) {
      const m = { role: "system", content: text };
      if (cache) m.cache_control = { type: "ephemeral" };
      out.push(m);
    }
  }
  for (const m of body.messages || []) {
    const blocks = typeof m.content === "string" ? [{ type: "text", text: m.content }] : m.content || [];
    if (m.role === "assistant") {
      let text = "";
      const calls = [];
      for (const b of blocks) {
        if (b.type === "text") text += b.text || "";
        else if (b.type === "tool_use") {
          const extra = extraFor(b.id);
          calls.push({
            id: b.id,
            type: "function",
            function: { name: b.name, arguments: JSON.stringify(b.input ?? {}) },
            ...(extra ? { extra_content: extra } : {}),
          });
        } // thinking blocks are dropped on purpose
      }
      const msg = { role: "assistant" };
      if (text) msg.content = text;
      if (calls.length) msg.tool_calls = calls;
      if (msg.content === undefined && !msg.tool_calls) msg.content = "(empty)";
      out.push(msg);
    } else {
      const texts = [];
      for (const b of blocks) {
        if (b.type === "tool_result") out.push({ role: "tool", tool_call_id: b.tool_use_id, content: toolResultText(b) });
        else if (b.type === "text") texts.push(b.text || "");
        else if (b.type === "image") texts.push("[image omitted: not supported by this gateway]");
      }
      const t = texts.filter(Boolean).join("\n");
      if (t) out.push({ role: "user", content: t });
    }
  }
  return out;
}

function openaiToolsToPuter(tools) {
  return (tools || [])
    .filter((t) => t?.type === "function" && t.function?.name)
    .map((t) => ({
      type: "function",
      function: {
        name: t.function.name,
        description: t.function.description || "",
        parameters: t.function.parameters || { type: "object", properties: {} },
      },
    }));
}

function anthropicToolsToPuter(tools) {
  return (tools || [])
    .filter((t) => t?.name && t.input_schema)
    .map((t) => ({
      type: "function",
      function: { name: t.name, description: t.description || "", parameters: t.input_schema },
    }));
}

function buildOpts(common, tools, toolChoice, parallel, signal) {
  const o = { model: resolveModel(common.model), normalize: true };
  if (common.max_tokens != null) o.max_tokens = common.max_tokens;
  if (common.temperature != null) o.temperature = common.temperature;
  if (common.stop && common.stop.length) o.stopSequences = common.stop;
  const eff = effortFor(o.model, common.reasoning_effort);
  if (eff) o.reasoning_effort = eff;
  if (tools.length) {
    o.tools = tools;
    o.parallelToolCalls = parallel;
    if (toolChoice !== undefined) o.toolChoice = toolChoice;
  }
  if (signal) o.signal = signal;
  return o;
}

const SSE_HEADERS = {
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-cache, no-transform",
  Connection: "keep-alive",
  "X-Accel-Buffering": "no",
};

// ---------------------------------------------------------------- OpenAI endpoint

async function handleOpenAIChat(req, res, ctx) {
  const body = await readJson(req);
  if (!Array.isArray(body.messages) || !body.messages.length) {
    throw new HttpError(400, "'messages' must be a non-empty array");
  }
  const puter = ctx.getPuter(ctx.token);
  const messages = openaiMessagesToPuter(body.messages);
  const tools = openaiToolsToPuter(body.tools);
  let toolChoice;
  const tc = body.tool_choice;
  if (typeof tc === "string") toolChoice = tc;
  else if (tc?.type === "function" && tc.function?.name) toolChoice = { type: "tool", name: tc.function.name };

  const stop = typeof body.stop === "string" ? [body.stop] : body.stop;
  const opts = buildOpts(
    { model: body.model, max_tokens: body.max_tokens ?? body.max_completion_tokens, temperature: body.temperature, stop, reasoning_effort: body.reasoning_effort },
    tools,
    toolChoice,
    body.parallel_tool_calls !== false,
    ctx.signal
  );
  const model = body.model || opts.model;
  const id = "chatcmpl-" + rid();
  const created = Math.floor(Date.now() / 1000);
  const inEst = estimateTokens(messages);
  ctx.log(`openai model=${opts.model} stream=${!!body.stream} tools=${tools.length} reasoning_effort=${body.reasoning_effort || "-"} -> sent=${opts.reasoning_effort || "no"}`);

  if (!body.stream) {
    const r = parseResult(await puter.ai.chat(messages, { ...opts, stream: false }));
    const outEst = estimateTokens(r.text + JSON.stringify(r.toolCalls));
    const u = r.usage || { input: inEst, output: outEst };
    const message = { role: "assistant", content: r.text || (r.toolCalls.length ? null : "") };
    if (r.reasoning) message.reasoning_content = r.reasoning;
    if (r.toolCalls.length) {
      message.tool_calls = r.toolCalls.map((t) => ({
        id: t.id,
        type: "function",
        function: { name: t.name, arguments: JSON.stringify(t.input) },
      }));
    }
    return sendJson(res, 200, {
      id,
      object: "chat.completion",
      created,
      model,
      choices: [{ index: 0, message, finish_reason: r.finish }],
      usage: { prompt_tokens: u.input, completion_tokens: u.output, total_tokens: u.input + u.output },
    });
  }

  const s = await openStream(puter, messages, opts); // throws before headers are sent
  res.writeHead(200, SSE_HEADERS);
  const chunk = (delta, finish = null) =>
    res.write(
      `data: ${JSON.stringify({ id, object: "chat.completion.chunk", created, model, choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`
    );
  chunk({ role: "assistant", content: "" });
  let toolIdx = 0;
  let sawTool = false;
  let usage = null;
  let outChars = 0;
  try {
    for (let ev = s.first; ev; ev = await s.next()) {
      if (ev.kind === "text") {
        outChars += ev.text.length;
        chunk({ content: ev.text });
      } else if (ev.kind === "reasoning" && ev.text) {
        chunk({ reasoning_content: ev.text });
      } else if (ev.kind === "tool") {
        sawTool = true;
        const args = JSON.stringify(ev.input);
        outChars += args.length;
        chunk({ tool_calls: [{ index: toolIdx++, id: ev.id, type: "function", function: { name: ev.name, arguments: args } }] });
      } else if (ev.kind === "usage") usage = ev.usage;
    }
    chunk({}, sawTool ? "tool_calls" : "stop");
    if (body.stream_options?.include_usage) {
      const u = usage || { input: inEst, output: Math.max(1, Math.ceil(outChars / 4)) };
      res.write(
        `data: ${JSON.stringify({ id, object: "chat.completion.chunk", created, model, choices: [], usage: { prompt_tokens: u.input, completion_tokens: u.output, total_tokens: u.input + u.output } })}\n\n`
      );
    }
    res.write("data: [DONE]\n\n");
  } catch (e) {
    if (!res.destroyed) {
      const he = toHttpError(e);
      res.write(`data: ${JSON.stringify({ error: { message: he.message, type: errType(he.status, "openai") } })}\n\n`);
    }
  }
  res.end();
}

// ---------------------------------------------------------------- Anthropic endpoint

function mapAnthropicToolChoice(tc) {
  if (!tc) return undefined;
  if (tc.type === "auto") return "auto";
  if (tc.type === "any") return "required";
  if (tc.type === "none") return "none";
  if (tc.type === "tool" && tc.name) return { type: "tool", name: tc.name };
  return undefined;
}

async function handleAnthropicMessages(req, res, ctx) {
  const body = await readJson(req);
  if (!Array.isArray(body.messages) || !body.messages.length) {
    throw new HttpError(400, "'messages' must be a non-empty array");
  }
  const puter = ctx.getPuter(ctx.token);
  const messages = anthropicToPuter(body);
  const tools = anthropicToolsToPuter(body.tools);
  const opts = buildOpts(
    { model: body.model, max_tokens: body.max_tokens, temperature: body.temperature, stop: body.stop_sequences, reasoning_effort: body.output_config?.effort },
    tools,
    mapAnthropicToolChoice(body.tool_choice),
    body.tool_choice?.disable_parallel_tool_use !== true,
    ctx.signal
  );
  const model = body.model || opts.model;
  const id = "msg_" + rid();
  const inEst = estimateTokens(messages);
  const stopReason = (finish) => (finish === "tool_calls" ? "tool_use" : finish === "length" ? "max_tokens" : "end_turn");
  ctx.log(`anthropic model=${opts.model} stream=${!!body.stream} tools=${tools.length} thinking=${body.thinking?.type || "-"} effort=${body.output_config?.effort || "-"} -> sent=${opts.reasoning_effort || "no"}`);

  if (!body.stream) {
    const r = parseResult(await puter.ai.chat(messages, { ...opts, stream: false }));
    const content = [];
    if (r.text) content.push({ type: "text", text: r.text });
    for (const t of r.toolCalls) content.push({ type: "tool_use", id: t.id, name: t.name, input: t.input });
    if (!content.length) content.push({ type: "text", text: "" });
    const u = r.usage || { input: inEst, output: estimateTokens(r.text + JSON.stringify(r.toolCalls)) };
    return sendJson(res, 200, {
      id,
      type: "message",
      role: "assistant",
      model,
      content,
      stop_reason: stopReason(r.finish),
      stop_sequence: null,
      usage: { input_tokens: u.input, output_tokens: u.output },
    });
  }

  const s = await openStream(puter, messages, opts); // throws before headers are sent
  res.writeHead(200, SSE_HEADERS);
  const ev = (name, data) => res.write(`event: ${name}\ndata: ${JSON.stringify(data)}\n\n`);
  ev("message_start", {
    type: "message_start",
    message: {
      id,
      type: "message",
      role: "assistant",
      model,
      content: [],
      stop_reason: null,
      stop_sequence: null,
      usage: { input_tokens: inEst, output_tokens: 1 },
    },
  });
  let idx = -1;
  let textOpen = false;
  let sawTool = false;
  let usage = null;
  let outChars = 0;
  const closeText = () => {
    if (textOpen) {
      ev("content_block_stop", { type: "content_block_stop", index: idx });
      textOpen = false;
    }
  };
  try {
    for (let e = s.first; e; e = await s.next()) {
      if (e.kind === "text") {
        if (!textOpen) {
          idx++;
          ev("content_block_start", { type: "content_block_start", index: idx, content_block: { type: "text", text: "" } });
          textOpen = true;
        }
        outChars += e.text.length;
        ev("content_block_delta", { type: "content_block_delta", index: idx, delta: { type: "text_delta", text: e.text } });
      } else if (e.kind === "tool") {
        closeText();
        sawTool = true;
        idx++;
        const args = JSON.stringify(e.input);
        outChars += args.length;
        ev("content_block_start", {
          type: "content_block_start",
          index: idx,
          content_block: { type: "tool_use", id: e.id, name: e.name, input: {} },
        });
        ev("content_block_delta", { type: "content_block_delta", index: idx, delta: { type: "input_json_delta", partial_json: args } });
        ev("content_block_stop", { type: "content_block_stop", index: idx });
      } else if (e.kind === "usage") usage = e.usage;
    }
    closeText();
    const u = usage || { input: inEst, output: Math.max(1, Math.ceil(outChars / 4)) };
    ev("message_delta", {
      type: "message_delta",
      delta: { stop_reason: sawTool ? "tool_use" : "end_turn", stop_sequence: null },
      usage: { input_tokens: u.input, output_tokens: u.output },
    });
    ev("message_stop", { type: "message_stop" });
  } catch (e) {
    if (!res.destroyed) {
      const he = toHttpError(e);
      ev("error", { type: "error", error: { type: errType(he.status, "anthropic"), message: he.message } });
    }
  }
  res.end();
}

async function handleCountTokens(req, res) {
  const body = await readJson(req);
  const n = estimateTokens([body.system || "", body.messages || [], body.tools || []]);
  sendJson(res, 200, { input_tokens: n });
}

// ---------------------------------------------------------------- credits / usage dashboard
//
//  GET /usage        HTML page: one bar for all accounts together, one bar per account
//  GET /usage.json   same data as JSON
//
// Accounts (Puter tokens) are read on every request from, and merged:
//   - accounts.txt next to server.js   (or the file named in ACCOUNTS_FILE), one per line:  "token"  or  "label token"  or  "label: token"
//   - PUTER_ACCOUNTS env var            (same entries, separated by commas or new lines)
// If none are configured, the token sent with the request is used (so a single account works out of the box).
// Amounts come from puter.auth.getMonthlyUsage().allowanceInfo (Puter counts in microcents: $0.01 = 1,000,000).
// USAGE_KEY (optional): if set, /usage and /usage.json require ?key=... or an x-usage-key header.
// CREDIT_VALUE_MICROCENTS (optional): value of one dashboard "credit" in microcents, to show credits instead of dollars.

const USAGE_CACHE_MS = 20000;
const usageCache = new Map();

function parseAccounts(text) {
  const out = [];
  for (const raw of String(text || "").split(/[\n,]/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const m = line.match(/^(?:(.+?)\s*[:=]\s*|(\S+)\s+)?(\S+)$/);
    if (!m) continue;
    out.push({ label: (m[1] || m[2] || "").trim(), token: m[3] });
  }
  return out;
}

function loadAccounts(requestToken) {
  const found = [];
  const file = path.resolve(__dirname, process.env.ACCOUNTS_FILE || "accounts.txt");
  try {
    found.push(...parseAccounts(fs.readFileSync(file, "utf8")));
  } catch (e) {
    if (e.code !== "ENOENT") console.warn(`Could not read ${file}: ${e.message}`);
  }
  found.push(...parseAccounts(process.env.PUTER_ACCOUNTS));
  if (!found.length && requestToken) found.push({ label: "this request's token", token: requestToken });
  const seen = new Set();
  const accounts = [];
  for (const a of found) {
    if (seen.has(a.token)) continue;
    seen.add(a.token);
    accounts.push({ label: a.label || `account ${accounts.length + 1}`, token: a.token, id: fingerprint(a.token) });
  }
  return accounts;
}

function usageUnit() {
  const v = Number(process.env.CREDIT_VALUE_MICROCENTS);
  return v > 0 ? { name: "credits", symbol: "", divisor: v } : { name: "USD", symbol: "$", divisor: 1e8 };
}

const withTimeout = (p, ms) =>
  Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(`Puter did not answer within ${ms / 1000}s`)), ms))]);

async function accountUsage(acc, getPuter, force) {
  const hit = usageCache.get(acc.token);
  if (!force && hit && Date.now() - hit.t < USAGE_CACHE_MS) return hit.data;
  let data;
  try {
    const u = await withTimeout(Promise.resolve(getPuter(acc.token).auth.getMonthlyUsage()), 15000);
    const a = u?.allowanceInfo;
    const allowance = Number(a?.monthUsageAllowance);
    const remaining = Number(a?.remaining);
    if (!Number.isFinite(allowance) || !Number.isFinite(remaining)) {
      throw new Error("Unexpected answer from Puter (no allowanceInfo). Keys: " + Object.keys(u || {}).join(","));
    }
    const used = Math.max(0, allowance - remaining);
    data = { ok: true, allowance, remaining, used, percentUsed: allowance > 0 ? Math.round((used / allowance) * 10000) / 100 : 0 };
  } catch (e) {
    data = { ok: false, error: String(e?.message || e?.error?.message || e || "failed") };
  }
  usageCache.set(acc.token, { t: Date.now(), data });
  if (usageCache.size > 200) usageCache.delete(usageCache.keys().next().value);
  return data;
}

async function buildUsageReport(accounts, getPuter, force) {
  const results = await Promise.all(accounts.map((a) => accountUsage(a, getPuter, force)));
  const rows = accounts.map((a, i) => ({ label: a.label, id: a.id, ...results[i] })); // tokens are never included
  const okRows = rows.filter((r) => r.ok);
  const allowance = okRows.reduce((n, r) => n + r.allowance, 0);
  const used = okRows.reduce((n, r) => n + r.used, 0);
  const remaining = okRows.reduce((n, r) => n + r.remaining, 0);
  return {
    unit: usageUnit(),
    totals: {
      accounts: rows.length,
      ok: okRows.length,
      failed: rows.length - okRows.length,
      allowance,
      used,
      remaining,
      percentUsed: allowance > 0 ? Math.round((used / allowance) * 10000) / 100 : 0,
    },
    accounts: rows,
    generatedAt: new Date().toISOString(),
  };
}

const sameSecret = (a, b) =>
  crypto.timingSafeEqual(crypto.createHash("sha256").update(String(a)).digest(), crypto.createHash("sha256").update(String(b)).digest());

async function handleUsage(req, res, ctx, url, route) {
  res.removeHeader("Access-Control-Allow-Origin"); // quota data is not meant for other websites
  res.setHeader("Cache-Control", "no-store");
  if (process.env.USAGE_KEY) {
    const given = url.searchParams.get("key") || req.headers["x-usage-key"] || "";
    if (!sameSecret(given, process.env.USAGE_KEY)) {
      throw new HttpError(401, "Missing or wrong usage key. Use /usage?key=... or the x-usage-key header.");
    }
  }
  if (route === "/usage") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    return res.end(USAGE_PAGE);
  }
  const accounts = loadAccounts(ctx.token);
  if (!accounts.length) {
    throw new HttpError(400, "No accounts configured. Put one Puter token per line in accounts.txt (see accounts.example.txt) or set PUTER_ACCOUNTS.");
  }
  ctx.log(`usage accounts=${accounts.length}`);
  const report = await buildUsageReport(accounts, ctx.getPuter, url.searchParams.get("refresh") === "1");
  return sendJson(res, 200, report);
}

const USAGE_PAGE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Puter credits</title>
<style>
:root{--bg:#f6f7f9;--card:#fff;--ink:#14161a;--sub:#5d6573;--line:#e3e6eb;--track:#e9ecf1;--ok:#1f9d55;--warn:#d98a00;--bad:#d43b3b}
@media (prefers-color-scheme:dark){:root{--bg:#0f1115;--card:#171a20;--ink:#eceff4;--sub:#9aa3b2;--line:#262b34;--track:#252a33}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.45 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
main{max-width:760px;margin:0 auto;padding:28px 16px 48px}
h1{font-size:20px;margin:0 0 4px}
.sub,.small{color:var(--sub);font-size:13px}
.card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:18px;margin-top:16px}
.row{display:flex;justify-content:space-between;gap:12px;align-items:baseline;flex-wrap:wrap}
.big{font-size:26px;font-weight:650}
.bar{height:14px;background:var(--track);border-radius:99px;overflow:hidden;margin:10px 0 6px}
.bar>i{display:block;height:100%;width:0;background:var(--ok);border-radius:99px;transition:width .5s}
.bar.warn>i{background:var(--warn)}
.bar.bad>i{background:var(--bad)}
.acct{padding:12px 0;border-top:1px solid var(--line)}
.acct:first-child{border-top:0;padding-top:0}
.err{color:var(--bad);font-size:13px;margin-top:4px}
button{font:inherit;padding:7px 12px;border-radius:9px;border:1px solid var(--line);background:var(--card);color:var(--ink);cursor:pointer}
</style></head><body><main>
<div class="row"><div><h1>Puter credits</h1><div class="sub" id="status">Loading...</div></div><button id="refresh">Refresh now</button></div>
<div class="card" id="total"></div>
<div class="card" id="accounts"></div>
<script>
(function () {
  var q = new URLSearchParams(location.search);
  function url(force) {
    var p = new URLSearchParams();
    if (q.get("key")) p.set("key", q.get("key"));
    if (force) p.set("refresh", "1");
    var s = p.toString();
    return "usage.json" + (s ? "?" + s : "");
  }
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }
  function fmt(v, u) {
    var n = v / u.divisor;
    if (u.name === "USD") return "$" + n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 });
    return n.toLocaleString(undefined, { maximumFractionDigits: 0 }) + " " + u.name;
  }
  function bar(pct) {
    var b = el("div", "bar" + (pct >= 90 ? " bad" : pct >= 70 ? " warn" : ""));
    var i = el("i");
    i.style.width = Math.min(100, Math.max(0, pct)) + "%";
    b.appendChild(i);
    return b;
  }
  function render(d) {
    var u = d.unit, t = d.totals, tot = document.getElementById("total");
    tot.textContent = "";
    var r = el("div", "row");
    r.appendChild(el("div", "big", fmt(t.used, u) + " used"));
    r.appendChild(el("div", "small", "of " + fmt(t.allowance, u) + " total"));
    tot.appendChild(r);
    tot.appendChild(bar(t.percentUsed));
    var r2 = el("div", "row");
    r2.appendChild(el("div", "small", t.percentUsed.toFixed(1) + "% used"));
    r2.appendChild(el("div", "small", fmt(t.remaining, u) + " left - " + t.ok + " of " + t.accounts + " accounts"));
    tot.appendChild(r2);
    var box = document.getElementById("accounts");
    box.textContent = "";
    d.accounts.forEach(function (a) {
      var w = el("div", "acct"), h = el("div", "row");
      h.appendChild(el("strong", "", a.label));
      h.appendChild(el("span", "small", "id " + a.id));
      w.appendChild(h);
      if (a.ok) {
        w.appendChild(bar(a.percentUsed));
        var f = el("div", "row");
        f.appendChild(el("span", "small", fmt(a.used, u) + " of " + fmt(a.allowance, u) + " (" + a.percentUsed.toFixed(1) + "%)"));
        f.appendChild(el("span", "small", fmt(a.remaining, u) + " left"));
        w.appendChild(f);
      } else {
        w.appendChild(el("div", "err", a.error));
      }
      box.appendChild(w);
    });
    document.getElementById("status").textContent =
      "Updated " + new Date(d.generatedAt).toLocaleTimeString() + " - refreshes every 30s - amounts in " + (u.name === "USD" ? "US dollars" : "credits");
  }
  function load(force) {
    fetch(url(force))
      .then(function (r) {
        return r.json().then(function (j) {
          if (!r.ok) throw new Error((j.error && j.error.message) || "HTTP " + r.status);
          return j;
        });
      })
      .then(render)
      .catch(function (e) {
        document.getElementById("status").textContent = "Error: " + e.message;
      });
  }
  document.getElementById("refresh").onclick = function () { load(true); };
  load(false);
  setInterval(load, 30000);
})();
</script>
</main></body></html>`;

// ---------------------------------------------------------------- server

function createServer({ getPuter = defaultGetPuter, quiet = false } = {}) {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://localhost");
    const path = url.pathname.replace(/\/+$/, "").replace(/^\/v1(?=\/|$)/, "") || "/";
    const flavor = path.startsWith("/messages") ? "anthropic" : "openai";

    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    if (req.method === "OPTIONS") return res.writeHead(204).end();

    const token = getToken(req);
    const ac = new AbortController();
    res.on("close", () => {
      if (!res.writableEnded) ac.abort();
    });
    const log = (m) => {
      if (!quiet) console.log(`${new Date().toISOString()} acct=${token ? fingerprint(token) : "none"} ${m}`);
    };
    const ctx = { token, getPuter, signal: ac.signal, log };

    try {
      if (req.method === "GET" && (path === "/" || path === "/health")) {
        return sendJson(res, 200, { ok: true, service: "puter-claude-gateway" });
      }
      if (req.method === "GET" && (path === "/usage" || path === "/usage.json")) {
        return await handleUsage(req, res, ctx, url, path);
      }
      if (req.method === "GET" && path === "/models") {
        return sendJson(res, 200, {
          object: "list",
          data: MODELS.map((m) => ({ id: m, object: "model", type: "model", display_name: m, created: 0, owned_by: ownerOf(m) })),
        });
      }
      if (req.method === "GET" && path.startsWith("/models/")) {
        const id = decodeURIComponent(path.slice("/models/".length));
        return sendJson(res, 200, { id, object: "model", type: "model", display_name: id, created: 0, owned_by: ownerOf(id) });
      }
      if (req.method === "POST" && (path === "/chat/completions" || path === "/messages" || path === "/messages/count_tokens")) {
        if (path === "/messages/count_tokens") return await handleCountTokens(req, res);
        if (!token) {
          throw new HttpError(401, "Missing Puter token. Send it as x-puter-token, Authorization: Bearer, or x-api-key.");
        }
        return path === "/chat/completions"
          ? await handleOpenAIChat(req, res, ctx)
          : await handleAnthropicMessages(req, res, ctx);
      }
      throw new HttpError(404, `No route for ${req.method} ${url.pathname}`);
    } catch (e) {
      const he = toHttpError(e);
      log(`error ${he.status} ${he.message}`);
      if (res.headersSent) res.end();
      else sendError(res, flavor, he);
    }
  });
}

process.on("unhandledRejection", (e) => console.error("unhandledRejection:", e?.message || e));

module.exports = { createServer, resolveModel, effortFor, toHttpError, pickUsage, parseAccounts, buildUsageReport, MODELS };

if (require.main === module) {
  createServer().listen(PORT, HOST, () => {
    console.log(`Puter Claude Gateway on http://${HOST}:${PORT}`);
    console.log("  OpenAI    -> POST /v1/chat/completions");
    console.log("  Anthropic -> POST /v1/messages");
    console.log("  Credits   -> GET  /usage   (all accounts, one page)");
    console.log(ENV_TOKEN ? "  Fallback token loaded from PUTER_AUTH_TOKEN" : "  No fallback token: clients must send their own Puter token");
  });
}
