import { StreamParser } from './stream-parser';
import type { TokenHealEvent, TokenHealOptions } from './types';

export {
  healJson,
  healJsonWithMeta,
  repairJsonString,
} from './json-healer';

export { StreamParser } from './stream-parser';

export type {
  CodeBlockEvent,
  DoneEvent,
  HealResult,
  JsonEvent,
  TextEvent,
  ThinkingEvent,
  TokenHealEvent,
  TokenHealOptions,
  ToolCallEvent,
} from './types';

export type TokenStreamInput =
  | AsyncIterable<string | Uint8Array>
  | ReadableStream<string | Uint8Array>;

export function createStreamParser<T = Record<string, unknown>>(
  options?: TokenHealOptions
): StreamParser<T> {
  return new StreamParser<T>(options);
}

export async function* healStream<T = Record<string, unknown>>(
  source: TokenStreamInput,
  options?: TokenHealOptions
): AsyncGenerator<TokenHealEvent<T>, void, unknown> {
  const parser = new StreamParser<T>(options);
  const decoder = new TextDecoder();

  for await (const chunk of toAsyncIterable(source)) {
    const textChunk =
      typeof chunk === 'string'
        ? chunk
        : decoder.decode(chunk, { stream: true });

    const events = parser.push(textChunk);
    for (const event of events) {
      yield event;
    }
  }

  const trailing = decoder.decode();
  if (trailing) {
    for (const event of parser.push(trailing)) {
      yield event;
    }
  }

  for (const event of parser.flush()) {
    yield event;
  }
}

async function* toAsyncIterable(
  source: TokenStreamInput
): AsyncIterable<string | Uint8Array> {
  if (Symbol.asyncIterator in source) {
    yield* source;
    return;
  }

  const reader = (source as ReadableStream<string | Uint8Array>).getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value !== undefined) {
        yield value;
      }
    }
  } finally {
    reader.releaseLock();
  }
}