import { healJsonWithMeta } from './json-healer.js';
import type {
  TokenHealEvent,
  TokenHealOptions,
} from './types.js';

type ParserMode =
  | 'text'
  | 'thinking'
  | 'tool_call'
  | 'code'
  | 'json_fence'
  | 'raw_json';

/**
 * Stateful streaming parser that separates raw LLM token streams into
 * typed events (`text`, `thinking`, `json`, `tool_call`, `code`, `done`)
 * and heals incomplete JSON payloads in real time.
 */
export class StreamParser<T = Record<string, unknown>> {
  private readonly thinkingOpen: string;
  private readonly thinkingClose: string;
  private readonly toolOpen: string;
  private readonly toolClose: string;

  private mode: ParserMode = 'text';
  private buffer = '';

  // Accumulated outputs
  private fullText = '';
  private fullThinking = '';
  private blockBuffer = '';
  private codeLanguage = '';
  private jsonDepth = 0;
  private jsonInString = false;
  private jsonEscape = false;

  constructor(options: TokenHealOptions = {}) {
    const thinkingTag = options.thinkingTag ?? 'thinking';
    const toolTag = options.toolTag ?? 'tool_call';

    this.thinkingOpen = `<${thinkingTag}>`;
    this.thinkingClose = `</${thinkingTag}>`;
    this.toolOpen = `<${toolTag}>`;
    this.toolClose = `</${toolTag}>`;
  }

  /**
   * Push a new raw string chunk from the AI stream and receive zero or more typed events.
   */
  public push(chunk: string): TokenHealEvent<T>[] {
    if (!chunk) return [];
    this.buffer += chunk;
    return this.drain(false);
  }

  /**
   * Signal the end of the stream, flushing any remaining buffered characters
   * and emitting a final `done` event.
   */
  public flush(): TokenHealEvent<T>[] {
    const events = this.drain(true);
    events.push({
      type: 'done',
      text: this.fullText,
      thinking: this.fullThinking,
    });
    return events;
  }

  /**
   * Reset internal state so the parser instance can be reused for a new stream.
   */
  public reset(): void {
    this.mode = 'text';
    this.buffer = '';
    this.fullText = '';
    this.fullThinking = '';
    this.blockBuffer = '';
    this.codeLanguage = '';
    this.jsonDepth = 0;
    this.jsonInString = false;
    this.jsonEscape = false;
  }

  private drain(isFinal: boolean): TokenHealEvent<T>[] {
    const events: TokenHealEvent<T>[] = [];

    while (this.buffer.length > 0) {
      if (this.mode === 'text') {
        const progressed = this.processTextMode(events, isFinal);
        if (!progressed) break;
      } else if (this.mode === 'thinking') {
        const progressed = this.processXmlBlockMode(
          events,
          this.thinkingClose,
          'thinking',
          isFinal
        );
        if (!progressed) break;
      } else if (this.mode === 'tool_call') {
        const progressed = this.processToolMode(events, isFinal);
        if (!progressed) break;
      } else if (this.mode === 'code' || this.mode === 'json_fence') {
        const progressed = this.processFenceMode(events, isFinal);
        if (!progressed) break;
      } else if (this.mode === 'raw_json') {
        const progressed = this.processRawJsonMode(events, isFinal);
        if (!progressed) break;
      }
    }

    return events;
  }

  private processTextMode(events: TokenHealEvent<T>[], isFinal: boolean): boolean {
    // Detect raw JSON stream at the very beginning of output (before any text)
    if (this.fullText.length === 0 && this.fullThinking.length === 0) {
      const trimmedLead = this.buffer.trimStart();
      if (trimmedLead.startsWith('{') || trimmedLead.startsWith('[')) {
        const leadingWsLen = this.buffer.length - trimmedLead.length;
        this.buffer = this.buffer.slice(leadingWsLen);
        this.mode = 'raw_json';
        this.blockBuffer = '';
        this.jsonDepth = 0;
        this.jsonInString = false;
        this.jsonEscape = false;
        return true;
      }
    }

    // Find the earliest structural marker in the buffer
    const markers = [
      { tag: this.thinkingOpen, nextMode: 'thinking' as const },
      { tag: this.toolOpen, nextMode: 'tool_call' as const },
      { tag: '```', nextMode: 'fence' as const },
    ];

    let earliestIdx = -1;
    let matchedMarker: (typeof markers)[number] | null = null;

    for (const marker of markers) {
      const idx = this.buffer.indexOf(marker.tag);
      if (idx !== -1 && (earliestIdx === -1 || idx < earliestIdx)) {
        earliestIdx = idx;
        matchedMarker = marker;
      }
    }

    if (matchedMarker && earliestIdx !== -1) {
      // Emit any plain text before the marker
      if (earliestIdx > 0) {
        const textDelta = this.buffer.slice(0, earliestIdx);
        this.emitText(events, textDelta);
      }

      this.buffer = this.buffer.slice(earliestIdx + matchedMarker.tag.length);

      if (matchedMarker.nextMode === 'fence') {
        // Wait for newline after ``` to read the language identifier (e.g., ```json or ```ts)
        const newlineIdx = this.buffer.indexOf('\n');
        if (newlineIdx === -1 && !isFinal) {
          // Put ``` back and wait for the rest of the header line
          this.buffer = '```' + this.buffer;
          return false;
        }

        const headerEnd = newlineIdx === -1 ? this.buffer.length : newlineIdx;
        const lang = this.buffer.slice(0, headerEnd).trim().toLowerCase();
        this.buffer = newlineIdx === -1 ? '' : this.buffer.slice(newlineIdx + 1);

        this.blockBuffer = '';
        this.codeLanguage = lang;
        this.mode = lang === 'json' ? 'json_fence' : 'code';
        return true;
      }

      this.blockBuffer = '';
      this.mode = matchedMarker.nextMode;
      return true;
    }

    // No full marker found; check if the tail could be a partial prefix of a marker
    if (!isFinal) {
      const holdBack = this.computePartialMarkerHoldback(
        this.buffer,
        markers.map((m) => m.tag)
      );

      if (holdBack > 0) {
        const safeLength = this.buffer.length - holdBack;
        if (safeLength > 0) {
          this.emitText(events, this.buffer.slice(0, safeLength));
          this.buffer = this.buffer.slice(safeLength);
        }
        return false;
      }
    }

    // Safe to flush entire buffer as text
    this.emitText(events, this.buffer);
    this.buffer = '';
    return true;
  }

  private processXmlBlockMode(
    events: TokenHealEvent<T>[],
    closeTag: string,
    kind: 'thinking',
    isFinal: boolean
  ): boolean {
    const closeIdx = this.buffer.indexOf(closeTag);

    if (closeIdx !== -1) {
      const delta = this.buffer.slice(0, closeIdx);
      this.fullThinking += delta;
      this.buffer = this.buffer.slice(closeIdx + closeTag.length);
      this.mode = 'text';

      events.push({
        type: kind,
        delta,
        content: this.fullThinking,
        isComplete: true,
      });
      return true;
    }

    const holdBack = isFinal
      ? 0
      : this.computePartialMarkerHoldback(this.buffer, [closeTag]);
    const safeLen = this.buffer.length - holdBack;

    if (safeLen > 0) {
      const delta = this.buffer.slice(0, safeLen);
      this.fullThinking += delta;
      this.buffer = this.buffer.slice(safeLen);

      events.push({
        type: kind,
        delta,
        content: this.fullThinking,
        isComplete: isFinal,
      });
    }

    if (isFinal) {
      this.mode = 'text';
    }

    return safeLen > 0;
  }

  private processToolMode(events: TokenHealEvent<T>[], isFinal: boolean): boolean {
    const closeIdx = this.buffer.indexOf(this.toolClose);

    if (closeIdx !== -1) {
      this.blockBuffer += this.buffer.slice(0, closeIdx);
      this.buffer = this.buffer.slice(closeIdx + this.toolClose.length);
      this.mode = 'text';

      this.emitToolEvent(events, true);
      this.blockBuffer = '';
      return true;
    }

    const holdBack = isFinal
      ? 0
      : this.computePartialMarkerHoldback(this.buffer, [this.toolClose]);
    const safeLen = this.buffer.length - holdBack;

    if (safeLen > 0) {
      this.blockBuffer += this.buffer.slice(0, safeLen);
      this.buffer = this.buffer.slice(safeLen);
      this.emitToolEvent(events, isFinal);
    }

    if (isFinal) {
      this.mode = 'text';
      this.blockBuffer = '';
    }

    return safeLen > 0;
  }

  private processFenceMode(events: TokenHealEvent<T>[], isFinal: boolean): boolean {
    const closeIdx = this.buffer.indexOf('```');

    if (closeIdx !== -1) {
      const delta = this.buffer.slice(0, closeIdx);
      this.blockBuffer += delta;
      this.buffer = this.buffer.slice(closeIdx + 3);

      // Consume optional trailing newline right after closing ```
      if (this.buffer.startsWith('\r\n')) {
        this.buffer = this.buffer.slice(2);
      } else if (this.buffer.startsWith('\n')) {
        this.buffer = this.buffer.slice(1);
      }

      if (this.mode === 'json_fence') {
        this.emitJsonEvent(events, true);
      } else {
        events.push({
          type: 'code',
          language: this.codeLanguage,
          delta,
          code: this.blockBuffer,
          isComplete: true,
        });
      }

      this.blockBuffer = '';
      this.codeLanguage = '';
      this.mode = 'text';
      return true;
    }

    const holdBack = isFinal
      ? 0
      : this.computePartialMarkerHoldback(this.buffer, ['```']);
    const safeLen = this.buffer.length - holdBack;

    if (safeLen > 0) {
      const delta = this.buffer.slice(0, safeLen);
      this.blockBuffer += delta;
      this.buffer = this.buffer.slice(safeLen);

      if (this.mode === 'json_fence') {
        this.emitJsonEvent(events, isFinal);
      } else {
        events.push({
          type: 'code',
          language: this.codeLanguage,
          delta,
          code: this.blockBuffer,
          isComplete: isFinal,
        });
      }
    }

    if (isFinal) {
      this.blockBuffer = '';
      this.codeLanguage = '';
      this.mode = 'text';
    }

    return safeLen > 0;
  }

  private processRawJsonMode(events: TokenHealEvent<T>[], isFinal: boolean): boolean {
    let consumed = 0;
    let completedRoot = false;

    for (let i = 0; i < this.buffer.length; i++) {
      const ch = this.buffer[i]!;
      consumed++;

      if (this.jsonInString) {
        if (this.jsonEscape) {
          this.jsonEscape = false;
        } else if (ch === '\\') {
          this.jsonEscape = true;
        } else if (ch === '"') {
          this.jsonInString = false;
        }
        continue;
      }

      if (ch === '"') {
        this.jsonInString = true;
      } else if (ch === '{' || ch === '[') {
        this.jsonDepth++;
      } else if (ch === '}' || ch === ']') {
        this.jsonDepth--;
        if (this.jsonDepth <= 0) {
          completedRoot = true;
          break;
        }
      }
    }

    this.blockBuffer += this.buffer.slice(0, consumed);
    this.buffer = this.buffer.slice(consumed);

    this.emitJsonEvent(events, completedRoot || isFinal);

    if (completedRoot || isFinal) {
      this.blockBuffer = '';
      this.mode = 'text';
    }

    return consumed > 0;
  }

  private emitText(events: TokenHealEvent<T>[], delta: string): void {
    if (!delta) return;
    this.fullText += delta;
    events.push({
      type: 'text',
      delta,
      content: this.fullText,
    });
  }

  private emitJsonEvent(events: TokenHealEvent<T>[], forceComplete: boolean): void {
    const result = healJsonWithMeta<T>(this.blockBuffer);
    if (result.value !== null) {
      events.push({
        type: 'json',
        data: result.value,
        raw: this.blockBuffer,
        isComplete: forceComplete || result.wasComplete,
      });
    }
  }

  private emitToolEvent(events: TokenHealEvent<T>[], isComplete: boolean): void {
    const result = healJsonWithMeta<Record<string, unknown>>(this.blockBuffer);
    if (result.value !== null && typeof result.value === 'object') {
      const payload = result.value;
      const name = typeof payload.name === 'string' ? payload.name : undefined;
      const args = (
        payload.arguments && typeof payload.arguments === 'object'
          ? payload.arguments
          : payload
      ) as T;

      events.push({
        type: 'tool_call',
        ...(name ? { name } : {}),
        arguments: args,
        raw: this.blockBuffer,
        isComplete,
      });
    }
  }

  /**
   * Computes how many trailing characters in `text` match a prefix of any marker
   * so we don't accidentally emit half of `<thinking>` or ```` ``` ```` as plain text.
   */
  private computePartialMarkerHoldback(text: string, markers: string[]): number {
    let maxHold = 0;
    for (const marker of markers) {
      const maxCheck = Math.min(text.length, marker.length - 1);
      for (let len = maxCheck; len >= 1; len--) {
        if (text.endsWith(marker.slice(0, len))) {
          if (len > maxHold) {
            maxHold = len;
          }
          break;
        }
      }
    }
    return maxHold;
  }
}