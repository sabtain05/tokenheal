import { describe, expect, it } from 'vitest';
import { createStreamParser, healStream, type TokenHealEvent } from '../src/index';

async function* chunksFromString(text: string, chunkSize = 3): AsyncGenerator<string> {
  for (let i = 0; i < text.length; i += chunkSize) {
    yield text.slice(i, i + chunkSize);
  }
}

describe('StreamParser & healStream', () => {
  it('separates <thinking> tags split across tiny token chunks from text', async () => {
    const raw =
      '<thinking>Analyzing user request step by step.</thinking>Here is your answer!';

    const events: TokenHealEvent[] = [];
    for await (const ev of healStream(chunksFromString(raw, 2))) {
      events.push(ev);
    }

    const thinkingEvents = events.filter((e) => e.type === 'thinking');
    const textEvents = events.filter((e) => e.type === 'text');
    const doneEvent = events.find((e) => e.type === 'done');

    expect(thinkingEvents.length).toBeGreaterThan(1);
    expect(thinkingEvents.at(-1)?.content).toBe(
      'Analyzing user request step by step.'
    );
    expect(thinkingEvents.at(-1)?.isComplete).toBe(true);

    expect(textEvents.at(-1)?.content).toBe('Here is your answer!');
    expect(doneEvent).toEqual({
      type: 'done',
      text: 'Here is your answer!',
      thinking: 'Analyzing user request step by step.',
    });
  });

  it('heals fenced ```json blocks progressively and separates non-json code blocks', async () => {
    const raw = [
      'Sure, here is the user:\n',
      '```json\n{"name": "Ada", "skills": ["math", "code"]}\n```\n',
      'And a snippet:\n',
      '```ts\nconst x = 42;\n```',
    ].join('');

    const events: TokenHealEvent[] = [];
    for await (const ev of healStream(chunksFromString(raw, 4))) {
      events.push(ev);
    }

    const jsonEvents = events.filter((e) => e.type === 'json');
    const codeEvents = events.filter((e) => e.type === 'code');

    expect(jsonEvents.length).toBeGreaterThan(2);
    expect(jsonEvents[0]?.data).toEqual({});
    expect(jsonEvents.some((e) => e.data?.name === 'Ada')).toBe(true);
    expect(jsonEvents.at(-1)).toMatchObject({
      type: 'json',
      data: { name: 'Ada', skills: ['math', 'code'] },
      isComplete: true,
    });

    expect(codeEvents.at(-1)).toMatchObject({
      type: 'code',
      language: 'ts',
      code: 'const x = 42;\n',
      isComplete: true,
    });
  });

  it('extracts and heals <tool_call> payloads on the fly', async () => {
    const raw =
      'Let me check the weather.<tool_call>{"name": "get_weather", "arguments": {"city": "Tokyo", "days": 3}}</tool_call>';

    const events: TokenHealEvent[] = [];
    for await (const ev of healStream(chunksFromString(raw, 5))) {
      events.push(ev);
    }

    const toolEvents = events.filter((e) => e.type === 'tool_call');
    expect(toolEvents.length).toBeGreaterThan(1);
    expect(toolEvents.at(-1)).toMatchObject({
      type: 'tool_call',
      name: 'get_weather',
      arguments: { city: 'Tokyo', days: 3 },
      isComplete: true,
    });
  });

  it('handles raw JSON streams without markdown fences', async () => {
    const raw = '{"status":"ok","items":[1,2,3]}';
    const events: TokenHealEvent[] = [];

    for await (const ev of healStream(chunksFromString(raw, 3))) {
      events.push(ev);
    }

    const jsonEvents = events.filter((e) => e.type === 'json');
    expect(jsonEvents.length).toBeGreaterThan(2);
    expect(jsonEvents.at(-1)).toMatchObject({
      type: 'json',
      data: { status: 'ok', items: [1, 2, 3] },
      isComplete: true,
    });
  });

  it('supports Web ReadableStream with Uint8Array chunks', async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('<thought>Hmm</thought>'));
        controller.enqueue(encoder.encode('Done!'));
        controller.close();
      },
    });

    const events: TokenHealEvent[] = [];
    for await (const ev of healStream(stream, { thinkingTag: 'thought' })) {
      events.push(ev);
    }

    const done = events.find((e) => e.type === 'done');
    expect(done).toEqual({
      type: 'done',
      thinking: 'Hmm',
      text: 'Done!',
    });
  });

  it('resets parser state cleanly for reuse', () => {
    const parser = createStreamParser();
    parser.push('First stream');
    parser.flush();

    parser.reset();
    const events = parser.push('Second stream');
    expect(events).toEqual([
      { type: 'text', delta: 'Second stream', content: 'Second stream' },
    ]);
  });
});