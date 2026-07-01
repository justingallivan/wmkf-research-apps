#!/usr/bin/env node
/**
 * READ-ONLY probe: inventory per-user email template preferences in Dataverse
 * `wmkf_appuserpreferences` for legacy `[bracket]` tokens left over from the
 * S311 email token-syntax unification (mustache `{{}}`).
 *
 * Context: reviewer templates render mustache-only (lib/utils/email-generator.js
 * `replacePlaceholders`), so a stored `[bracket]` body would render literally.
 * Run this whenever a PD reports a malformed template, or to re-confirm no
 * bracket bodies exist before assuming the migration is complete. Writes nothing.
 *
 * Keys probed:
 *   - reviewer_email_templates      JSON { type: { subject, body } }, override-only
 *   - grantee_invite_body           plain string
 *   - reviewer_finder_email_template legacy standalone single template
 *
 * Usage: node scripts/probe-user-email-token-syntax.mjs
 */
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { getAccessToken, createClient } = require('../lib/dataverse/client.js');

const KEYS = ['reviewer_email_templates', 'grantee_invite_body', 'reviewer_finder_email_template'];

function loadEnvLocal() {
  for (const envFile of ['.env', '.env.local']) {
    try {
      const env = readFileSync(resolve(process.cwd(), envFile), 'utf8');
      for (const line of env.split('\n')) {
        const t = line.trim();
        if (!t || t.startsWith('#')) continue;
        const i = t.indexOf('=');
        if (i === -1) continue;
        const k = t.slice(0, i).trim();
        const v = t.slice(i + 1).trim().replace(/^["']|["']$/g, '');
        if (!process.env[k]) process.env[k] = v;
      }
    } catch {}
  }
}

function bracketTokens(text) {
  return Array.from(new Set(String(text ?? '').match(/\[[^\]\n]{1,60}\]/g) || []));
}

/** Extract bracket tokens from a stored value of any shape (JSON or plain string). */
function tokensFromValue(raw) {
  if (raw == null) return [];
  let text = String(raw);
  // If JSON, walk string leaves only so JSON syntax brackets aren't miscounted.
  try {
    const parsed = JSON.parse(text);
    const leaves = [];
    const walk = (v) => {
      if (typeof v === 'string') leaves.push(v);
      else if (v && typeof v === 'object') Object.values(v).forEach(walk);
    };
    walk(parsed);
    text = leaves.join('\n');
  } catch { /* plain string */ }
  return bracketTokens(text);
}

async function main() {
  loadEnvLocal();
  const url = process.env.DYNAMICS_SANDBOX_URL || process.env.DYNAMICS_URL;
  if (!url) throw new Error('DYNAMICS_SANDBOX_URL / DYNAMICS_URL not set');
  console.log(`Dataverse: ${url}`);
  const token = await getAccessToken(url);
  const client = createClient({ resourceUrl: url, token });

  const allTokens = new Set();
  let totalWithBrackets = 0;
  for (const key of KEYS) {
    const filter = `wmkf_preferencekey eq '${key}'`;
    const r = await client.get(
      `/wmkf_appuserpreferences?$filter=${encodeURIComponent(filter)}&$select=wmkf_appuserpreferenceid,wmkf_preferencevalue,_ownerid_value&$top=5000`,
    );
    if (!r.ok) throw new Error(`list ${key} failed: ${r.status} ${r.text?.slice(0, 200)}`);
    const rows = r.body?.value || [];
    const perRow = [];
    for (const row of rows) {
      const toks = tokensFromValue(row.wmkf_preferencevalue);
      if (toks.length) {
        toks.forEach((t) => allTokens.add(t));
        perRow.push({ owner: row._ownerid_value, id: row.wmkf_appuserpreferenceid, tokens: toks });
      }
    }
    totalWithBrackets += perRow.length;
    console.log(`\n=== ${key} ===`);
    console.log(`  total rows: ${rows.length}; rows with [brackets]: ${perRow.length}`);
    for (const pr of perRow) {
      console.log(`  owner ${pr.owner} (pref ${pr.id}): ${pr.tokens.join(', ')}`);
    }
  }

  console.log(`\n=== ALL DISTINCT BRACKET TOKENS ACROSS USER PREFS ===`);
  console.log(Array.from(allTokens).sort().join('\n') || '(none)');
  console.log(`\nResult: ${totalWithBrackets} user preference row(s) still carry legacy [bracket] tokens.`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
