#!/usr/bin/env node
/**
 * CI gate: prompt-injection tagging coverage (A7).
 *
 * A7 hardens LLM-input surfaces so untrusted (attacker/applicant-influenced)
 * text is wrapped in nonce-bearing sentinels via `wrapUntrustedContent` and
 * the matching prompt carries the `buildUntrustedContentPreamble` rule. See
 * `docs/security-audit/A7_PROMPT_INJECTION_PLAN.md`.
 *
 * This gate is the durable anti-drift control. It is REGISTRY-based, not a
 * dataflow heuristic — the Codex review of the A7 plan recommended a concrete
 * call-site inventory over a fragile static scan. The registry below mirrors
 * the plan's inventory table. Each surface is either:
 *
 *   - status 'migrated' — across the union of its `promptFiles` and
 *     `callSiteFiles`, at least one file MUST reference `wrapUntrustedContent`
 *     and at least one MUST reference `buildUntrustedContentPreamble`. (Union,
 *     not per-list: a route+prompt split keeps the wrapper in the route and
 *     the preamble in the prompt; an Executor-driven surface keeps both in
 *     `execute-prompt.js`.) If a migrated surface loses either marker, this
 *     gate fails (a regression caught mechanically).
 *
 *     A surface flagged `multimodal: true` sends its untrusted content as
 *     Anthropic image/document content blocks — there is NO text string to
 *     wrap, so `wrapUntrustedContent` does not apply. Such a surface is
 *     required to carry the preamble only (the documented multimodal sibling
 *     control — see `docs/security-audit/A7_PROMPT_INJECTION_PLAN.md`).
 *
 *     A surface may additionally declare a `builders` list — the names of the
 *     prompt-builder functions in its prompt file(s). When present, the gate
 *     adds a CALL-SITE-GRANULAR layer: it slices the prompt file at top-level
 *     `export function` boundaries and asserts EACH declared builder carries
 *     `buildUntrustedContentPreamble` in its own body (a sibling builder's
 *     preamble does not cover it), and that every `create*Prompt` export is
 *     declared (a new sibling cannot escape). This closes the file-level
 *     `content.includes()` masking hole that false-greened #8/#15 — see
 *     `docs/CLAUDE_COVERAGE_LESSONS.md` lesson F. The wrap marker stays
 *     file-level: builders wrap via per-file helper indirection, so a
 *     per-builder body slice cannot see the wrap call.
 *
 *     `builders` is opt-in per surface. A builder exempt from the in-body
 *     check is declared `{ name, routePreamble: true }` (preamble injected at
 *     the route) or `{ name, noCallSite: true }` (exported but wired to no
 *     live LLM call site); both stay drift-tracked. A multi-builder prompt
 *     file only needs ONE surface to declare its `builders` — other surfaces
 *     sharing that file inherit the granular coverage (e.g. process-phase-ii
 *     references proposal-summarizer.js but the `qa` surface owns its
 *     `builders` list). The one multi-builder surface still on the plain
 *     file-level check is peer-reviewer, whose two prompt files build one
 *     preamble in the route and reuse it for every builder (no per-builder
 *     concern). Adopt `builders` for any new multi-builder prompt file.
 *
 *   - status 'pending'  — not yet hardened (a later A7 Part). Tracked, not
 *     enforced. As Parts 2-6 land, surfaces move pending -> migrated here in
 *     the same commit.
 *
 * It also flags DRIFT from new work: any prompt-builder file under
 * `shared/config/prompts/` that is not referenced by ANY registry surface is
 * reported — a new LLM surface was added without registering it.
 *
 * Usage:   node scripts/check-prompt-injection-tagging.js
 * Exit 0 — all migrated surfaces carry their markers, no unregistered prompt files.
 * Exit 1 — a migrated surface lost a marker, or a prompt file is unregistered.
 *
 * Self-test: scripts/check-prompt-injection-tagging-self-test.js exercises
 * the detection on synthetic fixtures (per the CLAUDE.md mandatory gate order).
 */

const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');

// Marker tokens a migrated surface must contain.
const PREAMBLE_MARKER = 'buildUntrustedContentPreamble';
const WRAP_MARKER = 'wrapUntrustedContent';

/**
 * The LLM-input surface registry. `inv` is the row number in the A7 plan's
 * inventory table. `promptFiles` must reference the preamble; `callSiteFiles`
 * must reference the wrapper. Paths are repo-relative.
 *
 * Every `.js` under `shared/config/prompts/` must be referenced by exactly
 * one surface's `promptFiles` (or be in PROMPT_FILE_ALLOWLIST) — the
 * unregistered-file check enforces this so a newly added prompt builder
 * cannot escape A7 tracking. Pending surfaces still list `promptFiles` for
 * that reason; the marker enforcement only runs for `migrated` surfaces.
 */
const SURFACES = [
  {
    id: 'grant-reporting-extract',
    inv: 12,
    status: 'migrated',
    promptFiles: ['shared/config/prompts/grant-reporting.js'],
    callSiteFiles: ['pages/api/grant-reporting/extract.js'],
    builders: [
      'createGrantReportExtractionPrompt',
      'createFieldRegenerationPrompt',
      'createGoalsAssessmentPrompt',
    ],
  },
  {
    id: 'process-phase-i-writeup',
    inv: 1,
    status: 'migrated',
    promptFiles: ['shared/config/prompts/phase-i-writeup.js'],
    callSiteFiles: ['pages/api/process-phase-i-writeup.js'],
  },
  // ── Pending (later A7 Parts) ──────────────────────────────────────────
  {
    id: 'process-phase-i',
    inv: 2,
    status: 'migrated',
    promptFiles: ['shared/config/prompts/phase-i-summaries.js'],
    callSiteFiles: ['pages/api/process-phase-i.js'],
  },
  {
    id: 'process-phase-ii',
    inv: 3,
    status: 'migrated',
    promptFiles: [
      'shared/config/prompts/proposal-summarizer.js',
      'shared/config/prompts/phase-ii-dynamics.js',
    ],
    callSiteFiles: ['pages/api/process.js'],
  },
  {
    id: 'process-legacy',
    inv: 4,
    status: 'migrated',
    promptFiles: ['shared/config/prompts/proposal-summarizer-legacy.js'],
    callSiteFiles: ['pages/api/process-legacy.js'],
    // The summary/extraction builders self-carry the preamble and are called
    // by process-legacy.js; the refinement/Q&A builders are exported but wired
    // to no live route (noCallSite).
    builders: [
      'createSummarizationPrompt',
      'createStructuredDataExtractionPrompt',
      { name: 'createRefinementPrompt', noCallSite: true },
      { name: 'createQAPrompt', noCallSite: true },
    ],
  },
  {
    id: 'qa',
    inv: 5,
    status: 'migrated',
    // createQASystemPrompt lives in proposal-summarizer.js (also #3's file);
    // the route supplies the wrapper, the prompt file supplies the preamble.
    // This is the single-promptFile surface for proposal-summarizer.js, so it
    // carries the per-builder coverage for the whole file (#3 references the
    // same file but adds phase-ii-dynamics.js, so it stays file-level).
    promptFiles: ['shared/config/prompts/proposal-summarizer.js'],
    callSiteFiles: ['pages/api/qa.js'],
    // createSummarizationPrompt / createStructuredDataExtractionPrompt
    // (called by process.js) and createQASystemPrompt (called by qa.js) all
    // self-carry the preamble. createRefinementPrompt / createQAPrompt are
    // exported but wired to no live route (noCallSite) — refine.js uses its
    // own route-local REFINEMENT_PROMPT, not the shared builder.
    builders: [
      'createSummarizationPrompt',
      'createStructuredDataExtractionPrompt',
      'createQASystemPrompt',
      { name: 'createRefinementPrompt', noCallSite: true },
      { name: 'createQAPrompt', noCallSite: true },
    ],
  },
  {
    id: 'refine',
    inv: 6,
    status: 'migrated',
    // Route-local REFINEMENT_PROMPT — wrapper + preamble both live in refine.js.
    callSiteFiles: ['pages/api/refine.js'],
  },
  {
    id: 'process-peer-reviews',
    inv: 7,
    status: 'migrated',
    promptFiles: [
      'shared/config/prompts/peer-reviewer.js',
      // Dataverse-seeded Executor variant (only referenced by
      // seed-peer-review-summarizer-prompts.js) — not a live route prompt, so
      // it carries no source markers; the Executor (#20) handles its wrapping.
      'shared/config/prompts/peer-reviewer-dynamics.js',
    ],
    callSiteFiles: ['pages/api/process-peer-reviews.js'],
  },
  {
    id: 'evaluate-multi-perspective',
    inv: 8,
    status: 'migrated',
    // Multimodal: the Stage-1 concept page is an Anthropic document content
    // block — no text to wrap. The A7 control is the multimodal preamble.
    multimodal: true,
    promptFiles: ['shared/config/prompts/multi-perspective-evaluator.js'],
    // Call-site-granular: every builder must carry the preamble in its own body.
    builders: [
      'createInitialAnalysisPrompt',
      'createProposalSummaryPrompt',
      'createOptimistPrompt',
      'createSkepticPrompt',
      'createNeutralPrompt',
      'createIntegratorPrompt',
    ],
  },
  {
    // Stage 1 paper extraction is multimodal (PDF document block); Stage 2
    // synthesis/comparison wrap the re-fed extracted-paper text in-builder,
    // so this surface has a genuine wrap site and is not multimodal-flagged.
    id: 'analyze-literature',
    inv: 9,
    status: 'migrated',
    promptFiles: ['shared/config/prompts/literature-analyzer.js'],
    builders: [
      'createPaperExtractionPrompt',
      'createSynthesisPrompt',
      'createComparisonPrompt',
    ],
  },
  {
    id: 'analyze-funding-gap',
    inv: 10,
    status: 'migrated',
    promptFiles: ['shared/config/prompts/funding-gap-analyzer.js'],
    callSiteFiles: ['pages/api/analyze-funding-gap.js'],
    builders: [
      'createFundingExtractionPrompt',
      'createFundingAnalysisPrompt',
      'createBatchFundingSummaryPrompt',
    ],
  },
  {
    // Route-local prompt. The image path is multimodal (receipt image
    // content block, preamble-controlled); the PDF path embeds extracted
    // text, which the route wraps — so this surface has a genuine wrap site
    // and is NOT multimodal-flagged. Both markers live in the route file.
    id: 'process-expenses',
    inv: 11,
    status: 'migrated',
    callSiteFiles: ['pages/api/process-expenses.js'],
  },
  {
    id: 'expertise-finder',
    inv: 13,
    status: 'migrated',
    promptFiles: ['shared/config/prompts/expertise-finder.js'],
    callSiteFiles: [
      'pages/api/expertise-finder/match.js',
      'pages/api/expertise-finder/batch-match.js',
    ],
    // buildCacheableSystemPrompt self-carries the preamble; buildUserPrompt
    // builds the user message and relies on the system-prompt preamble.
    builders: [
      'buildCacheableSystemPrompt',
      { name: 'buildUserPrompt', routePreamble: true },
    ],
  },
  {
    // integrity-screener.js is CommonJS (can't import the ESM boundary
    // helpers); the wrap + preamble both live in the service call site.
    id: 'integrity-screener',
    inv: 14,
    status: 'migrated',
    promptFiles: ['shared/config/prompts/integrity-screener.js'],
    callSiteFiles: ['lib/services/integrity-service.js'],
  },
  {
    id: 'virtual-review-panel',
    inv: 15,
    status: 'migrated',
    promptFiles: ['shared/config/prompts/virtual-review-panel.js'],
    callSiteFiles: ['pages/api/virtual-review-panel.js'],
    // Call-site-granular: every builder must carry the preamble in its own
    // body. `createPanelSynthesisPrompt` once had none — the 7 sibling
    // builders masked it at the file level (Codex S176).
    builders: [
      'createClaimExtractionPrompt',
      'createSearchCollationPrompt',
      'createIntelligenceSynthesisPrompt',
      'createClaimVerificationPrompt',
      'createPerplexityClaimVerificationPrompt',
      'createStructuredReviewPrompt',
      'createDevilsAdvocatePrompt',
      'createPanelSynthesisPrompt',
    ],
  },
  {
    id: 'reviewer-finder-analyze',
    inv: 16,
    status: 'migrated',
    promptFiles: [
      'shared/config/prompts/reviewer-finder.js',
      'shared/config/prompts/reviewer-finder-dynamics.js',
    ],
    callSiteFiles: [
      'lib/services/claude-reviewer-service.js',
      // createWebExtractionPrompt's call site (Track C web discovery, v1).
      'lib/services/web-discovery-service.js',
    ],
    // reviewer-finder-dynamics.js has no prompt builders of its own.
    // createWebExtractionPrompt: Perplexity web-discovery name extraction (v1) —
    // wraps untrusted web results + calls buildUntrustedContentPreamble in-body.
    builders: ['createAnalysisPrompt', 'createDiscoveredReasoningPrompt', 'createWebExtractionPrompt'],
  },
  {
    id: 'dynamics-explorer-chat',
    inv: 17,
    status: 'migrated',
    promptFiles: ['shared/config/prompts/dynamics-explorer.js'],
    callSiteFiles: ['pages/api/dynamics-explorer/chat.js'],
  },
  {
    // Executor-driven (summarize-v2). Hardening lives in execute-prompt.js
    // (wrapper + preamble injection); the proposal_text variable is declared
    // untrusted:true in scripts/seed-phase-i-summary-prompt.js, deployed to
    // the live wmkf_ai_prompts row separately (a Dataverse deploy step).
    id: 'phase-i-dynamics-v2',
    inv: 18,
    status: 'migrated',
    promptFiles: ['shared/config/prompts/phase-i-dynamics.js'],
    callSiteFiles: ['lib/services/execute-prompt.js'],
  },
  {
    id: 'phase-i-dynamics-legacy',
    inv: 19,
    status: 'migrated',
    callSiteFiles: ['pages/api/phase-i-dynamics/summarize.js'],
  },
  {
    id: 'execute-prompt-executor',
    inv: 20,
    status: 'migrated',
    callSiteFiles: ['lib/services/execute-prompt.js'],
  },
  {
    // Service-local prompt — wrap + preamble live in the service.
    id: 'contact-enrichment',
    inv: 21,
    status: 'migrated',
    callSiteFiles: ['lib/services/contact-enrichment-service.js'],
  },
  {
    id: 'reviewer-finder-emails',
    inv: 22,
    status: 'migrated',
    // email-reviewer.js wraps its own untrusted blocks in-builder (candidate
    // context is assembled inside the builder), so both markers live there.
    promptFiles: ['shared/config/prompts/email-reviewer.js'],
    callSiteFiles: ['pages/api/reviewer-finder/generate-emails.js'],
    builders: ['createPersonalizationPrompt', 'createSubjectPrompt'],
  },
  {
    id: 'dynamics-explorer-export',
    inv: 23,
    status: 'migrated',
    callSiteFiles: ['pages/api/dynamics-explorer/chat.js'],
  },
  {
    // Route-local prompt — wrap + preamble live in the route.
    id: 'cron-log-analysis',
    inv: 24,
    status: 'migrated',
    callSiteFiles: ['pages/api/cron/log-analysis.js'],
  },
];

// Prompt-builder files known NOT to be untrusted-content surfaces (so the
// "unregistered prompt file" check doesn't false-fire). Each needs a reason.
const PROMPT_FILE_ALLOWLIST = {
  // Shared prompt fragments / helpers — composed into other prompts, not a
  // standalone LLM call site of its own.
  'common.js': 'shared prompt fragments, not a standalone LLM surface',
};

// Matches a prompt-builder export name (`createXxxPrompt` / `buildXxxPrompt`).
const BUILDER_NAME_RE = /^(?:create|build)[A-Za-z0-9_]*Prompt$/;

/**
 * Slice a prompt-builder source file into per-builder segments. Builders are
 * top-level `export function NAME(...)` declarations (column 0); each segment
 * runs from one such declaration to the next (or EOF). This deliberately does
 * NOT brace-match — prompt files are full of literal `{`/`}` inside template
 * literals (JSON examples), which would defeat a naive matcher. The slice
 * relies only on the column-0 `export function` convention, so a non-exported
 * helper sitting between two builders is attributed to the preceding segment;
 * that is fine because the per-builder check only looks for the preamble call,
 * which each builder makes directly in its own return template.
 *
 * @returns {Record<string,string>} builder name → segment text
 */
function sliceBuilders(content) {
  const re = /^export function ([A-Za-z0-9_]+)\s*\(/gm;
  const marks = [];
  let m;
  while ((m = re.exec(content))) marks.push({ name: m[1], start: m.index });
  const out = {};
  for (let i = 0; i < marks.length; i++) {
    const end = i + 1 < marks.length ? marks[i + 1].start : content.length;
    out[marks[i].name] = content.slice(marks[i].start, end);
  }
  return out;
}

/**
 * Validate one surface against the filesystem. Pure-ish: takes a `readFile`
 * so the self-test can drive it with synthetic content.
 *
 * @returns {{ id: string, errors: string[] }}
 */
function checkSurface(surface, readFile) {
  const errors = [];
  if (surface.status !== 'migrated') return { id: surface.id, errors };

  const files = [...(surface.promptFiles || []), ...(surface.callSiteFiles || [])];
  let sawWrap = false;
  let sawPreamble = false;

  for (const f of files) {
    const content = readFile(f);
    if (content == null) {
      errors.push(`${surface.id}: registered file missing: ${f}`);
      continue;
    }
    if (content.includes(WRAP_MARKER)) sawWrap = true;
    if (content.includes(PREAMBLE_MARKER)) sawPreamble = true;
  }

  // Multimodal surfaces send untrusted content as image/document content
  // blocks — there is no text to wrap, so the wrap marker is not required.
  // The preamble (below) is still mandatory.
  if (!sawWrap && !surface.multimodal) {
    errors.push(
      `${surface.id}: no registered file references ${WRAP_MARKER} ` +
        '(migrated surface lost its untrusted-content wrapping).',
    );
  }
  if (!sawPreamble) {
    errors.push(
      `${surface.id}: no registered file references ${PREAMBLE_MARKER} ` +
        '(migrated surface lost its hardening preamble).',
    );
  }

  // Call-site-granular layer: when the surface declares `builders`, every
  // declared builder must carry the preamble in its OWN function body — a
  // sibling builder's preamble does not cover it. This closes the file-level
  // masking hole (CLAUDE_COVERAGE_LESSONS.md lesson F).
  //
  // A builder entry is either a string (must self-carry the preamble) or an
  // object with one exemption flag:
  //   { name, routePreamble: true } — preamble injected at the route/service
  //     call site (e.g. expertise-finder's `buildUserPrompt`, hardened by the
  //     system prompt the route builds first).
  //   { name, noCallSite: true }   — the builder is exported but wired to NO
  //     live LLM call site (e.g. proposal-summarizer's `createRefinementPrompt`
  //     / `createQAPrompt` — re-exported from shared/config/index.js but
  //     called by no route; their text was captured into Dataverse-seeded
  //     prompts). A7-inert today; declared only so drift tracking forces a
  //     conscious decision if one is ever wired up.
  // Both flags exempt the builder from the in-body preamble check but still
  // count it for drift, so a NEW builder must be explicitly classified.
  if (Array.isArray(surface.builders)) {
    const declared = surface.builders.map((b) =>
      typeof b === 'string' ? { name: b, routePreamble: false } : b,
    );
    const declaredNames = new Set(declared.map((d) => d.name));
    const segmentsByName = {};
    for (const f of surface.promptFiles || []) {
      const content = readFile(f);
      if (content == null) continue; // missing-file already flagged above
      for (const [name, seg] of Object.entries(sliceBuilders(content))) {
        segmentsByName[name] = { file: f, seg };
      }
    }
    for (const d of declared) {
      const hit = segmentsByName[d.name];
      if (!hit) {
        errors.push(
          `${surface.id}: declared builder "${d.name}" not found as a top-level ` +
            "`export function` in the surface's prompt file(s).",
        );
        continue;
      }
      // Require the CALL form `buildUntrustedContentPreamble(` — a bare token
      // in a comment or string must not satisfy the gate.
      if (!d.routePreamble && !d.noCallSite && !hit.seg.includes(`${PREAMBLE_MARKER}(`)) {
        errors.push(
          `${surface.id}: builder "${d.name}" (${hit.file}) does not call ` +
            `${PREAMBLE_MARKER}() in its own body — a sibling builder's preamble ` +
            'does not cover it (call-site-granular check). If its preamble is ' +
            'injected at the route, mark it `{ routePreamble: true }`.',
        );
      }
    }
    // Drift: a new prompt-builder export must be added to `builders`.
    for (const [name, hit] of Object.entries(segmentsByName)) {
      if (BUILDER_NAME_RE.test(name) && !declaredNames.has(name)) {
        errors.push(
          `${surface.id}: prompt builder "${name}" (${hit.file}) is not in the ` +
            "surface's `builders` list — add it so per-builder A7 coverage tracks it.",
        );
      }
    }
  }

  return { id: surface.id, errors };
}

/**
 * Find prompt-builder files not referenced by any registry surface.
 * @returns {string[]} repo-relative paths
 */
function findUnregisteredPromptFiles(surfaces, listPromptFiles) {
  const registered = new Set();
  for (const s of surfaces) {
    for (const f of s.promptFiles || []) registered.add(f);
  }
  return listPromptFiles().filter(
    (f) => !registered.has(f) && !(path.basename(f) in PROMPT_FILE_ALLOWLIST),
  );
}

// ── Real-filesystem adapters ─────────────────────────────────────────────

function readRepoFile(relPath) {
  const abs = path.join(repoRoot, relPath);
  try {
    return fs.readFileSync(abs, 'utf8');
  } catch {
    return null;
  }
}

function listRepoPromptFiles() {
  const dir = path.join(repoRoot, 'shared/config/prompts');
  let entries = [];
  try {
    entries = fs.readdirSync(dir);
  } catch {
    return [];
  }
  return entries
    .filter((e) => e.endsWith('.js') && !e.endsWith('.test.js'))
    .map((e) => `shared/config/prompts/${e}`);
}

function main() {
  const allErrors = [];

  for (const surface of SURFACES) {
    const { errors } = checkSurface(surface, readRepoFile);
    allErrors.push(...errors);
  }

  const unregistered = findUnregisteredPromptFiles(SURFACES, listRepoPromptFiles);
  for (const f of unregistered) {
    allErrors.push(
      `Unregistered prompt-builder file: ${f} — add a SURFACES entry ` +
        '(status pending or migrated) so A7 coverage tracks it.',
    );
  }

  const migrated = SURFACES.filter((s) => s.status === 'migrated');
  const pending = SURFACES.filter((s) => s.status === 'pending');

  if (allErrors.length > 0) {
    console.error('Prompt-injection tagging gate FAILED:\n');
    for (const e of allErrors) console.error(`  ✗ ${e}`);
    console.error(
      `\n${migrated.length} migrated surface(s), ${pending.length} pending. ` +
        'Fix the above before committing.',
    );
    process.exit(1);
  }

  console.log(
    `Prompt-injection tagging OK — ${migrated.length} migrated surface(s) ` +
      `carry their markers, ${pending.length} pending (later A7 Parts).`,
  );
}

if (require.main === module) main();

module.exports = { checkSurface, findUnregisteredPromptFiles, sliceBuilders, SURFACES };
