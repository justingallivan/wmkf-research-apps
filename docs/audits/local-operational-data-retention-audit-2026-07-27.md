---
title: Local Operational Data Retention Audit — 2026-07-27
domain: security-privacy
kind: audit
status: active
summary: "Privacy-safe inventory and preserve/archive/dispose proposal for ignored local operational artifacts; no operational artifact was moved, permissioned, or deleted."
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
- selection or provisioning of a controlled external storage system; and
- permission changes, file moves, archive creation, or deletion.

The classifiers emitted only aggregate counts. No raw personal value, contact
hash, person-bearing filename, or extracted OCR text was written to this
tracked report.

## Executive verdict

**Severity: High.**

**Verdict: `CLAIM NOT RECONCILED`.**

The inventory is complete for the stated local scope, but the retention
condition is not reconciled because the owner has not yet selected a secure
destination, event-based retention rules, or an exact deletion set.

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
non-deterministic execution/scoring evidence and one proposal-evaluation file
that passes its individual frozen validator. It does **not** include a usable
complete external input bundle: structural validation found no current
manifest or cohort file satisfying those contracts. The runner also rejects
input paths inside the repository. Before related deletion or public-history
remediation, preserve and provenance-check the existing proposal evaluation,
recover or recreate the manifest and cohort in access-controlled external
storage, validate the complete three-file contract, and repin the manifest to
the final source commit. Recreate the proposal evaluation only if its
provenance or currentness cannot be established.

`.gitignore` prevents accidental tracking. It does not provide encryption,
access control, retention, recovery, or secure disposal.

## Evidence matrix

| Claim | Evidence | Classification |
|---|---|---|
| Ignored operational files are disposable. | Tracked code consumes ignored execution and smoke state; some final deliverables may be sole copies. | `FALSIFIED` |
| The reviewer-holistic input bundle is locally complete. | One proposal-evaluation file passes its individual validator, but structural validation found zero current manifest-schema files and zero cohort-schema files. The complete contract is therefore unusable, and in-repository paths would be rejected by the runner. | `FALSIFIED` |
| Reviewer-holistic execution output is cheaply reproducible. | Reproduction requires external inputs, credentials, an exact randomization seed, live services, paid calls, and non-deterministic responses. | `FALSIFIED` |
| Current permissions adequately restrict flagged text files. | Fifty-eight of 63 flagged text/structured files have mode `0644`; only five have mode `0600`. | `FALSIFIED` |
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

## Load-bearing and disposition matrix

| Sanitized artifact class | Dependency and reproducibility | Proposed disposition |
|---|---|---|
| External reviewer-holistic manifest, proposal evaluation, and cohort | The workflow collectively requires all three: the planner requires manifest plus proposal evaluation; the runtime probe requires proposal evaluation and optionally checks the manifest; validation and execution require the full set. One individually valid proposal evaluation exists, but no usable complete bundle exists in the ignored repo tree. | **Preserve and provenance-check the existing evaluation first.** Recover or recreate the missing manifest and cohort outside the repository, restrict access, validate the complete contract, and repin the manifest to the final source commit. Recreate the evaluation only if its provenance/currentness fails. |
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
   copied files owner-readable/writable only (`0600`). Storage selection,
   encryption, backup, and authorized users remain owner decisions.
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

No step below has been executed.

1. Select the access-controlled destination and authorized users.
2. Preserve and provenance-check the individually valid reviewer-holistic
   proposal evaluation. Recover or recreate the missing manifest and cohort
   outside the repository; preserve the exact seed in controlled secret
   storage, validate the frozen three-file contract, and repin the manifest.
   Do not erase the only history source for a missing input before the external
   bundle has been verified.
3. Copy the load-bearing reviewer-holistic execution/scoring chain and any
   sole-copy final deliverables; verify privately.
4. Verify and complete any marker-gated smoke cleanup before deleting its
   state file.
5. Decide whether the application-research and Contact-ORCID back-propagation
   rollback windows are closed.
6. Produce an exact private candidate list for the approved categories.
7. Delete only the approved files, then rerun the ignored-file inventory and
   record aggregate before/after counts in a tracked receipt.
8. Reconcile the local-only finding in
   `docs/audits/public-repository-pii-history-audit-2026-07-27.md`.

## Owner decisions required

1. What access-controlled destination should hold preserved operational
   artifacts, and who should have access?
2. Is the reviewer-holistic study still active, or may its preservation window
   close after the external bundle is verified?
3. Are the application-research and Contact-ORCID back-propagation rollback
   windows closed?
4. Are any rendered decks, workbooks, documents, PDFs, or images the sole
   authoritative final copy?
5. May the first-wave disposal candidates be deleted after a private exact-path
   review and aggregate receipt?

Until those decisions are recorded and the missing reviewer-holistic input
contract is restored, the ignored-local component of the public PII/history
audit remains `CLAIM NOT RECONCILED`.

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
