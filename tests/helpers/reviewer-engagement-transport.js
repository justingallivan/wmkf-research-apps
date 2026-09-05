/**
 * Stateful HTTP boundary for reviewer lifecycle composition tests.
 *
 * Keep the real services, adapters, DAL context, write-core, and multipart
 * builder/parser above this fake. It models only this suite's OData subset;
 * unsupported queries/URLs throw rather than returning an empty success.
 * This is an executable transaction model, not a Dataverse server emulator or
 * proof of live Dataverse atomicity. Existing protocol tests remain required.
 */
const PRIMARY_KEYS = {
  wmkf_appreviewersuggestions: 'wmkf_appreviewersuggestionid',
  wmkf_appreviewanswers: 'wmkf_appreviewanswerid',
  wmkf_reviewquestions: 'wmkf_reviewquestionid',
  wmkf_potentialreviewerses: 'wmkf_potentialreviewersid',
  akoya_requests: 'akoya_requestid',
  systemusers: 'systemuserid',
};
const clone = (value) => JSON.parse(JSON.stringify(value));

function literal(value) {
  if (value === 'null') return null;
  if (value === 'true' || value === 'false') return value === 'true';
  if (/^-?\d+(?:\.\d+)?$/.test(value)) return Number(value);
  if (/^'(?:[^']|'')*'$/.test(value)) return value.slice(1, -1).replace(/''/g, "'");
  if (/^[0-9a-f-]{36}$/i.test(value) || /^\d{4}-\d\d-\d\dT[\d:.]+Z$/.test(value)) return value;
  throw new Error(`Transport fixture does not support literal: ${value}`);
}

// Small recursive parser, deliberately no eval and no permissive fallback.
function filterPredicate(expression) {
  if (!expression) return () => true;
  const tokens = expression.match(/'(?:[^']|'')*'|[()]|[^\s()]+/g) || [];
  let index = 0;
  function primary() {
    if (tokens[index] === '(') {
      index += 1;
      const result = disjunction();
      if (tokens[index++] !== ')') throw new Error(`Invalid fixture filter: ${expression}`);
      return result;
    }
    const field = tokens[index++];
    const operator = tokens[index++];
    const expected = literal(tokens[index++] || '');
    if (!/^[a-z_][a-z0-9_]*$/i.test(field) || !['eq', 'ne', 'lt', 'le', 'gt', 'ge'].includes(operator)) {
      throw new Error(`Unsupported fixture filter: ${expression}`);
    }
    return (row) => {
      const actual = row[field] ?? null;
      if (operator === 'eq') return actual === expected;
      if (operator === 'ne') return expected === null ? actual !== null : actual !== null && actual !== expected;
      if (actual === null || expected === null) return false;
      if (operator === 'lt') return actual < expected;
      if (operator === 'le') return actual <= expected;
      if (operator === 'gt') return actual > expected;
      return actual >= expected;
    };
  }
  function conjunction() {
    let left = primary();
    while (tokens[index] === 'and') {
      index += 1;
      const right = primary();
      const previous = left;
      left = (row) => previous(row) && right(row);
    }
    return left;
  }
  function disjunction() {
    let left = conjunction();
    while (tokens[index] === 'or') {
      index += 1;
      const right = conjunction();
      const previous = left;
      left = (row) => previous(row) || right(row);
    }
    return left;
  }
  const result = disjunction();
  if (index !== tokens.length) throw new Error(`Unconsumed fixture filter: ${expression}`);
  return result;
}

function response(status, body, contentType = 'application/json') {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => name.toLowerCase() === 'content-type' ? contentType : null },
    json: async () => JSON.parse(text),
    text: async () => text,
  };
}

function parseResource(url, origin) {
  const parsed = new URL(url);
  if (parsed.origin !== origin) throw new Error(`Unexpected network request: ${url}`);
  const match = parsed.pathname.match(/^\/api\/data\/v9\.2\/(\$batch|\w+)(?:\((.*)\))?$/);
  if (!match) throw new Error(`Unsupported fixture resource: ${url}`);
  return { entitySet: match[1], key: match[2] || null, params: parsed.searchParams };
}

function parseBatch(body, contentType, origin) {
  const outer = contentType.match(/boundary=([^;\s]+)/)?.[1];
  const inner = body.match(/Content-Type: multipart\/mixed; boundary=([^\r\n]+)/)?.[1];
  if (!outer || !inner || !body.endsWith(`--${outer}--\r\n`)) throw new Error('Malformed fixture batch envelope');
  const parts = body.split(`--${inner}`).slice(1, -1);
  if (!parts.length) throw new Error('Empty fixture changeset');
  return parts.map((part, index) => {
    const match = part.match(/^\r\nContent-Type: application\/http\r\nContent-Transfer-Encoding: binary\r\nContent-ID: (\d+)\r\n\r\n(PATCH|POST|DELETE) (\S+) HTTP\/1\.1\r\n([\s\S]*?)\r\n\r\n([\s\S]*)$/);
    if (!match || Number(match[1]) !== index + 1) throw new Error('Malformed fixture changeset operation');
    const headers = Object.fromEntries(match[4].split('\r\n').filter(Boolean).map((line) => {
      const colon = line.indexOf(':');
      return [line.slice(0, colon), line.slice(colon + 1).trim()];
    }));
    return { method: match[2], url: match[3], ...parseResource(match[3], origin), headers,
      body: match[5].trim() ? JSON.parse(match[5].trim()) : undefined };
  });
}

function batchResponse(statuses) {
  const boundary = 'fixture_batchresponse';
  const inner = 'fixture_changesetresponse';
  const parts = statuses.map((status, index) => [
    `--${inner}`, 'Content-Type: application/http', 'Content-Transfer-Encoding: binary',
    `Content-ID: ${index + 1}`, '', `HTTP/1.1 ${status} ${status === 204 ? 'No Content' : 'Rejected'}`,
    'Content-Type: application/json', '',
    status >= 400 ? JSON.stringify({ error: { message: `Fixture precondition rejected (${status})` } }) : '',
  ].join('\r\n'));
  return response(200, [`--${boundary}`, `Content-Type: multipart/mixed; boundary=${inner}`, '',
    ...parts, `--${inner}--`, `--${boundary}--`, ''].join('\r\n'), `multipart/mixed; boundary=${boundary}`);
}

// An explicit origin lets tests exercise the real target interlock's hostname
// classification. It is still purely in memory: there is no fetch fallback.
export function createReviewerEngagementTransport(initial = {}, { origin = 'https://reviewer-harness.invalid' } = {}) {
  let tables = Object.fromEntries(Object.keys(PRIMARY_KEYS).map((set) => [set, {}]));
  let version = 0;
  const usedTags = new Set();
  const requests = [];
  // Independent of HTTP status: failures here mean the test fixture does not
  // understand a request. Suites must assert this stays empty, even when a
  // service catches the thrown transport error and returns a fallback DTO.
  const unexpectedRequests = [];
  const pauses = [];
  const tag = () => {
    let next;
    do { next = `W/"${++version}"`; } while (usedTags.has(next));
    usedTags.add(next);
    return next;
  };
  function table(set, state = tables) {
    if (!PRIMARY_KEYS[set]) throw new Error(`Unregistered fixture entity set: ${set}`);
    return state[set];
  }
  function seed(set, row) {
    const key = row[PRIMARY_KEYS[set]];
    if (!key) throw new Error(`Fixture row lacks ${PRIMARY_KEYS[set]}`);
    if (row._etag) usedTags.add(row._etag);
    table(set)[key] = { ...clone(row), _etag: Object.hasOwn(row, '_etag') ? row._etag : tag() };
  }
  Object.entries(initial).forEach(([set, rows]) => rows.forEach((row) => seed(set, row)));
  function get(set, key) {
    const row = table(set)[key];
    return row ? clone(row) : null;
  }
  function patch(set, key, fields) {
    const row = table(set)[key];
    if (!row) throw new Error(`Missing fixture row: ${set}(${key})`);
    table(set)[key] = { ...row, ...clone(fields), _etag: tag() };
    return get(set, key);
  }
  async function checkpoint(request, stage) {
    const index = pauses.findIndex((pause) => pause.stage === stage && pause.predicate(request));
    if (index < 0) return;
    const [pause] = pauses.splice(index, 1);
    pause.arrive(request);
    await pause.wait;
  }
  function pauseNext(predicate, { stage = 'before' } = {}) {
    if (!['before', 'after'].includes(stage)) throw new Error('Unknown pause stage');
    let arrive;
    let release;
    const reached = new Promise((resolve) => { arrive = resolve; });
    const wait = new Promise((resolve) => { release = resolve; });
    pauses.push({ predicate, stage, arrive, wait });
    return { reached, release };
  }
  function selector(set, key, state) {
    if (!key?.includes('=')) return { key, row: table(set, state)[key], fields: {} };
    if (set !== 'wmkf_appreviewanswers') throw new Error(`Unsupported alternate key: ${key}`);
    const match = key.match(/^_wmkf_appreviewersuggestion_value=([0-9a-f-]{36}),wmkf_questionkey=('(?:[^']|'')*')$/i);
    if (!match) throw new Error(`Invalid answer alternate key: ${key}`);
    const fields = { _wmkf_appreviewersuggestion_value: match[1], wmkf_questionkey: literal(match[2]) };
    const existing = Object.entries(table(set, state)).find(([, row]) => Object.entries(fields).every(([field, value]) => row[field] === value));
    return { key: existing?.[0] || `${match[1]}:${fields.wmkf_questionkey}`, row: existing?.[1], fields };
  }
  function write(request, state) {
    const { entitySet: set, method, body = {}, headers = {} } = request;
    const selected = selector(set, request.key, state);
    const ifMatch = headers['If-Match'] || headers['if-match'];
    if (ifMatch && (!selected.row || (ifMatch !== '*' && selected.row._etag !== ifMatch))) return 412;
    if (method === 'DELETE') {
      if (!selected.row) return 404;
      delete table(set, state)[selected.key];
      return 204;
    }
    if (method !== 'PATCH') throw new Error(`Unsupported fixture write method: ${method}`);
    if (!selected.row && !request.key?.includes('=')) return 404;
    table(set, state)[selected.key] = {
      [PRIMARY_KEYS[set]]: selected.key, ...selected.fields, ...selected.row, ...clone(body), _etag: tag(),
    };
    return 204;
  }
  function project(row, params) {
    const select = params.get('$select');
    const result = select ? Object.fromEntries(select.split(',').map((field) => [field, row[field] ?? null])) : clone(row);
    delete result._etag;
    if (row._etag) result['@odata.etag'] = row._etag;
    for (const expansion of (params.get('$expand') || '').split(/,(?![^()]*\))/).filter(Boolean)) {
      const match = expansion.match(/^(\w+)(?:\(\$select=([\w,]+)\))?$/);
      if (!match) throw new Error(`Unsupported fixture expansion: ${expansion}`);
      const value = row[match[1]];
      result[match[1]] = value ? (match[2] ? Object.fromEntries(match[2].split(',').map((field) => [field, value[field] ?? null])) : clone(value)) : null;
    }
    return result;
  }
  async function handleRequest(url, options = {}) {
    const resource = parseResource(url, origin);
    const request = { method: options.method || 'GET', url, ...resource, headers: { ...options.headers },
      body: resource.entitySet === '$batch' ? options.body : (options.body ? JSON.parse(options.body) : undefined) };
    if (resource.entitySet === '$batch') request.operations = parseBatch(options.body, options.headers['Content-Type'], origin);
    requests.push(request);
    await checkpoint(request, 'before');
    let result;
    if (request.operations) {
      const transaction = clone(tables);
      const statuses = [];
      for (const op of request.operations) {
        const status = write(op, transaction);
        statuses.push(status);
        if (status >= 400) break;
      }
      if (statuses.every((status) => status < 400)) tables = transaction;
      result = batchResponse(statuses);
    } else if (request.method === 'GET') {
      for (const param of resource.params.keys()) {
        if (!['$select', '$filter', '$orderby', '$top', '$expand', '$count'].includes(param)) throw new Error(`Unsupported fixture query: ${param}`);
      }
      if (resource.key) {
        const row = table(resource.entitySet)[resource.key];
        result = row ? response(200, project(row, resource.params)) : response(404, {
          // A known table with a missing record is ObjectDoesNotExist, not an
          // arbitrary endpoint 404. Keep the real runtime classifier in play.
          error: { code: '0x80040217', message: 'Fixture row not found' },
        });
      } else {
        let rows = Object.values(table(resource.entitySet)).filter(filterPredicate(resource.params.get('$filter')));
        const count = rows.length;
        const ordering = resource.params.get('$orderby');
        if (ordering) {
          const clauses = ordering.split(',').map((clause) => {
            const match = clause.trim().match(/^(\w+)(?: (asc|desc))?$/);
            if (!match) throw new Error(`Unsupported fixture ordering: ${ordering}`);
            return [match[1], match[2] === 'desc' ? -1 : 1];
          });
          rows.sort((a, b) => {
            for (const [field, sign] of clauses) {
              if (a[field] !== b[field]) return (a[field] < b[field] ? -1 : 1) * sign;
            }
            return 0;
          });
        }
        if (resource.params.has('$top')) rows = rows.slice(0, Number(resource.params.get('$top')));
        result = response(200, { value: rows.map((row) => project(row, resource.params)), '@odata.count': count });
      }
    } else {
      const status = write(request, tables);
      result = response(status, status >= 400 ? { error: { message: `Fixture write rejected (${status})` } } : {});
    }
    request.status = result.status;
    await checkpoint(request, 'after');
    return result;
  }
  async function fetch(url, options = {}) {
    try {
      return await handleRequest(url, options);
    } catch (error) {
      unexpectedRequests.push({ url, method: options.method || 'GET', message: error.message });
      throw error;
    }
  }
  return { fetch, get, seed, patch, pauseNext, requests, unexpectedRequests, rows: (set) => clone(Object.values(table(set))) };
}
