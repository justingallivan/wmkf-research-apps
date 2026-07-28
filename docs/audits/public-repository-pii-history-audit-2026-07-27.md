---
title: Public Repository PII and History Audit — 2026-07-27
domain: security-privacy
kind: audit
status: active
summary: "Baseline public-repository privacy audit plus a current-tree remediation follow-up; reachable history and ignored local retention remain unresolved."
canonical: false
cataloged: 2026-07-27
last_verified: 2026-07-27
owner: product-engineering
related:
  - docs/audits/documentation-memory-hygiene-sweep-2026-07-27.md
  - docs/CREDENTIALS_RUNBOOK.md
  - docs/CI_GATES_REFERENCE.md
  - .gitignore
---

# Public Repository PII and History Audit — 2026-07-27

## Audit contract

**Mode:** `/sweep` Mode B — bounded privacy and history audit.

**Trigger:** the repository owner confirmed that
`justingallivan/wmkf-research-apps` is public and requested a separate PII and
Git-history audit.

**Claims tested:**

1. the tracked current tree is free of personal, confidential, or
   production-derived data that should not be retained in a public repository;
2. deleting or redacting current files would be sufficient to remove any
   discovered exposure;
3. reachable Git history contains no probable live credentials;
4. tracked archives and binaries do not conceal obvious high-risk identifiers;
5. ignored local evidence is adequately protected merely because Git does not
   track it; and
6. the repository's current secret gate is an adequate privacy gate.

**Baseline:** branch `codex/docs-memory-hygiene` at
`0afea87669c30611828fb9dfa79e29c90b11afdd`.

**Public-state verification:** GitHub reported the origin repository as public.
There were 3,311 commits reachable from fetched `origin` refs. The broader
local `--all` scan covered 3,345 commits, 32,652 reachable objects, 13,344
unique blobs, 13,332 text blobs, and 272,441,127 text bytes.

**Current-tree scope:** 2,460 tracked files, including 2,446 text files, current
tracked archives/binaries, durable documentation, tests, scripts, memory, and
session routing.

**Additional local scope:** ignored environment files and ignored operational
outputs were inspected only to determine local retention risk. Their values
were not copied into this report.

**Excluded surfaces:**

- unreachable or dangling objects and reflog-only objects;
- remote forks, clones, GitHub caches, CI artifacts, backups, and server-side
  refs not fetched locally;
- live Dataverse, Postgres, SharePoint, Vercel, or Power Platform records;
- OCR of two reachable PNG images; and
- destructive remediation, history rewrite, force-push, clone invalidation,
  credential rotation, notification, or local evidence deletion.

The excluded destructive and external actions require an explicit owner
decision. This audit performed no live data writes and changed no repository
history.

## Executive verdict

**Severity: High.**

**Verdict: `CLAIM NOT RECONCILED`.**

The baseline audit is complete, but the overall privacy condition is not
reconciled. The original tracked-tree findings have now been remediated on the
current branch: audited raw evidence was replaced with aggregate receipts,
operational identities were externalized, test identities were replaced with
reserved fixtures, named access mappings were removed, genuine contact
addresses were removed from current memory, and the production proposal
evaluation bundle was externalized behind explicit file inputs.

This follow-up does not rewrite reachable public history or dispose of ignored
local evidence. Earlier revisions still retain personal contact and
operational values, and a much larger personal-data corpus still exists in
ignored local outputs. Those two classes keep the verdict at
`CLAIM NOT RECONCILED`.

No probable live credential was identified in reachable Git history. The
primary problem is durable personal and confidential data retention, not an
API-key or password leak.

## Evidence matrix

| Claim | Evidence | Classification |
|---|---|---|
| The current public tree is PII-free. | The baseline contained production-derived reviewer contact/payment evidence, identifiable evaluation evidence, access rosters, and proposal metadata. The audited high-risk surfaces are resolved in the follow-up, but an absolute whole-tree semantic absence claim remains beyond the bounded classifiers. | Baseline: `STALE-CONFLICT`; follow-up: audited surfaces resolved, absolute claim `UNKNOWN` |
| Current-file deletion alone would close the exposure. | Deleted and earlier revisions containing personal contact values remain in reachable history. | `STALE-CONFLICT` |
| Reachable history contains a probable live credential. | Three secret-shaped hits were deterministic scanner/test fixtures; independent assignment and credential-URL checks found no candidate. | `FALSIFIED` |
| Current tracked archives conceal obvious secrets or high-risk identifiers. | Archive/XML/string inspection found none in the reviewed PPTX, ZIP, DOCX history, or PNG strings. | `FALSIFIED` within the stated binary limits |
| Ignored output is adequately protected by `.gitignore`. | Ignored exports contain a large personal-data corpus without a documented retention/access-control contract. | `STALE-CONFLICT` |
| The current secret gate is a privacy gate. | It passed while tracked production-derived personal data remained present. | `FALSIFIED` |

## Current-tree remediation follow-up

**Scope:** non-history changes only. No ignored output was deleted, no
credential was rotated, no repository visibility changed, and no Git object
or ref was rewritten.

| Invariant | Current-tree action | Verification |
|---|---|---|
| Tracked reviewer/payment evidence contains no person-level rows. | Replaced the three reviewer/payment files, five representative Atlas row dumps, and the W4 per-row anomaly table with dated aggregate receipts. | Whole-file review plus focused zero-count scans for contact addresses, UUIDs, and production request-number shapes. |
| Reviewer-evaluation evidence retains method without identifiable subjects. | Replaced the contact-strategy audit's named subjects with aggregate method/results. | Focused PII/identifier scan and document review. |
| Operational scripts contain no embedded production identity targets. | Required explicit user, request, email, or external cases-file inputs; write-capable repair remains dry-run by default and refuses a cases file inside the repository. | Syntax checks and fail-loud missing-input probes. |
| Test behavior is preserved without real identities. | Replaced audited identities with fictional names and reserved-domain addresses. | Eight focused suites: 147 tests passed. |
| Access documentation does not publish a person-to-privilege roster. | Replaced the Wave 1 rosters and intake pilot mappings with access-controlled roster/role references and synthetic UI examples. | Targeted name/address/GUID scan of the audited access documents. |
| Current memory contains no genuine contact address from the audited corpus. | Removed operational contacts, a personal test recipient, an applicant test account, and named reviewer-contact examples. Preserved OData forms such as `@odata.bind`, which are code syntax rather than addresses. | Genuine-address classifier returned zero current `.claude-memory` matches after excluding OData annotations. |
| Production proposal inputs are not retained in tracked evaluation assets. | Replaced four production proposal JSON assets with aggregate public receipts; operational planner/runner/validators require explicit external files, while tests use internally consistent synthetic fixtures. | Focused evaluator tests, syntax checks, and production-identifier scan. |
| Deliberate public support content remains intentional and bounded. | Retained the additional-access/help contact only in `shared/components/WelcomeModal.js` and `pages/guide.js`. | Scoped current-tree scan and owner-context review. |
| History and ignored-local boundaries remain explicit. | No history or local-retention mutation was performed. | Reachable-history and ignored-corpus baseline in this audit remains the governing evidence. |

## Findings

### P1 — tracked reviewer contact and payment evidence

Three Atlas evidence files contain person-level reviewer/contact records,
contact addresses, payment-network identifiers, and physical-address context:

- `docs/atlas/evidence/akoya-reviewer-billcom-rows-2026-05-16.txt`;
- `docs/atlas/evidence/akoya-reviewer-linkage-2026-05-16.txt`; and
- `docs/atlas/evidence/akoya-reviewer-payment-fields-2026-05-16.txt`.

The first two link named/contact records to payment or request context. Across
the three files, the audit counted approximately 30 contact-address
occurrences representing about 15 distinct non-placeholder identities. The
values do not recur in the test corpus, which supports classifying them as
production-derived rather than synthetic fixtures.

The files entered history in commits `4103af79`, `09e81fdb`, and `75b98284`.
Payment-network identifiers are treated as confidential even though no bank
account or routing number was detected.

**Follow-up:** the current versions are aggregate-only receipts and contain no
person-level contact, address, payment identifier, request number, or record
GUID.

**Status:** current-tree component resolved; reachable-history component
unresolved.

### P1 — identifiable reviewer-research evaluation evidence

`docs/audits/reviewer-serpapi-contact-strategy-adversarial-2026-07-18.md`
contains approximately four identifiable academic contacts, repeated about 15
times, alongside candidate, probe, and reviewer-finder evaluation context.

Public professional contact information is not equivalent to a private
credential. Its retention beside assessment and matching evidence creates a
separate privacy and reputational risk. The file entered history in commit
`83f162f8`.

**Follow-up:** the current version retains the evaluation method, aggregate
measurements, provenance boundary, and conclusions without named subjects,
contact details, person URLs, or reversible identity aliases.

**Status:** current-tree component resolved; reachable-history component
unresolved.

### P1 local-only — ignored operational evidence

The ignored `outputs/` tree contained 125 files with approximately:

- 1,665 contact-address occurrences;
- 162 phone-shaped occurrences;
- 60 street-address-shaped occurrences;
- 114 UUIDs; and
- 51 grant/request identifiers.

The largest concentration was under `outputs/reviewer-holistic-m1/`. Additional
ignored operational exports with personal data exist under `scripts/`,
including contact-enrichment and application-research snapshots.

These files are not part of the observed Git exposure. They remain a
high-severity local retention and access-control issue because `.gitignore`
prevents accidental tracking but does not define who may access the files, how
long they may remain, or how they are securely disposed of.

**Status:** unresolved local retention risk.

### P2 — broader production and proposal linkability

Other Atlas evidence links people, organizations, proposals, or production
request identifiers. Representative files include:

- `docs/atlas/evidence/akoya-pi-fields-2026-05-17.txt`;
- `docs/atlas/evidence/akoya-caltech-primarycontact-2026-05-17.txt`;
- `docs/atlas/evidence/akoya-socal-contact-divergence-2026-05-18.txt`;
- `docs/atlas/evidence/akoya-underinclusion-4-2026-05-17.txt`; and
- `docs/atlas/evidence/akoya-program-research-reviewer-2026-05-16.txt`.

The Atlas evidence directory contains approximately 169 seven-digit production
request-number occurrences. A request number or record GUID is not personal
data by itself, but becomes linkable when retained with names, institutions,
roles, proposal topics, reviewer status, or contact data.

The tracked proposal cohort and evaluation JSON files contain ten proposals'
request numbers, titles, program areas, document keys/hashes, and evaluation
results. This is principally confidential proposal/business information, with
possible person-level linkability from titles and research context.

**Follow-up:** the five representative raw Atlas files listed above are now
aggregate evidence receipts. The four mutually referential production
proposal assets are now aggregate public receipts; operational execution
requires explicit external files and contract tests use synthetic fixtures.

**Status:** audited current-tree surfaces resolved. This does not prove that
every semantically identifying value in every tracked document has been
classified.

### P2 — staff identities and access topology

Living and archived documentation contains identifiable staff rosters tied to
application access, production privileges, or administrative roles. The
highest-concentration surfaces are:

- `docs/Q9_PREFS_APPACCESS_DAL_MIGRATION_PLAN.md`;
- `docs/WAVE1_PROD_RUNBOOK.md`;
- `docs/archive/WAVE1_PROD_PRIVILEGE_REQUEST_2.md`; and
- `docs/INTAKE_ADMIN_MEMBERSHIPS_BUILD_PLAN.md`.

These are work identities, not private consumer profiles. The mapping of named
people to applications and privilege levels is nevertheless sensitive
operational information in a public repository.

**Follow-up:** the Wave 1 current and archived rosters now point to an
access-controlled roster rather than naming staff. The intake-admin design
uses role labels and synthetic applicant examples. The Q9 DAL migration plan
contains generic permission architecture, not a person-to-access mapping, and
was retained.

**Status:** audited current-tree roster mappings resolved.

### P2 — real-looking identities in code and fixtures

Actual-looking internal contact addresses are embedded in tests, operational
scripts, and UI content. Tests contain 1,162 of the current tree's 1,581
email-shaped occurrences; many are reserved/example values, but some appear to
be real staff identities.

Representative surfaces include:

- `tests/unit/alert-recipients.test.js`;
- `tests/unit/email-signature-service.test.js`;
- `scripts/test-role-isolation-wave1.js`;
- `scripts/probe-impersonation-as-user.js`;
- `shared/components/WelcomeModal.js`; and
- `pages/guide.js`.

A supplemental exact-value comparison against a bounded set of ignored local
operational exports found matching contact values in 12 tracked files: three
evidence documents, three operational scripts, and six unit tests. This is a
curated-corpus result, not a claim that every live source was queried. The
corpus and comparison rules are defined in the reproducibility appendix below.
Real identities are unnecessary for most test contracts and should use
reserved-domain fixtures.

**Follow-up:** audited operational targets now arrive through explicit CLI or
external-file inputs, and the audited unit-test identities use reserved
domains. The two user-facing help surfaces retain their deliberate public
contact as a bounded exception.

**Status:** audited current-tree fixture and script-literal findings resolved.

### P2 — reachable history retains deleted personal data

The full reachable-history scan inspected 340 delete/rename events covering
326 unique old blobs. It found at least nine unique non-placeholder contact
values that are absent from the current tree but remain reachable from
`origin/*`:

- six values across five deleted operational/probe scripts;
- two values across two deleted expert-review planning documents; and
- one value across deleted revisions of an email-settings component.

The operational/probe values were first introduced across commits `5251fb68`
and `5e5666d2`; the planning-document values at `5d35cc2f`; and the
email-settings value at `4319e8c0`. Their later deletion did not remove the
earlier blobs.

A separate current-versus-history fingerprint pass also found live-snapshot
contact matches in ten history-only paths or revisions, including older
session handoffs, operational output, a retired repair script, documents, and
tests.

Commit-message bodies contain 28 unique non-placeholder contact values across
31 commits. Three are absent from current files: two person-like values and one
generic-role value. Git author/committer identities were treated as expected
Git metadata and classified separately as low-severity privacy metadata.

**Status:** unresolved history exposure. Current-tree redaction cannot remove
these reachable objects.

### P3 — durable memory and session history

Current `.claude-memory` contains 16 contact-address occurrences representing
approximately ten distinct non-placeholder values across ten files, plus
production request numbers and a small number of operational record
identifiers. Most UUID matches in memory are agent provenance identifiers, not
personal identifiers.

The current `SESSION_PROMPT.md` is comparatively clean, but earlier reachable
revisions contain history-only contact values. This distinction is important:
current memory hygiene does not prove historical removal.

**Follow-up:** current memory's genuine contact-address count is zero after
contextual redaction. Remaining email-regex hits there are OData
navigation/annotation syntax, not contacts. Earlier session/memory revisions
were not rewritten.

**Status:** current-memory component resolved; session/history component
remains part of any authorized history-remediation scope.

## Credential, high-risk identifier, and binary results

The current repository secret gate passed over 2,446 tracked text files, and
its self-test passed. The reachable-history scan found exactly three
secret-shaped values:

- one deterministic encryption-key fixture in a retired unit-test revision;
  and
- two deliberate secret-scanner self-test markers.

Independent generic secret-assignment and credential-bearing-URL checks found
no additional candidate. No secret-shaped commit-message value was detected.
No probable live credential was identified in reachable Git text or reviewed
archive content.

The ignored, untracked `.env.local` contains 11 real secret-shaped assignments.
It had file mode `0600` and was not found in reachable history. This is expected
local secret material, not evidence of public Git exposure. It must continue
to be managed under the credentials runbook and must not be copied into audit
artifacts.

No Social Security number, bank account, or routing-number candidate was
identified. Two EIN-shaped matches were the same schema/example value, not
operational data. No date-of-birth context was found.

Reviewed binary/archive content included:

- two current onboarding PPTX files;
- `docs/security-audit.zip`;
- all reachable DOCX/PPTX/ZIP XML or text members;
- four NUL-bearing JavaScript blobs after NUL removal; and
- string content from two PNGs.

No secret or high-risk identifier was found in that reviewed content. The
office-document core metadata contains author/last-modifier metadata, which is
classified as low severity. The PNGs were not OCRed, so visually embedded text
remains an explicit unknown.

## Falsification and false-positive controls

- Reserved/example addresses and obviously fictional test personas were not
  treated as exposure merely because they matched an email pattern.
- Raw Atlas reviewer contact fingerprints did not appear in the test corpus.
- Most UUIDs in memory were provenance metadata; large UUID concentrations in
  saved-view evidence were Dataverse query/view/role identifiers.
- Seven-digit request numbers and GUIDs were treated as contextual operational
  identifiers rather than direct PII.
- Phone-shaped identity-benchmark matches were rejected where contextual
  inspection showed ordinary numeric data.
- Package-lock author metadata was treated as public package metadata.
- The deterministic 64-character unit-test fixture had a limited repeated
  alphabet and did not match a current local credential.
- The scanner self-test values were retained as intentional detection
  fixtures, not classified as secrets.

These controls reduce mechanical false positives. They do not override
person-level context in raw evidence, access rosters, proposal records, or
candidate evaluation.

## Limitations and explicit unknowns

- No `gitleaks`, `trufflehog`, `detect-secrets`, or `git-secrets` executable was
  installed. The audit used the repository scanner plus independent pattern,
  archive, and fingerprint checks. Novel provider token formats remain a
  possible false negative.
- Reachable `--all` history is broader than fetched public origin refs, but it
  does not include unreachable/dangling objects, all reflog-only objects, or
  server-side refs not fetched locally.
- Remote forks, clones, caches, CI artifacts, backups, and copied exports were
  not inventoried.
- Regex and fingerprint checks cannot reliably identify every human name,
  physical address, or semantically sensitive relationship.
- Two PNGs were not OCRed.
- The audit did not determine whether payment-network identifier exposure
  requires notification or identifier replacement; that is a security/data
  owner decision.
- The audit did not establish an approved retention period or access-control
  mechanism for ignored local evidence.

## Privacy-safe reproducibility appendix

This appendix records enough procedure to repeat or challenge the counts
without retaining personal values in the repository. Raw matches were never
written to this audit. Person-bearing filenames are intentionally represented
by their introducing/deleting commit or blob locator rather than copied into a
new public manifest.

### Ref and object scope

The following read-only commands established visibility and reachability:

```bash
rtk gh repo view justingallivan/wmkf-research-apps \
  --json nameWithOwner,isPrivate,visibility
rtk git rev-list --count --remotes=origin
rtk git rev-list --count --all
rtk git for-each-ref refs/remotes/origin
rtk git rev-list --objects --all
rtk git cat-file --batch-check
rtk git cat-file --batch
```

The unique object IDs emitted by `git rev-list --objects --all` were
deduplicated before content inspection. Blob type and size came from
`git cat-file --batch-check`; content came from `git cat-file --batch`. All 13,344
unique reachable blobs were classified. Text decoding covered 13,332 blobs and
272,441,127 bytes. Four NUL-bearing JavaScript blobs were rescanned after NUL
removal. Office/ZIP members were inspected as archive XML/text. The remaining
two PNGs received only a strings pass and were not OCRed.

Public-history assertions were then checked against the 60 fetched
`refs/remotes/origin/*` refs. The broader `--all` object census also includes
local-only refs and is recorded as a conservative superset, not as proof that
every object in that superset is public.

Delete/rename history was enumerated with the equivalent of:

```bash
rtk git log --all --diff-filter=DR --raw --no-abbrev
rtk git log --all --format=%H%x00%B
```

Old blob IDs from 340 delete/rename events were deduplicated into 326 unique
old blobs, scanned, and then checked for reachability from `origin/*`. Commit
messages were scanned separately because their text is not part of file blobs.

### Secret classifier

The current-tree receipt used:

```bash
rtk npm run check:secret-scan
rtk node scripts/check-secret-scan-self-test.js
```

The history pass applied the exported `scanText` contract from
`scripts/check-secret-scan.js` to each reachable text blob, with path context
where available, and performed separate generic secret-assignment and
credential-bearing-URL checks. The detector source at the baseline had these
SHA-256 receipts:

| Detector input | SHA-256 |
|---|---|
| `scripts/check-secret-scan.js` | `f8fd7a1a595f5510d487ca400ec1fbb4f529aa11d3f31e64b2b4a5e77888c983` |
| `scripts/check-secret-scan-allowlist.js` | `bd927481fcec060e92990ed1df8c2b1b1ffd3d06632f72940712f71908977186` |
| `lib/utils/tracked-secrets.js` | `7e84525ceef998722e6fd7eb58eca043319a82927e0826e57c7c2904de91faaf` |

The detector recognizes provider-specific Anthropic, AWS, GitHub, Slack,
Google, and Vercel Blob shapes; private-key headers/JSON; and assignments to
the repository's tracked secret names. Generic assigned values must be at
least 32 characters, contain at least two character classes, and have Shannon
entropy of at least 3.3. AWS IDs use a 2.5 entropy threshold. Values or context
marked as tests, fixtures, examples, placeholders, redactions, fakes, dummies,
samples, mocks, or rehearsals are excluded. Current-tree lockfiles are
excluded by the gate. Allowlist entries must match the bounded file/kind/line
contract in the allowlist source.

The three history hits were manually classified using source purpose,
determinism, entropy, and comparison with current ignored credentials. Their
privacy-safe locators are:

| Blob | Path | Classification |
|---|---|---|
| `0ed9602497a5` | `tests/unit/dataverse-prefs-service-characterization.test.js` | deterministic unit-test fixture |
| `8c4946ff3021` | `scripts/check-secret-scan-self-test.js` | two deliberate scanner self-test markers |

No other history blob, archive member, or commit message produced a probable
credential finding under these detectors.

### Personal-data classifier

The PII passes used independent, case-insensitive detectors for:

- email-shaped contact values;
- common North American phone shapes;
- canonical UUIDs;
- Social Security number shapes;
- date-of-birth terms adjacent to ISO or US-style dates;
- street number plus street-suffix/address context; and
- seven-digit request numbers, classified only when linked to a person,
  proposal, organization, reviewer state, or payment context.

Reserved/example domains, obvious placeholders, package-author metadata, and
synthetic test personas were excluded or classified separately. Contact values
were normalized by trimming surrounding punctuation and case-folding before
deduplication. Raw hashes of contact values are not retained here because a
small contact-value space makes unsalted hashes reversible by dictionary
comparison.

For deleted-file history, the redacted result manifest is:

| First-introducing commit | Later deletion lineage | Result locator |
|---|---|---|
| `5251fb68` | `8811051e` | five values across four operational/probe scripts |
| `5e5666d2` | `8811051e` | one value in a person-bearing operational-script path; basename intentionally omitted |
| `5d35cc2f` | `13cca603` | `EXPERT_REVIEWERS_PRO_GAPS.md`; `EXPERT_REVIEWER_FINDER_V2_PLAN.md` |
| `4319e8c0` | `3a42ec5e`, `9114adeb` | `shared/components/EmailSettingsPanel.js` |

The three additional history-only commit-message contacts are located at
`4f970414`, `056aa20d`, and `04685e16`. The first two are person-like; the
third is a generic-role mailbox. Values are intentionally omitted.

### Bounded ignored-export fingerprint comparison

The supplemental comparison used only ignored operational exports already
present in the local workspace:

- `scripts/.contact-orcid-backfill.jsonl`;
- `scripts/.appresearcher-snapshot.jsonl`.

It extracted email-shaped values with the case-insensitive equivalent of
`[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}`, lowercased them, collapsed
whitespace, trimmed them, and SHA-256 fingerprinted them in memory for exact
comparison. Fingerprints were deduplicated within the two-file corpus; neither
raw values nor their hashes were emitted. No domain, role-mailbox, test, or
placeholder exclusion was applied to this comparison, so a match proves exact
reuse from the named corpus but does not by itself prove that the value belongs
to a natural person.

Current scope was text content from `git ls-files`. History scope was
path-bearing blobs from `git rev-list --objects --all`; this supplemental pass
excluded blobs over 5 MiB and NUL-bearing blobs. A blob was classified current
when its object ID appeared in `git ls-files -s`, otherwise history-only. These
supplemental exclusions do not apply to the separate full history secret scan,
which classified every reachable blob as described above.

It did not query live Dataverse, Postgres, SharePoint, search providers, or
email systems. Counts across paths cannot be summed as unique people because
the same value may recur.

The reported baseline 12-file current distribution and 10 history-only
path/revision distribution are therefore bounded to this curated local corpus.
The baseline current path-only manifest is:

| Baseline current tracked path | Distinct matches |
|---|---:|
| `scripts/probe-potentialreviewer-email-dups-audit.js` | 2 |
| `docs/atlas/evidence/akoya-reviewer-linkage-2026-05-16.txt` | 1 |
| `docs/audits/reviewer-serpapi-contact-strategy-adversarial-2026-07-18.md` | 1 |
| `docs/W4_ANOMALY_TRIAGE.md` | 1 |
| `scripts/fix-roster-email-recovery.mjs` | 1 |
| `scripts/probe-potentialreviewer-email-dups.js` | 1 |
| `tests/unit/contact-parser-email-consistency.test.js` | 1 |
| `tests/unit/my-candidates-partial-save-on-email-conflict.test.js` | 1 |
| `tests/unit/promote-applicant-reviewer-contact.test.js` | 1 |
| `tests/unit/reviewer-email-reconciler.test.js` | 1 |
| `tests/unit/reviewer-merge-service.test.js` | 1 |
| `tests/unit/reviewer-vetted-email.test.js` | 1 |

The history-only path/revision manifest is:

| History-only path or locator | Distinct matches / revisions |
|---|---|
| `SESSION_PROMPT.md` | 3 matches across 9 blob revisions |
| Person-specific retired repair script, blob `0834113719df25f04699779f95cecdf89ebc1808` | 2 matches; basename intentionally omitted |
| `docs/audits/reviewer-serpapi-contact-strategy-adversarial-2026-07-18.md` | 1 match across 2 blob revisions |
| `docs/CLAUDE_SERPAPI_RESOLVER_ADVERSARIAL_REVIEW_PROMPT.md` | 1 match |
| `docs/W4_ANOMALY_TRIAGE.md` | 1 match across 2 blob revisions |
| `test-output.log` | 1 match |
| `tests/unit/contact-parser-email-consistency.test.js` | 1 match across 2 blob revisions |
| `tests/unit/promote-applicant-reviewer-contact.test.js` | 1 match across 4 blob revisions |
| `tests/unit/reviewer-email-reconciler.test.js` | 1 match |
| `tests/unit/reviewer-merge-service.test.js` | 1 match across 5 blob revisions |

These counts must not be used as a complete inventory of all possible
live-source identities.

## Remediation sequence and remaining owner decisions

### Immediate, non-history remediation — follow-up status

1. **Completed in current tree:** replace raw reviewer/payment evidence with
   aggregate receipts containing no person-level rows.
2. **Completed in current tree:** remove identifiable subjects from the
   reviewer contact-strategy audit while retaining method and aggregate
   results.
3. **Completed for audited surfaces:** replace representative Atlas row dumps
   with aggregates and externalize the production proposal-evaluation bundle.
4. **Completed for audited surfaces:** replace named access rosters with
   controlled-roster references and role labels.
5. **Completed for audited surfaces:** use reserved-domain fixtures and
   explicit operational inputs rather than embedded identities.
6. **Still open; no deletion authorized:** inventory owners must approve and
   enforce an access/retention/disposal rule for ignored operational exports.
7. **Still an owner decision:** classify whether the historically exposed
   payment-network identifiers require notification or replacement.

### Public-history decision

Deleting current files is necessary but insufficient. If the owner decides
that public history must be purged, the remediation must be coordinated and
must target exact blobs and metadata across:

- raw reviewer/payment evidence;
- identifiable evaluation evidence;
- deleted operational/probe scripts and documents;
- relevant historical session/memory revisions;
- commit-message contact values where policy requires removal; and
- any additional objects identified during the pre-rewrite dry run.

A history rewrite would require explicit authorization, a backup and rollback
plan, force-push coordination, clone invalidation, fork/cache/artifact review,
and post-rewrite verification. None of those destructive actions was performed
by this audit.

### Prevention

Add a PII/privacy gate separate from `check:secret-scan`. Its minimum contract
should:

- scan documentation, Atlas evidence, archives, memory, operational scripts,
  and fixtures;
- reject non-reserved person-specific contact values unless an explicit public
  exception is documented;
- flag street/phone shapes, raw person-level exports, payment-network fields,
  and access-roster mappings;
- require reserved domains in tests by default; and
- encourage future probes to persist redacted counts, field names, and random
  opaque identifiers rather than raw rows. Unsalted hashes of low-entropy PII,
  including contact addresses, must not be retained because dictionary
  comparison can reverse them; cryptographic hashes remain appropriate only
  for high-entropy artifacts such as file-content integrity receipts.

## Final audit accounting

| Baseline result | Count |
|---|---:|
| Material claims tested | 6 |
| `FALSIFIED` | 3 |
| `STALE-CONFLICT` | 3 |
| `UNKNOWN` primary claims | 0 |
| Explicit scope/coverage unknowns | 7 |
| Probable live credentials in reachable history | 0 |
| Confirmed unresolved privacy classes | 8 |

The non-history follow-up closed the six audited current-tree classes: raw
reviewer/payment evidence, identifiable contact-strategy evidence, broader
Atlas/proposal artifacts, named access mappings, embedded operational/test
identities, and current-memory contacts. The bounded ignored-export
fingerprint comparison now returns zero exact contact matches in tracked files.

Two privacy classes remain unresolved:

1. reachable public Git history; and
2. ignored local evidence retention/access/disposal.

The audit's finding is therefore intentionally not described as reconciled.
Current-tree redaction does not remove earlier blobs, commit messages, clones,
caches, or the ignored local corpus. The next actions still require explicit
owner decisions; they were not implicitly authorized by this remediation.
