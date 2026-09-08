export interface TranscriptSegment {
  /** Start time in seconds, when the source format provides one. */
  start?: number;
  /** End time in seconds, when the source format provides one. */
  end?: number;
  speaker?: string;
  text: string;
}
