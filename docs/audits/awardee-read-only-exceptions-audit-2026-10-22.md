# Awardee Preview, Copy and Export audit — 2026-10-22

**Bounded read-only exception audit; whole-repository verification INCOMPLETE.**
Sol investigated action and UI contracts, Luna repaired documentation, and the
parent reviewed source and changes. Only documentation changes are authorized.
No runtime code, live records, environments, worktrees or deployments changed;
no live probes, sends, paid calls or pushes.

## Scope and invariants

Sweep Mode B / contract-reconcile review. The audited controls are Awardee
**Preview email**, **Copy website HTML**, and **Cycle export**, not every action
or every kind of preview. Trace: UI → route guard/validation → signature or
document assembly → response → browser window/clipboard. The pipeline reads
Dataverse requests, contacts/accounts, package state and signature preferences;
its outputs are HTML and local browser effects. There is no audited
business-data persistence hop for these three actions. Authentication, caches,
logging and browser state are not covered by a universal zero-effects claim.

Preserve the S411 owner lesson: mutation controls must mirror actual server
preconditions. Preserve research-only product intent, staff-initiated eligibility,
editable recipients, and broader cycle output. No new status gate, program gate,
lead-PD requirement or global Awardee preview lock is introduced here.

| Invariant | Evidence to check | Documentary correction |
|---|---|---|
| Read-only output does not mean unauthenticated or no effects | Three routes plus `requireAppAccess` and UI handlers | Narrow “need no gate” to lifecycle mutation gates |
| Each action has its own scope | GUID-based single-request reads versus cycle query | Do not describe all reads as research/awarded-filtered |
| A render-only POST can remain business-read-only | Preview route and signature/render helpers | Preserve placeholder and no-send/no-mint boundary |
| Reviewer preview lock is a different contract | Request dispatch and Awardee props/key | No invented Awardee `previewReadOnly` enforcement |
| Owner history is not permission to change runtime policy | Historical S268 build record and current product decisions | Record scope differences without silently adding a gate |

## Action evidence matrix

| Action | Entry and access | Producer / reads | Persistence / consumer | Status |
|---|---|---|---|---|
| Preview email | `AwardeeTab.js:607-634` → POST `preview-invite.js:36-69`; app `reviewers`, GUID request, body minimum length; shared origin/session checks | Assigned-PD signature from `resolveSignatureForRequest`; shared invitation HTML renderer; explicitly nonfunctional placeholder portal link | No action-specific token mint, send, activity creation, deliverable write or status change found. Browser opens/writes a preview tab after fetch. | VERIFIED bounded source contract |
| Copy website HTML | `AwardeeTab.js:636-655` → GET `website-html.js:27-67`; app `reviewers`, GUID request | `assembleGranteeDocument` reads stored request/account/PI+Co-PI/package values; approved abstract preferred, formatted draft fallback | No action-specific business write or publication. Returns one HTML fragment, includes private image reference only as an escaped staff comment; UI textarea and clipboard write/fallback. | VERIFIED bounded source contract |
| Cycle export | `AwardeeTab.js:1368-1376` → GET `cycle-export.js:28-72`; app `reviewers`, valid cycle and configured research program list | `exportGranteeCycle:58-105` queries cycle + Active + PI present + research program, excluding ordinary test requests, then bounded assembly | Returns standalone HTML across the eligible cycle, not only the current request/PD. No action-specific business write found. Browser tab/print is separate from website publication. | VERIFIED bounded source contract |
| All three require a mutation-status gate | Historical memory tail versus current handlers | Render/read-only business pipelines above do not perform the writes protected by Send/Regenerate/Save guards | Auth/input/DAL requirements still apply; absence of lifecycle mutation guard is not absence of access control. | Broad claim refuted; narrower exception retained |
| Every single-request output enforces research/award eligibility | Spec's old cross-cutting claim versus Preview/website routes | Those routes validate a request GUID; assembler select has no program/status filter. Cycle query does enforce its cohort. | Product intent is not a server predicate. No new runtime gate authorized. | STALE universal enforcement claim |
| Reviewer preview mode disables Awardee mutations | `pages/workbench/[requestId].js:85,295-303` | `previewReadOnly` applies to Reviewers/Reviews; Awardee receives request/context, keyed by request ID | No Awardee read-only prop or global disabled fieldset established. | Refuted as a blanket UI guarantee |
| Pending Preview/Copy cannot affect browser state after navigation | Awardee handlers and keyed parent | Neither handler checks mounted/current request/attempt after its fetch before opening a window or writing clipboard | Keyed remount protects the new component's state, but cannot cancel old external browser effects. | SOURCE-CONFIRMED missing cancellation guard; occurrence not reproduced |

Full source paths: UI `shared/components/workbench/AwardeeTab.js`; routes under
`pages/api/workbench/grantee-deliverables/`; cycle service under
`lib/services/workbench/grantee-deliverables/cycle-export-service.js`; assembly
`lib/services/grantee-document-assembly.js`; renderer
`lib/services/grantee-document-html.js`.

## Mechanism, output integrity and limits

When authentication is required, `requireAppAccess`
(`lib/utils/auth.js:311-403`) checks origin, session, linked
profile, fresh active/superuser state, and app grants. It contains no
read-only-role/method/path exception allowlist. The three routes use
`withDalContext`; older matrix references to `bypassDynamicsRestrictions` were
stale implementation pointers. Neither trusted DAL context nor a read/render
description grants new data access outside the actual route guard.

Preview reuses the invitation renderer with a placeholder and resolved signature.
It is a formatting aid, not an immutable send receipt: it does not bind the
later body, recipients, signature or generated live link. The route test mocks
signature resolution; its “no Dataverse access” header overstates what that
mocked test proves, because signature resolution reads server data. Source/test
files remain unchanged in this documentation-only pass.

Assembly (`:115-186`) reads current stored fields, not unsaved editor text.
Caption/body are sanitized by the shared Markdown renderers and plain structural
fields are HTML-escaped. Private image references are not public image URLs;
actual image placement/public serving is separate. Shared assembly gives common
field selection/formatting, not an atomic snapshot across separate requests.
Account read failure may omit location while preserving the formatted name.

Cycle assembly (`cycle-export-service.js:33-49`) skips an award whose assembly
throws or returns null. A successful HTML response is therefore not proof that
every matched award is present. The renderer (`:77-79`) warns about query caps;
that is distinct from a per-award assembly omission. This is the documented
fail-soft behavior, not an undisclosed write path or permission defect.

## Owner decisions and historical evidence

`GRANTEE_PORTAL_SPEC.md` D3 preserves staff-initiated workflow eligibility rather
than universal proposal-status keying; D5 preserves research-only product intent.
The historical `GRANTEE_PORTAL_BUILD_PLAN.md:303-308` deliberately records no
server-side Research gate for the S268 send workflow and defers revisiting it if
the surface widens. That historical decision is not automatically a waiver for
every later route, but prevents labeling the missing filter an unintended defect
without checking scope. Current Preview/website reads have no such filter; cycle
export has an explicit query predicate. Documentation now states that distinction.

The S411 Send/Regenerate/Save examples remain owner incident history. They do
not authorize all future guards to be removed or added mechanically. Other
owner holds and the owner-review-burden memory remain untouched.

## Durable restatement disposition

| Surface | Classification | Action |
|---|---|---|
| UI/server-guard feedback memory's “read-only and need no gate” tail | STALE scope | Retain no lifecycle mutation gate; state auth/validation and local effects |
| API matrix Preview/website/cycle context pointers and broad scope language | STALE | Use actual DAL wrapper and per-action inputs/cohort/output limits |
| Grantee portal spec's universal research-only enforcement claim | STALE | Preserve product intent and distinguish actual action predicates |
| S268 send-workflow decision section in the historical grantee build plan | HISTORICAL | Retain dated decisions and rollout evidence; not fresh hosted proof |
| Awardee implementation memory and relevant output/visibility notes | AGREE within named source scope | No blanket read-only/cancellation guarantee inferred |
| Other Preview/Copy/Export or deployment Preview occurrences | UNRELATED / outside scope | Do not substitute by keyword or generalize these findings |

Searches covered docs, memory, wiki, root/session instructions, rules/skills and
source/tests. These are grouped dispositions, not an exhaustive per-sentence
census. Every edited durable target was whole-read by its editing agent; source
regions and callers were read for the actual claims. No present deployment,
tenant data population or real browser action was probed.

## Prioritized next work

1. **P1 — retain prior safety findings.** The PI role selection conflict and
   shared-person identity-field/decision ordering gap remain open in the linked
   [identity/COI audit](identity-coi-referral-provenance-audit-2026-10-22.md).
2. **P2 — pending browser output after navigation.** Add focused tests that start
   Preview/Copy for request A, navigate/unmount or start another attempt, then
   resolve A. Assert external window/clipboard calls, not only React state.
   Choose a current-attempt/cancellation contract before changing runtime behavior.
3. **P2 — research scope at direct reads.** If stronger eligibility enforcement
   is desired, compare the historical deliberate gate omission with present
   direct-request access and obtain a scoped product decision. No implicit new
   program/status restriction is proposed by this audit.
4. **P2 — export completeness and preview semantics.** Establish whether staff
   need explicit per-award assembly-omission reporting or bound preview/send
   evidence. Existing cap warning and shared renderer do not prove those contracts.
5. **Next audit — remaining exceptions.** Inventory other read/render-labelled
   affordances against their actual handlers, including shared helpers that can
   mint tokens, record access, create drafts, cache files or trigger work. This
   three-action result grants no blanket exemption to those paths.

Recommendations have local source prerequisites; cancellation races, stricter
eligibility and completeness alternatives were not implemented or reproduced.
Verdict: **READY WITH NAMED TEST/DESIGN FOLLOW-UPS**, not runtime remediation.

## Parent verification

The parent reviewed all three Luna diffs and the action handlers, route shells,
assembly, HTML renderer, auth function and cycle service branches. Sol provided
an independent UI/report challenge. Review corrected the browser-tab location,
preview/send parity overstatement, cycle completeness/scope wording and auth
precondition scope. Historical S268 decisions and S411 incident context remain;
no new program/status or read-access policy was inferred from the findings.

Eight existing focused suites passed, **182 tests**: Preview route, website route,
cycle route/service, document assembly/HTML, Awardee tab and reviewer preview
safety. Their controlled mocks and fixtures cover normal, validation, render,
fallback, cap and fail-soft cases; they do not reproduce late navigation effects,
exercise current tenant access or establish complete real-cycle output.

Agent-invariants, memory-router, fact-consistency, canonical-pointers,
doc-symbol-refs, build-claim-freshness, doc-currency, API-route matrix,
docs-catalog and harness-framing checks passed with applicable self-tests after
their gates. Fixture-writing checks ran serially. Existing memory-router
MaxListeners and three external-materials guard-recognition warnings remain
advisory. `git diff --check` passed. No executable/test/JSON/schema file changed.

Final target review leaves the three corrected documentary scope claims without
the old contradictory instructions. Other read/render-labelled actions and
current hosted state remain unverified; this is not whole-repository closure.
Unrelated critique, `output/` and the owner-review-burden memory remain untouched.
Work is local only; no push/deployment. Verdict: **bounded documentary repairs
reviewed; named runtime follow-ups open; wider audit INCOMPLETE**.
