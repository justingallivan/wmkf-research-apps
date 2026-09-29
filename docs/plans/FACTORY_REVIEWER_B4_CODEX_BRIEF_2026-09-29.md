# Codex brief — revise slice B4: the cast suggested reviewer in the app (2026-09-29)

## Where

You are in `/Users/gallivan/Code/WMKF_Apps-codex-b4` on branch `codex/factory-reviewer-b4`, created from `origin/main` at `75d58e331` (PR #357 merged). Run `/start` first. **Stay on this branch and in this directory.** Claude is working in parallel in the main checkout and in `.claude/worktrees/liaison-from-institution` (a different plan).

Commit with descriptive messages and push this branch (`git push -u origin codex/factory-reviewer-b4`). Pushing a feature branch does not deploy. **Never push to `main`; do not merge.** The owner and Claude review and merge.

## Goal

**Plan revision only. Do not change runtime code** (`lib/`, `pages/`, `shared/`). Revise slice B4 in `docs/plans/TEST_REQUEST_FACTORY_CAST_AND_STATUS_PLAN_2026-09-28.md` (*Order* 6 and owner decision 8) into a build-ready revision 3 that answers every finding of Codex plan review round 1 (recorded under *Order* 6). A second, independent review follows; it will not be you.

Owner decision 8 (S549, option A): ordinary suggestion-creating operations admit a synthetic person **when, and only when, the target Request is a test Request**. Real Requests stay fenced; merges keep refusing synthetic persons. Purpose: staff can work the cast reviewer (`TEST · Factory Reviewer`, person `e5003660-35f1-41e1-a1c4-aa2e4ec6e591`) through the normal reviewer workflow on a production test Request (1003303 today) — Find, Candidates, invitation, acceptance, review.

## What the revision must settle (one subsection each, with file:line evidence)

File references below come from the round-1 review and Claude's S549 trace; re-verify each before relying on it.

1. **Hydration and promotion.** Find-tab intake hydrates the slot person through `loadApplicantKnownReviewer` → `findByEmailCandidates`, which excludes synthetic people; promotion then 503s. Design the request-scoped exact-person path (admits the GUID-bound person only after proving the Request is a test Request) and name every other read on the Find → Candidates → Review Manager path that excludes synthetic people. Search exclusions stay.
2. **One capability, both switches.** Define a single fail-closed predicate over `SYNTHETIC_REVIEWER_ISOLATION` and `TEST_REQUEST_ISOLATION` (on / off / unset / invalid) and state what every combination does, including that a marked person must never take the ordinary path onto a real Request when the reviewer switch is off.
3. **Authorize at service entry.** For `save-candidates-service.js`, `promote-applicant-reviewer-service.js`, `manual-reviewer-service.js` and the applicant-reviewers intake, place the pairing check before the first person write, and state which person writes are forbidden for a cast person (identity fields, email, ORCID, address trust, Contact link). Recommend whether manual add stays refused (the owner will decide).
4. **Downstream trace.** For a synthetic person on a test Request, trace invitation, the external accept portal, the acceptance drain, CRM Contact promotion, review form access and submission, honoraria/BILL, manual reminders and scheduled sweeps. For each: does it refuse, skip, or proceed, and is that what the design plan's owner decision 9 wants (`docs/plans/TEST_REQUEST_FACTORY_DESIGN_2026-09-19.md`, decision 9)? A table is fine. Stop and record the first step that would refuse, rather than designing around it silently.
5. **Email contract.** Test-Request email is gated on the Request marker and an allowlisted address, not on the recipient being a synthetic person (`lib/services/dynamics/email.js`, `lib/services/test-requests/email-allowlist.js`). Correct the plan's wording and list the options (accept "allowlisted recipients", or enforce recipient/suggestion binding) as an owner question.
6. **Durable slot binding.** `--bind-reviewer` must also set the Request's Potential Reviewer 1. Design a separately journaled slot operation (not a substate that misrepresents the verified suggestion row): pre-PATCH ETag and occupancy snapshot, one fenced PATCH (body exactly the bind; navigation property from live metadata; concrete `If-Match`), readback, lost-response recovery by re-read, 412 and occupied-slot outcomes, and recovery when the suggestion row is already verified (1003303's binding `0d1a990d` is). Name the migration (054 is edited in place only for the local ledgers under P6; say whether this is 054-in-place or a new migration), the V55 fresh-install mirror, the Atlas page (`docs/atlas/postgres-test-request-runs.md`) and the PG crash-boundary tests.
7. **Tests that would pass while broken.** For each piece, the discriminating fixture (the thing excluded must be present) and the mutation that must fail it.

Keep the round-1 findings and the superseded draft in the plan for the record; mark the revision clearly. Label every present-state claim `[VERIFIED via file:line]` or `[ASSUMED]` (the repo's hooks enforce this in plan docs).

## Also in scope (small, code allowed here only)

Commit the Potential Reviewer slot probe as a new section of `scripts/probe-test-request-factory-production-readiness.js` (read-only metadata; same client and helpers as sections 11–12), with a unit test for any classifier you add. Its logic, as run once by the owner on 2026-09-29 (result recorded in the plan's *Order* 5), is the appendix below. **Do not run it against production**; the owner runs production probes. Sandbox runs are fine only if the section supports the sandbox URL; otherwise leave it untested against a live org.

## Guardrails

- Derive every field, identifier and helper name from the real source or the Atlas; never fabricate identifiers.
- No production reads or writes. No `DATAVERSE_PROD_WRITE_ACK`, no `DATAVERSE_ALLOW_PROD_READS`.
- Run the doc gates you touch (`check:doc-currency`, `check:fact-consistency`, `check:doc-symbol-refs`, `check:build-claim-freshness`), and the probe's unit test and `check:types` if you change the script. Gate and self-test sequentially.
- Codex model for any sub-review you run yourself: `--model gpt-5.6-sol`.

## Done means

The plan's *Order* 6 reads as revision 3 with all seven subsections, owner questions listed at the end, the probe section committed with its test, gates green, branch pushed. Report the commit list and the open owner questions.

## Appendix — the probe as run (S549, session scratch)

Reference only: it requires the client by an absolute path to the main checkout; the committed section uses the probe script's own imports and helpers.

```js
#!/usr/bin/env node
/**
 * READ-ONLY production metadata probe (S549, owner-requested): what reacts to an
 * update of akoya_request.wmkf_potentialreviewer1..5, and are those columns audited.
 * GET only, through the interlocked raw client. Process metadata only; no record data.
 */
const { loadEnvLocal, getAccessToken, createClient } = require('/Users/gallivan/Code/WMKF_Apps/lib/dataverse/client');

const PRODUCTION_URL = 'https://wmkf.crm.dynamics.com';
const SLOTS = ['1', '2', '3', '4', '5'].map((n) => `wmkf_potentialreviewer${n}`);
const FLOW_MESSAGE = { 1: 'create', 2: 'delete', 3: 'update', 4: 'create or update', 5: 'create or delete', 6: 'update or delete', 7: 'create, update or delete' };
const mentionsSlot = (text) => SLOTS.filter((s) => String(text || '').toLowerCase().includes(s));

async function getAll(client, path) {
  const rows = [];
  let next = path;
  while (next) {
    const resp = await client.get(next);
    if (!resp.ok) throw new Error(`GET failed (${resp.status}): ${String(resp.text).slice(0, 300)}`);
    rows.push(...(resp.body?.value || []));
    next = resp.body?.['@odata.nextLink'] || null;
  }
  return rows;
}

async function main() {
  loadEnvLocal();
  const token = await getAccessToken(PRODUCTION_URL);
  const client = createClient({ resourceUrl: PRODUCTION_URL, token });
  let incomplete = false;

  console.log('A. Column auditing (akoya_request)');
  const entity = await client.get("/EntityDefinitions(LogicalName='akoya_request')?$select=IsAuditEnabled");
  console.log(`   entity auditing: ${entity.ok ? JSON.stringify(entity.body?.IsAuditEnabled?.Value) : `unreadable (${entity.status})`}`);
  for (const slot of SLOTS) {
    const r = await client.get(`/EntityDefinitions(LogicalName='akoya_request')/Attributes(LogicalName='${slot}')?$select=LogicalName,IsAuditEnabled`);
    if (!r.ok) { incomplete = true; console.log(`   ${slot}: unreadable (${r.status})`); continue; }
    console.log(`   ${slot}: audited=${JSON.stringify(r.body?.IsAuditEnabled?.Value)}`);
  }

  console.log('\nB. Classic workflows and business rules on akoya_request (activated)');
  const workflows = await getAll(client,
    "/workflows?$select=name,category,mode,triggeronupdateattributelist,xaml&$filter=primaryentity eq 'akoya_request' and type eq 1 and statecode eq 1");
  const updateTriggered = workflows.filter((w) => w.category === 0 && w.triggeronupdateattributelist);
  console.log(`   activated: ${workflows.length} (update-triggered workflows: ${updateTriggered.length})`);
  const triggered = updateTriggered.filter((w) => w.triggeronupdateattributelist.split(',').some((a) => SLOTS.includes(a.trim())));
  console.log(`   triggered by a slot update: ${triggered.length}`);
  for (const w of triggered) console.log(`   - ${w.name}  on update(${w.triggeronupdateattributelist})  ${w.mode === 1 ? 'real-time' : 'background'}`);
  const referencing = workflows.filter((w) => mentionsSlot(w.xaml).length && !triggered.includes(w));
  console.log(`   other definitions that mention a slot (conditions or writes): ${referencing.length}`);
  for (const w of referencing) console.log(`   - [${w.category === 2 ? 'business rule' : w.category === 0 ? 'workflow' : `category ${w.category}`}] ${w.name}  mentions ${mentionsSlot(w.xaml).join(',')}`);
  const noXaml = workflows.filter((w) => !w.xaml).length;
  if (noXaml) { incomplete = true; console.log(`   definitions without readable xaml: ${noXaml}`); }

  console.log('\nC. Plug-in steps on akoya_request Update (enabled)');
  const steps = await getAll(client,
    '/sdkmessageprocessingsteps?$select=name,stage,mode,filteringattributes,ishidden' +
    '&$expand=sdkmessageid($select=name),plugintypeid($select=typename)' +
    "&$filter=sdkmessagefilterid/primaryobjecttypecode eq 'akoya_request' and statecode eq 0");
  const updates = steps.filter((s) => s.sdkmessageid?.name === 'Update');
  console.log(`   enabled Update steps: ${updates.length}`);
  for (const s of updates) {
    const attrs = String(s.filteringattributes || '').split(',').map((a) => a.trim()).filter(Boolean);
    const fires = !attrs.length ? 'ANY column' : attrs.some((a) => SLOTS.includes(a)) ? `a slot (${attrs.filter((a) => SLOTS.includes(a)).join(',')})` : null;
    if (fires) console.log(`   - fires on ${fires}: [stage ${s.stage}, ${s.mode === 0 ? 'sync' : 'async'}${s.ishidden ? ', hidden' : ''}] ${s.name || '(unnamed)'}  type=${s.plugintypeid?.typename || '?'}`);
  }
  const unfiltered = await getAll(client,
    '/sdkmessageprocessingsteps?$select=name,stage,mode,ishidden' +
    '&$expand=sdkmessageid($select=name),plugintypeid($select=typename)' +
    '&$filter=_sdkmessagefilterid_value eq null and statecode eq 0');
  const allEntityUpdates = unfiltered.filter((s) => s.sdkmessageid?.name === 'Update');
  console.log(`   enabled Update steps with no entity filter (all entities): ${allEntityUpdates.length} (hidden: ${allEntityUpdates.filter((s) => s.ishidden).length})`);
  for (const s of allEntityUpdates.filter((x) => !x.ishidden)) console.log(`   - [stage ${s.stage}, ${s.mode === 0 ? 'sync' : 'async'}] ${s.name || '(unnamed)'}  type=${s.plugintypeid?.typename || '?'}`);

  console.log('\nD. Cloud flows (activated) with an akoya_request update trigger');
  const flows = await getAll(client, '/workflows?$select=name,clientdata&$filter=category eq 5 and statecode eq 1');
  let unreadable = 0;
  let requestUpdate = 0;
  for (const f of flows) {
    let definition;
    try { definition = JSON.parse(f.clientdata || '')?.properties?.definition; } catch { definition = null; }
    if (!definition) { unreadable += 1; continue; }
    for (const [name, t] of Object.entries(definition.triggers || {})) {
      const p = t?.inputs?.parameters || {};
      if (p['subscriptionRequest/entityname'] !== 'akoya_request') continue;
      const msg = Number(p['subscriptionRequest/message']);
      if (![3, 4, 6, 7].includes(msg)) continue;
      requestUpdate += 1;
      const filter = String(p['subscriptionRequest/filteringattributes'] || '');
      const hit = !filter ? 'ANY column' : mentionsSlot(filter).length ? `a slot (${mentionsSlot(filter).join(',')})` : `other columns only (${filter})`;
      console.log(`   - ${f.name} / ${name}: ${FLOW_MESSAGE[msg]}, fires on ${hit}`);
    }
  }
  console.log(`   flows read: ${flows.length}; akoya_request update triggers: ${requestUpdate}; unreadable definitions: ${unreadable}`);
  if (unreadable) incomplete = true;

  console.log(`\n${incomplete ? 'INCOMPLETE (see above)' : 'COMPLETE'}`);
  process.exitCode = incomplete ? 1 : 0;
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; });
```
