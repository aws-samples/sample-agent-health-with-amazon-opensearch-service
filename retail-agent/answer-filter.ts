/**
 * Pure, dependency-free filtering of the agent's <answer> stream.
 *
 * The agent wraps its reply in <thinking>...</thinking> (internal) and
 * <answer>...</answer> (customer-facing). The frontend must only ever see the
 * answer body, streamed incrementally. This module contains the streaming state
 * machine and the snapshot stripper, kept free of server/SDK imports so it can
 * be unit tested directly.
 */

const ANSWER_OPEN = '<answer>';
const ANSWER_CLOSE = '</answer>';

/**
 * Largest k (< tag.length) such that buffer ends with tag.slice(0, k) — the
 * length of a partial tag that may complete in the next chunk.
 */
export function partialSuffixLen(buffer: string, tag: string): number {
  const maxk = Math.min(buffer.length, tag.length - 1);
  for (let k = maxk; k > 0; k--) {
    if (buffer.endsWith(tag.slice(0, k))) return k;
  }
  return 0;
}

/**
 * Extracts only the text between <answer> and </answer>, emitting deltas as they
 * arrive (no full-message buffering).
 *
 * Everything before <answer> (e.g. <thinking> blocks) and after </answer> is
 * suppressed. Tags split across chunk boundaries are handled by holding back a
 * short partial-tag suffix between calls.
 */
export class AnswerTagStreamFilter {
  private active = false; // inside the <answer> body
  private finished = false; // past </answer>
  private buffer = '';

  get done(): boolean {
    return this.finished;
  }

  /** Consume a raw delta; return the cleaned text to emit (possibly ""). */
  feed(delta: string): string {
    if (this.finished) return '';
    this.buffer += delta;

    if (!this.active) {
      const idx = this.buffer.indexOf(ANSWER_OPEN);
      if (idx === -1) {
        const keep = partialSuffixLen(this.buffer, ANSWER_OPEN);
        this.buffer = keep ? this.buffer.slice(this.buffer.length - keep) : '';
        return '';
      }
      this.active = true;
      this.buffer = this.buffer.slice(idx + ANSWER_OPEN.length);
    }

    const closeIdx = this.buffer.indexOf(ANSWER_CLOSE);
    if (closeIdx !== -1) {
      const emit = this.buffer.slice(0, closeIdx);
      this.buffer = '';
      this.finished = true;
      return emit;
    }

    const hold = partialSuffixLen(this.buffer, ANSWER_CLOSE);
    const emit = hold ? this.buffer.slice(0, this.buffer.length - hold) : this.buffer;
    this.buffer = hold ? this.buffer.slice(this.buffer.length - hold) : '';
    return emit;
  }
}

/**
 * Remove <thinking>...</thinking> blocks and <answer>/</answer> wrapper tags
 * from a complete string (used for non-streamed snapshot content).
 */
export function stripThinkingAndAnswerTags(text: string): string {
  let out = text.replace(/<thinking>[\s\S]*?<\/thinking>/g, '');
  out = out.replace(/<\/?answer>/g, '');
  return out.trim();
}
