---
title: Reviewer Lifecycle Stage 1D — Closed Invitation and Response History
kind: audit
domain: reviewer-workbench
status: complete
canonical: false
owner: product-engineering
last_verified: 2026-09-05
---

# Stage 1D implementation receipt

Branch: `codex/reviewer-lifecycle-approved-policies`. Base: `95690c75`.
Implementation: `c51fa34d8f48f520ebbf40c34965c48dd3e383b9`.
The owner approved the closed-history policy on 2026-09-04. Separate agents
investigated callers, built service/route/adapter regressions and implementation,
and built real-adapter races. The interrupted session resumed on 2026-09-05;
source and saved test artifacts were checked before continuing.

## Contract and implementation

Change surface: generic invitation/response correction, F3. Entry point:
authenticated `PATCH /api/reviewer-finder/my-candidates`. Persistence: existing
Dataverse reviewer suggestion. Consumers: invitation/response DTOs, portal
state, synthesis readiness, token follow-up and subsequent person edits.
The preimplementation invariant table and owner authority are in
[the approved decisions](REVIEWER_LIFECYCLE_APPROVED_DECISIONS_2026-09-04.md).

[VERIFIED via source and focused/composed tests] The route retains the Request
id returned by existing server authorization and passes it outside the request
body. The generic service freshly reads the suggestion, requires the same
Request binding, and accepts explicit null or known open/received status.
Complete, withdrew, released, an independent completion marker, and
missing/unknown status cannot pass. A client-supplied binding is not authority.

The protected inputs are `invited`, `accepted`, `declined`, `emailSentAt`,
`responseType`, and `responseReceivedAt`. Defined false/null values and
unchanged values are still correction attempts. A concrete fresh ETag binds
the PATCH to that exact authorizing row. The adapter independently recognizes
the six mapped columns, checks source state and requires a concrete caller
version or its own guard-read version when none was supplied. A supplied stale
or malformed version is never replaced with a newer version. No bypass flag
or shared policy extraction was introduced.

[VERIFIED via negative complements and races] Source/binding/version conflicts
return a domain 409; absent server-authorized Request input returns 400 and
structured not-found returns 404. No automatic retry occurs. Rejection precedes
the nonfatal accepted=true token follow-up and all person edits. Success retains
the lifecycle-write → token-follow-up → person-edit ordering, timestamp
normalization, actor forwarding and existing success envelope.

## Preserved differences and limits

The guard applies to source state, allowing a named command to transition an
open engagement. Dedicated closeout notes/eligibility correction keeps its
no-restamp behavior. Courtesy thank-you, deadline, reminder, metadata and
selection-only writes retain their contracts. Specialized acceptance, terminal
withdrawal, restore and raw receipt operations are not replaced by this setter.
Receipt alone does not bar a generic correction before human closeout; selected
and accepted are not new generic source prerequisites.

Inline invitation dispatch still precedes its lifecycle stamp. A closed/raced
source may therefore yield the existing `inviteRecorded:false` after delivery;
the adapter check is not a new pre-send gate. The legacy generate-email
markAsSent raw path remains a separately inventoried boundary. No email is
retried by this change. The old backfill script's generic setter can no longer
rewrite protected fields on closed history; no script was run or removed.

The suggestion ETag does not lock a separate Request's ownership change or
identify an unseen remove/restore generation with identical bindings. A
successful lifecycle update followed by token/person failure retains the
existing multi-write limitations. Unknown transport failure does not prove
noncommit. There is no schema, enum, migration, new route, backfill, live write,
cron invocation, merge to main or deployment in this stage.

## Regression evidence

[VERIFIED via saved Jest JSON] The executable baseline was unchanged at
`95690c75` when regressions were introduced. Three focused suites had **154
expected failures / 15 passes**, with 132 unrelated tests intentionally
unselected. The new composed F3 selection had **106 expected failures / 1 pass**,
with 78 retained tests unselected. Neither red run had a runtime-error suite.

After implementation, the three complete focused suites passed **301 tests**,
14 compatibility suites passed **309 tests**, and the entire composed race
suite passed **185 tests**, all without failures/skips. The race suite has 107
new F3 cases plus 78 unchanged retained tests. At this frozen Stage 1D commit,
F2/F4 and the old F5 batch characterization remained intact. Exact saved artifacts:

- `/tmp/reviewer-stage1d-focused-{red,green}.{json,log}`
- `/tmp/reviewer-stage1d-compatibility.{json,log}`
- `/tmp/reviewer-stage1d-composed-{red,green}.{json,log}`

Tests exercise all six fields across three closed states, false/null/unchanged
inputs, open/received complements, exact actor/version forwarding, missing or
malformed state/version/binding, and real closeout/withdrawal/release/reparent
winners before the service read, adapter read and PATCH. The fixture contains
person and linked honorarium rows, so unchanged-history assertions prove
exclusion rather than absence. Rejected conditional writes preserve the whole
winning row and produce no token/person effects or retry.

The parent reran ESLint for all seven changed source/test files and
`git diff --check`, both passing, before freezing the implementation commit.
Focused test execution uses actual services/adapters above an isolated HTTP
transport; live Dataverse behavior and cross-record authorization atomicity
are not certified by that fixture.

## Full verification and independent review

[VERIFIED at `c51fa34d`] `npm test -- --runInBand --watch=false --json
--outputFile=/tmp/reviewer-stage1d-full.json` passed **770 suites / 10,291 tests**,
zero failures, skipped/TODO tests or runtime-error suites. Existing diagnostics
outside the isolated harness include missing SQL connection configuration,
incomplete mock methods, negative-path logs and React act warnings; this is not
a clean-console or live-service claim. The strict composed harness had no
unexpected SQL/network calls. Full log: `/tmp/reviewer-stage1d-full.log`.

`npm run build -- --webpack` passed, with existing esmExternals,
dynamic-dependency and Node localStorage warnings. Build before/after tracked
diffs and status inventories were byte-identical; the generated migration
manifest had no drift. Log/status: `/tmp/reviewer-stage1d-build.log` and
`/tmp/reviewer-stage1d-build-status.json`.

All **59 distinct check scripts**, including self-tests, passed sequentially.
Only duplicate CI/no-write aliases were omitted. Exact commands/statuses:
`/tmp/reviewer-stage1d-gates.json`. Static writer census scanned 1,282 files,
recognized 175 calls, and found zero recognized unresolved bindings or parse
errors. Its one added call is the fresh candidate-service read; it is a
file-local static census, not proof of every dynamic/external writer.

[VERIFIED via fresh independent review] `/root/stage1d_fresh_review` returned
**PASS**, with no runtime corrections. It independently passed **591 tests and
probes**, including real route-to-authorization-helper binding cases and
post-delivery invitation stamp failures. Eight in-memory broken mutations all
produced discriminating assertion failures. Checked-out source was not mutated.
See [the complete review](REVIEWER_LIFECYCLE_STAGE1D_REVIEW_2026-09-05.md).

## Bounded durable reconciliation and handoff

Sweep Mode A covers F3's source-built status and the three approved policies.
Source, exact-version transport, raw-field consumers and red/green/mutation
evidence establish the behavior independently of prose. The Atlas's method and
writer contracts, wiki's generic correction contract and service catalogue now
record the guarded behavior and deployment boundary. The wiki's related
thank-you claim and present-tense synthetic-receipt claim were corrected:
courtesy recording remains independent, and equal legacy receipt/completion
stamps are a display heuristic rather than proof of historical provenance.

The assigned canonical-document pass classified ten claim groups: three AGREE,
five STALE structurally fixed, one HISTORICAL and one UNRELATED. It also filled
the missing generic service/wiki contracts. Root reconciled SESSION_PROMPT and
approved decisions; prior stage reports and inventories retain visible frozen
boundaries. Searches cover docs, memory, wiki, instructions/rules/skills,
source/tests and raw protected fields. No schema/enum/route registry entry is
new. No unrelated wiki-history audit or deployment recertification is claimed.
Final searches left zero remaining live stale claims within this bounded scope;
all 11 final documentation gate/self-test commands passed sequentially
(`/tmp/reviewer-stage1d-final-doc-gates.json`). Verdict: **RECONCILED** for the
named source/policy claims, with deployment and unrelated history excluded.

Stage 1D source work is complete. Its follow-up Stages 1E and 6A subsequently
completed at `bab3adea`/`77720b5a` and `5b9964c8`; their separate receipts and
the approved decisions carry the later evidence. This receipt preserves the
Stage 1D validation boundary. Public branch publication was approved and
completed on 2026-09-05; see [the release receipt](REVIEWER_LIFECYCLE_RELEASE_2026-09-05.md).
Production promotion remains pending; no main merge or production promotion
occurred.
