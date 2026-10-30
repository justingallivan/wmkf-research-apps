/** Browser-safe bounded JSON and canonical hashing preimage contract.
 * No persistence, service imports or network. See README for canonical format.
 */
const LIMITS = Object.freeze({ bytes: 1048576, depth: 32, nodes: 50000, memoUtf16: 1000000 });
const owns = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const isObject = v => v !== null && typeof v === 'object' && !Array.isArray(v)
  && [Object.prototype, null].includes(Object.getPrototypeOf(v));
function fail(code) { const error = new Error(code); error.code = code; throw error; }
function wellFormed(text) {
  for (let i = 0; i < text.length; i++) {
    const n = text.charCodeAt(i);
    if (n >= 0xd800 && n <= 0xdbff) {
      const next = text.charCodeAt(++i);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
    } else if (n >= 0xdc00 && n <= 0xdfff) return false;
  }
  return true;
}
function utf8Length(text) {
  let size = 0;
  for (let i = 0; i < text.length; i++) {
    const n = text.charCodeAt(i);
    if (n < 128) size++; else if (n < 2048) size += 2;
    else if (n >= 0xd800 && n <= 0xdbff) { size += 4; i++; } else size += 3;
  }
  return size;
}
/** Validate JSON values BEFORE stringify (which would silently drop/coerce data). */
function inspectJson(value) {
  let nodes = 0, units = 0;
  const ancestors = new Set();
  function visit(v, depth) {
    if (++nodes > LIMITS.nodes || depth > LIMITS.depth) fail('json_complexity_limit');
    if (v === null || typeof v === 'boolean') return;
    if (typeof v === 'number') {
      if (!Number.isFinite(v) || Object.is(v, -0) || (Number.isInteger(v) && !Number.isSafeInteger(v))) fail('unsupported_number');
      return;
    }
    if (typeof v === 'string') { units += v.length; if (units > LIMITS.bytes) fail('payload_too_large'); if (!wellFormed(v)) fail('malformed_unicode'); return; }
    if (!Array.isArray(v) && !isObject(v)) fail('json_value_required');
    if (ancestors.has(v)) fail('json_cycle');
    ancestors.add(v);
    if (Object.getOwnPropertySymbols(v).length) fail('unsupported_property');
    const keys = Object.keys(v);
    if (Array.isArray(v) && (keys.length !== v.length || keys.some((k, i) => k !== String(i)))) fail('sparse_or_extended_array');
    for (const k of Object.getOwnPropertyNames(v)) {
      if (Array.isArray(v) && k === 'length') continue;
      units += k.length; if (units > LIMITS.bytes) fail('payload_too_large');
      const d = Object.getOwnPropertyDescriptor(v, k);
      if (!d.enumerable || !owns(d, 'value') || !wellFormed(k)) fail('unsupported_property');
      visit(d.value, depth + 1);
    }
    ancestors.delete(v);
  }
  visit(value, 0);
  if (utf8Length(JSON.stringify(value)) > LIMITS.bytes) fail('payload_too_large');
}
/** Strict JSON memo/wire parser: duplicate keys, unsafe numbers and depth reject.
 * Returns the original JSON semantics, never rewrites the stored memo text.
 */
function parseJson(text) {
  if (typeof text !== 'string') fail('json_text_required');
  if (text.length > LIMITS.memoUtf16 || utf8Length(text) > LIMITS.bytes) fail('payload_too_large');
  let i = 0, nodes = 0;
  const whitespace = () => { while (/[ \t\r\n]/.test(text[i] || '') && i < text.length) i++; };
  function string() {
    const start = i++;
    while (i < text.length) {
      if (text[i] === '\\') { i += 2; continue; }
      if (text[i++] === '"') {
        let result;
        try { result = JSON.parse(text.slice(start, i)); } catch { fail('invalid_json'); }
        if (!wellFormed(result)) fail('malformed_unicode');
        return result;
      }
    }
    fail('invalid_json');
  }
  function value(depth) {
    if (++nodes > LIMITS.nodes || depth > LIMITS.depth) fail('json_complexity_limit');
    whitespace();
    if (text[i] === '"') return string();
    if (text[i] === '{') {
      i++; const out = Object.create(null); whitespace();
      if (text[i] === '}') { i++; return out; }
      while (i < text.length) {
        whitespace(); if (text[i] !== '"') fail('invalid_json');
        const key = string();
        if (owns(out, key)) fail('duplicate_json_key');
        whitespace(); if (text[i++] !== ':') fail('invalid_json');
        out[key] = value(depth + 1); whitespace();
        if (text[i] === '}') { i++; return out; }
        if (text[i++] !== ',') fail('invalid_json');
      }
      fail('invalid_json');
    }
    if (text[i] === '[') {
      i++; const out = []; whitespace();
      if (text[i] === ']') { i++; return out; }
      while (i < text.length) {
        out.push(value(depth + 1)); whitespace();
        if (text[i] === ']') { i++; return out; }
        if (text[i++] !== ',') fail('invalid_json');
      }
      fail('invalid_json');
    }
    const token = /^(?:null|true|false|-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?)/.exec(text.slice(i));
    if (!token) fail('invalid_json');
    i += token[0].length;
    const result = JSON.parse(token[0]);
    if (typeof result === 'number' && (!Number.isFinite(result) || Object.is(result, -0) || (Number.isInteger(result) && !Number.isSafeInteger(result)))) fail('unsupported_number');
    return result;
  }
  const result = value(0); whitespace();
  if (i !== text.length) fail('invalid_json');
  inspectJson(result);
  return result;
}
function quote(text) {
  let out = '"';
  for (let i = 0; i < text.length; i++) {
    const n = text.charCodeAt(i);
    if (n === 34 || n === 92) out += '\\' + text[i];
    else if (n < 32 || n >= 127) out += '\\u' + n.toString(16).padStart(4, '0');
    else out += text[i];
  }
  return out + '"';
}
/** ASCII-only tagged canonical JSON; IEEE754 numbers, ordinal UTF16 key order. */
function canonicalPreimage(value) {
  inspectJson(value);
  function encode(v) {
    if (v === null) return '["null"]';
    if (typeof v === 'string') return '["s",' + quote(v) + ']';
    if (typeof v === 'boolean') return '["b",' + (v ? 'true' : 'false') + ']';
    if (typeof v === 'number') {
      const data = new DataView(new ArrayBuffer(8)); data.setFloat64(0, v, false);
      let hex = ''; for (let i = 0; i < 8; i++) hex += data.getUint8(i).toString(16).padStart(2, '0');
      return '["n",' + quote(hex) + ']';
    }
    if (Array.isArray(v)) return '["a",[' + v.map(encode).join(',') + ']]';
    return '["o",[' + Object.keys(v).sort().map(k => '[' + quote(k) + ',' + encode(v[k]) + ']').join(',') + ']]';
  }
  return encode(value);
}
module.exports = { LIMITS, owns, isObject, wellFormed, utf8Length, inspectJson, parseJson, canonicalPreimage };
