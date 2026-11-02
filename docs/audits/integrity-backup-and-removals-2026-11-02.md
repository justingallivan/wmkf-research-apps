# Retraction Watch backup, restore and removal review — 2026-11-02

**Historical checkpoint:** subsequent migration, merge/deployment and production dry-run are complete in the [live release receipt](integrity-production-release-2026-11-02.md). First publication and monthly activation remain held.

**Backup/restore VERIFIED. Historical removal-review verdict: the raw feed alone would lose two records.** The owner subsequently approved narrow retention; see the [current retention implementation/review](integrity-retention-fable-review-2026-11-02.md). Justin authorized the backup, isolated restore verification and removal review. Production was read-only; no migration, merge, refresh, env change or schedule activation occurred.

## Backup and restore proof

- [VERIFIED via native pg_dump/pg_restore and data comparison] Private, Git-ignored local backup: `/Users/gallivan/Code/WMKF_Apps/.integrity-backups/2026-11-02-pre-refresh/`. Directory mode 0700; dump mode 0600. Archive contains only `public.retractions`, its owned sequence/default, data, PK/unique constraints and all five indexes. No passwords, screening histories or staff decisions are in this scoped backup. Ownership/grants are intentionally omitted for portable isolated restore; this is not a full-app disaster-recovery backup.
- [VERIFIED] Production direct endpoint was fenced to app project `falling-surf-05640504` / `neondb`. One exported REPEATABLE READ READ ONLY snapshot bound production fingerprint reads and pg_dump to the same rows. Sequence value/called state was checked before/after; unchanged. pg_dump 18.6 backed up server 17.11 with full certificate verification; it emitted no warnings.
- [VERIFIED] Archive 15275103 bytes, SHA-256 `4fbd26264805cc2c08590fe14b295f9c31a80ae5b7e6309a45b9f1e19249092e`. The archive listing explicitly includes TABLE DATA, SEQUENCE SET, ownership/default dependency and author GIN index.
- [VERIFIED via actual restore] Restored with pg_restore into a brand-new, empty loopback Postgres 18.6 database `integrity_restore_20261102`. All **68,248 rows**, ordered row JSON SHA-256 `258a50be7c5d41983f611fb39192e90d9af42ca1b2d891aafed71cb6935184a9`, column types/defaults/nullability, all five index definitions, portable constraints and sequence state match. Sequence last_value 68,248 / is_called true. Postgres 18 adds catalog rows for NOT NULL constraints; nullability is compared through columns and version-specific catalog rows are excluded from the portable constraint comparison.
- [VERIFIED] Temporary restore cluster stopped and removed. Checksummed archive, immutable source fingerprint and `restore-verification.json` remain on the Mac outside the disposable worktree. Manifest records successful verification. This proves a table-level portable restore, not a Neon PITR restore or a production restore procedure execution. Neon seven-day history remains an independently verified recovery layer. Refresh the backup if writes occur before release; keep the archive after worktree cleanup. No offsite archive upload was performed.

Reproducibility: `scripts/backup-retractions.cjs --output-dir=/new/private/absolute/path` performs only fenced production reads and local file writes. `scripts/verify-retractions-restore.cjs --backup-dir=/backup/path` requires explicit `RETRACTION_RESTORE_TEST_URL`, restricts it to a named loopback database, refuses nonempty targets, verifies archive checksum/scope, then restores and compares. Neither restore script nor local harness loads production credentials. Standard tool behavior: [PostgreSQL pg_dump documentation](https://www.postgresql.org/docs/current/app-pgdump.html). Do not run restore against Production under this authorization.

## All 15 removals reviewed

[VERIFIED via new bounded HTTPS download and read-only DB comparison] A fresh official download still has 73,519 rows / 67,793,090 bytes, SHA-256 `7a729a87837985954a34326202cb98c4bff4b2b142fda8695febb613cf45a7f4`, identical to preflight. It omits the same 15 IDs. `scripts/review-retraction-removals.cjs` compares valid original DOI and normalized title and exposes journal/authors; placeholder DOI “unavailable” is not identity evidence. A same-title candidate alone is not labeled a duplicate. Replacement coverage is verified; the upstream editors’ reasons for changing IDs remain unknown unless stated below.

| Removed ID | Current source IDs | Disposition |
|---|---|---|
| 1137 | 72794 | Same original DOI and title; retraction coverage retained. |
| 13045 | 12920 | UNRESOLVED: same title/authors but different journal. Missing Medicine article has its own publisher retraction; Pathology entry is not proof of replacement. |
| 17901 | 12294 | Current feed reinstatement; legacy original DOI actually identifies the withdrawn retraction notice. Cambridge independently confirms withdrawal. |
| 21617 | 21616 | Current feed keeps Expression of concern, EOC Lifted / No Further Action. Legacy retraction classification is superseded; NLM identifies the later notice as a retraction of the EOC. |
| 24345 | 24194 | Current feed reinstatement, same title; legacy original DOI is the notice DOI in the retained entry. Classification is feed-based; no independent publisher reinstatement was fetched. |
| 36393 | 2175 | Same original DOI and title; retraction coverage retained. |
| 38913 | 34580 | Same original DOI and title; retraction coverage retained. |
| 5078 | 72421 | Same original DOI and title; retraction coverage retained. |
| 53644 | 41895 | Same original DOI and title; retraction coverage retained. |
| 62224 | 73832 | Same original DOI and title; retraction coverage retained. |
| 6430 | 64470 | Same original DOI and title; retraction coverage retained. |
| 65869 | 62700 | Same original DOI and title; retraction coverage retained. |
| 66213 | 70759 | Same original DOI (case-normalized) and title; retraction coverage retained. |
| 67801 | none | UNRESOLVED: no DOI/title replacement; no occurrence of original DOI, notice DOI, distinctive title or PMID in fresh source. Elsevier and NLM still identify a retraction. |
| 8490 | 8374; 8488 | Retraction retained as 8374 with original DOI 10.1104/pp.110.157180; 8488 is a correction. Legacy original DOI 10.1104/pp.16.00050 is the correction notice DOI. |

Summary: nine same-original-DOI retractions remain represented; one has a corrected original/notice DOI with a retained retraction; three have retained records with changed notice status; **two omissions remain unresolved**.

### 67801 — confirmed retraction with no replacement

“Microencapsulation using a novel wall material prepared via Maillard reaction-derived mung bean protein-peach gum conjugates to enhance stability and functionality of chia seed oil,” original DOI `10.1016/j.ijbiomac.2025.139959`. The [publisher article page](https://www.sciencedirect.com/science/article/pii/S0141813025005082) still identifies it as retracted (search-index content; direct fetch returned 403). The independently accessible [NLM notice](https://pubmed.ncbi.nlm.nih.gov/40579249/) identifies the July 2025 retraction notice, DOI `10.1016/j.ijbiomac.2025.144736`; [original NLM record](https://pubmed.ncbi.nlm.nih.gov/39824431/). Neither DOI nor the distinctive title appears anywhere in the newly downloaded CSV. Removing this row would lose an existing paper signal. No reason for the omission has been established.

### 13045 — same title, distinct journal publication

The missing row is in *International Journal of Clinical and Experimental Medicine*, 2014;7:4809–4818. Current row 12920 is in *International Journal of Clinical and Experimental Pathology*, 2015;8:207–216, despite identical title and authors. The Medicine paper has its own [publisher retraction notice](https://e-century.us/files/ijcem/10/9/ijcem1709001.pdf), 2017;10(9):14159, indexed as [PMID 29874332](https://pubmed.ncbi.nlm.nih.gov/29874332/). The separate Pathology notice is [PMID 29874309](https://pubmed.ncbi.nlm.nih.gov/29874309/). Therefore a title match is insufficient to approve deleting the Medicine entry as a duplicate. Current name-based author coverage may overlap, but that does not establish equivalent paper-level evidence.

Other independently checked status evidence: [Cambridge withdrawal of the retraction](https://www.cambridge.org/core/journals/canadian-journal-of-emergency-medicine/article/withdrawal-of-assessing-efficacy-of-lipid-in-unstable-nonlast-overdose-patients-retraction/A5BE04C1A431D3FA4B485608EE50A0B1) supports 17901; [NLM EOC record](https://pubmed.ncbi.nlm.nih.gov/17177760/) and [later EOC withdrawal record](https://pubmed.ncbi.nlm.nih.gov/24393141/) support treating 21617 as a notice-status correction rather than assuming the original article remains retracted. No automatic finding about the named authors follows from these records.

## Release disposition

- **Migration 092:** no new technical blocker from the backup or removal review. It is additive to corpus schema and does not publish/delete records. Owner authorization, immediate target/pending-set/session/lock recheck and quiet-window coordination are still required.
- **Merge/deployment:** may proceed independently with worker flag unset and cron absent, after explicit promotion approval and combined-main checks. This review does not authorize that promotion. Known-good deployment is recorded in the preceding preflight.
- **First refresh, initial finding:** raw-feed-only publication was held. The owner-approved two-record retention implementation now addresses this condition in source, with review/operational release gates tracked in the linked follow-up. The reviewed merge deletes every absent source ID, so it would delete both unresolved entries. The approved retention design preserves provenance and both entries; require its Fable closure and operational dry-run before publication. Do not silently patch the downloaded CSV, pretend the local archive hash identifies modified bytes, simply suppress all deletions, or contact the upstream maintainer without owner authorization. Any runtime correction requires focused tests and the requested Fable review before merge. Actual production-pooler/hosted dry-run and exact publication approval remain outstanding as planned.
- **Monthly schedule:** remains absent. Activate only after a verified first publication; unchanged monthly source can repeat the same omission, so a one-off manual workaround is insufficient.

Contract-reconcile and bounded sweep: backup producer→private archive/checksum→fresh local restore→full data/schema/index/sequence comparison verified; partial failure cannot trigger production restore; target/empty-database guards are fail-closed; old preflight recovery gaps and current guide/Atlas/plan restatements updated. Runtime screening policy and publication code were not changed. Residual unknowns: upstream omission reasons, external/manual writers, campaign quiet-window approval, actual hosted pooler COPY/time budget and Neon PITR execution. Scope excludes unrelated app backups and a blanket claim about all external schedulers.

Verification: syntax and scoped lint checks passed for all three tools. Atlas, doc-currency, fact-consistency, docs-catalog, doc-symbol and secret gates/self-tests passed sequentially. A fresh post-backup production READ ONLY probe still found only migration 092 pending, no other active sessions and no corpus locks. Fetched main remains one unrelated documentation commit ahead of the branch base. No runtime publication policy changed.
