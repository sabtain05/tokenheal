# tokenheal

**On-the-fly JSON healing and clean stream event separation for AI responses.**

---

## The Problem

- **Broken Real-Time UIs:** LLMs stream responses token-by-token, breaking `JSON.parse()` until the entire stream finishes.
- **Messy Response Formats:** Raw streams mix user-facing prose, markdown code blocks, `<thinking>` logs, and `<tool_call>` payloads into one chaotic string.
- **Repetitive Boilerplate:** Developers waste hours writing fragile regex hacks and custom buffers across every frontend and backend project.

## The Solution

- **On-the-Fly JSON Healing:** Automatically closes incomplete brackets, braces, quotes, numbers, and literals on every incoming chunk so UIs render structured data immediately.
- **Clean Event Separation:** Splits raw streams into typed, predictable events (`text`, `thinking`, `json`, `tool_call`, `code`, `done`).
- **Universal Zero-Dependency Core:** Lightweight TypeScript with **0 runtime dependencies**—works in React, Node.js, Bun, Deno, and Edge workers in three lines of code.

---

## Installation

```bash
npm install tokenheal
# or
pnpm add tokenheal
# or
bun add tokenheal

```

---

## Quick Start (3 Lines of Code)

```ts
import { healStream } from 'tokenheal';

for await (const event of healStream(aiStream)) {
  if (event.type === 'json') renderUI(event.data); // Valid JS object on every token!
}

```

### Handling All Stream Events

`healStream()` accepts any `AsyncIterable<string | Uint8Array>` or Web `ReadableStream`:

```ts
import { healStream } from 'tokenheal';

interface WeatherArgs {
  city: string;
  days: number;
}

for await (const event of healStream<WeatherArgs>(response.body!)) {
  switch (event.type) {
    case 'thinking':
      console.log('Model reasoning:', event.content);
      break;
    case 'text':
      process.stdout.write(event.delta);
      break;
    case 'json':
      updateStructuredCard(event.data);
      break;
    case 'tool_call':
      console.log(`Calling ${event.name}:`, event.arguments);
      break;
    case 'code':
      renderCodeBlock(event.language, event.code);
      break;
    case 'done':
      console.log('Stream complete!');
      break;
  }
}

```

---

## API Reference

### `healStream(source, options?)`

Async generator that consumes an `AsyncIterable` or `ReadableStream` and yields typed `TokenHealEvent` objects:

| Event `type` | Payload Fields | Description |
| --- | --- | --- |
| `'text'` | `delta`, `content` | Clean user-facing prose outside tags/fences |
| `'thinking'` | `delta`, `content`, `isComplete` | Reasoning extracted from `<thinking>...</thinking>` |
| `'json'` | `data`, `raw`, `isComplete` | Live-healed JS object from raw JSON or ````json` blocks |
| `'tool_call'` | `name?`, `arguments`, `raw`, `isComplete` | Live-healed tool payload from `<tool_call>...</tool_call>` |
| `'code'` | `language`, `delta`, `code`, `isComplete` | Non-JSON fenced markdown code blocks |
| `'done'` | `text`, `thinking` | Emitted when the stream finishes |

### `createStreamParser(options?)`

For manual push-based control (e.g., WebSockets or event emitters):

```ts
import { createStreamParser } from 'tokenheal';

const parser = createStreamParser({ thinkingTag: 'thought', toolTag: 'tool_call' });

const events = parser.push('{"user": "Al');
// -> [{ type: 'json', data: { user: 'Al' }, raw: '{"user": "Al', isComplete: false }]

const finalEvents = parser.flush();

```

### `healJson(input, fallback?)` & `healJsonWithMeta(input, fallback?)`

Standalone one-off JSON repair helpers:

```ts
import { healJson, healJsonWithMeta } from 'tokenheal';

healJson('{"items": [1, 2, {"name": "Ada');
// -> { items: [1, 2, { name: 'Ada' }] }

healJsonWithMeta('{"ok": tr');
// -> { value: { ok: true }, repaired: '{"ok": true}', wasComplete: false }

```

---

## License

MIT

---

<strong>A Sabtain Ali production</strong>
