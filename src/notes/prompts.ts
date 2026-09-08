const MAX_TRANSCRIPT_CHARS = 60_000;

export function clipTranscript(text: string): string {
  if (text.length <= MAX_TRANSCRIPT_CHARS) return text;
  return (
    text.slice(0, MAX_TRANSCRIPT_CHARS) +
    '\n\n...[transcript truncated for length]...'
  );
}

const LANGUAGE_NAMES: Record<string, string> = {
  vi: 'Vietnamese',
  en: 'English',
  ja: 'Japanese',
  ko: 'Korean',
  zh: 'Chinese',
  fr: 'French',
  de: 'German',
  es: 'Spanish',
};

/** "vi" -> "Vietnamese (vi)"; unknown values pass through unchanged. */
export function displayLanguage(lang: string): string {
  const name = LANGUAGE_NAMES[lang.toLowerCase()];
  return name ? `${name} (${lang})` : lang;
}

function languageRule(outputLanguage?: string): string {
  return outputLanguage
    ? `Write ALL output in ${displayLanguage(outputLanguage)}, regardless of the transcript's language. Keep technical terms in their original language, adding a translation in parentheses where helpful.`
    : 'Write in the same language as the transcript.';
}

/** Prompt asking Gemini for the full structured lecture note as JSON. */
export function notePrompt(
  transcript: string,
  meta: { source: string; date: string },
  outputLanguage?: string
): string {
  return `You are an expert study assistant. A student attended an online class or meeting and needs high-quality study notes.

Read the transcript below and return ONLY a valid JSON object (no markdown fences, no commentary) with exactly this shape:

{
  "title": "short descriptive lecture title",
  "executiveSummary": "3-6 sentence summary of the whole session",
  "keyConcepts": ["concept 1", "concept 2", ...],
  "timeline": [{"time": "mm:ss or description", "event": "what happened / topic covered"}, ...],
  "definitions": [{"term": "...", "definition": "..."}, ...],
  "reviewQuestions": ["open question the student should be able to answer", ...],
  "quiz": [{"question": "...", "answer": "..."}, ...],
  "flashcards": [{"question": "...", "answer": "..."}, ...],
  "actionItems": ["homework / follow-up mentioned in the session", ...]
}

Rules:
- ${languageRule(outputLanguage)}
- 5-10 keyConcepts, 4-8 timeline entries, 3-8 definitions, 5 reviewQuestions, 5 quiz items with correct answers, 8-12 flashcards, and every explicit assignment/deadline as an actionItem (empty array if none).
- Base everything strictly on the transcript. Do not invent facts.

Session metadata: source=${meta.source}, date=${meta.date}

Transcript:
"""
${clipTranscript(transcript)}
"""`;
}

/** Prompt that maintains a rolling summary during a live session. */
export function rollingSummaryPrompt(
  previousSummary: string,
  newText: string,
  outputLanguage?: string
): string {
  return `You maintain a live rolling summary of an ongoing online class. Update the summary so a student joining late can catch up instantly.

Previous summary (may be empty):
"""
${previousSummary || '(none yet)'}
"""

New transcript since the last summary:
"""
${clipTranscript(newText)}
"""

Return ONLY the updated summary as at most 10 short markdown bullet points. ${languageRule(outputLanguage)} Keep still-relevant points from the previous summary, fold in the new content, and drop anything obsolete.`;
}
