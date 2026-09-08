import { isFreeTierModel, type Config } from './config.js';
import type { QuotaGuard } from './quotaGuard.js';

/** Thrown when AI is not usable (missing key, blocked model, ...). */
export class AiUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AiUnavailableError';
  }
}

export interface AiError {
  message: string;
  at: string;
}

export interface GenerateOptions {
  /** Override the default model for this call (e.g. a flash-lite model). */
  model?: string;
}

export interface AiClient {
  readonly available: boolean;
  readonly model: string;
  /** Most recent AI failure, cleared by the next successful call. */
  readonly lastError: AiError | null;
  generate(prompt: string, opts?: GenerateOptions): Promise<string>;
  generateJson<T>(prompt: string, opts?: GenerateOptions): Promise<T>;
}

interface GeminiResponse {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
  }>;
}

const API_BASE = 'https://generativelanguage.googleapis.com/v1beta';

export class GeminiClient implements AiClient {
  private _lastError: AiError | null = null;

  constructor(
    private readonly cfg: Pick<
      Config,
      'geminiApiKey' | 'geminiModel' | 'paidAiDisabled'
    >,
    private readonly quota: QuotaGuard,
    private readonly fetchImpl: typeof fetch = fetch
  ) {}

  get model(): string {
    return this.cfg.geminiModel;
  }

  get available(): boolean {
    return Boolean(this.cfg.geminiApiKey);
  }

  get lastError(): AiError | null {
    return this._lastError;
  }

  async generate(prompt: string, opts?: GenerateOptions): Promise<string> {
    try {
      const text = await this.doGenerate(prompt, opts);
      this._lastError = null;
      return text;
    } catch (err) {
      this._lastError = {
        message: err instanceof Error ? err.message : String(err),
        at: new Date().toISOString(),
      };
      throw err;
    }
  }

  private async doGenerate(
    prompt: string,
    opts?: GenerateOptions
  ): Promise<string> {
    const model = opts?.model?.trim() || this.cfg.geminiModel;

    if (!this.cfg.geminiApiKey) {
      throw new AiUnavailableError(
        'GEMINI_API_KEY is not set. Add it in Settings or .env (get a free key ' +
          'at https://aistudio.google.com/apikey) to enable AI features.'
      );
    }
    if (this.cfg.paidAiDisabled && !isFreeTierModel(model)) {
      throw new AiUnavailableError(
        `PAID_AI_DISABLED=true blocks model "${model}" because it is not ` +
          `on the known free-tier list. Pick a free-tier model such as ` +
          `gemini-3.8-flash, or explicitly set PAID_AI_DISABLED=false to accept paid usage.`
      );
    }

    // Throws QuotaExceededError with a clear message when the daily cap is hit.
    this.quota.assertCanCall();

    const url = `${API_BASE}/models/${encodeURIComponent(model)}:generateContent`;
    const res = await this.fetchImpl(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-goog-api-key': this.cfg.geminiApiKey,
      },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
      }),
    });

    if (!res.ok) {
      const body = (await res.text()).slice(0, 400);
      if (res.status === 429) {
        throw new Error(
          `Google free-tier limit reached for model "${model}" (HTTP 429). ` +
            `Google resets this daily. Switch to a flash-lite model in Settings ` +
            `(higher free limits) or wait for the reset. Details: ${body}`
        );
      }
      if (res.status === 401 || res.status === 403) {
        throw new Error(
          `Gemini rejected the API key (HTTP ${res.status}). Check/update the ` +
            `key in Settings. Details: ${body}`
        );
      }
      throw new Error(`Gemini API error ${res.status} (model ${model}): ${body}`);
    }

    // Only count calls that actually reached the API successfully.
    this.quota.recordCall();

    const data = (await res.json()) as GeminiResponse;
    const text =
      data.candidates?.[0]?.content?.parts
        ?.map((p) => p.text ?? '')
        .join('') ?? '';
    if (!text.trim()) {
      throw new Error('Gemini returned an empty response.');
    }
    return text;
  }

  async generateJson<T>(prompt: string, opts?: GenerateOptions): Promise<T> {
    const raw = await this.generate(prompt, opts);
    return extractJson<T>(raw);
  }
}

/** Extracts a JSON object from a model response (handles ``` fences and prose). */
export function extractJson<T>(raw: string): T {
  let text = raw.trim();
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) text = fence[1].trim();
  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  if (first === -1 || last <= first) {
    throw new Error('Model response did not contain a JSON object.');
  }
  return JSON.parse(text.slice(first, last + 1)) as T;
}
