// Global Alert Feed — LLM transport for gpt-oss-20b.
//
// Every call in this pipeline uses GRAMMAR-CONSTRAINED DECODING. There is no
// free-text parsing anywhere: the model cannot emit a token that violates the
// schema, so an enum field cannot contain a value we didn't authorize.
//
// ── Backends ────────────────────────────────────────────────────────────────
// The spec called for vLLM. Nothing is listening on :8000; what is actually
// serving gpt-oss-20b on this machine is Ollama on :11434. They constrain
// output through DIFFERENT, non-interchangeable request fields, and I verified
// this empirically rather than assuming:
//
//   vLLM  (OpenAI /v1/chat/completions)
//       guided_json: <schema>
//       chat_template_kwargs: { reasoning_effort: 'low' }
//
//   Ollama (native /api/chat)
//       format: <schema>
//       think: 'low'
//
// Ollama's OpenAI-compatible /v1 endpoint SILENTLY IGNORES both `guided_json`
// and `response_format: {type:'json_schema'}` — measured: it spent all 300
// tokens on chain-of-thought and returned `content: ""`. So we must speak each
// server's native dialect. Set VITE_LLM_BACKEND=vllm to switch.
//
// Scope: used only by the Global Alert Feed pipeline. The existing Ollama-based
// services (statementAi, securityAi, healthAi, …) keep their own transport.

export type LlmBackend = 'ollama' | 'vllm';
export type ReasoningEffort = 'low' | 'medium' | 'high';

const BACKEND = (import.meta.env.VITE_LLM_BACKEND ?? 'ollama') as LlmBackend;
const OLLAMA_URL = import.meta.env.VITE_OLLAMA_URL ?? 'http://localhost:11434';
const VLLM_URL = import.meta.env.VITE_VLLM_URL ?? 'http://localhost:8000/v1';
const MODEL = import.meta.env.VITE_LLM_MODEL ?? (BACKEND === 'vllm' ? 'gpt-oss-20b' : 'gpt-oss:20b');

export interface GuidedCallOptions {
  system: string;
  user: string;
  /** JSON Schema. The decoder is constrained to it. */
  schema: Record<string, unknown>;
  reasoningEffort: ReasoningEffort;
  maxTokens?: number;
  timeoutMs?: number;
}

export class LlmError extends Error {
  // Declared explicitly rather than as a parameter property: this project has
  // `erasableSyntaxOnly` enabled, which forbids that TS-only shorthand.
  status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = 'LlmError';
    this.status = status;
  }
}

function buildRequest(o: GuidedCallOptions): { url: string; body: unknown; pick: (d: any) => unknown } {
  const messages = [
    { role: 'system', content: o.system },
    { role: 'user', content: o.user },
  ];

  if (BACKEND === 'vllm') {
    return {
      url: `${VLLM_URL}/chat/completions`,
      body: {
        model: MODEL,
        messages,
        temperature: 0, // classification must be reproducible
        max_tokens: o.maxTokens ?? 1024,
        guided_json: o.schema,
        chat_template_kwargs: { reasoning_effort: o.reasoningEffort },
      },
      pick: (d) => d?.choices?.[0]?.message?.content,
    };
  }

  return {
    url: `${OLLAMA_URL}/api/chat`,
    body: {
      model: MODEL,
      messages,
      stream: false,
      format: o.schema,          // ← Ollama's constrained decoding
      think: o.reasoningEffort,  // ← gpt-oss reasoning budget
      options: { temperature: 0, num_predict: o.maxTokens ?? 1024 },
    },
    // Ollama puts chain-of-thought in `thinking`, the constrained answer in `content`.
    pick: (d) => d?.message?.content,
  };
}

/**
 * One grammar-constrained completion. Returns the parsed object.
 * Throws LlmError — callers decide whether that means "skip this batch" or
 * "fail the stage". It never returns a partially-parsed or guessed value.
 */
export async function guidedJson<T>(opts: GuidedCallOptions): Promise<T> {
  const { url, body, pick } = buildRequest(opts);

  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(opts.timeoutMs ?? 120000),
      body: JSON.stringify(body),
    });
  } catch (err) {
    throw new LlmError(`${BACKEND} unreachable at ${url}: ${String(err)}`);
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new LlmError(`${BACKEND} responded ${res.status}: ${text.slice(0, 200)}`, res.status);
  }

  const data = await res.json();
  const content = pick(data);
  if (typeof content !== 'string' || content.trim() === '') {
    // Empty content under a schema means the server ignored the constraint and
    // burned its budget reasoning. That is a config error, not bad luck.
    throw new LlmError(
      `${BACKEND} returned no constrained content — is schema-guided decoding supported? ` +
      `(finish_reason=${data?.choices?.[0]?.finish_reason ?? data?.done_reason ?? '?'})`
    );
  }

  try {
    return JSON.parse(content) as T;
  } catch {
    throw new LlmError(`constrained decoding produced non-JSON: ${content.slice(0, 160)}`);
  }
}

export const LLM_BACKEND = BACKEND;
export const LLM_MODEL = MODEL;
export const LLM_ENDPOINT = BACKEND === 'vllm' ? VLLM_URL : OLLAMA_URL;
