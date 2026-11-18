/**
 * Discriminated union of all typed events emitted by TokenHeal.
 */
export type TokenHealEvent<T = Record<string, unknown>> =
  | TextEvent
  | ThinkingEvent
  | JsonEvent<T>
  | ToolCallEvent<T>
  | CodeBlockEvent
  | DoneEvent;

/**
 * Standard user-facing prose/text chunk.
 */
export interface TextEvent {
  type: 'text';
  /** The incremental delta received in this chunk */
  delta: string;
  /** The full accumulated user-facing text so far */
  content: string;
}

/**
 * Internal model reasoning extracted from <thinking>...</thinking> tags.
 */
export interface ThinkingEvent {
  type: 'thinking';
  /** The incremental reasoning delta */
  delta: string;
  /** The full accumulated thinking content so far */
  content: string;
  /** True once the closing </thinking> tag has been encountered */
  isComplete: boolean;
}

/**
 * Live-healed structured JSON payload (from raw JSON streams or ```json blocks).
 */
export interface JsonEvent<T = Record<string, unknown>> {
  type: 'json';
  /** The parsed, valid JS object/array healed on the fly */
  data: T;
  /** The raw (potentially incomplete) JSON string accumulated so far */
  raw: string;
  /** True if the JSON stream was naturally complete without needing auto-closure */
  isComplete: boolean;
}

/**
 * Tool / function call payload extracted from <tool_call> tags or tool JSON blocks.
 */
export interface ToolCallEvent<T = Record<string, unknown>> {
  type: 'tool_call';
  /** Tool/function name if detected */
  name?: string;
  /** Live-healed arguments object */
  arguments: T;
  /** Raw accumulated tool payload string */
  raw: string;
  /** True once the tool call block is completely closed */
  isComplete: boolean;
}

/**
 * Non-JSON fenced markdown code block (e.g., ```typescript, ```python).
 */
export interface CodeBlockEvent {
  type: 'code';
  /** Language identifier after the opening backticks (e.g., "ts", "python") */
  language: string;
  /** Incremental code delta */
  delta: string;
  /** Full accumulated code inside the block */
  code: string;
  /** True once the closing ``` fence is reached */
  isComplete: boolean;
}

/**
 * Emitted when the stream finishes (via flush() or end of AsyncIterable).
 */
export interface DoneEvent {
  type: 'done';
  /** Final aggregated text */
  text: string;
  /** Final aggregated thinking log (if any) */
  thinking: string;
}

/**
 * Configuration options for the TokenHeal stream parser.
 */
export interface TokenHealOptions {
  /**
   * Custom XML-style tag name used for reasoning blocks.
   * @default 'thinking'
   */
  thinkingTag?: string;

  /**
   * Custom XML-style tag name used for tool calls.
   * @default 'tool_call'
   */
  toolTag?: string;

  /**
   * Fallback value returned by healJson() if the input cannot be salvaged yet
   * (e.g., an empty string or lone opening quote before any key/value).
   * @default null
   */
  fallback?: unknown;
}

/**
 * Result returned by the standalone healJson() helper.
 */
export interface HealResult<T unknown> {
  value: T;
  repaired: string;
  wasComplete: boolean;
}