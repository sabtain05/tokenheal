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

    // Part of a literal (true, false, null) or number
    if (tokenStart === -1) {
      tokenStart = i;
    }
  }

  let repaired = trimmed;

  // 1. Handle trailing escape backslash inside an open string (e.g. `"hello\`)
  if (inString) {
    if (escapeNext) {
      repaired = repaired.slice(0, -1);
    }
    repaired += '"';
  } else if (tokenStart !== -1) {
    // 2. Complete or strip partial unquoted literals/numbers at the tail
    const partialToken = repaired.slice(tokenStart);
    const prefix = repaired.slice(0, tokenStart);

    if ('true'.startsWith(partialToken)) {
      repaired = prefix + 'true';
    } else if ('false'.startsWith(partialToken)) {
      repaired = prefix + 'false';
    } else if ('null'.startsWith(partialToken)) {
      repaired = prefix + 'null';
    } else if (/^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(partialToken)) {
      // Already a complete valid JSON number
    } else if (/^-?\d+\.$/.test(partialToken)) {
      // Trailing decimal point: "12." -> "12.0"
      repaired = prefix + partialToken + '0';
    } else if (/^-?\d+(\.\d+)?[eE][+-]?$/.test(partialToken)) {
      // Trailing exponent: "1e" or "1e+" -> "1e0"
      repaired = prefix + partialToken + '0';
    } else if (partialToken === '-') {
      // Lone minus sign -> "0"
      repaired = prefix + '0';
    } else {
      // Unrecognized partial token -> strip it
      repaired = prefix;
    }
  }

  // 3. Clean up dangling structural tails inside objects/arrays
  repaired = cleanStructuralTail(repaired, stack);

  // 4. Close any remaining open containers in reverse (LIFO) order
  for (let i = stack.length - 1; i >= 0; i--) {
    repaired += stack[i] === '{' ? '}' : ']';
  }

  return repaired;
}

/**
 * Strips incomplete key-value pairs, dangling colons, or trailing commas
 * right before closing open brackets/braces.
 */
function cleanStructuralTail(str: string, stack: ContainerType[]): string {
  let current = str.trimEnd();
  if (stack.length === 0) return current;

  const topContainer = stack[stack.length - 1];

  // Remove trailing comma (e.g., `{"a": 1,` or `[1, 2,`)
  if (current.endsWith(',')) {
    return current.slice(0, -1).trimEnd();
  }

  // Remove dangling colon in an object (e.g., `{"a":` -> `{`)
  if (topContainer === '{' && current.endsWith(':')) {
    const withoutColon = current.slice(0, -1).trimEnd();
    return stripTrailingKey(withoutColon);
  }

  // Check if an object ends with a dangling key without a colon (e.g., `{"a": 1, "b"` -> `{"a": 1`)
  if (topContainer === '{' && current.endsWith('"')) {
    const keyStartIndex = findOpeningQuoteIndex(current);
    if (keyStartIndex > 0) {
      const beforeKey = current.slice(0, keyStartIndex).trimEnd();
      const lastCharBeforeKey = beforeKey[beforeKey.length - 1];
      // If preceded by `{` or `,`, this string is an object key with no `: value` yet
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