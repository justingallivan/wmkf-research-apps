# Historical impact and concurrency follow-up — 2026-10-22

**ASSESSMENT COMPLETE — bounded read-only live assessment and local reviews;
implementation pending.** Owner: Codex; branch:
`codex/memory-audit-followups`. Sol's bounded source, caller and fixture reviews
are complete. The safe local probe sources and evidence artifacts are prepared
for parent review and commit. No live record changes, sends, provider generation,
deployment, environment changes or pushes. The local repairs remain unreleased.
Unrelated critique/output and the owner-review-burden memory remain untouched.

## Scope and invariants

Sweep Mode B / contract-reconcile review. Entry points: structured PI resolution,
automated shared-person enrichment, request-authorized reviewer mutations and
roster finalization. Persistence under assessment: Dataverse request/person/
suggestion state and Postgres roster state; local evidence/docs/tests are the
only changed surfaces in this assessment. The subsequent three approved local runtime repairs are tracked separately below. Consumers: screening, reviewer staff workflows,
future agents and the owner. Historical exposure is not proof of a wrong outcome.

| Invariant | Verification |
|---|---|
| Live systems remain unchanged | Direct allowlisted GETs; OAuth token POST only; read-only SQL if needed; no runtime application handlers as probes |
| Historical attribution requires historical evidence | Separate current vulnerable-shape population, shared-person use and demonstrated past mutation; never infer corruption from count alone |
| Concurrency findings name real writers and guard timing | Trace request owner writes and roster finalizer SQL/callers; use isolated local fixtures, no production race reproduction |
| Owner decisions stay settled | Identity continuity required; staff/manual correction preserved; apply the three explicit decisions below; no inferred retention or release policy |
| Evidence remains reproducible and bounded | Keep safe probe sources local pending parent review/commit; retain aggregate-only redacted results, explicit caps/completeness and failure status |

Safe local probe sources prepared for this assessment and included in the local
changed surfaces: `scripts/probe-memory-historical-impact.cjs`,
`scripts/probe-memory-maintenance-receipts.cjs`,
`scripts/probe-memory-blob-retention.cjs`, and
`scripts/probe-memory-blob-store-bindings.cjs`. These sources and their evidence
artifacts are pending parent review/commit; they are not yet committed.

## Investigation ledger

- Historical PI/person assessment: Sol's bounded query/schema/attribution review
  is complete; results and limits are recorded below.
- Concurrent ownership and roster behavior: Sol's source/caller/fixture trace is
  complete; real database concurrency remains untested.
- Remaining non-active memory inventory and concrete policy prerequisites: Sol's
  whole-read review of all 32 non-active leaves is complete.
- Current model/prompt evidence: parent source-only resolution trace; no provider
  invocation. Production environment values remain outside the probe scope.

## Decisions

The owner approved all three recommended behaviors in the decision table below.
This settles those product choices; their implementation remains pending. The
approval does not authorize release or live record correction, which remain
outside this continuation.

## Concurrency evidence (local source and controlled fixtures)

[VERIFIED via source and 49 passing mocked route/service tests] The shared
request authorizer observes lead PD once. A deterministic fixture authorizes
PD A, changes the request to PD B before the service reread, and reaches the
invitation transport with PD B as From/impersonated user. Positive control keeps
A and sends as A; negative control rejects a non-lead before streaming. Parent
caught and corrected the initial race fixture's caller identity so it actually
authorizes A before the reassignment. This is an application interleaving, not a
real Dataverse transaction race or evidence of a past send.

Source chain: `reviewer-request-authorization.js:56-133` →
`pages/api/review-manager/send-emails.js:84-99` →
`send-emails-service.js:277-298,479-499,935-955`; draft fingerprint
`review-manager/draft-fingerprint.js:69-97` omits assigned PD. Close-review binds
fresh suggestion parent/ETag but not the Request ownership revision. Bounded
writer search did not find ordinary reassignment in app routes; an external CRM
edit can supply the interleaving. No mid-flight ownership semantics changed.

[VERIFIED via source; real database concurrency NOT TESTED] Roster finalization
(`reviewer-roster-store.js:730-775`) intentionally recreates absent rows and
merges anchors into active/saved rows while preserving excluded/ineligible/blocked
rows. `recordSurfaced` cannot replace saved/excluded rows. `setExcluded` at
259-277 can instead replace any non-ineligible row, including a newly saved row,
with excluded status and the stale submitted candidate. UI exclusion starts from
an active card; a stale card can race promotion. Exclude-first can leave the
Dataverse save committed but roster finalization withheld, with partial-success
warning. Save-first can have its saved roster state replaced by exclusion.

No local `initdb`, `postgres` or `psql` binary was available in the checked
standard locations. No configured/shared database was used for fixture writes.
Existing SQL-shape mocks do not prove concurrent Postgres semantics; no new
mock SQL model was presented as that proof. Proposed disposable-DB barriers:
finalize-before-exclude, exclude-before-finalize, and `recordSurfaced` on both
sides of finalize, asserting final row/blob/anchors and partial result.

## Remaining non-active memory inventory

Sol whole-read all **32 non-active leaves**: 25 closed, 3 stale, 4 superseded.
Luna repaired six historical-authority hazards; parent preserves their original
frontmatter statuses and reviews the final diff. The closed lifecycle campaign
is not a standing merge grant; old plugin incidents are not state-deletion
recipes; the retired panel is not a new app; April roadmap and May pilot choices
are not current roadmap/custom-portal authorization. May schema follow-through
and owner parking/GOApply decisions remain explicit.

The W6 drop note's repeated DO NOT RE-FIRE boundary and superseded reviewer
routing are already clear and are retained. The two small active handoffs retain
useful owner decisions; size alone does not justify another split.

## Read-only historical assessment results

[VERIFIED via `scripts/probe-memory-historical-impact.cjs --execute`]
`memory-historical-impact-evidence-2026-10-22.json` records complete bounded GET
queries: 157 current requests missing Project Leader with a Research Leader
present (155 active), 811 suggestion links and 4,545 person rows. None of those
157 requests joins the current suggestion links. This is current shape across
all programs; it does not prove no prior resolver call, transient rejected
candidate or earlier request-role state. No affected-record repair set follows.

Across all people, 1,841 are confirmed/probable; all carry at least one base
person-key-shaped anchor (syntax only, not checksum/continuity proof). Twenty-nine
people link to multiple requests; seven are protected. Current Wave 13 binding
or lineage fields are present on 24 people. These are population/state counts,
not proof of wrong-person data or which writer acted.

[VERIFIED via bounded `--history-only` GETs] Organization and the three relevant
entities have auditing enabled; field-level audit enablement was not
independently verified. Bulk audit table reads returned 403, but a separate
per-record history path succeeded for all seven protected shared people.
Complete available pages contained **112 details**, with **41 details carrying
inspected identity fields in `NewValue`**, and **zero explicit
nonblank-to-different-nonblank ORCID replacement events**. These checks do not
exclude wrong metrics, fill-empty wrong ORCID, missing historical evidence, or
unshared people. No raw identifiers, values, actors, dates or audit detail
bodies were retained. The access result is in
`memory-audit-history-access-evidence-2026-10-22.json`.

The bounded history request follows Microsoft's documented GET function and
PagingInfo contract. The documented Web API response does not supply the
AuditRecord actor/date metadata; do not infer writer attribution from it.
[Microsoft audit-history reference](https://learn.microsoft.com/en-us/power-apps/developer/data-platform/auditing/retrieve-audit-data#retrieverecordchangehistory-message).
No role elevation, history deletion or record correction was attempted.

## Configuration and retention evidence

- Current Production reviewer model override is `opus`, a tier alias. No model
  list/generation was called; effective hosted resolution remains unknown.
- All 39 current prompt variable values parse as JSON; 25 schemas parse as JSON
  and 14 are absent. Missing schema is not independently a defect: legacy prompt
  paths have separate contracts. Pre-Site proposal-core is current v5 with native
  JSON-schema/full-retention metadata; alignment is current v1 with no-retention
  metadata. No prompt body or exact code/live schema equality is asserted.
- Current structured excluded-reviewer junction count is zero. This does not
  establish the absence of an external producer or decide exclusion policy.
- The exact `retention:blob_days` setting is absent in the queried Production
  settings table; current source would use its 90-day default. That is not proof
  of effective runtime cache/environment or a cleanup target.
- Read-only local-config PostgreSQL receipts: the latest 14 daily-maintenance
  runs completed with zero Blob errors, zero Blob deletions and two skips each.
  Other record deletions in these receipts are historical job output, not actions
  of this assessment. This connection does not establish the deployed connection.
- Owner explicitly authorized bounded, potentially metered Vercel Blob listings.
  The initial two-store probe stopped before listing because the local DVX token
  was absent. No production secret was fetched. The unaffected public-prefix
  read completed in **one SDK list invocation**: 335 objects, 230,987,633 bytes,
  oldest 110 days, with 224 in the 90–179-day bucket. No content was fetched.
  The private store was not listed, rather than reported empty.
- Existing Vercel account login exposed store metadata. The local public token
  matches a project-linked store with cached whole-store count 347; a name-only
  export-store candidate is unlinked and reports count two. This does not prove
  the runtime DVX credential binding. The private inventory needs an authorized
  credential-bearing context; production env values were not exported or changed.
  Source has no private DVX cleanup path. The public age/receipt difference does
  not prove a broken cleanup: references and effective target remain unverified.

Artifacts prepared locally: `maintenance-retention-evidence-2026-10-22.json`,
`blob-retention-metadata-evidence-2026-10-22.json`,
`blob-store-binding-evidence-2026-10-22.json`,
`memory-audit-history-access-evidence-2026-10-22.json`, and
`memory-historical-impact-evidence-2026-10-22.json`. The probe sources listed
above are prepared locally pending parent review/commit. The observed CLI is
65.2.0; no CLI installation/update was performed.

## Owner-approved behaviors; implementation pending

| Decision | Current evidence | Recommended behavior | Alternative / consequence |
|---|---|---|---|
| Lead-PD change during an unsent operation | Real authorization/service fixture can authorize A then dispatch as fresh B | **APPROVED:** On detected reassignment before the next unsent write/send, stop and require the currently authorized PD plus a fresh preview; bind assigned sender in preview evidence | Let an already-authorized action finish under current behavior, including fresh B sender. No promise to undo an already-dispatched send. |
| Stale Find exclusion after promotion | Exclude can overwrite newly saved roster row/blob; invitation suggestion remains separate | **APPROVED:** Preserve saved row and reject stale Find exclusion with guidance to use Invite removal | Permit Find exclusion to hide roster state after promotion while the canonical Invite record remains; document intentional split. |
| Known current institution conflict on sparse manual Add/Refer | Sparse creation is intentional; manual/send paths lack Find's trusted COI check and no explicit waiver was found | **APPROVED:** Keep sparse Add/Refer; apply trusted, corroborated-current-institution screening before the first manual invitation, blocking confirmed conflicts only. Unknown affiliation keeps the current sparse behavior; no new per-edit COI recheck or staff acknowledgement | Keep manual invitation exempt from this automated screen, relying on staff/reviewer handling. This would be an explicit exception, not inferred from sparse entry. |

All three behaviors are owner-approved. Their implementation is pending; the
approval records decisions and does not describe shipped behavior.

Broad/HHMI sole-overlap rows are deliberately visible but unselectable in the
current documented Find contract. No change or new owner decision is needed to
preserve that behavior. Foundation exclusion breadth remains an existing
foundation-owned hold. Retention changes are not proposed from incomplete
private inventory or an unproven cleanup-target comparison.
