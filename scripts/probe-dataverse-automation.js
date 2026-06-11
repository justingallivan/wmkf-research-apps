#!/usr/bin/env node
/**
 * READ-ONLY probe: enumerate server-side automation registered in the live
 * Dataverse environment that fires on the tables the reviewer-accept flow
 * writes to. Answers the question "what Power Automate flows / workflows /
 * plugins might fire if a test accept creates a honorarium request?" BEFORE
 * anyone runs a real accept against prod.
 *
 * The accept path (pages/api/external/review/[token]/respond.js →
 * lib/bill/honorarium-onboard-orchestrator.js) touches three tables:
 *   - akoya_request               CREATE (the honorarium request) + same entity as grant requests
 *   - contact                     UPDATE (address1_* + address1_telephone1 PATCH)
 *   - wmkf_appreviewersuggestion  UPDATE (accept stamp + acks + junction lookup)
 *
 * For each it lists:
 *   A. Classic processes (workflow category 0/2/3/4) whose primaryentity is the
 *      table — with the Create/Update/Delete trigger flags.
 *   B. Plugin / real-time steps (sdkmessageprocessingstep) filtered to the table
 *      — message (Create/Update/Delete), stage, sync/async, enabled/disabled.
 *   C. Cloud flows (workflow category 5 = Power Automate) whose clientdata
 *      references the table — best-effort trigger-vs-action + event detection.
 *
 * SAFETY: the ONLY POST is the OAuth token request; every Dataverse call is a
 * GET against system tables (workflow / sdkmessageprocessingstep / sdkmessage /
 * sdkmessagefilter). It reads metadata only — it creates/updates/deletes
 * nothing and triggers no automation.
 *
 * Environment: hits whatever `DYNAMICS_URL` in .env.local points at (per
 * project-dev-environment, that is PROD — which is exactly the environment a
 * real test accept would run against). The target URL is printed up front.
 *
 * Usage:  node scripts/probe-dataverse-automation.js
 */

const fs = require('fs');
const path = require('path');

// --- env: load .env.local (same pattern as the other probe scripts) ----------
const envPath = path.join(__dirname, '..', '.env.local');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!m) continue;
    let [, k, v] = m;
    v = v.trim().replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1');
    if (!process.env[k]) process.env[k] = v;
  }
}

// Tables the accept flow writes to, with the entity-set (plural) name used in
// cloud-flow trigger/action parameters.
const TARGETS = [
  { logical: 'akoya_request', set: 'akoya_requests', note: 'CREATE on accept — SAME entity as grant requests (highest concern)' },
  { logical: 'contact', set: 'contacts', note: 'UPDATE (address + phone PATCH)' },
  { logical: 'wmkf_appreviewersuggestion', set: 'wmkf_appreviewersuggestions', note: 'UPDATE (accept stamp + acks)' },
];

const CATEGORY = {
  0: 'Workflow (classic)', 1: 'Dialog', 2: 'Business Rule', 3: 'Action',
  4: 'Business Process Flow', 5: 'Cloud flow (Power Automate)',
};
// Dataverse "When a row is added/modified/deleted" trigger `message` values.
const TRIGGER_MSG = {
  1: 'CREATE', 2: 'DELETE', 3: 'UPDATE', 4: 'Create/Update',
  5: 'Create/Delete', 6: 'Update/Delete', 7: 'Create/Update/Delete',
};

async function getToken() {
  const r = await fetch(`https://login.microsoftonline.com/${process.env.DYNAMICS_TENANT_ID}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: process.env.DYNAMICS_CLIENT_ID,
      client_secret: process.env.DYNAMICS_CLIENT_SECRET,
      scope: `${process.env.DYNAMICS_URL}/.default`,
    }),
  });
  if (!r.ok) throw new Error(`Token: ${r.status} ${(await r.text()).slice(0, 300)}`);
  return (await r.json()).access_token;
}

// GET that follows @odata.nextLink so large result sets aren't silently truncated.
async function getAll(token, urlPath) {
  let url = `${process.env.DYNAMICS_URL}/api/data/v9.2${urlPath}`;
  const rows = [];
  while (url) {
    const r = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`, Accept: 'application/json', 'OData-Version': '4.0',
        Prefer: 'odata.maxpagesize=500',
      },
    });
    const text = await r.text();
    let body; try { body = JSON.parse(text); } catch { body = text; }
    if (!r.ok) {
      const msg = typeof body === 'string' ? body.slice(0, 300) : (body?.error?.message || JSON.stringify(body).slice(0, 300));
      const err = new Error(`${r.status} ${msg} — GET ${urlPath.slice(0, 80)}`);
      err.status = r.status;
      throw err;
    }
    rows.push(...(body.value || []));
    url = body['@odata.nextLink'] || null;
  }
  return rows;
}

const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
const stateOf = (sc) => (sc === 1 ? 'Activated' : sc === 0 ? 'Draft' : `state ${sc}`);
const stepStateOf = (sc) => (sc === 0 ? 'Enabled' : sc === 1 ? 'Disabled' : `state ${sc}`);
const MODE = { 0: 'sync', 1: 'async' };
const STAGE = { 10: 'pre-validation', 20: 'pre-operation', 40: 'post-operation' };

// Heuristically decide whether a cloud flow's clientdata references a target
// table, and if so whether in the TRIGGER (it fires on the table) or only in an
// action (it reads/writes the table mid-flow). Trigger detection + event are
// best-effort from the connector parameters — confirm anything flagged.
function analyzeCloudFlow(clientdata, tgt) {
  let parsed = null;
  try { parsed = JSON.parse(clientdata); } catch { /* fall back to raw scan */ }
  const setTok = `"${tgt.set}"`;
  const logiTok = `"${tgt.logical}"`;
  const refs = clientdata.includes(setTok) || clientdata.includes(logiTok);
  if (!refs) return null;

  const triggers = parsed?.properties?.definition?.triggers || {};
  for (const t of Object.values(triggers)) {
    const tj = JSON.stringify(t);
    if (tj.includes(setTok) || tj.includes(logiTok)) {
      const m = tj.match(/"message"\s*:\s*"?(\d+)"?/);
      const event = m ? (TRIGGER_MSG[Number(m[1])] || `message ${m[1]}`) : 'event?';
      return { where: 'TRIGGER', event };
    }
  }
  return { where: 'action/body ref', event: '—' };
}

(async () => {
  const { DYNAMICS_TENANT_ID, DYNAMICS_CLIENT_ID, DYNAMICS_CLIENT_SECRET, DYNAMICS_URL } = process.env;
  if (!DYNAMICS_TENANT_ID || !DYNAMICS_CLIENT_ID || !DYNAMICS_CLIENT_SECRET || !DYNAMICS_URL) {
    console.error('Missing DYNAMICS_TENANT_ID / DYNAMICS_CLIENT_ID / DYNAMICS_CLIENT_SECRET / DYNAMICS_URL in .env.local');
    process.exit(1);
  }

  console.log('═'.repeat(78));
  console.log('Dataverse automation probe (READ-ONLY — metadata GETs only, triggers nothing)');
  console.log(`Environment: ${DYNAMICS_URL}`);
  console.log('Tables checked: akoya_request, contact, wmkf_appreviewersuggestion');
  console.log('═'.repeat(78));

  const token = await getToken();
  console.log('✓ token acquired\n');

  // ── A + C: the `workflow` table (classic processes + cloud flows) ──────────
  // One pull of all process DEFINITIONS, bucketed client-side. clientdata is
  // only meaningful for cloud flows (category 5).
  let workflows = [];
  let workflowErr = null;
  try {
    workflows = await getAll(token,
      // NB: there is no `triggeronupdate` boolean on `workflow`; an update trigger
      // is expressed by a non-empty `triggeronupdateattributelist`.
      '/workflows?$select=name,category,statecode,type,primaryentity,'
      + 'triggeroncreate,triggerondelete,triggeronupdateattributelist,clientdata'
      + '&$filter=type eq 1');
  } catch (e) {
    workflowErr = e;
  }

  // ── B: plugin / real-time steps per table (queried individually) ───────────
  const stepsByTable = {};
  const stepErr = {};
  for (const tgt of TARGETS) {
    try {
      stepsByTable[tgt.logical] = await getAll(token,
        '/sdkmessageprocessingsteps?$select=name,stage,mode,statecode,rank'
        + '&$expand=sdkmessageid($select=name),sdkmessagefilterid($select=primaryobjecttypecode)'
        + `&$filter=sdkmessagefilterid/primaryobjecttypecode eq ${q(tgt.logical)}`);
    } catch (e) {
      stepErr[tgt.logical] = e;
    }
  }

  // ── Report, per target table ───────────────────────────────────────────────
  // Track CREATE-movers split by kind so the bottom line isn't a single alarmist
  // number: custom cloud-flow triggers (the real external-effect risk) vs. classic
  // workflows (gated by internal conditions) vs. platform/plugin steps (fire on
  // EVERY create already — benign baseline). Only ACTIVE items are counted.
  const movers = {};
  for (const t of TARGETS) movers[t.logical] = { cloudTrigger: 0, cloudTriggerOther: 0, classic: 0, plugin: 0 };

  for (const tgt of TARGETS) {
    console.log('─'.repeat(78));
    console.log(`TABLE: ${tgt.logical}  — ${tgt.note}`);
    console.log('─'.repeat(78));

    // A. classic processes (non-cloud-flow) on this primaryentity
    if (workflowErr) {
      console.log(`  A. Classic workflows/rules: ⚠️  could not read 'workflow' table (${workflowErr.status || ''} ${workflowErr.message.slice(0, 120)})`);
    } else {
      const classic = workflows.filter((w) => w.category !== 5 && w.primaryentity === tgt.logical);
      if (!classic.length) {
        console.log('  A. Classic workflows/business rules/actions: none');
      } else {
        console.log(`  A. Classic workflows/business rules/actions (${classic.length}):`);
        for (const w of classic) {
          const ev = [
            w.triggeroncreate ? 'Create' : null,
            w.triggerondelete ? 'Delete' : null,
            (w.triggeronupdate || w.triggeronupdateattributelist) ? 'Update' : null,
          ].filter(Boolean).join('+') || 'no event flags (manual/on-demand?)';
          if (w.triggeroncreate && w.statecode === 1) movers[tgt.logical].classic++;
          console.log(`     • [${stateOf(w.statecode)}] ${CATEGORY[w.category] || `cat ${w.category}`} "${w.name}" — fires on: ${ev}`);
        }
      }
    }

    // B. plugin / real-time steps on this table
    if (stepErr[tgt.logical]) {
      const e = stepErr[tgt.logical];
      console.log(`  B. Plugin/real-time steps: ⚠️  could not read (${e.status || ''} ${e.message.slice(0, 120)})`);
    } else {
      const steps = (stepsByTable[tgt.logical] || []).filter((s) => {
        const msg = s.sdkmessageid?.name || '';
        return ['Create', 'Update', 'Delete', 'SetState', 'SetStateDynamicEntity', 'Assign'].includes(msg);
      });
      if (!steps.length) {
        console.log('  B. Plugin/real-time steps (Create/Update/Delete): none');
      } else {
        console.log(`  B. Plugin/real-time steps (${steps.length}):`);
        for (const s of steps) {
          const msg = s.sdkmessageid?.name || '?';
          if (msg === 'Create' && s.statecode === 0) movers[tgt.logical].plugin++;
          console.log(`     • [${stepStateOf(s.statecode)}] ${msg} · ${STAGE[s.stage] || `stage ${s.stage}`} · ${MODE[s.mode] || `mode ${s.mode}`} — "${s.name}"`);
        }
      }
    }

    // C. cloud flows referencing this table
    if (workflowErr) {
      console.log('  C. Cloud flows (Power Automate): ⚠️  (workflow table unreadable — see A)');
    } else {
      const flows = workflows.filter((w) => w.category === 5 && w.clientdata);
      const matches = [];
      for (const w of flows) {
        const hit = analyzeCloudFlow(w.clientdata, tgt);
        if (hit) matches.push({ name: w.name, statecode: w.statecode, ...hit });
      }
      if (!matches.length) {
        console.log('  C. Cloud flows referencing this table: none detected');
      } else {
        console.log(`  C. Cloud flows referencing this table (${matches.length}) — HEURISTIC, confirm in Power Automate:`);
        for (const m of matches) {
          if (m.where === 'TRIGGER' && m.statecode === 1) {
            if (m.event === 'CREATE' || m.event.includes('Create')) movers[tgt.logical].cloudTrigger++;
            else movers[tgt.logical].cloudTriggerOther++; // activated trigger, event unparsed → must-confirm
          }
          const flag = m.where === 'TRIGGER' ? `⚡ TRIGGER on ${m.event}` : 'references in actions only';
          console.log(`     • [${stateOf(m.statecode)}] "${m.name}" — ${flag}`);
        }
      }
    }
    console.log('');
  }

  // ── Bottom line ────────────────────────────────────────────────────────────
  console.log('═'.repeat(78));
  console.log('BOTTOM LINE — what fires on akoya_request CREATE (the honorarium-request create):');
  const a = movers.akoya_request;
  console.log(`  • custom cloud-flow CREATE triggers (Activated): ${a.cloudTrigger}  ← the real external-effect risk; confirm EACH in Power Automate`);
  console.log(`  • Activated cloud triggers, event UNCONFIRMED:   ${a.cloudTriggerOther}  ← parser couldn't read the event; treat as must-confirm (e.g. the deprecated GOapply review-group flow)`);
  console.log(`  • classic workflows on Create (Activated):       ${a.classic}  ← check their internal type/program conditions (likely gated to grant/scholarship, not honorarium)`);
  console.log(`  • plugin steps on Create (Enabled):              ${a.plugin}  ← mostly AkoyaGo/system internals that ALREADY fire on every real honorarium create (benign baseline)`);
  console.log('');
  console.log('  Plus the manual-payment item to confirm regardless: the "Bill.com - Push Payments"');
  console.log('  cloud flow (seen in section C) — verify it triggers on a PAYMENT record, not request-create.');
  console.log('');
  console.log('  contact / wmkf_appreviewersuggestion are UPDATEd (not created) by the accept — lower');
  console.log('  concern; see their sections above (note the AkoyaGo Business-Central contact sync).');
  console.log('');
  console.log('Caveats: cloud-flow trigger/event detection is heuristic (parsed from clientdata) —');
  console.log('confirm any ⚡TRIGGER in the Power Automate UI. Draft/Disabled items are listed but do');
  console.log('NOT fire. The plugin baseline is not "new" risk — it fires for every production honorarium');
  console.log('too; the cloud-flow trigger count is the number that actually gates a fenced real-prod test.');
  console.log('═'.repeat(78));
})().catch((e) => {
  console.error('\nProbe failed:', e.message);
  process.exit(1);
});
