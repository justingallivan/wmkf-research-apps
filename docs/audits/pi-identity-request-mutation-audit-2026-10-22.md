# PI identity and request-mutation authorization audit — 2026-10-22

**Documentation repairs; runtime PI claim NOT RECONCILED.** Sol investigated two
P1 backlog items, Luna repaired confirmed documentary defects, and the parent
reviewed the diffs and material source branches. No runtime code, live records,
environment, deployment, worktree, or owner policy was changed. No live probes,
sends, paid calls, or pushes were performed.

## Scope and invariants

Sweep Mode B / contract-reconcile Mode A: establish the meaning and use of PI
identity and the narrow request-bound Reviewer Follow-up mutation boundary.
Entry points are reviewer discovery/enrichment/save/confirmation and terminal,
closeout, and due-date routes. Source persistence is Dataverse request/contact/
suggestion state and the operational Postgres roster; documentation is the only
changed durable surface. Consumers include reviewer screening, staff UI, email
notification and future agents. Other identity/referral flows remain a separate
backlog item. Current external populations and deployment are UNKNOWN.

| Invariant | Documentary surface | Review |
|---|---|---|
| Project Leader means PI; Research Leader means institutional officer | PI and liaison memories, enforcement contract, identity wiki | Preserve S159 owner decision; describe source conflict explicitly |
| Person identity validation cannot establish PI role | Same surfaces | Compare lookup selection with actual name/ORCID guards and consumers |
| Global merge and staff document reads remain org-open | Org-open memory | Preserve T1/D4 decisions; do not broaden the request-mutation exception |
| Dated release evidence is historical evidence | Org-open memory and reliability pointer | Separate source trace from September release/read-only-smoke receipts |
| No runtime repair or live incident is implied | Report and backlog | Record population and race uncertainty; no executable-file changes |

## Evidence matrix

| Claim | Producer / authority | Persistence and consumer | Evidence / disconfirming check | Status |
|---|---|---|---|---|
| PI is Project Leader; Research Leader is an officer | Owner-attested S159 triad | Request person lookups; all scientific attribution | `project-institution-foundation-liaison.md`; commit `7653b1e82` explicitly rejects officer-as-PI. No approved program-specific fallback exception found in investigated history. | VERIFIED owner decision |
| Resolver still selects Research Leader when Project Leader is absent | `proposal-pi-identity.js:139-149` | Contact read, ORCID/OpenAlex identity DTO | Unconditional `projectleader || researchleader`; no program/era guard. Unit test `proposal-pi-identity.test.js:52-63` expects it. Original implementation `70e78f062` and adapter refactor `f38c34ee6` preserve behavior. | STALE/CONFLICT with owner meaning |
| ORCID/name guard proves the selected person's role | Resolver `:166-211` | Identity DTO | Guards normalize ORCID and compare selected contact's name with available authority names; neither verifies request role. A valid officer identity passes the person check. | Refuted |
| Fallback affects downstream reviewer decisions | Resolver and `reviewer-request-context.js:281-300` | Discovery, enrichment, save screening, confirmation | Consumer paths below; no live affected-row count obtained. | VERIFIED source exposure; population UNKNOWN |
| Request-bound writes authorize the session actor | Three route shells and `reviewer-request-authorization.js:42-133` | Server-read suggestion/request ownership | `actorRefFromSession`; fresh role lookup; complete suggestion ownership read; request lookup; non-superuser must match lead PD case-insensitively. Missing actor fails closed for non-superuser. | VERIFIED bounded source trace |
| Terminal/closeout bind fresh row to authorized request | Terminal service `:275-282,344-359`; close-review service `:133-169,199-235` | ETag-bound suggestion changes | Terminal checks `belongsToRequest`; closeout checks returned `authorizedRequestId`; writes use freshly read row ETag. | VERIFIED source |
| Due-date service has the same request pin | Due-extension route `:67-74`, service `:139-165,344-349` | Fresh suggestion deadline write, then notification | Route discards authorizer return; service resolves request again and uses newer suggestion ETag without the original request id. No ordinary reparent writer established in bounded adapter search. | PARTIAL; residual race hypothesis, not confirmed bypass |
| September release receipts prove today's hosted configuration | Dated merge/deployment/read-only smoke | Hosted routes/config | Source and Git history cannot establish current hosted state. No fresh probe; prior smoke did not exercise a write. | UNKNOWN today |

Source paths in this matrix are under `lib/services/` unless a route/test is
named. Full authoritative paths: `lib/services/proposal-pi-identity.js`,
`lib/services/reviewer-request-context.js`,
`lib/services/reviewer-request-authorization.js`,
`lib/services/reviewer-engagement/terminal-transition.js`,
`lib/services/reviewer-engagement/close-review.js`, and
`lib/services/reviewer-due-extension.js`.

## PI consumer impact

- `pages/api/reviewer-finder/discover.js:251-258,297-304,339-347` supplies the
  selected identity's institutions, exact identity exclusion and author-name
  augmentation. `pages/api/reviewer-finder/enrich-contacts.js:141-149,175-190`
  uses it for institution-COI recomputation.
- `lib/services/workbench/enrich-recommended-service.js:751-787` supplies
  institution flags and author/coauthor-name augmentation.
- `lib/services/reviewer-finder/save-candidates-service.js:652-673,1145-1153,1184-1200`
  screens candidate save attempts before persistence using the resulting
  institution context. A failed PI-context read aborts save with 503; ordinary
  unresolved/no-ORCID results differ from that failed state.
- `lib/services/workbench/reviewer-roster-service.js:173-199,529-537` consumes
  `contactName` even with `resolved:false` and may reject staff confirmation as
  `proposal_author_candidate`. Missing or malformed ORCID therefore does not
  neutralize every consequence of selecting the officer.
- `lib/services/workbench/promote-applicant-reviewer-service.js:456-480` uses
  the context for institution screening when Phase 2 is enabled. Current
  activation was not probed.

This is source exposure, not proof of a misclassified live reviewer or grant.
The structured display projection separately uses Project Leader only
(`reviewer-request-context.js:195`); a correct displayed PI does not falsify the
resolver conflict.

## Authorization trace and limits

Routes `pages/api/review-manager/terminal-transition.js:79-84`,
`pages/api/review-manager/close-review.js:52-63`, and
`pages/api/review-manager/review-due-extension.js:67-74` authorize before calling
the mutation services, including terminal previews and due-date notification
retry. Client identities are not the authorization input. The compatibility
export `lib/services/review-manager/terminal-transition-service.js` is not the
implementation; it routes to `reviewer-engagement/terminal-transition.js`.

Authorization is all-or-none for the supplied target batch. Terminal mutation
then has per-row eligibility, ETag and partial-success results; zero transitions
returns 409. Release may commit before email failure and reports that distinction.
Closeout changes suggestion completion/eligibility, never the final Finance
remit flag. Due-date save commits before notification; `saved:true, notified:false`
can require notification retry without another date write.

The current Follow-up panel is
`shared/components/workbench/ReviewerFollowUpPanel.js:35-47,116-124`, not the
old redirect page. It derives management permission from the server projection
and preview state. Server checks remain authoritative. Sol found a separate UI
lifetime concern: `ReviewerDueDateEditor.js:85-106,185-195` does not invalidate
an already-open modal when management permission changes. This is not evidence
of server authorization bypass; retain it for a focused stale-context test.
No request-row ETag ties a lead-PD ownership read atomically to a later
suggestion write. Concurrent PD reassignment safety was not established.

## Durable restatement disposition

| Surface group | Classification | Disposition |
|---|---|---|
| Structured-PI memory and enforcement contract §4; identity-wiki summary | STALE | Correct role guarantee, retain person-identity safeguards, document unresolved runtime conflict |
| Liaison memory / schema annotation / Power Tools / intake / later Factory role statements | AGREE | Preserve owner role semantics; liaison memory links known resolver conflict |
| Historical PI wire-in plan `:75,98-99` and May 17 candidate-field probe | HISTORICAL | Preserve dated algorithm/inference, not current role authority |
| Org-open memory | STALE freshness framing; AGREE owner policy | Separate current bounded source proof from dated Sept 2 merge/read-only-smoke receipt |
| Reliability memory implementation pointer | STALE pointer | Point to actual terminal service; identify compatibility re-export |
| Closeout memory / historical Sept 2 visibility plan | AGREE / HISTORICAL | Preserve financial authority and release chronology |
| Route matrix close-review rollout note | STALE | Replace deployment-pending wording with dated S479 and September 8 release chronology; no present deployment claim |
| Other raw Research Leader field occurrences | AGREE / UNRELATED | Role labels, fixture fields and non-PI consumers are not blanket fallback defects |

Literal and semantic searches covered docs, memories, wiki, root/session
instructions, rules/skills, source and tests. No additional current instruction
endorsing the PI fallback was found outside repaired surfaces; runtime source
and the explicit fallback test remain unchanged. These are grouped dispositions,
not an invented exhaustive hit count. Entire edited durable files were read by
their editing agent; the parent reviewed material source regions and full diffs.

## Prioritized actionable backlog

1. **P1 — PI role selection conflict.** Before runtime repair, determine whether
   any approved legacy exception actually exists; none was found here. Design a
   resolver/test correction consistent with owner semantics, including the
   unresolved `contactName` consumer, absent Project Leader, non-research
   processes, valid officer ORCID and same-name cases. Preserve existing
   abort/name/identity and institution safeguards. Population assessment and any
   retained-outcome review need a separately authorized evidence plan; do not
   silently relabel people or rewrite historical COI outcomes.
2. **P1 — request authorization continuity.** Add a focused test/design for
   due-date save/retry retaining the authorizer's request identity, and establish
   whether reparent/PD-reassignment races are reachable before calling them
   vulnerabilities. Include the open-modal permission/context-change case.
3. **P1 — next source audit.** Continue the full identity/COI/exclusion,
   referral-closure and acknowledgement-provenance fanout. The present PI trace
   does not verify every identity gate or persisted-field reader.
4. **P1 — next action-specific audit.** After identity/provenance, verify
   Awardee Preview/Copy/Export and similar read-only exemptions through actual
   handlers and persistence effects. Labels alone do not establish harmlessness.

Recommendation prerequisites are present in local source/history. Source
counterchecks were performed; runtime changes, race reproductions and external
population probes were NOT performed. Runtime recommendation verdict: **READY
WITH NAMED EVIDENCE/TEST WORK**, not an implemented fix.

## Parent verification

The parent reviewed all seven documentary diffs and the material source branches.
Sol independently challenged the PI findings and the authorization report.
Review corrected a thin-route source pointer, preserved append-only author
augmentation, distinguished save-context failure from discovery fallback, and
corrected the display-projection pointer. An invalid decorated wiki verification
date failed the gate; the original ISO date was restored, with scoped review
wording in the body, and the gate/self-test then passed.

Six existing focused test suites passed, **78 tests**: PI resolver, shared request
authorizer, terminal route, closeout route, due-date route and due-date service.
The first test invocation named two nonexistent integration paths; Jest ran the
three matching suites (45 tests). The second invocation used the actual unit
route paths and ran three further suites (33 tests). These mocked tests prove
their bounded contracts, including the existing disputed fallback expectation;
they do not prove role semantics, current hosted state or race reachability.

Agent-invariants, memory-router, fact-consistency, canonical-pointers,
doc-symbol-refs, build-claim-freshness, agent-wiki, harness-framing, doc-currency,
docs-catalog and API-route-matrix checks passed. Applicable self-tests ran after
their gates, with the entire fixture-writing battery serial. The unchanged
memory-router MaxListeners and three external-materials guard-recognition
warnings remain advisory. `git diff --check` passed. No executable files changed.
The owner-review-burden memory and unrelated critique/output artifacts remain
untouched. Work remains local; no push or deployment.

Verdict: documentary corrections reviewed within the named scope; **runtime PI
claim NOT RECONCILED; all-claim/live-state audit INCOMPLETE**. Remaining actions
are ordered above; no checker or keyword suppression was used to close findings.
