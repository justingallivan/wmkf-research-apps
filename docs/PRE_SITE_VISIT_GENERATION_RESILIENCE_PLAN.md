---
title: Pre-Site Visit Generation Resilience Plan
domain: request-workbench
kind: plan
status: active
summary: "Production-deployed Pre-Site resilience change with durable warnings and preserved integrity gates; generation + no-duplicate smokes passed 2026-08-27."
canonical: false
cataloged: 2026-08-18
last_verified: 2026-08-27
owner: product-engineering
related:
  - docs/PRE_SITE_VISIT_DATAVERSE_SCHEMA_DESIGN.md
  - docs/WORKBENCH_WRITEUP_LIFECYCLE_PLAN.md
  - docs/audits/pre-site-visit-proposal-core-implementation-2026-08-16.md
  - shared/config/prompts/pre-site-visit-proposal-core.js
  - lib/services/pre-site-visit/proposal-core-service.js
  - lib/services/pre-site-visit/artifact-service.js
  - lib/services/pre-site-visit/docx-renderer.js
  - shared/components/workbench/StaffDeliberationsTab.js
---

# Pre-Site Visit Generation Resilience Plan

> [RECHECKED after lib/services/pre-site-visit/proposal-core-service.js change: S466 (2026-08-28) raised this caller's Claude transport budget to 240s (`timeoutMsOverride`, see `docs/EXECUTOR_CONTRACT.md`) after production run `88f7c877` hit the 120s default on Request `1002788`; the timeout landed in the durable failure contract exactly as this plan specifies, and the attempt was retryable.]

## Status

**[DEPLOYED TO PRODUCTION 2026-08-18; SIGNED-IN GENERATION + NO-DUPLICATE
SMOKES PASSED 2026-08-27.]**
Application commit `46903bc4` is Ready in deployment
`dpl_HGogbJnprevoYKLaxevamxdajtC4`. The audited Admin publisher created
sole-current governed prompt v4 row
`74409f95-509b-f111-b8db-6045bd008868` on 2026-08-18; exact readback matched
the tracked body, system prompt, variables, complete output schema, model,
temperature, and token budget with zero mismatches. No request generation or
SharePoint write was performed during release verification.

**Smoke results (2026-08-27, owner-approved, Request `1002852`)** `[VERIFIED
via signed-in Workbench UI + authenticated status-API readback]`:

- The owner had already run one successful signed-in generation on
  2026-08-18T23:36Z under prompt v4 (artifact
  `ba0f767f-5d9b-f111-b8db-6045bd008868`, run
  `ea2f6d9c-5d9b-f111-b8db-70a8a5ae4225`) — Ready with the two expected
  durable warnings; it was never recorded until this smoke found it.
- **Prompt v5 exists**: sometime after 2026-08-18T23:36Z the prompt was
  re-published as sole-current v5. The republish is **unattributed** (the
  owner does not recall doing it; check the Admin publisher audit trail if
  attribution ever matters). Content is verified identical to the tracked
  contract by the runtime exact-match preflight
  (`artifact-service.js::validateNarrativePrompt`), which gated the
  successful 2026-08-27 generation.
- **Ready-with-warning generation (step 5): PASSED.** A signed-in owner-click
  regeneration produced a fresh governed generation under prompt v5 (the
  version bump legitimately changed the generation key; input fingerprint
  unchanged `d2ca2726…`): artifact `c0a211b1-77a2-f111-b8db-70a8a5b16486`,
  run `c3143de2-77a2-f111-b8db-6045bd0a1ac2`, template v7, warnings
  `section_over_target` (executiveSummary 720/700 chars) and
  `long_form_over_target` (715/600 words), valid SharePoint Word file
  (38,757 bytes, full siteId/driveId/itemId/versionId/eTag lineage),
  UI banner + Word link rendered.
- **Exact no-duplicate retry (step 7 tail): PASSED.** After the owner
  affirmed performing a second unchanged Regenerate click, authenticated
  readback showed the durable state bit-identical — same artifact/run/file,
  unchanged SharePoint timestamp/version/eTag, no pending row — so the retry
  created no new model call, file, or row. (Evidence is owner-affirmed action
  + unchanged durable readback; the second click ran in the owner's own
  browser tab, so its POST was not separately observed.)
- **Bonus: lost-POST recovery path proven live.** The first regeneration's
  POST returned a gateway 503 while the generation completed durably; the
  Workbench recovered the Ready state through its bounded read-only status
  polling without repeating POST — the exact behavior this plan's failure
  contract specifies for handled failures after a claimed row exists.
- **Hard source/template failure (step 6): SKIPPED by owner decision
  2026-08-27** — it writes a failed AI-run row against a real request and
  the owner chose not to spend one; it remains proven by the negative
  service/route tests in the verification matrix.
- The historical 2026-08-16 failed row was not mutated.

## Owner decision and product boundary

**[DECIDED 2026-08-18]** Pre-Site Visit writeups are AI-generated working
drafts that staff edit in Word. A response that is substantively usable but
slightly long or imperfectly formatted must still produce a Word document.
Editorial targets guide generation and staff review; they are not workflow
availability gates.

The system must continue to fail closed when it cannot prove the request,
source document, prompt, template, artifact lineage, or SharePoint identity.
This plan changes content-quality handling, not those authority boundaries.

## Triggering Production incident

**[VERIFIED via Production Dataverse and Vercel logs 2026-08-18]** Request
`1002852` failed during governed proposal-core validation after Claude returned
complete JSON with a normal `end_turn`. The persisted failure was:

```text
Claude output failed schema validation:
$.proposalCore.executiveSummary: max 700 characters.
```

The attempt used AI run `ba137cb4-409b-f111-b8db-6045bd008868`. It stopped
before DOCX rendering and SharePoint upload, so no Word file was created. The
immediate Workbench message was only “Pre-Site Visit generation did not
complete.” Retrying unchanged would merely ask the model to satisfy the same
unstated blocking boundary again.

The 700-character ceiling was originally introduced after an earlier
controlled overview overflowed the intended first-page region and displaced
later page starts. That was a layout-quality concern, not a Dataverse storage
limit. Each named narrative field is a 32,000-character Memo column.

## Triggering Production contract and evidence

| Current behavior | Producer / gate | Persistence | Consumer | Status |
|---|---|---|---|---|
| Five first-page fields have hard limits of 700, 420, 500, 520, and 480 characters | `pre-site-visit-proposal-core.js` validation schema | Failed `wmkf_ai_run`; no proposal core | Generic POST error | VERIFIED IN SOURCE AND PRODUCTION for the 700-character case |
| Long-form fields also have hard limits of 9,000, 9,000, and 6,000 characters | prompt validation schema | Failed `wmkf_ai_run`; no proposal core | Generic POST error | VERIFIED IN SOURCE |
| Extra output keys are dropped by the validator but also reported as fatal for this prompt | `validateAiJson` plus `allowExtra: 'error'` | Failed `wmkf_ai_run` | Generic POST error | VERIFIED IN SOURCE/TEST |
| Blank-line paragraphs in either Personnel field are fatal | `forbidPattern` in the local validation schema | Failed `wmkf_ai_run`; no proposal core | Generic POST error | VERIFIED IN SOURCE/TEST |
| Empty sections, omitted exact roster names, and more than two long-form paragraphs can fail during rendering | `docx-renderer.js` | Proposal core and input snapshot are already persisted | Generic POST error | VERIFIED IN SOURCE/TEST for empty/name gates; paragraph-count branch VERIFIED IN SOURCE |
| A retry reuses a persisted core before deciding whether to call Claude | `artifact-service.js::persistedDraft` | Same failed Request Document row | Repeated render attempt | VERIFIED IN SOURCE |
| Proposal text above 100,000 characters is truncated with an in-prompt marker | Executor payload boundary | Boundary metadata is retained on the AI run | No staff-facing warning | VERIFIED IN SOURCE/TEST |
| Actual Word page count is not tested at runtime | DOCX renderer emits OOXML only | N/A | Staff opens Word | VERIFIED IN SOURCE |

## Invariants

| Invariant | Required behavior | Verification |
|---|---|---|
| Usable drafts complete | Length, word-count, paragraph-count, and layout-target deviations do not block Ready | Focused service + renderer + component tests with deliberately over-target content |
| Warnings are not hidden | A completed artifact returns durable, content-free warning codes and readable messages on POST and later GET | Route/component tests plus persisted-envelope round trip |
| No identical blind retry | The system never repeats the same model request merely because an editorial target was missed | Real stored-schema fixture accepts warning-only output; service test asserts one model call and Ready |
| Hard failures stay hard | Missing authority, malformed/unrenderable structure, template corruption, and upload/lineage failures never return Ready | Negative service/route tests with real tripping inputs |
| Invalid persisted content cannot poison retry | Anything persisted as reusable has passed trim-based required-content checks and literal-placeholder rejection; later template/infrastructure failures may reuse that valid core only after the failing environment changes | Failure-then-retry tests distinguish content failure from safe technical recovery and never repeat the same deterministic model request |
| Raw and canonical output remain distinguishable | The AI run retains raw provider output; Request Document fields/envelope contain the validated, normalized render core | Readback tests and audit-field assertions |
| Existing artifacts remain readable | Existing proposal-core envelope v2, input-snapshot v2, and Ready Word rows continue to load without mutation | Compatibility fixtures for v2 Ready and Failed rows |
| Material render behavior is versioned | A release that changes renderer acceptance/normalization gets a new render/template contract identity | Generation-key test proves old and new contracts do not collide |
| Request changes cannot receive stale UI state | Existing sequence and AbortController guards remain on all post-await state writes | Existing stale-request component tests plus warning-path case |

## Target validation policy

### Hard failures

Keep these as blocking because a trustworthy artifact cannot be produced:

- invalid request ID or request/source mismatch;
- missing request number, project title, applicant institution, or PI;
- missing, renamed, unstable, or unreadable canonical Proposal Narrative;
- malformed JSON, missing required proposal-core fields, wrong field types, or
  trim-empty required sections;
- provider refusal, incomplete output, context exhaustion, or token truncation;
- prompt identity/variable/assertion drift;
- corrupt template package, missing/duplicated required placeholders, or lost
  staff-owned placeholders;
- incomplete Dataverse claim/snapshot/lineage state;
- incomplete or unstable SharePoint upload identity; and
- claim, ETag, current-pointer, lifecycle, or cleanup conflicts.

Hard model-output failures must occur before the core becomes reusable. Their
user-facing response must identify the failed stage and include the AI run or
artifact reference when available.

### Normalize without failure

- Drop undeclared JSON keys rather than carrying them into any sink. Record a
  content-free audit diagnostic, but do not fail an otherwise valid core.
- Collapse blank-line paragraphs in the first-page and Personnel fields to the
  single paragraph the Word template expects. Preserve the raw provider output
  only on the AI run.
- Normalize ordinary line breaks and surrounding whitespace deterministically.

The prompt's native JSON Schema may retain `additionalProperties: false` as
generation guidance. The local validation schema must omit fatal
`allowExtra: 'error'` behavior so any undeclared key is actually dropped before
the canonical core is returned.

### Complete with warnings

- section exceeds its target words or target characters;
- first-page content may overflow its intended page region;
- Background/Impact plus Methodology exceeds the combined word target;
- either long-form section contains more than two paragraphs;
- a deterministic pre-persistence text check does not find an authoritative
  roster name exactly in a Personnel section;
- proposal input was truncated by the 100,000-character payload boundary; or
- another deterministic editorial check is introduced later.

Name diagnostics are computed before persistence from the canonical plain text,
not returned by the renderer. The renderer underlines authoritative names it
can match as best-effort presentation and must not abort solely because a name
is missing, punctuated differently, or split across Word text runs. Exact
matching can produce false-positive warnings when punctuation or formatting
differs; that is acceptable only because the result is advisory. Warnings do
not alter Word text and do not insert review banners into the document.

### Sink-oriented ceilings

Replace layout-sized schema ceilings with generous technical ceilings aligned
below the 32,000-character named-field capacity. The Production implementation
uses a tested 30,000-character technical ceiling for each section. Prompt v4
and the paired application preflight enforce the same tracked contract.
Word/character targets remain explicit in the prompt and warning policy.

Define the word, character, and paragraph targets once in a tracked
Pre-Site-specific configuration object. Build the corresponding prompt section
requirements and diagnostics from that object so prompt copy and warning
thresholds cannot drift independently.

## Warning contract

Use stable codes and content-free metadata. The initial set should include:

| Code | Example metadata | Staff message |
|---|---|---|
| `section_over_target` | section, observed words/chars, target | “Executive Summary is longer than the suggested length and may need editing.” |
| `long_form_over_target` | combined words, target | “Background and Methodology may require layout editing.” |
| `paragraphs_over_target` | section, observed, target | “This section has more paragraphs than suggested.” |
| `personnel_name_not_matched` | section, roster display name | “A roster name was not found exactly in this Personnel section.” |
| `proposal_input_truncated` | original/transmitted characters | “Claude received a truncated proposal input; review the draft for omitted material.” |
| `extra_output_key_dropped` | key name only | Audit-only unless staff action is useful. |

Warnings must be available both on the successful POST response and the later
GET status response. `projectPreSiteVisitArtifact` is the single DTO derivation
point for warnings so Ready reuse, lease-active reuse, alternate-key races,
upload recovery, normal POST completion, and GET status all return the same
contract. The Workbench displays warnings beside the Ready Word link in an
amber review panel. A warning never changes operation status from Ready.

## Durable representation and compatibility

No new Dataverse column is required. Extend the existing immutable
`wmkf_presiteproposalcorejson` envelope to a new schema version containing:

```json
{
  "schemaVersion": 3,
  "proposalCore": {},
  "diagnostics": []
}
```

Only content-free diagnostics may enter the array. `persistedDraft` and every
projection must accept both schema versions 2 and 3:

- version 2: validate/read exactly as today and derive any safe content warning
  that can be computed from its named fields and input snapshot;
- version 3: validate/read the canonical core plus stored diagnostics; and
- unknown versions: continue to fail closed with a specific reconciliation
  error.

The input snapshot remains schema version 2 with its exact current shape. Do
not add diagnostics or payload-boundary counts to it: the snapshot participates
in the input fingerprint and generation key, so changing it would invalidate
reuse for every request. Input-truncation metadata belongs in the new core
envelope diagnostics instead.

For legacy envelope-v2 rows, content warnings that depend only on the named
fields and existing roster snapshot can be derived on read. A historical
`proposal_input_truncated` warning cannot be reconstructed because v2 stores no
original/transmitted character counts; this limitation must be explicit in
tests and UI expectations.

Before rendering, require exact equality between the canonical envelope core
and the eight named Dataverse fields after the same deterministic
normalization. Divergence fails closed with a specific reconciliation code;
named fields must not silently override the audited envelope. The AI run
continues to retain the raw provider output, while the Request Document stores
the normalized canonical core. Implementation must reconcile the Wave 19
column description and durable docs that currently call the envelope the
“exact validated Claude proposal-core object.”

Do not backfill or mutate existing rows. Existing Ready Word artifacts remain
authoritative and unchanged.

## Retry and partial-success contract

1. Validate and normalize the model output completely before persisting it as
   a reusable core. The hard content preflight is trim-based and rejects any
   required empty section plus literal reserved template tokens such as
   `[[AI:...]]`, `[[DV:...]]`, or staff/manual placeholders in generated text.
2. Compute all content diagnostics, including plain-text roster-name checks,
   before persistence.
3. Persist the canonical core, diagnostics, input snapshot, and AI-run link
   under the owned claim.
4. Render from Dataverse readback as today.
5. A technical failure after valid-core persistence may reuse that core
   (upload retry, lost finalization response, or template/infrastructure repair).
   A template text-node/span failure remains retryable only after the deployed
   template or renderer changes; the UI must not invite an unchanged blind
   retry.
6. A content failure must never leave a core that `persistedDraft` will blindly
   reuse. Tests must cover whitespace-only sections, literal reserved
   placeholders, omitted names, extra paragraphs, and over-target lengths
   across first attempt and retry.

No automatic semantic retry is part of the first implementation. A later
correction attempt is acceptable only if it sends explicit validation feedback,
records `semanticAttempt`, links `retryOfRunId`, and is separately approved.
Repeating the same prompt without new information is prohibited.

## Error and observability contract

- Convert Executor validation failures into stable typed codes rather than a
  generic `Error`.
- Preserve the sanitized internal detail on the failed Request Document and AI
  run.
- Return a safe stage-specific message, error code, and `runId`/`artifactId` to
  the client.
- Display the support reference in the Workbench.
- When POST returns a handled failure after a claimed row exists, perform one
  read-only status refresh so the UI can show the durable failure detail. Do
  not poll or repeat POST.
- Log one structured server event containing request ID/number, artifact ID,
  run ID, generation phase, safe code, and safe message. Do not log proposal or
  generated narrative text.

## Implementation sequence

**Production status 2026-08-27:** Phases 0–5 are deployed. Phase 6 steps 1–4
completed 2026-08-18; steps 5 and 7 passed 2026-08-27 (see Status); step 6
(hard-failure smoke) was skipped by owner decision and remains test-proven.

### Phase 0 — Pin the failure matrix

Add characterization tests for every current gate before changing behavior:

- each of the five tight first-page limits;
- the three generous long-form limits;
- extra output key;
- Personnel blank-line paragraphs;
- whitespace-only section;
- literal reserved template token in generated text;
- missing exact roster name in either Personnel section;
- three or more Background/Methodology paragraphs;
- truncated proposal input; and
- retry after each pre-persistence and post-persistence failure.

The tests must contain inputs that actually trip each gate; negative assertions
without the offending content are insufficient. Existing characterization
tests are converted to the new hard/normalize/warn expectations rather than
deleted, so each removed fatal gate retains a regression assertion.

### Phase 1 — Separate hard validation, normalization, and diagnostics

- Refactor the Pre-Site-specific contract so structural validation returns a
  canonical core and deterministic diagnostics.
- Keep the shared `validateAiJson` security semantics unchanged for other
  prompts.
- Define the approved targets and sink ceiling once in a tracked
  Pre-Site-specific configuration object.
- Remove layout-sized `maxLength`, Personnel `forbidPattern`, and fatal
  `allowExtra: 'error'` rules from the Pre-Site local hard-failure schema;
  replace them with the sink ceiling and Pre-Site normalization/diagnostic
  rules.
- Change this prompt's extra-key policy from fatal to drop-only. Do not weaken
  schemas for unrelated Executor consumers.
- Enforce trim-nonempty content and reject literal reserved template tokens
  before Request Document core persistence.
- Require normalized equality between the envelope core and eight named fields
  before rendering or reuse.
- Add a production-shaped Executor fixture that loads a stored prompt-row
  schema and proves over-target text, extra keys, blank-line Personnel content,
  and extra long-form paragraphs return a canonical result instead of a schema
  error. A local-schema-only mock is insufficient because Dataverse owns the
  runtime output schema.

### Phase 2 — Make rendering content-tolerant

- Render any number of non-empty long-form paragraphs.
- Underline only authoritative roster names actually found.
- Treat underlining as best-effort presentation only. Name diagnostics were
  already computed from canonical plain text before persistence; the renderer
  neither creates nor owns them.
- Retain hard template occurrence and post-render placeholder checks.
- Introduce a new render/template contract identity so changed rendering
  semantics cannot collide with existing generation keys. If the retained v4
  OOXML bytes do not change, document that the new version represents the
  renderer contract rather than a formatting change. The identity bump means
  every request's next explicit regeneration creates a new artifact rather
  than reusing a prior Ready row; it does not proactively regenerate anything.
- Update the renderer fixture builder for the relaxed paragraph/name behavior
  so test-generated templates exercise the same contract.

### Phase 3 — Persist and project warnings

- Write schema-version-3 proposal-core envelopes while preserving v2 reads.
- Carry the Executor's content-free payload-boundary metadata into diagnostics.
- Add `warnings` to the artifact DTO through the single
  `projectPreSiteVisitArtifact` projection used by POST, GET, reuse, lease,
  race, and recovery paths.
- Derive/deduplicate warning codes deterministically on read, including the
  documented inability to recover historical truncation metadata from v2.
- Reject envelope/named-field divergence instead of silently preferring named
  fields.
- Keep Ready, Failed, and lifecycle option sets unchanged; no Dataverse
  migration or new status is planned.

### Phase 4 — Improve errors and Workbench messaging

- Add stable error mapping at Executor/service boundaries.
- Log handled terminal failures with support identifiers.
- Display Ready-with-warning state and support references accessibly.
- Preserve the existing request-sequence and abort guards on every new async
  state update.
- Clear warnings and support-reference state when the selected request changes
  or a newer status response supersedes the current one.
- Add a single GET refresh after handled POST failure; never repeat generation
  automatically.
- Ensure every Failed/pending-failure projection can surface the same safe
  support reference rather than limiting it to the immediate POST response.

### Phase 5 — Publish a governed prompt version

- Publish the complete new immutable
  `pre-site-visit.proposal-core.generate` `PROMPT_OUTPUT_SCHEMA` verbatim, not a
  partial patch. It must retain desired word targets while changing all eight
  fatal section ceilings to the approved sink ceiling and removing every
  runtime-fatal Personnel `forbidPattern`. Native
  `additionalProperties: false` may remain provider guidance, but no stored
  custom policy may reintroduce local fatal `allowExtra: 'error'` behavior.
- Add a runtime prompt-contract fingerprint/preflight. A deployment whose
  expected Pre-Site schema does not exactly match the current Dataverse prompt
  must stop before calling the model with a specific operator-facing
  `prompt_contract_not_ready` error.
- Verify exact Dataverse readback of body, system prompt, variables, the entire
  output schema, model, temperature, token budget, status, and sole-current
  state. Assert published-schema equality with the tracked local contract, not
  merely the absence of the 700-character value.
- The new prompt version and new render/template contract version must both
  participate in the generation identity, ensuring Request `1002852` does not
  reclaim its failed prompt-v3/template-v4 row.

### Phase 6 — Controlled rollout

Develop Phases 0–4 on a Tier 1 branch and do not merge intermediate runtime
phases to `main`, because `main` auto-deploys to Production. Because prompt
publication and application deployment cannot be atomic, use a short
coordinated release window with no active Pre-Site generation:

1. deploy the complete backward-compatible application, renderer contract,
   warning projection, and prompt-contract preflight as one release;
2. **Completed 2026-08-18:** confirm the deployed preflight blocks generation
   with `prompt_contract_not_ready` while prompt v3 remains current;
3. **Completed 2026-08-18:** publish complete governed prompt v4 through the
   audited Admin publisher;
4. **Completed 2026-08-18:** verify exact sole-current prompt state, schema
   equality, and Ready deployment identity;
5. **Passed 2026-08-27:** run a signed-in controlled request that
   intentionally exceeds one soft target and confirm Ready-with-warning plus
   a valid Word link (Request `1002852`; see Status for artifact/run IDs);
6. **Skipped by owner decision 2026-08-27** (remains proven by negative
   service/route tests): confirm a hard source/template failure still
   returns no Ready artifact;
7. **Passed 2026-08-27 at the app-readback level:** current pointer, run
   provenance, warnings, SharePoint lineage, and exact no-duplicate retry
   verified via the authenticated status API; raw Dataverse row/envelope-v3
   inspection was not separately performed (the app's status projection is
   itself a server-side Dataverse read); and
8. stop generation immediately if any red gate fails.

Application and prompt rollback are a paired operational action, never
independent actions while generation remains enabled. If rollback is required,
pause generation first and keep it paused on the restored old stack: restoring
prompt v3/template-v4 could otherwise reclaim the known failed row or recreate
the same 700-character failure. Prefer a forward fix; re-enable generation only
after the new application and governed prompt contracts are again paired and
verified. Do not delete, mutate, or backfill Request `1002852`'s historical
failed row.

Do not use an invitation-bound request for destructive or repeated testing.
Request `1002852` may be retried only after the new prompt and render identities
are confirmed, and only with owner approval. (Exercised with owner approval
2026-08-18 and 2026-08-27; see Status.)

## Verification matrix

| Surface | Required verification |
|---|---|
| Prompt contract | `tests/unit/pre-site-visit-proposal-core-prompt-config.test.js` asserts every new ceiling and the absence of fatal Personnel/extra-key rules; a production-shaped stored-prompt-row Executor fixture accepts warning-only output; exact published-schema readback equals the tracked contract; prompt-injection tagging gate and self-test run sequentially |
| Proposal-core service | focused tests for hard/soft/normalization/extra-key behavior, literal reserved tokens, whitespace-only content, normalized envelope/named-field equality, and payload diagnostics |
| Renderer | package preservation, all placeholders, unlimited long-form paragraph render, partial roster underlining, byte determinism |
| Artifact lifecycle | v2/v3 compatibility including v2 truncation limitation, warning persistence and projection on every reuse/race/recovery path, failed-core retry, upload/finalization recovery, claim races, generation-key version separation |
| API | exact request body/auth unchanged; specific failure body and warnings on success/status |
| UI | Ready-with-warning, support reference on immediate and later Failed state, one status refresh, no automatic POST retry, warning reset, stale-request guards |
| Durable docs | docs catalog, Atlas/service catalog/current schema contract reconciled after implementation |
| Build | focused Jest suites, relevant CI gates, `npm run build` |
| Production | read-only prompt/schema preflight, one approved signed-in controlled smoke, exact Dataverse/Graph readback |

## Complement and fall-through checks

- No warnings → existing clean Ready UI and response remain unchanged.
- One or many warnings → exactly one Ready artifact; warnings are deduplicated
  and never interpreted as errors.
- Unknown warning code → render a safe generic review warning, never raw text.
- Existing envelope v2 → readable without mutation.
- Envelope v3 → diagnostics validated and bounded.
- Unknown envelope version → fail closed before render/upload.
- Extra output key → dropped from canonical output and never persisted as a
  named field.
- Missing required key or wrong type → hard failure before core persistence.
- Empty or whitespace-only required section → hard failure before core
  persistence.
- Literal reserved placeholder token in generated text → hard failure before
  core persistence.
- Missing roster name → warning; present roster names still underlined.
- More than two long-form paragraphs → all non-empty paragraphs rendered plus
  one warning.
- Proposal input under the cap → no truncation warning.
- Proposal input over the cap → one durable warning with counts, no source text.
- Legacy v2 input that was truncated → no reconstructed truncation warning;
  other derivable warnings remain available.
- Envelope and named fields differ after normalization → specific hard
  reconciliation failure, never silent field precedence.
- Failed POST with persisted state → one GET refresh, never an automatic POST.
- Ready reuse, lease-active reuse, alternate-key race, and upload recovery →
  warnings project through the same DTO helper as normal completion.
- Request changes during POST/GET → no stale warning, error, or artifact state.

## Out of scope

- Changing the eight-section content design or staff-owned template sections.
- Automatically editing or truncating Claude prose to fit a page.
- Adding warnings inside the Word document itself.
- New Dataverse columns, entities, option-set values, or migrations.
- Backfilling existing Ready or Failed rows.
- Automatic semantic retries without explicit corrective feedback.
- Changing canonical Proposal Narrative selection or provenance requirements.

## Contract-reconciliation audit scope

- **Whole-flow:** in scope; UI → route → service → Executor → Dataverse →
  renderer → SharePoint → POST/GET consumer is specified above.
- **Partial success:** in scope; Ready-with-warning and Failed are distinct, and
  retries must preserve only validated reusable work.
- **Async/stale state:** in scope; existing sequence/abort behavior is an
  invariant for warning/error additions.
- **Helper extraction:** in scope only for a Pre-Site-specific diagnostics
  helper; shared validator behavior for unrelated prompts must not change.
- **Durable surface:** no new database surface; existing envelope compatibility,
  Atlas/service catalog, and docs catalog are required.
- **Doc reconciliation:** updated after the paired Production application and
  prompt-v4 release; controlled generation evidence remains explicitly open.
- **Symbol fan-out:** no new status/option value; the new `warnings` DTO field
  must be traced through POST, GET, UI, fixtures, and tests.

## Plan acceptance criteria

The implementation is ready for release consideration only after an
independent adversarial review of the actual diff confirms or corrects:

1. the hard-versus-warning boundary;
2. the persisted-core retry invariant;
3. proposal-core-envelope-v2 and input-snapshot-v2 compatibility;
4. prompt and render/template generation identity;
5. warning durability without a Dataverse migration;
6. deployment ordering around immutable prompt publication; and
7. tests that would fail if any original content gate silently returned;
8. runtime equality between the tracked and published prompt schema;
9. trim/placeholder pre-persistence protection and envelope/field
   reconciliation; and
10. paired rollback behavior that cannot reactivate the known failed contract.

## Adversarial review record

**[COMPLETED 2026-08-18]** Claude Code reviewed the draft read-only through the
user's OAuth subscription. The review prompt included the exact Request
`1002852` incident, AI run ID, complete-provider-output fact, 700-character
validation failure, pre-render/pre-upload stop, generic UI message, human-edited
draft policy, and prohibition on unchanged blind retries.

The review identified the following material gaps; all are accepted into this
revision:

| Finding | Disposition in this plan |
|---|---|
| Dataverse's stored prompt-row schema, not only the local schema, is the runtime gate | Publish and read back the entire output schema verbatim; add a real stored-schema Executor fixture and runtime contract preflight |
| Persisted cores could still contain whitespace-only sections or literal placeholders and poison retry | Reject both before persistence; reuse only after an environmental repair |
| Independent app/prompt rollout or rollback could recreate the incident or reclaim the failed row | Do not deploy intermediate phases; block mixed contract state; pause generation for paired rollback and preserve the historical row |
| Renderer-owned name diagnostics contradicted the pre-persistence invariant | Compute advisory name checks before persistence; keep underline matching presentation-only |
| Warning derivation could diverge across Ready/reuse/race/recovery paths | Use `projectPreSiteVisitArtifact` as the single projection point and document the v2 truncation limit |
| Envelope and named fields could disagree silently | Require normalized equality and preserve raw provider output only on the AI run |
| Tests could pass against mocks that omit the actual stored schema | Add production-shaped prompt fixtures, positive over-target cases, and explicit absence assertions for every removed fatal gate |
| The plan blurred the two schema-version-2 payloads and secondary release effects | Freeze input-snapshot v2, version only the core envelope, reset UI warning state, update fixture builders, and acknowledge next-regeneration identity changes |

The reviewer found no new authorization, secret-handling, source-selection, or
SharePoint identity weakening in the proposed direction. This review validates
the plan's risk coverage; it does not authorize implementation or deployment.

### Implementation adversarial review

**[COMPLETED 2026-08-18]** Claude Sonnet reviewed the source-built diff
read-only through the user's OAuth subscription with the Request `1002852`
incident and hard-versus-warning policy included in the brief. It found no P0
issue and no material defect in shared Executor validation, prompt rollout,
envelope v2/v3 compatibility, warning projection, UI request guards, or render
identity. It identified one P1 and one defensive P2 retry classification gap:
`pre_site_visit_draft_incomplete` and `pre_site_visit_snapshot_mismatch` could
recur deterministically while still advertising retryability. Both codes now
block unchanged retry before claim or model execution, with focused fixtures
proving `retryable: false` and zero claim/model calls. The reviewer also
confirmed that drop-plus-warning for undeclared Pre-Site output keys is an
intentional prompt-local policy, not a shared-validator weakening.
Claude's narrow post-fix re-review confirmed both gaps closed and found no new
blocker.
