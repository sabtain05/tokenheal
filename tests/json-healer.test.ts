import { describe, expect, it } from 'vitest';
import { healJson, healJsonWithMeta, repairJsonString } from '../src/index';

describe('JSON Healer', () => {
  it('returns already valid JSON untouched with wasComplete: true', () => {
    const input = '{"name":"Alice","active":true,"scores":[10,20]}';
    const result = healJsonWithMeta(input);

    expect(result.wasComplete).toBe(true);
    expect(result.repaired).toBe(input);
    expect(result.value).toEqual({
      name: 'Alice',
      active: true,
      scores: [10, 20],
    });
  });

  it('closes unclosed strings and objects', () => {
    expect(healJson('{"title": "Hello Wor')).toEqual({
      title: 'Hello Wor',
    });
  });

  it('handles escaped quotes and trailing backslashes inside strings', () => {
    expect(healJson('{"quote": "She said \\"hi')).toEqual({
      quote: 'She said "hi',
    });
    expect(healJson('{"path": "C:\\\\Users\\')).toEqual({
      path: 'C:\\Users',
    });
  });

  it('strips dangling object keys and colons without values', () => {
    expect(healJson('{"a": 1, "incompleteKey')).toEqual({ a: 1 });
    expect(healJson('{"a": 1, "incompleteKey":')).toEqual({ a: 1 });
    expect(healJson('{"a": 1, "incompleteKey":   ')).toEqual({ a: 1 });
    expect(healJson('{"onlyKey"')).toEqual({});
  });

  it('removes trailing commas in objects and arrays', () => {
    expect(healJson('{"a": 1, "b": 2,')).toEqual({ a: 1, b: 2 });
    expect(healJson('[1, 2, 3, ')).toEqual([1, 2, 3]);
  });

  it('completes partial booleans and null literals', () => {
    expect(healJson('{"ok": tr')).toEqual({ ok: true });
    expect(healJson('{"ok": fal')).toEqual({ ok: false });
    expect(healJson('{"data": nu')).toEqual({ data: null });
  });

  it('repairs incomplete numbers cleanly', () => {
    expect(healJson('{"price": 19.')).toEqual({ price: 19.0 });
    expect(healJson('{"exp": 1e+')).toEqual({ exp: 1 });
    expect(healJson('{"neg": -')).toEqual({ neg: 0 });
  });

  it('closes deeply nested structures in LIFO order', () => {
    const partial = '{"users": [{"id": 1, "tags": ["admin", "ed';
    expect(healJson(partial)).toEqual({
      users: [{ id: 1, tags: ['admin', 'ed'] }],
    });
  });

  it('returns fallback on empty or unsalvageable input', () => {
    expect(healJson('', { empty: true })).toEqual({ empty: true });
    expect(repairJsonString('   ')).toBe('');
  });
});