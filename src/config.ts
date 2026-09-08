import 'dotenv/config';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export interface Config {
  port: number;
  geminiApiKey: string | undefined;
  geminiModel: string;
  /** Model for rolling summaries ('' = same as geminiModel). */
  summaryModel: string;
  paidAiDisabled: boolean;
  maxDailyCalls: number;
  watchDir: string;
  vaultDir: string;
  dataDir: string;
  summaryEveryChunks: number;
  summaryEveryMinutes: number;
  watchDisabled: boolean;
  /** Language for generated notes/summaries ('' = same as the transcript). */
  outputLanguage: string;
}

/**
 * Models known to be available on the Google AI Studio free tier.
 * While PAID_AI_DISABLED=true, only these models may be used.
 */
export const FREE_TIER_MODELS = [
  'gemini-3.8-flash',
  'gemini-3.7-flash',
  'gemini-3.6-flash',
  'gemini-3.5-flash',
  'gemini-3.5-flash-lite',
  'gemini-3.1-flash-lite',
  'gemini-flash-latest',
  'gemini-flash-lite-latest',
  'gemini-2.5-flash',
  'gemini-2.5-flash-lite',
  'gemini-2.0-flash',
  'gemini-2.0-flash-lite',
  'gemini-1.5-flash',
  'gemini-1.5-flash-8b',
];

export function isFreeTierModel(model: string): boolean {
  return FREE_TIER_MODELS.some((m) => model === m || model.startsWith(`${m}-`));
}

function toBool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value.trim() === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
}

function toInt(value: string | undefined, fallback: number): number {
  const n = Number.parseInt(value ?? '', 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

// Like toInt but allows 0 (e.g. MAX_DAILY_CALLS=0 blocks all AI calls).
function toNonNegInt(value: string | undefined, fallback: number): number {
  const n = Number.parseInt(value ?? '', 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

export function expandHome(p: string): string {
  if (p === '~') return os.homedir();
  if (p.startsWith('~/') || p.startsWith('~\\')) {
    return path.join(os.homedir(), p.slice(2));
  }
  return p;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return {
    port: toInt(env.PORT, 3456),
    geminiApiKey: env.GEMINI_API_KEY?.trim() || undefined,
    geminiModel: env.GEMINI_MODEL?.trim() || 'gemini-2.5-flash',
    summaryModel: env.GEMINI_SUMMARY_MODEL?.trim() || '',
    paidAiDisabled: toBool(env.PAID_AI_DISABLED, true),
    maxDailyCalls: toNonNegInt(env.MAX_DAILY_CALLS, 20),
    watchDir: expandHome(env.WATCH_DIR?.trim() || '~/Documents/Zoom'),
    vaultDir: expandHome(env.VAULT_DIR?.trim() || '~/LearningVault'),
    dataDir: expandHome(env.DATA_DIR?.trim() || '~/.learning-harness'),
    summaryEveryChunks: toInt(env.SUMMARY_EVERY_CHUNKS, 10),
    summaryEveryMinutes: toInt(env.SUMMARY_EVERY_MINUTES, 5),
    watchDisabled: toBool(env.WATCH_DISABLED, false),
    outputLanguage: env.OUTPUT_LANGUAGE?.trim() || '',
  };
}

/**
 * Upserts KEY=value lines in a .env file (creating the file when missing),
 * preserving unrelated lines and comments. Used by the Settings UI.
 */
export function updateEnvFile(
  envPath: string,
  updates: Record<string, string>
): void {
  let content = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';
  for (const [key, value] of Object.entries(updates)) {
    const line = `${key}=${value}`;
    const re = new RegExp(`^${key}=.*$`, 'm');
    if (re.test(content)) {
      content = content.replace(re, line);
    } else {
      if (content && !content.endsWith('\n')) content += '\n';
      content += `${line}\n`;
    }
  }
  fs.writeFileSync(envPath, content, 'utf8');
}
