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

export interface ThinkingEvent {
  type: 'thinking';
  delta: string;
  content: string;
  isComplete: boolean;
}

export interface JsonEvent<T = Record<string, unknown>> {
  type: 'json';
  data: T;
  raw: string;
  isComplete: boolean;
}

export interface ToolCallEvent<T = Record<string, unknown>> {
  type: 'tool_call';
  name?: string;
  arguments: T;
  raw: string;
  isComplete: boolean;
}

export interface CodeBlockEvent {
  type: 'code'
  language: string;
  delta: string;
  code: string;
  isComplete: boolean;
}

export interface DoneEvent {
  type: 'done';
  text: string;
  thinking: string;
}

export interface TokenHealOptions {
  thinkingTag?: string;
  toolTag?: string;
  fallback?: unknown;
}

export interface HealResult<T unknown> {
  value: T;
  repaired: string;
  wasComplete: boolean;
}