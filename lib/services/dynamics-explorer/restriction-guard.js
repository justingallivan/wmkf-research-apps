/**
 * Restriction enforcement for the Dynamics Explorer chat loop: the local
 * table/field guard applied to tool calls, redaction of restricted field
 * names from schema text, and the $expand segment splitter it depends on.
 *
 * Extracted verbatim from pages/api/dynamics-explorer/chat.js:926-950,
 * 2868-2935 (pre-S2 line numbers); characterization tests are the safety net.
 */

export function restrictedFieldsForTable(tableName, restrictions) {
  return new Set(
    restrictions
      .filter(r => r.field_name && r.table_name === tableName)
      .map(r => r.field_name)
  );
}

// Redact restricted field NAMES wherever they appear in free text (table
// descriptions, rules, other fields' descriptions). Dropping a restricted
// field from the field list is not enough — its logical name can still be
// referenced in prose ("filter by wmkf_x ..."), which leaks its existence.
// Token-bounded so a restricted name isn't matched inside a longer logical
// name (logical names are [A-Za-z0-9_]).
export function redactRestrictedFieldNames(text, restrictedFieldNames) {
  if (!text || restrictedFieldNames.size === 0) return text;
  let out = String(text);
  for (const name of restrictedFieldNames) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`(?<![A-Za-z0-9_])${escaped}(?![A-Za-z0-9_])`, 'g');
    out = out.replace(re, '[restricted]');
  }
  return out;
}

// ─── Helpers ───

export function checkRestriction(toolName, input, restrictions) {
  if (!restrictions.length || !input.table_name) return null;
  for (const r of restrictions) {
    if (r.table_name === input.table_name) {
      if (!r.field_name) return `Table "${r.table_name}" is restricted`;
      if (input.select) {
        const fields = input.select.split(',').map(f => f.trim());
        if (fields.includes(r.field_name)) return `Field "${r.field_name}" is restricted`;
      }
      if (input.field) {
        const aggFields = [input.field];
        if (input.group_by) aggFields.push(input.group_by);
        for (const f of aggFields) {
          if (f === r.field_name) return `Field "${r.field_name}" is restricted`;
        }
      }
    }

    // Check $expand for restricted tables/fields via navigation properties
    if (input.expand) {
      const segments = splitChatExpandSegments(input.expand);
      for (const seg of segments) {
        const parenIdx = seg.indexOf('(');
        const navProperty = parenIdx === -1 ? seg.trim() : seg.substring(0, parenIdx).trim();
        // Table-level block: navigation property references restricted table
        if (!r.field_name && navProperty.toLowerCase().includes(r.table_name.toLowerCase())) {
          return `Table "${r.table_name}" is restricted (referenced via $expand "${navProperty}")`;
        }
        // Field-level block: nested $select contains restricted field
        if (r.field_name && r.table_name === input.table_name && parenIdx !== -1) {
          const options = seg.substring(parenIdx + 1, seg.lastIndexOf(')'));
          const selectMatch = options.match(/\$select\s*=\s*([^;)]+)/);
          if (selectMatch) {
            const nestedFields = selectMatch[1].split(',').map(f => f.trim());
            if (nestedFields.includes(r.field_name)) {
              return `Field "${r.field_name}" is restricted (referenced via $expand nested $select)`;
            }
          }
        }
      }
    }
  }
  return null;
}

/**
 * Split $expand into segments, respecting parentheses depth.
 */
export function splitChatExpandSegments(expand) {
  const segments = [];
  let depth = 0;
  let current = '';
  for (const ch of expand) {
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    if (ch === ',' && depth === 0) {
      segments.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  if (current.trim()) segments.push(current.trim());
  return segments;
}

