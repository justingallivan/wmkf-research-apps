#!/usr/bin/env node
/**
 * READ-ONLY probe: does creating a child row BUMP the parent record's ETag?
 *
 * Settles the load-bearing assumption behind the reviewer-merge pre-deactivate
 * reference re-check (S423). `executeMerge` guards its final deactivate with
 * `ifMatch` on the loser PERSON's ETag. If Dataverse bumps a parent's ETag when a
 * child row carrying a lookup to it is created, that guard already catches a
 * suggestion row created mid-merge and the re-check is redundant. If it does not,
 * the re-check is necessary.
 *
 * Method — no writes, no sandbox, no test data. Dataverse `@odata.etag` is
 * `W/"<versionnumber>"` (verified exactly against a `versionnumber` select), and
 * versionnumber is an org-wide monotonic rowversion, so ETags from different
 * tables are comparable as one sequence.
 *
 * A rowversion tracks the row's LAST WRITE, not its creation. A row created in
 * 2024 and edited last week carries a recent version. So a child's CURRENT
 * version is only its creation version if the child has never been updated —
 * `createdon == modifiedon`. Those pristine children are the only usable
 * evidence, and the comparison is:
 *
 *   parentVersion < pristineChildVersion
 *     ⇒ the parent's last write precedes that child's creation
 *     ⇒ creating the child did NOT write the parent. DISPROVES the bump.
 *
 * Using a modified child here would be unsound: its version reflects the later
 * edit, so it could exceed the parent's for reasons having nothing to do with
 * creation.
 *
 * A single clean case is proof. Zero cases across a large population is strong
 * evidence the opposite way. Parents that are NEWER than their children prove
 * nothing on their own — an ordinary later edit (email fix, identity bind) moves
 * a parent forward for reasons unrelated to child creation — so they are counted
 * separately as inconclusive rather than as evidence for the bump.
 *
 * The org-wide monotonicity premise is itself checked, not assumed: the probe
 * samples cross-entity row pairs and reports how often version ordering agrees
 * with MODIFIEDON ordering. (Checking it against createdon is a mistake — it
 * scores ~50% on real data purely because rowversion tracks writes, not
 * creation, and would invalidate a perfectly sound method.) Low agreement
 * invalidates the comparison, and the probe says so instead of reporting a
 * verdict.
 *
 * Does NOT answer the slot-binding half of the question (binding
 * `wmkf_PotentialReviewerN@odata.bind` on akoya_request). Dataverse records no
 * binding timestamp, so history cannot separate a binding from any other edit to
 * the request. Reported as unanswered.
 *
 * Artifact contains GUIDs, timestamps, and version numbers only: no reviewer
 * names, emails, or proposal content.
 *
 * Usage:
 *   node scripts/probe-etag-parent-bump.js --target=sandbox
 *   DATAVERSE_ALLOW_PROD_READS=yes node scripts/probe-etag-parent-bump.js \
 *     --target=prod --output outputs/etag-parent-bump-probe.json
 */

const fs = require('node:fs');
const path = require('node:path');
const { loadEnvLocal, getAccessToken, createClient } = require('../lib/dataverse/client.js');

const PARENT_SET = 'wmkf_potentialreviewerses';
const CHILD_SET = 'wmkf_appreviewersuggestions';

const PARENT_SELECT = ['wmkf_potentialreviewersid', 'createdon', 'modifiedon'].join(',');
const CHILD_SELECT = [
  'wmkf_appreviewersuggestionid',
  '_wmkf_potentialreviewer_value',
  'createdon',
  // Required: only a never-updated child's version is its creation version.
  'modifiedon',
].join(',');

// Dataverse stamps createdon and modifiedon from the same transaction clock on
// insert, but they are stored to millisecond precision — allow a small tolerance
// rather than requiring bit-exact equality.
const PRISTINE_TOLERANCE_MS = 1000;

// Parents whose modifiedon sits within this window of the child's createdon are
// "coincident": consistent with a bump, but also with a staff edit that happened
// to land at the same moment. Never counted as proof either way.
const COINCIDENT_WINDOW_MS = 60_000;
const MONOTONICITY_SAMPLE_PAIRS = 2000;

function parseCli(argv) {
  const targetArg = argv.find((arg) => arg.startsWith('--target='));
  if (!targetArg) throw new Error('--target=prod or --target=sandbox is required');
  const target = targetArg.slice('--target='.length);
  if (!['prod', 'sandbox'].includes(target)) {
    throw new Error("--target must be 'prod' or 'sandbox'");
  }
  const outputIndex = argv.indexOf('--output');
  const outputPath = outputIndex === -1 ? null : argv[outputIndex + 1];
  if (outputIndex !== -1 && (!outputPath || outputPath.startsWith('--'))) {
    throw new Error('--output requires a path');
  }
  const knownIndexes = new Set([argv.indexOf(targetArg)]);
  if (outputIndex !== -1) {
    knownIndexes.add(outputIndex);
    knownIndexes.add(outputIndex + 1);
  }
  const unknown = argv.filter((_, index) => !knownIndexes.has(index));
  if (unknown.length > 0) throw new Error(`unknown arguments: ${unknown.join(' ')}`);
  return { outputPath, target };
}

/** `W/"1234567"` → 1234567. Null when the annotation is absent or unparseable. */
function etagVersion(row) {
  const raw = row?.['@odata.etag'];
  const match = typeof raw === 'string' ? raw.match(/"(\d+)"/) : null;
  return match ? Number(match[1]) : null;
}

function ms(value) {
  const t = value ? Date.parse(value) : NaN;
  return Number.isNaN(t) ? null : t;
}

async function queryAll(client, entitySet, select) {
  const rows = [];
  let requestPath = `/${entitySet}?${new URLSearchParams({ $select: select }).toString()}`;
  while (requestPath) {
    const response = await client.get(requestPath);
    if (!response.ok) {
      throw new Error(`GET ${requestPath} failed (${response.status}): ${response.text}`);
    }
    rows.push(...(response.body?.value || []));
    requestPath = response.body?.['@odata.nextLink'] || null;
  }
  return rows;
}

/**
 * Does version ordering agree with createdon ordering across entities? Samples
 * deterministically (fixed stride, no RNG) so repeated runs are comparable.
 */
function checkMonotonicity(rows) {
  const usable = rows.filter((r) => r.version !== null && r.createdOnMs !== null);
  if (usable.length < 2) return { checked: 0, agreed: 0, agreementRate: null };
  let checked = 0;
  let agreed = 0;
  const stride = Math.max(1, Math.floor(usable.length / Math.sqrt(MONOTONICITY_SAMPLE_PAIRS)));
  for (let i = 0; i < usable.length && checked < MONOTONICITY_SAMPLE_PAIRS; i += stride) {
    for (let j = i + stride; j < usable.length && checked < MONOTONICITY_SAMPLE_PAIRS; j += stride) {
      const a = usable[i];
      const b = usable[j];
      if (a.version === b.version || a.createdOnMs === b.createdOnMs) continue;
      checked += 1;
      if ((a.version < b.version) === (a.createdOnMs < b.createdOnMs)) agreed += 1;
    }
  }
  return { checked, agreed, agreementRate: checked ? agreed / checked : null };
}

function analyze(parents, children) {
  // Only PRISTINE children (never updated) carry their creation version. Among
  // those, keep the highest-versioned one per parent: it is the best chance of
  // exceeding the parent, and so the strongest available evidence.
  const byParent = new Map();
  let skippedModifiedChildren = 0;
  for (const child of children) {
    const parentId = child._wmkf_potentialreviewer_value;
    if (!parentId) continue;
    const version = etagVersion(child);
    const createdOnMs = ms(child.createdon);
    const modifiedOnMs = ms(child.modifiedon);
    if (version === null || createdOnMs === null || modifiedOnMs === null) continue;
    if (Math.abs(modifiedOnMs - createdOnMs) > PRISTINE_TOLERANCE_MS) {
      skippedModifiedChildren += 1;
      continue;
    }
    const current = byParent.get(parentId.toLowerCase());
    if (!current || version > current.version) {
      byParent.set(parentId.toLowerCase(), {
        childId: child.wmkf_appreviewersuggestionid,
        version,
        createdOnMs,
        createdOn: child.createdon,
      });
    }
  }

  const cases = [];
  let missingVersion = 0;
  for (const parent of parents) {
    const id = String(parent.wmkf_potentialreviewersid || '').toLowerCase();
    const newestChild = byParent.get(id);
    if (!newestChild) continue;
    const version = etagVersion(parent);
    const modifiedOnMs = ms(parent.modifiedon);
    if (version === null || modifiedOnMs === null) { missingVersion += 1; continue; }

    const gapMs = newestChild.createdOnMs - modifiedOnMs;
    let verdict;
    if (version < newestChild.version) {
      // Parent has not been written since before this child existed. Decisive.
      verdict = 'parent-behind-child';
    } else if (Math.abs(gapMs) <= COINCIDENT_WINDOW_MS) {
      verdict = 'coincident';
    } else {
      verdict = 'parent-ahead-of-child';
    }
    cases.push({
      potentialReviewerId: id,
      parentVersion: version,
      parentModifiedOn: parent.modifiedon,
      newestChildId: newestChild.childId,
      newestChildVersion: newestChild.version,
      newestChildCreatedOn: newestChild.createdOn,
      childMinusParentSeconds: Math.round(gapMs / 1000),
      verdict,
    });
  }

  const counts = { 'parent-behind-child': 0, coincident: 0, 'parent-ahead-of-child': 0 };
  for (const c of cases) counts[c.verdict] += 1;
  return { cases, counts, missingVersion, skippedModifiedChildren };
}

function conclude(counts, monotonicity, denominator) {
  if (monotonicity.agreementRate !== null && monotonicity.agreementRate < 0.95) {
    return {
      verdict: 'METHOD-INVALID',
      detail: `Version ordering agreed with modifiedon ordering in only ${(monotonicity.agreementRate * 100).toFixed(1)}% of ${monotonicity.checked} sampled cross-entity pairs. Versionnumber is not behaving as an org-wide monotonic write counter here, so version comparison cannot answer the question. Do not read the counts below as evidence.`,
    };
  }
  if (denominator === 0) {
    return { verdict: 'NO-DATA', detail: 'No potential reviewer with at least one never-updated suggestion row and a readable ETag was found.' };
  }
  if (counts['parent-behind-child'] > 0) {
    return {
      verdict: 'CREATION-DOES-NOT-BUMP-PARENT',
      detail: `${counts['parent-behind-child']} of ${denominator} parents sit at a LOWER version than a never-updated child of theirs, meaning the parent's last write precedes that child's creation. Creating a child row does not bump the parent's ETag, so an ifMatch on the parent cannot detect a new child. The merge pre-deactivate re-check is NECESSARY.`,
    };
  }
  return {
    verdict: 'CONSISTENT-WITH-PARENT-BUMP',
    detail: `Zero of ${denominator} parents sit below their newest child's version. That is what you would see if child creation bumped the parent. It is not proof — a population where every parent was edited after its last child produces the same shape — so confirm against a controlled write in a sandbox before removing any guard that depends on this.`,
  };
}

async function main() {
  const { outputPath, target } = parseCli(process.argv.slice(2));
  loadEnvLocal();
  if (target === 'prod' && process.env.DATAVERSE_ALLOW_PROD_READS !== 'yes') {
    throw new Error('Production reads require DATAVERSE_ALLOW_PROD_READS=yes');
  }
  const resourceUrl = target === 'sandbox'
    ? process.env.DYNAMICS_SANDBOX_URL
    : process.env.DYNAMICS_URL || process.env.DATAVERSE_URL;
  if (!resourceUrl) throw new Error(`Missing Dynamics URL for target=${target}`);
  const targetUrl = new URL(resourceUrl);
  const token = await getAccessToken(resourceUrl);
  const client = createClient({ resourceUrl, token });

  const [parents, children] = await Promise.all([
    queryAll(client, PARENT_SET, PARENT_SELECT),
    queryAll(client, CHILD_SET, CHILD_SELECT),
  ]);

  // Against MODIFIEDON, not createdon: a rowversion orders writes, not creations.
  const monotonicity = checkMonotonicity([
    ...parents.map((r) => ({ version: etagVersion(r), createdOnMs: ms(r.modifiedon) })),
    ...children.map((r) => ({ version: etagVersion(r), createdOnMs: ms(r.modifiedon) })),
  ]);

  const { cases, counts, missingVersion, skippedModifiedChildren } = analyze(parents, children);
  const conclusion = conclude(counts, monotonicity, cases.length);

  // Decisive cases first, then the widest coincident/ahead gaps, for spot-checking.
  const examples = [...cases]
    .sort((a, b) => {
      if (a.verdict === 'parent-behind-child' && b.verdict !== 'parent-behind-child') return -1;
      if (b.verdict === 'parent-behind-child' && a.verdict !== 'parent-behind-child') return 1;
      return b.childMinusParentSeconds - a.childMinusParentSeconds;
    })
    .slice(0, 20);

  const artifact = {
    observedAt: new Date().toISOString(),
    target: target === 'prod' ? 'production' : 'sandbox',
    targetHostname: targetUrl.hostname.toLowerCase(),
    question: 'Does creating a child row bump the parent record ETag (versionnumber)?',
    method: 'Compare each parent potential-reviewer version against the highest-versioned NEVER-UPDATED (createdon == modifiedon) suggestion row of that parent. parentVersion < pristineChildVersion proves the parent was not written at or after that child was created. Modified children are unusable: their version reflects a later edit, not creation.',
    conclusion,
    monotonicityCheck: {
      ...monotonicity,
      note: 'Cross-entity pairs where version ordering agrees with MODIFIEDON ordering. A rowversion orders writes, not creations — checking against createdon scores ~50% on migrated data and would falsely invalidate a sound method. Below 95% the probe reports METHOD-INVALID.',
    },
    population: {
      parentRows: parents.length,
      childRows: children.length,
      childrenSkippedAsModified: skippedModifiedChildren,
      parentsWithPristineChild: cases.length,
      parentsSkippedNoVersionOrModifiedOn: missingVersion,
    },
    counts,
    countsLegend: {
      'parent-behind-child': 'DECISIVE — parent version below a never-updated child of its own; creation did not touch the parent.',
      coincident: `Parent modifiedon within ${COINCIDENT_WINDOW_MS / 1000}s of the child createdon. Consistent with a bump AND with an unrelated simultaneous edit. Proves nothing.`,
      'parent-ahead-of-child': 'Parent written after the child. Expected from ordinary later edits; not evidence of a bump.',
    },
    unanswered: [
      'Slot binding (wmkf_PotentialReviewerN@odata.bind on akoya_request) is a different operation and Dataverse records no binding timestamp, so history cannot isolate it. Needs a controlled sandbox write.',
    ],
    examples,
  };

  const json = `${JSON.stringify(artifact, null, 2)}\n`;
  if (outputPath) {
    const resolved = path.resolve(outputPath);
    fs.writeFileSync(resolved, json, 'utf8');
    console.error(`Wrote read-only ETag parent-bump probe: ${resolved}`);
    console.error(`Verdict: ${conclusion.verdict}`);
  } else {
    process.stdout.write(json);
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`ETag parent-bump probe failed: ${error?.stack || error?.message || error}`);
    process.exit(1);
  });
}

module.exports = { PARENT_SET, CHILD_SET, parseCli, etagVersion, analyze, checkMonotonicity, conclude };
