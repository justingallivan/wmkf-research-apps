/**
 * Tool-result shaping and sizing for the Dynamics Explorer chat loop: result
 * char budgets, active-only/select filtering, record-count derivation, and
 * per-tool "thinking" copy.
 *
 * Note: the `// ─── Tool execution ───` marker below is carried verbatim from
 * its original position ahead of `sanitizeSelect` in chat.js; the region it
 * originally introduced (`executeTool`) stays in the route/moves at S8, not
 * here — the marker moved with `sanitizeSelect` per the plan's exactly-once
 * line assignment (plan §3.2).
 *
 * Extracted verbatim from pages/api/dynamics-explorer/chat.js (multiple
 * regions: 69, 74–86, 641–669, 798–919, 2936–2955, pre-S2 line numbers);
 * characterization tests are the safety net.
 */

export const MAX_RESULT_CHARS = 16000;

export const OPERATIONAL_LOG_TABLES = new Set(['wmkf_ai_run', 'wmkf_ai_runs']);

// Per-tool char limits — composite tools return compact text and need more room
export const TOOL_CHAR_LIMITS = {
  search: 12000,
  get_related: 12000,
  find_reports_due: 12000,
  describe_table: 12000,
  list_documents: 8000,
  search_documents: 10000,
  export_csv: 4000,
};

// ─── Tool execution ───

/**
 * Strip _formatted fields from $select — they are auto-returned via the
 * Prefer: odata.include-annotations="*" header and cannot be $selected.
 * The model sometimes includes them despite the system prompt rule.
 */
export function sanitizeSelect(select) {
  if (!select) return select;
  const fields = select.split(',').map(f => f.trim()).filter(f => !f.endsWith('_formatted'));
  return fields.length > 0 ? fields.join(',') : undefined;
}

/**
 * Inject `statecode eq 0` into a Dynamics OData filter so inactive records are
 * excluded by default. Skipped when the caller opts in via `include_inactive`,
 * or when the user filter already references statecode (respect explicit intent).
 */
export function applyActiveOnlyFilter(userFilter, includeInactive) {
  if (includeInactive) return userFilter;
  if (userFilter && /\bstatecode\b/i.test(userFilter)) return userFilter;
  const active = 'statecode eq 0';
  return userFilter ? `(${userFilter}) and ${active}` : active;
}

export function isOperationalLogTable(tableName) {
  return OPERATIONAL_LOG_TABLES.has(String(tableName || '').trim().toLowerCase());
}

// `get_entity` resolves to a BARE record rather than a collection. `get_record`
// is deliberately NOT here: no such branch exists in executeTool.
const ENTITY_LOOKUP_TOOLS = new Set(['get_entity']);

// Tools that answer with SCHEMA rather than data. A successful describe_table
// has no count field at all; reporting 0 would file a success under
// "zero results", so it counts as the one schema it returned.
const METADATA_TOOLS = new Set(['describe_table']);

// Count fields in preference order, derived from the actual return shapes in
// this file rather than guessed. Two rules make the order what it is:
//
//  1. `count` first — for count_records the count IS the answer.
//  2. The TARGET of the call beats incidental context, and `totalCount` comes
//     LAST. Several relationship handlers return both a specific count and a
//     total: account→emails returns `emailCount` (emails found) alongside
//     `requestCount` (requests scanned to find them), and most handlers return
//     `totalCount` (total matching in Dataverse) next to the number of target
//     rows actually returned. Those tool-specific counts win. Search is the
//     deliberate exception: its formatted `results` value is a string, so
//     `totalCount` is the relevant search cardinality. `requestCount` sits after
//     the other targets because it is context whenever one of them is present.
const COUNT_FIELDS = [
  'count',
  'emailCount', 'paymentCount', 'reportCount', 'annotationCount', 'reviewerCount',
  'documentCount', 'searchCount',
  'exportedCount', 'estimatedCount',
  'requestCount',
  'totalCount',
];

/**
 * What to write to dynamics_query_log.record_count for one tool result.
 *
 * Semantics: the tool result's relevant cardinality. Search reports total
 * matches; collection queries, exports, and relationship tools report the
 * target rows returned; 0 means a genuine zero-result answer (including an
 * explicitly classified name-based lookup miss); -1 means the tool errored;
 * a schema or single-entity answer counts as 1.
 *
 * The original expression was a falsy-chain
 * (`records?.length || results?.length || count || searchCount || …`) which
 * logged `search`'s formatted-string LENGTH as a count (212 for 3 hits), logged
 * 0 for every successful get_entity, and ignored export counts entirely. A
 * first correction fixed those but still preferred `totalCount` over the
 * tool-specific field and omitted `annotationCount`/`reviewerCount`, so
 * relationship calls reported total matches instead of returned rows and
 * request→reviewers reported 0 on success. Both rounds of that are covered by
 * tests built from the real return shapes.
 *
 * NOTE: rows written before this change carry the old semantics — any trend
 * analysis spanning it must treat the eras separately.
 */
export function deriveRecordCount(name, result) {
  if (!result || typeof result !== 'object') return 0;
  if (result._validatorReject) return 0;
  if (result._notFound) return 0;
  if (result.error) return -1;

  // Arrays are genuine collections. Strings never are — that was the search bug.
  if (Array.isArray(result.records)) return result.records.length;
  if (Array.isArray(result.results)) return result.results.length;

  for (const field of COUNT_FIELDS) {
    if (Number.isFinite(result[field])) return result[field];
  }

  if (ENTITY_LOOKUP_TOOLS.has(name)) return 1;
  if (METADATA_TOOLS.has(name)) return 1;
  return 0;
}

/**
 * Strip null, empty string, false, and 0 values from a record.
 * Also remove internal fields (starting with @ or containing "odata").
 * This dramatically reduces payload for sparse Dynamics records.
 */
export function stripEmpty(record) {
  if (!record || typeof record !== 'object') return record;
  const cleaned = {};
  for (const [key, value] of Object.entries(record)) {
    // Skip OData metadata
    if (key.startsWith('@') || key.includes('odata')) continue;
    // Skip null/empty/zero/false
    if (value === null || value === undefined || value === '' || value === false || value === 0) continue;
    // Skip GUID-like null values (all zeros)
    if (typeof value === 'string' && /^0{8}-0{4}-0{4}-0{4}-0{12}$/.test(value)) continue;
    cleaned[key] = value;
  }
  return cleaned;
}

/**
 * Truncate a tool result to fit within charLimit while preserving valid JSON.
 * For results with records arrays, trims records and reports how many were cut
 * so Claude knows to paginate if needed.
 */
export function truncateResult(result, charLimit) {
  let str = JSON.stringify(result);
  if (str.length <= charLimit) return str;

  // Record-aware truncation: trim records array rather than cutting JSON mid-string
  if (result?.records && Array.isArray(result.records) && result.records.length > 0) {
    const totalReturned = result.records.length;
    const totalCount = result.totalCount || totalReturned;
    const avgCharsPerRecord = str.length / totalReturned;
    // Leave room for metadata fields (count, totalCount, hasMore, note)
    const maxRecords = Math.max(1, Math.floor((charLimit - 300) / avgCharsPerRecord));

    if (maxRecords < totalReturned) {
      const trimmed = {
        records: result.records.slice(0, maxRecords),
        count: maxRecords,
        totalCount,
        note: `Showing ${maxRecords} of ${totalCount} total. Present the totalCount to the user. To see more, use a tighter $select (fewer fields) or narrower $filter, or present what you have and offer to query with different criteria.`,
      };
      return JSON.stringify(trimmed);
    }
  }

  // Fallback: string truncation for non-record results
  return str.substring(0, charLimit) + '... [truncated]';
}

export function getThinkingMessage(toolName, input) {
  switch (toolName) {
    case 'search': return `Searching for "${input.search}"...`;
    case 'get_entity': return `Looking up ${input.type}: "${input.identifier}"...`;
    case 'get_related': return `Finding ${input.target_type} for ${input.source_type} ${input.source_name || input.source_id || ''}...`;
    case 'describe_table': return input.table_name ? `Describing ${input.table_name}...` : 'Listing available tables...';
    case 'query_records': return `Querying ${input.table_name}...`;
    case 'count_records': return `Counting ${input.table_name}...`;
    case 'aggregate': return `Calculating ${input.operation} of ${input.field}...`;
    case 'find_reports_due': return `Finding reports due ${input.date_from ? 'from ' + input.date_from.substring(0, 10) : ''}...`;
    case 'list_documents': return `Listing documents for request ${input.request_number || input.request_id || ''}...`;
    case 'search_documents': return `Searching documents for "${input.query}"...`;
    case 'export_csv':
      if (input.process_instruction && input.confirmed) return `Processing and exporting ${input.table_name || 'data'} with AI analysis...`;
      if (input.process_instruction) return `Estimating AI processing for ${input.table_name || 'data'} export...`;
      return `Exporting ${input.table_name || 'data'} as Excel...`;
    default: return `Running ${toolName}...`;
  }
}

