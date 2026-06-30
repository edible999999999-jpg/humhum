/**
 * Streaming sentence splitter.
 * Accumulates LLM tokens and emits complete sentences at boundaries.
 *
 * Strategy:
 * - First sentence: cap at ~20 tokens for fast initial TTS (low TTFB)
 * - Subsequent sentences: emit at natural boundaries (。！？. ! ?)
 * - Fallback: split at clause boundaries (，, ; ：) if sentence gets too long
 * - Hard cut at maxChars if no boundary found
 */

export interface SentenceChunk {
  text: string;
  index: number;
  isLast: boolean;
}

export class SentenceSplitter {
  private buffer = "";
  private sentenceIndex = 0;
  private isFirstSentence = true;
  private readonly firstSentenceMaxChars: number;
  private readonly maxChars: number;

  constructor(opts?: { firstSentenceMaxChars?: number; maxChars?: number }) {
    this.firstSentenceMaxChars = opts?.firstSentenceMaxChars ?? 60;
    this.maxChars = opts?.maxChars ?? 200;
  }

  /** Feed a token (or chunk of tokens) from the LLM stream */
  feed(token: string): SentenceChunk[] {
    this.buffer += token;
    const chunks: SentenceChunk[] = [];

    while (this.buffer.length > 0) {
      const maxLen = this.isFirstSentence
        ? this.firstSentenceMaxChars
        : this.maxChars;

      // Try to find a sentence boundary
      const sentenceEnd = findSentenceBoundary(this.buffer, maxLen);

      if (sentenceEnd > 0) {
        const sentence = this.buffer.slice(0, sentenceEnd).trim();
        this.buffer = this.buffer.slice(sentenceEnd);

        if (sentence.length > 1 && /\w|[一-鿿]/.test(sentence)) {
          chunks.push({
            text: sentence,
            index: this.sentenceIndex++,
            isLast: false,
          });
          this.isFirstSentence = false;
        }
      } else if (this.buffer.length >= maxLen) {
        // Force split at clause boundary or hard cut
        const clauseEnd = findClauseBoundary(this.buffer, maxLen);
        const splitAt = clauseEnd > 0 ? clauseEnd : maxLen;

        const fragment = this.buffer.slice(0, splitAt).trim();
        this.buffer = this.buffer.slice(splitAt);

        if (fragment.length > 0) {
          chunks.push({
            text: fragment,
            index: this.sentenceIndex++,
            isLast: false,
          });
          this.isFirstSentence = false;
        }
      } else {
        // Not enough text yet, wait for more
        break;
      }
    }

    return chunks;
  }

  /** Flush any remaining buffer as the final chunk */
  flush(): SentenceChunk | null {
    const remaining = this.buffer.trim();
    if (remaining.length <= 1 || !/\w|[一-鿿]/.test(remaining)) return null;

    this.buffer = "";
    return {
      text: remaining,
      index: this.sentenceIndex++,
      isLast: true,
    };
  }

  /** Reset the splitter state for a new stream */
  reset(): void {
    this.buffer = "";
    this.sentenceIndex = 0;
    this.isFirstSentence = true;
  }
}

// Chinese and English sentence-ending punctuation
const SENTENCE_ENDINGS = /[。！？.!?]\s*/;
const CLAUSE_ENDINGS = /[，,；;：:]\s*/;

function findSentenceBoundary(text: string, maxLen: number): number {
  const searchArea = text.slice(0, maxLen);
  let lastMatch = -1;

  const regex = new RegExp(SENTENCE_ENDINGS.source, "g");
  let match: RegExpExecArray | null;
  while ((match = regex.exec(searchArea)) !== null) {
    lastMatch = match.index + match[0].length;
  }

  return lastMatch;
}

function findClauseBoundary(text: string, maxLen: number): number {
  const searchArea = text.slice(0, maxLen);
  let lastMatch = -1;

  const regex = new RegExp(CLAUSE_ENDINGS.source, "g");
  let match: RegExpExecArray | null;
  while ((match = regex.exec(searchArea)) !== null) {
    lastMatch = match.index + match[0].length;
  }

  return lastMatch;
}
