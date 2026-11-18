import type { HealResult } from './types.js';

type ContainerType = '{' | '[';

/**
 * Repairs an incomplete or streaming JSON string so it can be safely parsed
 * via JSON.parse() on every incoming token.
 */
export function repairJsonString(input: string): string {
  const trimmed = input.trimStart();
  if (!trimmed) return '';

  const stack: ContainerType[] = [];
  let inString = false;
  let escapeNext = false;

  // Track the start index of the current token outside strings
  let tokenStart = -1;

  for (let i = 0; i < trimmed.length; i++) {
    const ch = trimmed[i]!;

    if (inString) {
      if (escapeNext) {
        escapeNext = false;
      } else if (ch === '\\') {
        escapeNext = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }

    // Outside of string
    if (ch === '"') {
      inString = true;
      tokenStart = -1;
      continue;
    }

    if (ch === '{' || ch === '[') {
      stack.push(ch);
      tokenStart = -1;
      continue;
    }

    if (ch === '}' || ch === ']') {
      if (stack.length > 0) {
        stack.pop();
      }
      tokenStart = -1;
      continue;
    }

    if (ch === ':' || ch === ',') {
      tokenStart = -1;
      continue;
    }

    if (/\s/.test(ch)) {
      if (tokenStart !== -1) {
        tokenStart = -1;
      }
      continue;
    }

    if (tokenStart === -1) {
      tokenStart = i;
    }
  }

  let repaired = trimmed;

  if (inString) {
    if (escapeNext) {
      repaired = repaired.slice(0, -1);
    }
    repaired += '"';
  } else if (tokenStart !== -1) {
    const partialToken = repaired.slice(tokenStart);
    const prefix = repaired.slice(0, tokenStart);

    if ('true'.startsWith(partialToken)) {
      repaired = prefix + 'true';
    } else if ('false'.startsWith(partialToken)) {
      repaired = prefix + 'false';
    } else if ('null'.startsWith(partialToken)) {
      repaired = prefix + 'null';
    } else if (/^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(partialToken)) {
    } else if (/^-?\d+\.$/.test(partialToken)) {
      repaired = prefix + partialToken + '0';
    } else if (/^-?\d+(\.\d+)?[eE][+-]?$/.test(partialToken)) {
      repaired = prefix + partialToken + '0';
    } else if (partialToken === '-') {
      repaired = prefix + '0';
    } else {
      repaired = prefix;
    }
  }
  repaired = cleanStructuralTail(repaired, stack);
  for (let i = stack.length - 1; i >= 0; i--) {
    repaired += stack[i] === '{' ? '}' : ']';
  }

  return repaired;
}

function cleanStructuralTail(str: string, stack: ContainerType[]): string {
  let current = str.trimEnd();
  if (stack.length === 0) return current;

  const topContainer = stack[stack.length - 1];

  if (current.endsWith(',')) {
    return current.slice(0, -1).trimEnd();
  }

  if (topContainer === '{' && current.endsWith(':')) {
    const withoutColon = current.slice(0, -1).trimEnd();
    return stripTrailingKey(withoutColon);
  }

  if (topContainer === '{' && current.endsWith('"')) {
    const keyStartIndex = findOpeningQuoteIndex(current);
    if (keyStartIndex > 0) {
      const beforeKey = current.slice(0, keyStartIndex).trimEnd();
      const lastCharBeforeKey = beforeKey[beforeKey.length - 1];
      if (lastCharBeforeKey === '{' || lastCharBeforeKey === ',') {
        return stripTrailingKey(current);
      }
    }
  }

  return current;
}

function stripTrailingKey(str: string): string {
  const quoteStart = findOpeningQuoteIndex(str);
  if (quoteStart === -1) return str;

  const beforeKey = str.slice(0, quoteStart).trimEnd();
  if (beforeKey.endsWith(',')) {
    return beforeKey.slice(0, -1).trimEnd();
  }
  return beforeKey;
}

function findOpeningQuoteIndex(str: string): number {
  for (let i = str.length - 2; i >= 0; i--) {
    if (str[i] === '"') {
      let backslashes = 0;
      let j = i - 1;
      while (j >= 0 && str[j] === '\\') {
        backslashes++;
        j--;
      }
      if (backslashes % 2 === 0) {
        return i;
      }
    }
  }
  return -1;
}

export function healJsonWithMeta<T = Record<string, unknown>>(
  input: string,
  fallback: T | null = null
): HealResult<T | null> {
  const trimmed = input.trim();
  if (!trimmed) {
    return { value: fallback, repaired: '', wasComplete: false };
  }

  try {
    const parsed = JSON.parse(trimmed) as T;
    return { value: parsed, repaired: trimmed, wasComplete: true };
  } catch {}

  const repaired = repairJsonString(trimmed);
  if (!repaired) {
    return { value: fallback, repaired: '', wasComplete: false };
  }

  try {
    const parsed = JSON.parse(repaired) as T;
    return { value: parsed, repaired, wasComplete: false };
  } catch {
    return { value: fallback, repaired, wasComplete: false };
  }
}

export function healJson<T = Record<string, unknown>>(
  input: string,
  fallback: T | null = null
): T | null {
  return healJsonWithMeta<T>(input, fallback).value;
}