/**
 * Minimal Server-Sent-Events reader for the reviewer-search endpoints
 * (analyze / discover / enrich-contacts). They stream frames shaped like
 *   event: <name>\n
 *   data: {...}\n
 *   \n
 * Each parsed frame is delivered as `{ event, data }` so callers can detect an
 * `event: error` frame (whose payload is `{ message }`, NOT `{ error }`) and
 * not mask a real server error as an empty result (Codex S210).
 *
 * `parseSseBuffer` is pure (split out for unit tests): given an accumulated
 * buffer and the event-name carried over from the previous chunk, it returns the
 * complete frames, the trailing partial line, and the event name to carry
 * forward (an `event:` line and its `data:` line can land in different chunks).
 */

/**
 * @param {string} buffer
 * @param {string|null} carryEvent - event name carried from the previous chunk
 * @returns {{ events: Array<{event: string|null, data: object}>, rest: string, carryEvent: string|null }}
 */
export function parseSseBuffer(buffer, carryEvent = null) {
  const lines = buffer.split('\n');
  // The last element is whatever came after the final '\n' — possibly an
  // incomplete line. Keep it to prepend to the next chunk.
  const rest = lines.pop() ?? '';
  const events = [];
  let currentEvent = carryEvent;
  for (const line of lines) {
    if (line.startsWith('event: ')) {
      currentEvent = line.slice(7).trim();
    } else if (line.startsWith('data: ')) {
      try {
        events.push({ event: currentEvent, data: JSON.parse(line.slice(6)) });
      } catch {
        // Non-JSON or a frame split across chunk boundaries — ignored, as the
        // standalone reader does. Result frames always arrive whole.
      }
    } else if (line === '' || line === '\r') {
      // Blank line terminates a frame — the event name does not carry past it.
      currentEvent = null;
    }
  }
  return { events, rest, carryEvent: currentEvent };
}

/**
 * Read an SSE Response body to completion, invoking `onEvent({event, data})` for
 * every `data:` frame. Throws on a non-OK response or a missing body, so a caller
 * that forgets to pre-check `.ok` still fails loud rather than reading an error
 * page as a stream (Codex S210).
 *
 * @param {Response} response - a fetch Response with a streaming body
 * @param {(frame: {event: string|null, data: object}) => void} onEvent
 */
export async function readSseStream(response, onEvent) {
  if (!response || !response.ok) {
    throw new Error(`SSE request failed (${response ? response.status : 'no response'})`);
  }
  if (!response.body || typeof response.body.getReader !== 'function') {
    throw new Error('readSseStream: response has no readable stream body');
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let carry = null;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const r = parseSseBuffer(buffer, carry);
    buffer = r.rest;
    carry = r.carryEvent;
    for (const ev of r.events) onEvent(ev);
  }
  // Flush a trailing frame that arrived without its closing newline.
  if (buffer.trim()) {
    const r = parseSseBuffer(buffer + '\n', carry);
    for (const ev of r.events) onEvent(ev);
  }
}
