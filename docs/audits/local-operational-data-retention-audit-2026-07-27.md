---
title: Local Operational Data Retention Audit — 2026-07-27
domain: security-privacy
kind: audit
status: active
summary: "Privacy-safe retention inventory, private OneDrive preservation, closed study/smoke/rollback/finality reviews, and remaining exact disposal decision."
canonical: false
cataloged: 2026-07-27
last_verified: 2026-07-27
owner: product-engineering
related:
  - docs/audits/public-repository-pii-history-audit-2026-07-27.md
  - docs/audits/reviewer-holistic-m1-scoped-pilot-closure-2026-07-27.md
  - docs/REVIEWER_HOLISTIC_REVIEW_IMPLEMENTATION_PLAN.md
  - docs/CREDENTIALS_RUNBOOK.md
  - .gitignore
---

# Local Operational Data Retention Audit — 2026-07-27

## Audit contract

**Mode:** `/sweep` Mode B — bounded local-retention and access-control audit.

**Trigger:** the public-repository PII/history audit found a larger corpus of
personal and production-derived data in ignored local outputs. The owner
authorized a programmatic inventory and classification before deciding what
to preserve, move, or delete.

**Claims tested:**

1. ignored local operational files can be treated as disposable merely because
   they are not tracked by Git;
2. all load-bearing inputs needed to reproduce or resume the reviewer-holistic
   experiment are present;
3. ignored execution output is reproducible at low cost;
4. local filesystem permissions adequately restrict the sensitive text
   corpus; and
5. a safe first deletion set can be identified without exposing personal
   values in a tracked manifest.

**Baseline:** branch `codex/local-retention-inventory` from deployed `main` at
`1436aefc455fb70763ae56c4a9453237b31790ff`.

**Included scope:**

- ignored regular files under `outputs/`;
- ignored operational state, snapshots, probes, and generated schema artifacts
  under `scripts/`; and
- ignored root-level operational logs and smoke receipts.

**Excluded scope:**

- environment and authentication files, credentials, dependencies, caches,
  build output, editor state, and CodeGraph state;
- live Dataverse, Postgres, Blob, Vercel, SharePoint, or Power Platform data;
- remote copies, backups, CI artifacts, and files outside the repository;
- semantic verification of every person, organization, proposal, or financial
  relationship;
- source permission changes, file moves, or deletion.

The classifiers emitted only aggregate counts. No raw personal value, contact
hash, person-bearing filename, or extracted OCR text was written to this
tracked report.

## Executive verdict

**Severity: High.**

**Verdict: `CLAIM NOT RECONCILED`.**

The inventory is complete for the stated local scope. The owner selected an
existing WMKF organizational OneDrive location, and the first preservation
copy is complete and byte-verified through the local OneDrive mount. The owner
then confirmed that the files are visible in OneDrive and only the owner has
access. The retention condition is still not reconciled because the exact
source deletion set has not been approved. The owner has now closed the
reviewer-holistic study and its
reproducibility window; its privacy-safe design, aggregate findings,
limitations, and decision are retained in a tracked closure audit.
Read-only production reconciliation has also closed the application-research
and Contact-ORCID rollback windows. Their three raw checkpoints are audit-only
controlled-disposal candidates; no deletion is authorized by that finding.
The 29-file rendered-artifact review identified three authoritative finals:
two historical presentation decks and the complete frozen identity-benchmark
workbook. All three are now byte-identical, owner-only copies in the local
OneDrive mount. The remaining 26 rendered artifacts are derivatives,
superseded work, or already-preserved operational/research evidence. The owner
confirmed that the three new copies are visible in the external archive.
The remaining unique design-source and staff-facing material was reviewed
individually: 20 files were copied byte-identically to the owner-only archive,
while seven review/handoff notes were proven durably represented in tracked
documentation. A private machine-readable and human-readable review now
enumerates all 139 scoped source files without authorizing deletion.

The pre-cleanup ignored corpus contained 140 files totaling 15,288,067 bytes
(about 14.6 MiB). At least 63 text or structured files contained identity,
production-record, proposal, reviewer, access, location, or finance signals.
Fifty-eight of those 63 files have mode `0644`, which allows reads by other
local accounts under ordinary Unix permission semantics. The 29 Office, PDF,
and image files were successfully parsed or OCRed; their content and
operational context require treating all 29 as sensitive pending
artifact-by-artifact disposition.

The reviewer-holistic execution chain is the most important preservation
boundary. Current ignored output includes unique, costly, and
non-deterministic execution/scoring evidence and one scored
proposal-evaluation file that passes its individual validator. The ignored
tree does **not** include a usable complete external input bundle because it
lacks a current manifest and cohort.

The preservation follow-up recovered the last pre-redaction v2 manifest,
frozen proposal evaluation, and owner-approved cohort directly from reachable
history into the external archive. That three-file set passes the current full
frozen validator. It is preserved separately from the later scored evaluation
and was not returned to the public working tree. The owner confirmed that the
study is complete and will not be kept active for a rerun, so manifest
repinning is not required. The raw bundle remains controlled pending exact
disposal approval, not as active reproducibility state.

`.gitignore` prevents accidental tracking. It does not provide encryption,
access control, retention, recovery, or secure disposal.

## Evidence matrix

| Claim | Evidence | Classification |
|---|---|---|
| Ignored operational files are disposable. | Tracked code consumes ignored execution and smoke state. Three authoritative finals existed only in the ignored source set before the follow-up preservation copy. | `FALSIFIED` |
| The reviewer-holistic input bundle is locally complete. | The ignored tree has one individually valid scored proposal evaluation but no current manifest or cohort. A separate pre-redaction three-file frozen contract was restored to the external archive and passes the full validator. | Ignored tree: `FALSIFIED`; external restoration: `VERIFIED locally` |
| Reviewer-holistic execution output is cheaply reproducible. | Reproduction requires external inputs, credentials, an exact randomization seed, live services, paid calls, and non-deterministic responses. | `FALSIFIED` |
| Baseline source permissions adequately restrict flagged text files. | Fifty-eight of 63 flagged text/structured files had mode `0644`; only five had mode `0600`. | `FALSIFIED` |
| The preservation copy is byte-complete and owner-only on the local mount. | Eighty-nine archive files have zero applicable source/destination or manifest/source checksum mismatches; 20 directories including the archive root are `0700`, all files are `0600`, and no symlink remains. | `VERIFIED locally` |
| The preservation copy is synchronized and cloud access is correctly bounded. | The owner confirmed cloud visibility and owner-only access through the first 67 files. The 20 unique-source copies and two private review files are locally byte-verified in the same location but not yet owner-confirmed visible. | `PARTIAL` |
| The recorded smoke cleanup is complete. | Marker-gated cleanup deleted the current suggestion, marked potential reviewer, and marked linked Contact; independent production read-back found all absent and the source checkpoint cleared. | `VERIFIED` |
| The reviewer-holistic study still needs an open reproducibility window. | The owner confirmed the study is complete; a tracked privacy-safe closure audit preserves its method, aggregate findings, limits, and decision. | `FALSIFIED via owner confirmation` |
| The application-research migration still needs an open rollback window. | All 339 checkpoint links are unique and non-null; all 339 current target people exist; all three retired entities remain absent. The sole formerly populated field now empty exactly matches a documented intentional Scholar-identity correction. | `FALSIFIED via read-only production reconciliation` |
| The Contact-ORCID historical backfill still needs an open rollback window. | All 162 projected writes had applied decisions and all 162 current Contact values match exactly, with zero mismatch, missing, malformed, not-found, or read-failure outcomes. | `FALSIFIED via read-only production reconciliation` |
| The rendered-artifact set still contains unknown sole-copy finals. | Programmatic package inspection, visual review, exact hashing, source/reference tracing, and frozen-workbook reconciliation identified exactly three authoritative finals and copied all three byte-identically to the owner-only archive mount. The owner confirmed that the three copies are visible there. | `FALSIFIED via local verification and owner confirmation` |
| An exact source-only disposal review exists. | The owner-only private manifest enumerates all 139 scoped regular files: 82 have exact archive matches, 49 are reproducible/derived, seven have durably tracked conclusions, and one workbook is substantively superseded. Fourteen reader/replay caveats are explicit; no archive path, directory, or symlink is eligible. | `VERIFIED locally`, subject to owner approval |
| Exact retention periods are established. | No repository policy or owner decision defines them. | `UNKNOWN` |

## Aggregate inventory

### Location and size — pre-cleanup baseline

| Sanitized class | Files | Bytes | Notes |
|---|---:|---:|---|
| Other ignored `outputs/` artifacts | 85 | 6,974,459 | Reports, review outputs, rendered deliverables, and operational receipts |
| Reviewer-holistic outputs | 42 | 7,501,699 | Execution, identity research, scoring, unblinding, and supporting artifacts |
| Ignored operational `scripts/` artifacts | 10 | 713,527 | Rollback snapshots, enrichment records, probe state, and smoke state |
| Ignored generated schema artifact | 1 | 65,843 | Regenerable current-state output |
| Ignored root smoke receipts | 2 | 32,539 | Reproducible smoke output |
| **Total** | **140** | **15,288,067** | |

After verified smoke cleanup removed the 286-byte source checkpoint, the
current scoped corpus is 139 files totaling 15,287,781 bytes. No other scoped
file changed.

### Age

For the 138-file `outputs/` and `scripts/` core:

| Last modification | Files |
|---|---:|
| 0–7 days | 14 |
| 8–30 days | 53 |
| 31–90 days | 71 |
| More than 90 days | 0 |

Modification time is routing evidence, not proof of business age or
disposability.

### Format

The core plus root smoke receipts contains 111 text or structured files and 29
binary/rendered files. All 69 core JSON files parsed successfully.
Exact-content hashing found only one two-file duplicate group totaling 42
redundant bytes, so duplicate removal would not materially reduce the
footprint or risk.

The 29 binary/rendered files comprise 21 PNG, three XLSX, two PPTX, two DOCX,
and one PDF. Parsing/OCR succeeded for all of them:

- the Office/PDF set contained identity and proposal context; the PPTX set also
  contained payment context, and one workbook contained substantial
  address-like context;
- all 21 images contained OCR-readable text;
- 17 images contained identity-related terms, 11 contained payment-related
  terms, and nine contained proposal-related terms; and
- no extracted text was retained in this report.

These are contextual classifiers, not a claim that every match is direct PII.
They are sufficient to reject bulk treatment as harmless image or office
output.

## Preservation follow-up — 2026-07-27

The owner selected an existing WMKF organizational OneDrive folder. The exact
path and cloud access topology are private operational details and are not
retained in this public report.

The archive copy contains:

| Sanitized class | Files | Status |
|---|---:|---|
| Complete reviewer-holistic output directory | 42 | Byte-identical to source |
| Review-form production probe receipts | 13 | Byte-identical to source |
| Smoke cleanup checkpoint | 1 | Byte-identical to source |
| Application-research and Contact-ORCID rollback checkpoints | 3 | Byte-identical to source |
| Seed-only reviewer-holistic environment file | 1 | Byte-identical to source; no unrelated credential file copied |
| Recovered pre-redaction manifests, frozen proposal evaluation, and cohort | 4 | Byte-identical to the history extraction; v2 three-file contract passes the current full frozen validator |
| Authoritative rendered finals | 3 | Two self-contained presentation decks and one complete frozen benchmark workbook; byte-identical to source |
| Unique staff-facing and presentation-generator source | 20 | Byte-identical to source after individual value review |
| Private source-disposal review controls | 2 | Human-readable review plus machine-readable, hash-frozen manifest; no deletion command |
| **Total** | **89** | **9,025,315 bytes** |

Local verification found 20 archive directories including the root at mode
`0700`, 89 files at mode `0600`, zero symlinks, and zero applicable checksum
mismatches. A copied build-time
dependency symlink was identified and removed from the archive without
changing its target or the source tree. The temporary history-extraction
directory was deleted after the four recovered files were checksum-verified.

The source-side ignored files were not moved, changed, permissioned, or
deleted. The owner confirmed after the first 64-file copy that those files are
visible in OneDrive and only the owner has access. The three finality-follow-up
files use the same owner-only destination, are locally byte-verified, and were
subsequently confirmed visible by the owner. The 20 unique-source copies and
two private review files use the same destination and pass local verification;
their remote visibility awaits owner confirmation.

## Smoke cleanup follow-up — 2026-07-27

**Change surface:** one ignored local checkpoint consumed by
`scripts/smoke-test-candidate.mjs` and
`scripts/live-reviewer-invite-smoke.mjs`.

**Persistence:** the checkpoint records a production Dataverse potential
reviewer, reviewer suggestion, request, and test address. Cleanup can delete
suggestions, the potential reviewer, and a promoted Contact. The source
commentary expected Contact deletion to fail for missing permission, but this
live run disproved that stale expectation: the same application identity
deleted the marker-verified Contact successfully.

A read-only production probe used the repository's explicit
`DATAVERSE_ALLOW_PROD_READS=yes` acknowledgement and found:

- one complete checkpoint record;
- the recorded potential reviewer still exists and its normalized name
  contains the required smoke marker;
- the potential reviewer links to a Contact found by the test address, and
  that Contact also contains the smoke marker;
- the originally recorded suggestion identifier no longer resolves; and
- exactly one current suggestion remains linked to the recorded potential
  reviewer.

The cleanup contract remained applicable despite the stale suggestion
identifier: after the person-level marker gate passed, cleanup queried all
suggestions linked to the recorded person.

The owner authorized production cleanup. The first attempt used the local
calendar date rather than the interlock's UTC date; the target interlock denied
the first DELETE before any write. The retry used the current UTC
acknowledgement and deleted the one current suggestion, the marked potential
reviewer, and the marker-verified promoted Contact. The script then cleared the
local checkpoint.

An independent read-only production verification, using the preserved
OneDrive checkpoint, proved:

- the potential reviewer is absent;
- the originally recorded suggestion is absent;
- zero suggestions remain linked to the recorded person;
- no Contact remains for the test address; and
- the local checkpoint is absent.

**Cleanup result:** complete, with no administrator follow-up required. The
preserved OneDrive checkpoint is now a disposal candidate rather than active
recovery state.

## Rollback-window closure follow-up — 2026-07-27

**Change surface:** the application-research collapse snapshot and the two
Contact-ORCID historical backfill checkpoints, all ignored and already copied
byte-identically to the owner-only external archive.

The aggregate-only verifier read the checkpoints locally and queried current
production Dataverse state through the explicit read-only acknowledgement. It
emitted no names, addresses, ORCIDs, record identifiers, or row-level values.
No live write or deletion occurred.

For the application-research collapse:

- all 339 snapshot links were non-null and unique;
- all 339 linked target people still exist;
- the three retired entities remain absent;
- every historically populated value remains populated except one Scholar URL;
  that exception exactly fingerprints the previously documented intentional
  correction of a wrong Scholar identity, where the complete Scholar identity
  bundle was cleared; and
- later populated changes to a small set of fields are current state, not
  migration loss.

For the Contact-ORCID backfill:

- the resolve checkpoint contains 1,533 decisions: 162 write, 14 noop, seven
  ambiguous, 1,349 no-contact, and one null-status outcome;
- all 162 projected writes have a corresponding applied decision; and
- current read-back found 162 exact normalized matches and zero
  different-valid, missing, malformed, not-found, or read-failure outcomes.

**Closure result:** both rollback windows are closed. The three raw checkpoints
are audit-only controlled-disposal candidates. They must not be used for a
bulk rollback: the application-research source schema is gone, and clearing
Contact ORCIDs from a historical log could erase later independent
confirmation. Any future correction requires a new reviewed remediation based
on current evidence. Exact deletion remains separately approval-gated.

## Rendered-artifact finality follow-up — 2026-07-27

**Change surface:** 29 ignored binary/rendered artifacts: 21 PNG, three XLSX,
two PPTX, two DOCX, and one PDF.

The review combined package metadata and structure, exact hashes, spreadsheet
formulas/completion state, tracked import receipts, current source and
documentation references, visual rendering, slide-overflow checks, and
privacy-safe OCR classification. No raw content or person-bearing path was
written to this report. No source file was changed or deleted.

Exactly three artifacts are authoritative finals:

- two historical presentation decks, with five and 15 slides, are visually
  complete, pass overflow checks, and contain no macro, embedded package,
  external relationship, or unresolved comment dependency; and
- one 40-case benchmark workbook is complete, matches the tracked frozen-v2
  source hash, and records 40/40 completed decisions with no attention state.

None of the three existed as an exact Git object or in the first preservation
copy. All three were copied byte-identically to the owner-only OneDrive mount,
adding 141,264 bytes. The editable presentation files are self-contained, and
the workbook's row-level decisions also remain validated by the tracked
frozen import receipt. Preserve the three external final copies. Their ignored
source duplicates can join the exact disposal candidate list.

The other 26 artifacts are not sole authoritative finals:

- 20 PNGs are one-per-slide renders of the two decks and one PNG is their QA
  contact sheet; all are sensitive but have no tracked consumer;
- one workbook is a non-authoritative working copy whose cached summary reports
  only 20/40 rows complete. All seven raw decision fields for all 40 rows match
  the tracked v1 import exactly, all 46 formulas match the complete v2
  workbook, and neither workbook contains comments, macros, or external links;
- one scoring workbook belongs to the completed reviewer-holistic study and
  is already byte-preserved as private row-level audit evidence; and
- two DOCX and one PDF are review-form smoke evidence already byte-preserved
  externally. The PDF is a derivative of the report DOCX, and the courtesy
  copy's answer content is contained in that report.

**Finality result:** the sole-copy question is resolved locally. Preserve the
three external authoritative finals. The owner confirmed that the new archive
copies are visible, so all 29 source-side ignored copies are controlled
disposal candidates pending exact deletion approval. This result does not
authorize deletion.

## Load-bearing and disposition matrix

| Sanitized artifact class | Dependency and reproducibility | Proposed disposition |
|---|---|---|
| External reviewer-holistic manifest, proposal evaluation, and cohort | The completed workflow required all three. A separate frozen three-file bundle is restored and passes full validation in the external archive. The tracked closure audit now preserves the privacy-safe method and decision. | **Controlled disposal candidate.** The study and reproducibility window are closed; no manifest repin is required. Retain until exact-path approval and aggregate deletion receipt. |
| Reviewer-holistic execution checkpoints | Supported resume/retry and downstream cohort selection during the completed study. Reproduction was paid, live-service-dependent, and non-deterministic. | **Controlled disposal candidate.** No longer operational recovery state; retain only until exact-path approval and aggregate deletion receipt. |
| Reviewer-holistic scoring package and unblinding map | Supports the private row-level audit trail. The tracked closure audit preserves aggregate findings and limitations without identifiers. | **Controlled disposal candidate.** Keep access narrow until exact-path approval; do not publish the unblinding map. |
| Reviewer identity/email research and chained evaluation outputs | Thirteen files are read/resumed by tracked scripts and one more is a documented optional replay input. No production runtime consumer exists; the study is closed and the complete directory is byte-preserved externally. | **Source-only controlled disposal candidates.** Preserve the archive; restore the exact archived copy before deliberately reopening a rerun or replay. |
| Review-form production probe receipts | Current state can be reprobed, but the historical state and durable claims cannot be reconstructed exactly. All 13 files are byte-preserved externally; tracked exact-path references are evidence citations, not runtime readers. | **Source-only controlled disposal candidates.** Preserve the archive and reconcile any citation that still promises a local path before deletion. |
| Smoke-test candidate state | The marker-gated production cleanup and independent read-back are complete; no person, suggestion, or Contact remains. The source checkpoint was cleared automatically, while the preserved OneDrive copy remains. | **Dispose of the preserved checkpoint** after the aggregate cleanup receipt is accepted. |
| Application-research rollback snapshot | Aggregate reconciliation found all 339 target people and confirmed the only empty historical value is the documented intentional Scholar correction; the three source entities remain absent. | **Controlled disposal candidate.** Rollback window closed; retain only until exact-path approval and aggregate deletion receipt. |
| Contact-ORCID back-propagation checkpoints | Aggregate reconciliation found all 162 intended writes still match exactly. Historical clearing would risk erasing later confirmation. | **Controlled disposal candidate.** Rollback window closed; retain only until exact-path approval and aggregate deletion receipt. |
| Cross-store and contact probes | No tracked downstream consumer; current state is reproducible. | **First-wave disposal candidate** after confirming durable aggregate conclusions. |
| Zero-byte identity-audit output | No downstream consumer and no retained evidence. | **First-wave disposal candidate.** |
| Merge-probe raw receipts | Offline diagnostic evidence; the probe can be rerun. | **First-wave disposal candidate** after any needed aggregate conclusion is tracked. |
| Generated schema diff | Regenerable from current metadata; no runtime consumer. | **First-wave disposal candidate** after any needed aggregate conclusion is tracked. |
| Root smoke receipts and reproducible logs | No tracked consumer; represent point-in-time diagnostic output. | **First-wave disposal candidate** unless they are the only evidence for an unresolved incident. |
| Historical presentation decks and complete frozen benchmark workbook | Exactly three authoritative finals passed structural and visual review, were copied byte-identically to the owner-only archive mount, and were confirmed visible by the owner. | **Preserve the three external copies.** Source-side duplicates may be disposed after exact approval. |
| Slide-render PNGs and contact sheet | Twenty slide renders map exactly to the two preserved decks; one contact sheet is QA-only. No tracked consumer exists. | **Controlled disposal candidates.** Preserve no PNG solely for local reproducibility. |
| Superseded benchmark workbook | A non-authoritative working copy has a stale/incomplete cached summary, but every raw decision field matches the tracked v1 import and every formula matches the complete v2 workbook; it contains no comments, macros, or external links. | **Controlled disposal candidate.** |
| Review-form DOCX/PDF evidence | Two DOCX and one derivative PDF are operational evidence, not business finals; all are already byte-preserved externally and their aggregate conclusion is tracked. | **Controlled disposal candidates** after exact approval. |
| Presentation generator and operating-note source | Individual semantic review found 18 unique presentation rebuild files and two audience-ready operating notes worth retaining. | **Preserve external copies.** All 20 are now byte-preserved; source-side copies are controlled disposal candidates. |
| Other agent review and handoff output | Seven remaining standalone notes were reviewed individually. One has an exact tracked copy; the others' adopted conclusions, rejected proposals, findings, and shipped state are retained in tracked current or explicitly historical documents. | **Source-only controlled disposal candidates.** |

The exact consumer audit found 13 files read or resumed by tracked scripts and
one additional documented optional replay input. Other exact names are output
targets or evidence citations rather than content readers. No production
runtime or directory-scan consumer exists. The 14 reader/replay dependencies
remain explicit in the private manifest; their source-only disposal is safe
only because the owner closed the relevant rerun and rollback windows and
exact archive copies remain available for deliberate restoration.

## Proposed retention controls

No calendar retention period is asserted without an organization policy or
owner decision. The safest current rules are event-based:

1. **Secure destination first.** Use access-controlled storage outside the
   repository. The local staging directory should be owner-only (`0700`) and
   copied files owner-readable/writable only (`0600`). The WMKF organizational
   OneDrive storage class is selected and the local copy satisfies those mode
   requirements. The owner confirmed cloud presence and owner-only access;
   encryption and backup remain platform controls.
2. **Close completed experiment bundles deliberately.** The owner closed the
   reviewer-holistic reproducibility window after the verified external copy.
   Its tracked closure audit now preserves privacy-safe design, aggregate
   findings, limitations, and the decision. The raw input, execution, scoring,
   unblinding, and seed bundle is audit-only pending an exact private disposal
   review; it does not require repinning or indefinite reproducibility
   retention.
3. **Finish cleanup-dependent workflows.** Retain exact marker/state files
   until read-back proves that synthetic rows are gone. The state file should
   be deleted after verified cleanup so stale identifiers cannot be mistaken
   for active work.
4. **Close rollback windows deliberately.** The application-research and
   Contact-ORCID migrations were reconciled against current production state
   and their rollback windows are closed. Their aggregate receipt is tracked
   above; row-level files remain only until exact disposal approval.
5. **Dispose of reproducible diagnostics after receipt.** A tracked aggregate
   result may replace raw probes, schema diffs, smoke logs, and intermediate
   renders when no incident or audit obligation remains.
6. **Review sole-copy deliverables.** Complete: three authoritative
   finals were identified and copied byte-identically to the owner-only
   archive mount, and the owner confirmed that the copies are visible. The 21
   PNGs are render/QA intermediates, not finals.
7. **Review unique source and handoff material.** Complete locally: 20 unique
   staff-facing/design-source files were copied byte-identically to the
   owner-only archive, and seven remaining standalone notes were reconciled
   against tracked durable documentation.
8. **Verify transfers and deletions.** Compare byte counts and cryptographic
   receipts privately after transfer, open representative copied artifacts,
   and generate a privacy-safe deletion receipt containing only category,
   counts, bytes, date, and approving owner.

## Safe execution sequence

1. **Complete:** the owner selected the WMKF organizational OneDrive
   destination. The local copy is owner-only and byte-verified; the owner
   confirmed cloud presence and owner-only access.
2. **Complete:** the scored proposal evaluation and exact seed are preserved,
   and the recovered frozen manifest/cohort contract passes the full validator
   in the external archive. The owner closed the study and reproducibility
   window; a privacy-safe tracked audit preserves its design and findings, and
   manifest repinning is not required.
3. **Complete:** the load-bearing reviewer-holistic
   execution/scoring chain and review-form evidence are copied and
   byte-verified. The finality review identified three additional authoritative
   finals and copied them byte-identically to the same owner-only archive
   mount. The owner confirmed that those three files are visible there.
4. **Complete:** marker-gated cleanup deleted the marked smoke person, its
   current suggestion, and the marked linked Contact. Independent production
   read-back proved all are absent, and the source checkpoint is gone.
5. **Complete:** read-only production reconciliation closed the
   application-research and Contact-ORCID rollback windows. The three raw
   checkpoints are audit-only controlled-disposal candidates.
6. **Complete locally:** the owner-only private review enumerates all 139
   current scoped source files, freezes their hashes, identifies 14
   reader/replay caveats, excludes directories and symlinks, and contains no
   deletion command. Twenty unique files were preserved before classification;
   visibility of those copies and the two review files awaits owner
   confirmation.
7. **Pending:** delete only approved source files, rerun the ignored-file
   inventory, and record aggregate before/after counts in a tracked receipt.
8. **Pending:** reconcile the local-only finding in
   `docs/audits/public-repository-pii-history-audit-2026-07-27.md`.

## Owner decisions required

1. May the exact 139-file, source-only candidate set in the private review be
   deleted after its 22 newest archive files are confirmed visible, with the
   14 reader/replay caveats accepted and an aggregate receipt retained?

The missing reviewer-holistic input contract is restored and verified in the
external archive, the study and reproducibility window are closed, and its
privacy-safe design and findings are tracked. The owner also confirmed cloud
presence and owner-only access. The application-research and Contact-ORCID
rollback windows are also closed with aggregate reconciliation recorded above.
The finality review preserved the three authoritative finals and classified
the other rendered artifacts. Individual review also preserved the remaining
unique source/operating material or reconciled its conclusions durably. Until
remote visibility of the latest 22 archive files is confirmed and the exact
source-only disposal decision is recorded, the ignored-local component of the
public PII/history audit remains `CLAIM NOT RECONCILED`.

## Privacy-safe reproducibility

The inventory enumerated ignored, untracked regular files using Git's ignore
rules, then grouped them by public-safe path category, extension, byte size,
modification age, and Unix mode. Text/structured files were parsed where
applicable and scanned with overlapping context classifiers for identity,
contact, proposal/request, reviewer/evaluation, finance/payment,
access/authentication, organization/affiliation, location/address, opaque
identifiers, and narrative content.

Office files were inspected by parsing DOCX/PPTX XML and XLSX shared
strings/cells. The PDF text layer was parsed. PNGs were OCRed locally with
macOS Vision. Only aggregate counts left the inspection process.

Tracked code and documentation were traced to identify producers, exact
filename consumers, resume/cleanup state, outside-repository input guards, and
reproducibility dependencies. JSON inputs were checked structurally against
the current frozen reviewer-holistic contract. This report intentionally omits
raw matches, person-bearing basenames, reversible contact hashes, secret
values, record identifiers, and OCR text.

The bounded scan can miss semantically sensitive relationships that contain no
classifier term. The sole-copy and individual semantic reviews are complete;
final disposition still requires confirmation of the latest archive sync and
exact owner approval for deletion.
