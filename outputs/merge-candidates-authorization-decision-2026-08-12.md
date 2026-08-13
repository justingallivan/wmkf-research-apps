# merge-candidates authorization — proposed decision, for adversarial review

**Date:** 2026-08-12 (Session 422)
**Status:** REVISED after adversarial review. Nothing implemented. No code changed.
**Reviewer question:** are these the right choices? Refute them if not.

## Revision log — Codex adversarial review, 2026-08-12

Three findings; verdict `needs-attention`. Dispositions:

- **Finding 1 (high), access equivalence — RESOLVED, decision A stands.** Codex correctly
  established that `requireAppAccess` is **any-of** (`lib/utils/auth.js:344`,
  `appKeys.some(...)`), so this route admits the legacy `reviewer-finder` grant *or* the
  modern `reviewers` grant (`shared/config/appRegistry.js:337`). `reviewer-finder` is a
  retired app consolidated into the Workbench, whose old grants are still honored
  (`appRegistry.js:170-177`). The live question was whether anyone holds the retired grant
  *without* `reviewers` — such a user would have no Workbench UI but could still reach this
  endpoint. **Owner reports that set is empty (2026-08-12)** — every caller is a current
  Workbench user, which is the population fact 10 describes. `[OWNER-REPORTED, not probed]`
  If that ever stops being true, A must be re-opened.
- **Finding 3 (medium), `computeCanManage` — UPHELD. Decision C was wrong and is rewritten
  below.** The claim that it "guards nothing" was true of merge only and was written as a
  general claim about the helper. It is false generally: verified consumers are
  `ReviewerInvitePanel` (invite actions), `ReviewerDueDateEditor`, `ReviewerFindPanel`
  (manual-creation controls), `ReviewerSearchSection` (candidate-card remedies), and
  `ReviewerManagePanel`, all fed from `ReviewersTab`. Deleting it would strip affordance
  gating from many unrelated write controls.
- **Finding 2 (high), merge race — MECHANISM CONFIRMED, severity reduced to medium, and it
  refutes D's *justification* rather than D itself.** `executeMerge` enumerates once via
  `planMerge` (`reviewer-merge.js:333`) and never re-enumerates before deactivating the
  loser at `:501`, which uses the *loser person* ETag — unchanged by a newly-created
  suggestion row. So a reference created after planning survives the merge pointing at an
  inactive reviewer. Real, but pre-existing, not introduced here, and requiring a write
  inside a seconds-wide window. Keeping the predicate (D) is still correct; the wrong part
  was claiming it bounds blast radius absolutely — it bounds it *as of plan time*. Folded
  into E.

---

## What is being decided

`/api/reviewer-finder/merge-candidates` collapses a duplicate
`wmkf_potentialreviewers` row (loser) into a keeper. It has been carried as an open
security question since S414 (`.claude-memory/project-merge-candidates-authorization-gap.md`).
This document proposes closing it **without adding an authorization check**, and doing
three narrower things instead.

The reviewer should attack both the diagnosis and the proposed response.

---

## Verified facts (all re-checked S422 against source, not from memory)

1. **The route takes no `requestId`.** Body is `{keeperId, loserId, fieldChoices, confirm}`
   (`pages/api/reviewer-finder/merge-candidates.js:31`). Auth is app-level only:
   `requireAppAccess(req, res, 'reviewer-finder', 'reviewers')` (`:23`).

2. **No authorization guard exists in the service layer either.** Grepped
   `lib/services/reviewer-merge.js` for `authoriz|canManage|membership|permission|superuser`
   — zero hits. Every `requestId` in the service is read *off the records themselves*
   (`:197`, `:266`, `:410` via `r._wmkf_request_value`), never supplied by the caller as
   a scope to authorize against.

3. **`actingUserSystemId` is attribution, not authorization.** Threaded into write calls
   beside `ifMatch` ETags at `:375, 381, 394, 432, 464, 482, 501`. Never compared against
   a record, a request, or a permission.

4. **The UI gate fails open by construction.**
   `computeCanManage` (`shared/components/reviewers/reviewer-modes.js:95-97`) returns
   `Boolean(isSuperuser || !pdId || !myUserId || myUserId === pdId)` — permissive whenever
   either id is unresolved. Its own docblock calls it "Cosmetic only … FAILS OPEN".

5. **The operation is destructive and non-transactional.** `executeMerge` hard-deletes
   colliding suggestion rows (`reviewer-merge.js:432`) and deactivates the loser person
   (`:501`). No compensation for a failure after the delete.

6. **The block predicate genuinely narrows the blast radius** (`reviewer-merge.js:227-249`).
   It refuses a loser that is promoted to a CRM contact (`_wmkf_contact_value` set),
   engaged (invited / responded / review or honorarium activity on any request), or holds
   a `confirmed` identity the keeper lacks. Reachable set is therefore
   **pre-engagement, non-promoted, non-confirmed-identity** duplicates only.

7. **The app authenticates to Dataverse as a single service principal**, not as the
   signed-in user: `grant_type: 'client_credentials'` (`lib/dataverse/client.js:56`,
   `lib/services/dynamics/auth.js:59`). Dataverse therefore cannot apply per-user rules
   to any app traffic — there is no user in the request to apply them to.

8. **The in-repo `restrictions` mechanism is not Dataverse security.** It is an
   in-process AsyncLocalStorage row filter (`lib/services/dynamics-context.js:1-35`),
   used mainly by Dynamics Explorer chat; write endpoints routinely call
   `bypassDynamicsRestrictions`.

9. **The plan step shows counts, not identities.** `projectMergePlanForClient`
   (`reviewer-merge.js:292-303`) returns `repointCount`, `collisionCount`,
   `slotRepointCount` and deliberately omits request/suggestion identifiers — the API
   route matrix records this as intentional ("no suggestion/request/ETag internals",
   `docs/API_ROUTE_SECURITY_MATRIX.md:203`).

## Owner-supplied fact (not verifiable from source)

10. **All users have the same Dataverse access.** Every Reviewer Finder user can already
    read and change these same records directly in CRM. Owner's stated concern is not
    malice but that *"these apps might make it easier to do something stupid."*

---

## Proposed decision

### A. Do NOT add a `requestId` + caller-authorization check. Record it as declined.

Reasoning: given fact 10, an app-side scope check blocks in the app exactly what the
same person may do by hand in CRM. It would be a control that constrains the careful
path while leaving the uncontrolled path open — cost and complexity for no reduction in
what anyone can actually do.

Note the reasoning explicitly *depends* on fact 10. Fact 7 means the app layer is the
only place a per-user rule could live; if the access assumption were false, the
conclusion would invert and this would be privilege escalation through the app.

### B. Show what is about to be destroyed.

Change the plan projection to name the affected grant requests rather than counting
them. Today the confirm dialog can say "3 repointed, 1 deleted, 2 slots changed" without
naming a single request.

The data-minimization rationale for the omission (fact 9) does not survive fact 10:
withholding identifiers protects nothing from users who can read them in CRM, while
denying them the context that would prompt a second look.

### C. (REWRITTEN) Keep `computeCanManage`; make its unresolved branch fail closed.

Do **not** delete it — see Finding 3. It is a live affordance gate for invite actions,
due-date editing, manual reviewer creation, and candidate-card remedies, and removing it
would make exactly the mistakes the owner is worried about easier.

The defect is narrower than "cosmetic": it returns
`Boolean(isSuperuser || !pdId || !myUserId || myUserId === pdId)`
(`shared/components/reviewers/reviewer-modes.js:95-97`), so it hides controls from
non-PD staff **when identities resolve** and shows everything **when they don't**. The
fix is to make the unresolved case fail closed rather than open, and to stop describing
the helper as cosmetic in its docblock — that wording is what let the S414 scope document
cite this route's `requireAppAccess` as evidence the merge was safely authorized.

Scope any merge-specific visibility change separately from that change.

### D. Leave the block predicate alone.

It limits damage by what the record *is*, which holds regardless of who clicks. This is
the mechanism actually providing safety and it should not be traded away for a
permission check.

### E. Name, do not bundle, the durability gap — now the largest open item here.

Two related defects, neither introduced by this proposal:

1. The non-transactional cascade (fact 5) can leave a half-merged state with no
   compensation.
2. The plan-time enumeration race (Finding 2): a suggestion row or request slot created
   after `planMerge` is never re-scanned, and the loser is deactivated anyway, leaving a
   live reference to an inactive reviewer.

Adversarial review ranked these above B and C, and that ranking is probably right —
they are the failure modes that corrupt state rather than merely permit a bad click.
Suggested minimum: re-enumerate suggestions and slots immediately before deactivation,
and add a regression test where a new loser reference appears after planning.

---

## Questions for the reviewer

1. Is A wrong? Is there a reason an app-side check earns its keep even when every user
   has equivalent direct CRM access — audit trail, defense in depth against a
   compromised session, protection against scripted misuse of the endpoint?
2. Does B leak anything that matters, or create a surface not considered here?
3. Is C safe — does anything depend on `computeCanManage` that would break, and is
   deleting better than making it honest?
4. Is the severity ranking right? Specifically: is E (half-merged state, no undo) the
   larger practical risk, such that ordering B/C ahead of it is a mistake?
5. Is any verified fact above actually wrong, or too narrowly checked?
