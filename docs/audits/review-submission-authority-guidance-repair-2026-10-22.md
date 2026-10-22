# Review submission authority and reader guidance repair — 2026-10-22

## Scope and invariants

Sweep Mode A; contract-reconcile Mode B. Second authorized repair batch from the
read-only submission/rescue/record-authority audit. Documentation and source
comments only. No runtime, worktree topology, environment, deployment, external
record, question publication, schedule, owner policy or retention operation changed.

| Claim / invariant | Producer → persistence → consumer evidence | Repair / classification |
|---|---|---|
| Final submit consumes request answers, not a server draft reread. | ReviewAuthoringForm submits current values → submit-service sanitizes/validates body.answers → atomic answer/parent receipt commit → best-effort draft deletion. | Draft Atlas and service header corrected; scratchpad/finality history retained. VERIFIED via source. |
| Staff rescue GET cache and POST authority are distinct. | getManualReviewEntryForm uses cached getActiveQuestionSet → rendered version → POST uncached getAuthoritativeQuestionSet plus required matching version before canonical write. | Rescue memory documents the read/write distinction; no cache/payload change. VERIFIED via source. |
| Current combined Word export is server-authoritative. | Reviews export route/service rereads request and reviewer snapshots → server composition/render → private/no-store download. | Wiki separates browser comparison/copy from combined export and preserves older client implementation as history. VERIFIED via source. |
| Draft, structured answers, receipt, and file pointer establish different things. | Draft scratchpad; canonical answer rows; receipt readers/readiness; retention snapshot-shape validation; persisted pointer download. | One authority map in answer Atlas with pointers from upload memory, draft Atlas and wiki. No partial legacy contract tightened. VERIFIED via source. |

The authority map documents intentional reader differences: reviewer DTOs attach
empty arrays/null ratings for absent snapshot rows; synthesis participation uses
receipt/readiness and stored answer digests without a separate full-form test;
combined exports reread server inputs; individual retention requires a rich-text
row and valid stored snapshot shapes, without applying current questions to old
reviews; download follows a pointer that may identify legacy uploads or generated
Reviews DOCX files. None of these signals alone authorizes deletion or infers a
genuine/complete review from a file.

No new enums, tables, routes, helpers, async branches, or data contracts. New
partial-success/async/helper/symbol-value fan-out audits are N/A. Existing partial
legacy paths and distinct consumer rules were inspected as documentation evidence.
Durable-surface/doc reconciliation applies. All three source edits must preserve
identical non-comment tokens to HEAD.

## Restatement and historical classification

STALE → repaired: draft Atlas/service description of mapping a stored draft;
rescue memory's fresh/authoritative GET wording; wiki client-export summary;
download header's legacy-only path assumption; individual-builder future-retention
comments. The new Atlas map fills the missing common authority explanation.
AGREE: atomic submit and best-effort cleanup; two snapshot ratings; full-form
staff rescue versus legacy partial writers; option-snapshot null/corrupt handling;
current server export section and retention-specific validator.
HISTORICAL: original build plans, July rescue release ID, earlier client export,
parent-rating retirement and archived upload rationale remain. No old deployment
receipt is treated as a fresh hosting check. UNRELATED: generic draft references
in other workflows; no edits.

Disconfirming checks: inspect submit body.answers and absence of a draft reread;
inspect cached GET versus uncached POST rather than infer from 'live'; distinguish
browser ExportMenu from the server loader; check receipt-only/partial rows rather
than generalize full-form invariants; inspect retention's stored-shape guard and
download's pointer read rather than assume either validates today's full form.
Portal legacy compatibility allows absent setVersion; the staff requirement is
not generalized to all writers.

Owner boundaries preserved: full structured submission remains primary, staff
rescue remains an edge case, legacy routes remain retained and protected, snapshot
history is not reconstructed from current options, and no reset/deletion/backfill
or exposure approval is introduced. Runtime tests are not substitutes for these
source-backed distinctions.

## Validation and limits

All 24 selected checks/self-tests passed: 10 sequential pairs (atlas, doc-currency,
fact-consistency, doc-symbol-refs, build-claim-freshness, canonical-pointers,
drain-table-mentions, prompt-storage-mentions, agent-wiki, memory-router), plus
agent-invariants, docs-catalog, memory-drift, memory-health. The prior eight
advisory memory-health signals remain; no new signal. All three source files
have identical Babel non-comment tokens to HEAD. git diff --check passed.
No runtime tests/build were needed for prose/comment-only changes.

Fresh reviewer authority_guidance_review whole-read the lifecycle wiki, corrected
its scoped export introduction, and independently reviewed the eight-file repair
diff against submit, rescue, synthesis/readiness, export, retention and download
source. No blockers; no new completeness or operational authorization claim.
Targeted restatement searches leave zero live stale assertions for these four
scoped contracts in the reviewed surfaces. Claims: 4 → VERIFIED 4 within
repository source scope. Verdict: RECONCILED for this authority/reader batch only.
Current live data, deployments, flags, published questions, artifact counts and
operational permissions were not probed. This repair documents bounded source
contracts, not a whole-system or deployment certification.
