#!/usr/bin/env node
'use strict';
/*
 * PreToolUse hook (Write|Edit): durable-contract-surface reminder.
 *
 * When creating/changing a high-signal contract surface — a Postgres migration,
 * an API route, or any edit whose content adds a `CREATE TABLE` — inject a
 * non-blocking reminder of the durable-surface obligations that are easy to ship
 * a route/table without (manifest, Atlas, route matrix, canonical counts, tests,
 * the gate that would catch the omission) and point at the /contract-reconcile
 * skill's six audits.
 *
 * High-signal ONLY: stays silent unless the path is a migration / API route, or
 * the new content introduces a CREATE TABLE. This is the failure mode where a new
 * route/table ships without its matrix/Atlas/manifest update.
 *
 * FAILS OPEN: any parse error / missing field exits 0 silently — never blocks.
 */
let input = '';
process.stdin.on('data', (c) => { input += c; });
process.stdin.on('end', () => {
  try {
    const data = JSON.parse(input);
    if (!data) return;
    const name = data.tool_name;
    if (name !== 'Write' && name !== 'Edit') return;
    const ti = data.tool_input || {};
    const fp = typeof ti.file_path === 'string' ? ti.file_path : '';
    if (!fp) return;
    // Tooling config (hooks/skills/settings) is not an application contract
    // surface — and this hook's own source contains "CREATE TABLE" in a regex.
    if (/(^|\/)\.claude\//.test(fp)) return;

    // The text being written/added (Write.content or Edit.new_string).
    const added = (typeof ti.content === 'string' ? ti.content : '') +
      (typeof ti.new_string === 'string' ? ti.new_string : '');

    const isMigration = /(^|\/)lib\/db\/migrations\/.+\.sql$/.test(fp);
    // Only nudge route obligations on a NEW route file (Write) — editing an
    // existing route would falsely nudge "add to the matrix" when it's already
    // there; a contract-changing edit is covered by the skill's task triggers.
    const isNewApiRoute = name === 'Write' && /(^|\/)pages\/api\/.+\.(js|mjs|cjs|ts|tsx)$/.test(fp);
    // A CREATE TABLE added OUTSIDE the migrations dir (e.g. setup-database.js) —
    // but NOT in a markdown doc, where "CREATE TABLE" is prose describing a table,
    // not creating one (this hook's own description tripped that).
    const isMarkdown = /\.(md|mdx)$/i.test(fp);
    const addsTable = !isMarkdown && /\bCREATE TABLE\b/i.test(added);
    if (!isMigration && !isNewApiRoute && !addsTable) return;

    const obligations = [];
    if (isMigration || addsTable) {
      obligations.push(
        'new table → `npm run prebuild` (migrations manifest) + an `docs/atlas/` page (`check:atlas`) + ' +
        'apply it (`node scripts/apply-migrations.js`) before the code that reads it can run');
    }
    if (isNewApiRoute) {
      obligations.push(
        'API route → add the row to `docs/API_ROUTE_SECURITY_MATRIX.md` (`check:api-routes`); a new ' +
        'requireAppAccess route also shifts `CANONICAL_COUNTS` (`check:fact-consistency`) — refresh with ' +
        '`npm run check:fact-consistency -- --write` and reconcile every doc that hardcodes the count');
    }

    const msg =
      'Durable contract surface touched. Complete the /contract-reconcile durable-surface + ' +
      'whole-flow audits — caller→persistence→consumer, plus: ' +
      obligations.join('; ') + '. Also confirm tests for the new contract and the CI gate that ' +
      'covers this omission are green.';

    process.stdout.write(JSON.stringify({
      hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: msg },
    }));
  } catch (e) {
    // fail open — never block a write/edit
  }
});
