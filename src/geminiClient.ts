import { isFreeTierModel, type Config } from './config.js';
import type { QuotaGuard } from './quotaGuard.js';

/** Thrown when AI is not usable (missing key, blocked model, ...). */
export class AiUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AiUnavailableError';
  }
}

export interface AiClient {
  readonly available: boolean;
  readonly model: string;
  generate(prompt: string): Promise<string>;
  generateJson<T>(prompt: string): Promise<T>;
}

interface GeminiResponse {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
  }>;
}

const API_BASE = 'https://generativelanguage.googleapis.com/v1beta';

export class GeminiClient implements AiClient {
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

  async generate(prompt: string): Promise<string> {
    if (!this.cfg.geminiApiKey) {
      throw new AiUnavailableError(
        'GEMINI_API_KEY is not set. Add it to .env (get a free key at ' +
          'https://aistudio.google.com/apikey) to enable AI features.'
      );
    }
    if (this.cfg.paidAiDisabled && !isFreeTierModel(this.cfg.geminiModel)) {
      throw new AiUnavailableError(
        `PAID_AI_DISABLED=true blocks model "${this.cfg.geminiModel}" because it is not ` +
          `on the known free-tier list. Set GEMINI_MODEL to a free-tier model such as ` +
          `gemini-2.5-flash, or explicitly set PAID_AI_DISABLED=false to accept paid usage.`
      );
    }

    // Throws QuotaExceededError with a clear message when the daily cap is hit.
    this.quota.assertCanCall();

    const url = `${API_BASE}/models/${encodeURIComponent(this.cfg.geminiModel)}:generateContent`;
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
      const body = (await res.text()).slice(0, 500);
      throw new Error(`Gemini API error ${res.status}: ${body}`);
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

  async generateJson<T>(prompt: string): Promise<T> {
    const raw = await this.generate(prompt);
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
