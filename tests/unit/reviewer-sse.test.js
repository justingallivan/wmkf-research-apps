/**
 * parseSseBuffer — the pure framing core of the reviewer-search SSE reader.
 * Now emits { event, data } so callers can detect `event: error` frames.
 * @jest-environment node
 */

import { parseSseBuffer } from '../../shared/components/reviewers/sse.js';

describe('parseSseBuffer', () => {
  test('parses complete frames with their event name', () => {
    const { events, rest } = parseSseBuffer('event: progress\ndata: {"message":"hi"}\n\nevent: result\ndata: {"ranked":[]}\n\n');
    expect(events).toEqual([
      { event: 'progress', data: { message: 'hi' } },
      { event: 'result', data: { ranked: [] } },
    ]);
    expect(rest).toBe('');
  });

  test('detects an error frame (payload is {message}, not {error})', () => {
    const { events } = parseSseBuffer('event: error\ndata: {"message":"Claude API key not configured"}\n\n');
    expect(events).toEqual([{ event: 'error', data: { message: 'Claude API key not configured' } }]);
  });

  test('data with no preceding event has event: null', () => {
    const { events } = parseSseBuffer('data: {"a":1}\n\n');
    expect(events).toEqual([{ event: null, data: { a: 1 } }]);
  });

  test('carries a trailing partial frame forward as rest', () => {
    const { events, rest } = parseSseBuffer('data: {"a":1}\n\ndata: {"b":2');
    expect(events).toEqual([{ event: null, data: { a: 1 } }]);
    expect(rest).toBe('data: {"b":2');
  });

  test('an event name split across chunks is carried forward', () => {
    const first = parseSseBuffer('event: error\n');
    expect(first.events).toEqual([]);
    expect(first.carryEvent).toBe('error');
    const second = parseSseBuffer('data: {"message":"boom"}\n\n', first.carryEvent);
    expect(second.events).toEqual([{ event: 'error', data: { message: 'boom' } }]);
  });

  test('a partial frame completes when its remainder arrives next chunk', () => {
    const first = parseSseBuffer('data: {"b":2');
    expect(first.events).toEqual([]);
    const second = parseSseBuffer(first.rest + '3}\n\n');
    expect(second.events).toEqual([{ event: null, data: { b: 23 } }]);
  });

  test('blank line resets the carried event name', () => {
    const { events, carryEvent } = parseSseBuffer('event: result\ndata: {"ranked":[]}\n\n');
    expect(events[0].event).toBe('result');
    expect(carryEvent).toBeNull();
  });

  test('silently drops a malformed complete data line', () => {
    const { events } = parseSseBuffer('data: not-json\n\ndata: {"ok":true}\n\n');
    expect(events).toEqual([{ event: null, data: { ok: true } }]);
  });
});
