---
title: Local Operational Data Retention Audit — 2026-07-27
domain: security-privacy
kind: audit
status: active
summary: "Privacy-safe retention inventory plus a verified owner-only OneDrive preservation copy; source artifacts remain unchanged and disposition is unresolved."
canonical: false
cataloged: 2026-07-27
last_verified: 2026-07-27
owner: product-engineering
related:
  - docs/audits/public-repository-pii-history-audit-2026-07-27.md
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
- cloud-side OneDrive sharing membership and upload/sync confirmation; and
- source permission changes, file moves, or deletion.

The classifiers emitted only aggregate counts. No raw personal value, contact
hash, person-bearing filename, or extracted OCR text was written to this
tracked report.

## Executive verdict

**Severity: High.**

**Verdict: `CLAIM NOT RECONCILED`.**

The inventory is complete for the stated local scope. The owner selected an
existing WMKF organizational OneDrive location, and the first preservation
copy is complete and byte-verified through the local OneDrive mount. The
retention condition is still not reconciled because cloud-side synchronization
and access membership have not been independently verified, event-based
retention decisions remain open, and no exact source deletion set has been
approved.

The ignored corpus contains 140 files totaling 15,288,067 bytes (about
14.6 MiB). At least 63 text or structured files contain identity,
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
and was not returned to the public working tree. Repinning the manifest to the
final source commit remains necessary only if the study stays reproducible and
will be run again.

`.gitignore` prevents accidental tracking. It does not provide encryption,
access control, retention, recovery, or secure disposal.

## Evidence matrix

| Claim | Evidence | Classification |
|---|---|---|
| Ignored operational files are disposable. | Tracked code consumes ignored execution and smoke state; some final deliverables may be sole copies. | `FALSIFIED` |
| The reviewer-holistic input bundle is locally complete. | The ignored tree has one individually valid scored proposal evaluation but no current manifest or cohort. A separate pre-redaction three-file frozen contract was restored to the external archive and passes the full validator. | Ignored tree: `FALSIFIED`; external restoration: `VERIFIED locally` |
| Reviewer-holistic execution output is cheaply reproducible. | Reproduction requires external inputs, credentials, an exact randomization seed, live services, paid calls, and non-deterministic responses. | `FALSIFIED` |
| Current permissions adequately restrict flagged text files. | Fifty-eight of 63 flagged text/structured files have mode `0644`; only five have mode `0600`. | `FALSIFIED` |
| The preservation copy is byte-complete and owner-only on the local mount. | Sixty-four copied files have zero source/destination checksum mismatches; eight directories are `0700`, all files are `0600`, and no symlink remains. | `VERIFIED locally` |
| The preservation copy is synchronized and cloud access is correctly bounded. | The local OneDrive mount accepted and reread the copy, but no tenant URL or cloud-side access view was available for independent verification. | `UNKNOWN` |
| A bounded first disposal set exists. | Zero-byte, current-state probe, merge receipt, generated schema, and smoke-log classes have no active tracked consumer after their conclusions or cleanup are verified. | `VERIFIED`, subject to owner approval |
| Exact retention periods are established. | No repository policy or owner decision defines them. | `UNKNOWN` |

## Aggregate inventory

### Location and size

| Sanitized class | Files | Bytes | Notes |
|---|---:|---:|---|
| Other ignored `outputs/` artifacts | 85 | 6,974,459 | Reports, review outputs, rendered deliverables, and operational receipts |
| Reviewer-holistic outputs | 42 | 7,501,699 | Execution, identity research, scoring, unblinding, and supporting artifacts |
| Ignored operational `scripts/` artifacts | 10 | 713,527 | Rollback snapshots, enrichment records, probe state, and smoke state |
| Ignored generated schema artifact | 1 | 65,843 | Regenerable current-state output |
| Ignored root smoke receipts | 2 | 32,539 | Reproducible smoke output |
| **Total** | **140** | **15,288,067** | |

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
| **Total** | **64** | **8,666,629 bytes** |

Local verification found eight archive directories at mode `0700`, 64 files at
mode `0600`, zero symlinks, and zero checksum mismatches. A copied build-time
dependency symlink was identified and removed from the archive without
changing its target or the source tree. The temporary history-extraction
directory was deleted after the four recovered files were checksum-verified.

The source-side ignored files were not moved, changed, permissioned, or
deleted. The local OneDrive mount does not expose authoritative cloud upload
or sharing status, so cloud synchronization and access membership remain an
explicit owner-verification gate.

## Load-bearing and disposition matrix

| Sanitized artifact class | Dependency and reproducibility | Proposed disposition |
|---|---|---|
| External reviewer-holistic manifest, proposal evaluation, and cohort | The workflow collectively requires all three: the planner requires manifest plus proposal evaluation; the runtime probe requires proposal evaluation and optionally checks the manifest; validation and execution require the full set. One scored evaluation exists in ignored output but no usable complete bundle exists there. A separate frozen three-file bundle is now restored and passes full validation in the external archive. | **Preserve the verified frozen bundle separately from the scored output.** Confirm cloud sync/access, and repin the manifest to the final source commit only if the study remains active and reproducible. |
| Reviewer-holistic execution checkpoints | Consumed by resume/retry and downstream cohort selection. Reproduction is paid, live-service-dependent, and non-deterministic. | **Preserve — highest priority.** Move only as one verified external bundle. |
| Reviewer-holistic scoring package and unblinding map | Supports scoring, audit, and research. Reproduction depends on the execution chain, exact seed, and external inputs. | **Preserve securely.** Apply narrower access to the unblinding map. |
| Reviewer identity/email research and chained evaluation outputs | Fourteen files are exactly referenced by tracked code; other results support manual judgments and experiment history. | **Preserve code-linked chain.** Review remaining files individually; do not bulk-delete the folder. |
| Review-form production probe receipts | Current state can be reprobed, but the historical state and durable claims cannot be reconstructed exactly. | **Preserve until sanitized tracked receipts replace any citations**, then archive or dispose. |
| Smoke-test candidate state | Contains exact record identifiers needed for marker-gated cleanup. | **Do not delete** until cleanup read-back proves no test rows remain. Delete promptly after that proof. |
| Application-research rollback snapshot | No current code reader; source tables were dropped, so the historical rollback evidence is not reproducible. | **Owner decision:** controlled short archive if rollback/audit value remains; otherwise dispose after explicit sign-off. |
| Contact-ORCID back-propagation checkpoints | Historical decisions are not reproducible, although current state can be reprobed. The one-shot workflow has shipped. | **Short archive or aggregate receipt**, then dispose after owner confirms rollback is no longer required. |
| Cross-store and contact probes | No tracked downstream consumer; current state is reproducible. | **First-wave disposal candidate** after confirming durable aggregate conclusions. |
| Zero-byte identity-audit output | No downstream consumer and no retained evidence. | **First-wave disposal candidate.** |
| Merge-probe raw receipts | Offline diagnostic evidence; the probe can be rerun. | **First-wave disposal candidate** after any needed aggregate conclusion is tracked. |
| Generated schema diff | Regenerable from current metadata; no runtime consumer. | **First-wave disposal candidate** after any needed aggregate conclusion is tracked. |
| Root smoke receipts and reproducible logs | No tracked consumer; represent point-in-time diagnostic output. | **First-wave disposal candidate** unless they are the only evidence for an unresolved incident. |
| Rendered office/PDF/image output and final decks | Intermediates are usually rebuildable; a final human deliverable may be a sole copy. | **Preserve only final/sole copies externally; dispose intermediates** after visual/finality review. |
| Other agent review and handoff output | Usually rerunnable but not byte-identical; conclusions may already be tracked. | **Review individually; dispose when durable conclusions exist elsewhere.** |

The exact code-reference split in the reviewer-holistic directory is 14 files
referenced by tracked code, three referenced only by tracked documentation,
and the remainder not exactly referenced. Exact reference is a strong
preservation signal, but absence of a reference does not by itself prove an
artifact lacks audit, research, or final-deliverable value.

## Proposed retention controls

No calendar retention period is asserted without an organization policy or
owner decision. The safest current rules are event-based:

1. **Secure destination first.** Use access-controlled storage outside the
   repository. The local staging directory should be owner-only (`0700`) and
   copied files owner-readable/writable only (`0600`). The WMKF organizational
   OneDrive storage class is selected and the local copy satisfies those mode
   requirements. Cloud sharing membership, synchronization, encryption, and
   backup remain owner/platform verification items.
2. **Preserve a coherent experiment bundle.** Keep the verified three-file
   input contract, execution checkpoints, scoring package, unblinding map,
   exact randomization seed, final source commit, and a sanitized inventory
   receipt together. Keep the seed in controlled secret storage, never tracked
   documentation. If the owner explicitly closes the reproducibility window
   or the seed is already unavailable, a non-reversible receipt may document
   that fact, but it cannot substitute for the seed; label the retained bundle
   audit-only and non-reproducible.
3. **Finish cleanup-dependent workflows.** Retain exact marker/state files
   until read-back proves that synthetic rows are gone. The state file should
   be deleted after verified cleanup so stale identifiers cannot be mistaken
   for active work.
4. **Close rollback windows deliberately.** Retain one-shot rollback evidence
   only until the data owner confirms the migrated state and ends the rollback
   window. Then preserve an aggregate receipt and dispose of row-level files.
5. **Dispose of reproducible diagnostics after receipt.** A tracked aggregate
   result may replace raw probes, schema diffs, smoke logs, and intermediate
   renders when no incident or audit obligation remains.
6. **Review sole-copy deliverables.** Move final decks, workbooks, documents,
   or reports that have continuing business value; do not preserve every
   intermediate render merely because a final copy is valuable.
7. **Verify transfers and deletions.** Compare byte counts and cryptographic
   receipts privately after transfer, open representative copied artifacts,
   and generate a privacy-safe deletion receipt containing only category,
   counts, bytes, date, and approving owner.

## Safe execution sequence

1. **Partial:** the owner selected the WMKF organizational OneDrive
   destination. The local copy is owner-only and byte-verified; cloud sync and
   access membership still require confirmation.
2. **Partial:** the scored proposal evaluation and exact seed are preserved.
   The missing frozen manifest/cohort contract was recovered from history and
   passes the full validator in the external archive. Manifest repinning is
   pending if the study remains active.
3. **Partial:** the load-bearing reviewer-holistic execution/scoring chain and
   review-form evidence are copied and byte-verified. Sole-copy final
   deliverables outside those directories still require review.
4. **Pending:** verify and complete marker-gated smoke cleanup before deleting
   its source state file.
5. **Pending:** decide whether the application-research and Contact-ORCID
   back-propagation rollback windows are closed.
6. **Pending:** produce an exact private candidate list for the approved
   disposal categories.
7. **Pending:** delete only approved source files, rerun the ignored-file
   inventory, and record aggregate before/after counts in a tracked receipt.
8. **Pending:** reconcile the local-only finding in
   `docs/audits/public-repository-pii-history-audit-2026-07-27.md`.

## Owner decisions required

1. Can the owner confirm that OneDrive reports the archive synchronized and
   that its cloud access membership is limited to approved WMKF users?
2. Is the reviewer-holistic study still active, or may its preservation window
   close after the external bundle is verified?
3. Are the application-research and Contact-ORCID back-propagation rollback
   windows closed?
4. Are any rendered decks, workbooks, documents, PDFs, or images the sole
   authoritative final copy?
5. May the first-wave disposal candidates be deleted after a private exact-path
   review and aggregate receipt?

The missing reviewer-holistic input contract is now restored and locally
verified in the external archive. Until cloud sync/access, retention-window,
and exact disposal decisions are recorded, the ignored-local component of the
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
classifier term. The final disposition therefore requires owner review of
sole-copy deliverables and non-code-referenced research output.
