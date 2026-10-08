# Claude Opus review receipt — Proposal Ranking

Date: 2026-10-07. Reviewed design: `docs/plans/PROPOSAL_RANKING_DESIGN_2026-10-07.md`.
Actual model reported by Claude CLI: `claude-opus-5-5`. Outcome: success.
Authentication: verified Claude OAuth session; user explicitly approved external
review and potential usage costs. Review used Read/Grep/Glob only; no implementation
or live-system probes were performed. The text below is the reviewer output, not
an accepted implementation specification.

## Codex reconciliation notes

- The high-level verdict is useful: exact eligibility, operational recovery, and
  authorization/storage details need specification before building.
- B3 identifies a legitimate privacy boundary to review, but its proposal to rely
  on service-account fallback is **not accepted**. Existing impersonation, DAL,
  and fail-closed rules must be preserved. Row ownership/sharing and table roles
  need a concrete design; neither privacy nor a bypass is established by this review.
- B4's requirement that the default CSO be on the ranking roster conflicts with
  the agreed separation of facilitator and voter. The CSO may facilitate without
  a vote; replacement facilitators must come from the roster. Beth currently
  appears in the roster through proposal assignments (owner-provided fact).
- B5's description of the admin editor must be qualified: its preflight set-version
  comparison is not an atomic parent-list fence, but its changeset operations
  do have per-row If-Match protection. The design already proposes a new parent
  version fence; do not characterize the existing editor as wholly unprotected.
- B2's excusal/void options, S3's independent program generation, and superuser
  privileges remain recommendations, not owner-approved changes.
- The existing design already distinguishes requested amount from total project
  budget and requires currency compatibility. S5 is a verification item; do not
  silently substitute another money field. No currency metadata was probed here.

## Independent reviewer output (verbatim)

# Proposal Ranking design review

**Reviewed:** `docs/plans/PROPOSAL_RANKING_DESIGN_2026-10-07.md`, read in full, plus the cited sources and the code next to them. I used read-only tools only. Nothing is implemented yet, so every finding is about the design.

## Verdict: revise before build

The overall direction is sound and simple. It reuses the existing app, auth and Dataverse layers. Records are fixed per round, saves send the whole list with a version check, and the editable meeting order is kept separate from submissions. I agree with all of that and none of the agreed product decisions needs to change.

Five contracts are still undefined, though, and each one would force a guess during schema or service work:

- which proposals are eligible
- who opens a round, and what happens if a PD never submits
- privacy at the Dataverse table level
- how the facilitator is identified and who may change them
- how creation is made idempotent and how list order is stored

I could verify every source finding in the design's table. Where something below could not be verified, it is marked **Uncertain**.

---

## Build-blocking findings

### B1. The Phase II eligibility rule is not defined
*Sections: Agreed decisions (Pool); Source findings, row 5.*

- **Verified:** the only existing rule is the Workbench one: `akoya_requeststatus eq 'Phase II Pending' OR triage = Advancing`, with set-aside handling (`shared/config/workbenchVisibility.js:9-16`).
  - The "Advancing" part exists to pick up rows that were still `Phase I Pending` before the formal status change (`shared/config/d26Allowlist.js:15-25`, `shared/config/triageStatus.js:9-12`).
  - The design correctly says this is not automatically the ranking rule, but it never states the replacement.
- **Verified:** `akoya_requeststatus` is a stored text value, not a picklist (`workbenchVisibility.js:23-25`). "Must not depend on UI wording" can't be fully met: if Akoya renames the stage, the stored value may change too. The only protection is one shared constant plus a loud failure.
- **Uncertain (needs owner input and a probe):**
  - Are proposals deferred from an earlier cycle and re-dated into this one (`Phase II Deferred`) part of the pool?
  - Do set-aside or untriaged rows matter, given triage is documented as dashboard-only?
  - Has the D26 cycle actually been moved to `Phase II Pending` yet?
- **Minimal fix:**
  - Write the rule down: ordinary (non-test) requests where `akoya_requeststatus = <exported PHASE_II_PENDING constant>`, `_akoya_programid_value` is SE or MR, the cycle comes from `wmkf_meetingdate`, and triage is ignored.
  - Export the constant that is currently private in `workbenchVisibility.js:9` instead of copying the string.
  - Opening a round must fail loudly if the cycle has research requests but none match.
  - The owner confirms how deferred and triage rows are treated.

### B2. Who opens a round and when, and what happens if a PD never submits
*Sections: Agreed decisions (Participants, Submission); "Planned end-to-end contract"; Build step 3.*

- **Verified gap:** the design says generation needs every rostered PD to submit, reopening is out of scope, and the roster is fixed at opening. Nothing says who opens the round or when.
  - Opening too early fixes the seed with incomplete reviews, because new reviews "must not silently change" the round's inputs.
  - A PD who is away, leaves, or is reassigned blocks generation for that program permanently. The design lists "missing PD assignments, inactive staff" as open, but this case leaves the round stuck, not merely edge-case behaviour.
- **Minimal fix:**
  - (a) Only the facilitator (or a superuser) opens the round, through a deliberate action. A preview before opening shows the proposal count, how many proposals are unscored, and how many reviews are outstanding.
  - (b) **Owner input:** one escape hatch. Before generation, the facilitator may mark a roster PD who hasn't submitted as excused, with a recorded reason; the composite then averages the remaining submissions. This doesn't conflict with "no manual participant selection *required*".
  - (c) **Owner input:** how to recover from a round opened by mistake. An ops-only void of an unpublished round is enough for v1.

### B3. Privacy is enforced only in the API, but PDs also use Dynamics directly
*Sections: Proposed architecture ("subject to schema/security review"); privacy bullets.*

- **Verified:** writes run as the calling user via `MSCRMCallerID` when impersonation is enabled, using the overlap of the user's and the app's privileges, with a fallback (`lib/services/dynamics/write-core.js:57-82`).
- **Inference:** if staff security roles get table privileges so those writes succeed as the user, PDs could likely read every individual list in Dynamics (Advanced Find or views) before publication. That would defeat "server-side enforcement" and the agreed "PD sees only their own lists".
- **Minimal fix (engineering):** state that the ranking tables give staff security roles no read privilege. Only the app's service account reads them. PD identity goes in an explicit column, not in `createdby`.
  - Either let writes take the service-account fallback, or call the write path with `noFallback` turned off and no caller ID.
  - Add an item to the security review: confirm that no staff role, including grants-manager and system-customizer roles, can read the tables.

### B4. How the default facilitator is identified, and who may change the facilitator
*Section: Agreed decisions (Default facilitator).*

- **Verified:** the source has no CSO or facilitator setting. Beth appears only in a profile remap in `lib/services/dataverse-identity-map.js:24`.
- Participant identity should be the Dynamics user ID from `_wmkf_programdirector_value`, which is the lead PD only; the secondary PD is excluded (`lib/services/reviewer-finder/my-proposals-service.js:14-15`). The design never names this field.
- **Minimal fix (engineering):**
  - Set the default facilitator as a configured Dynamics user ID, not a name or email.
  - If that ID isn't on the fixed roster (for example, Beth leads no proposals in that cycle), opening requires choosing a facilitator from the roster explicitly.
  - Compare identities as lowercase GUIDs.
- **Owner input:**
  - Who may change the facilitator: only the current facilitator, or a superuser too?
  - Is it allowed after generation? Changing it moves visibility of all draft lists and unpublished composites to the new person.

### B5. Atomic and idempotent writes need specific Dataverse choices
*Sections: Logical records; "Whether positions use child rows…"; contract bullets on version checks and repeats.*

- **Verified:** a changeset is atomic, and each operation can carry its own `If-Match`, but created-row IDs are not returned (`lib/services/dynamics/changeset.js:66-78`).
- **Verified:** the review-question "version" is computed on read and compared before writing (`lib/services/admin/review-questions-service.js:124-137`). That leaves a gap between check and write, so it is not a real version check. Don't copy it for the list-level check.
- **Minimal fix (engineering):**
  1. Store each list's order as an ordered array of `akoya_requestid` values on the list row. The row's ETag is then the version, and save, submit and publish are each one conditional PATCH. Child position rows would need a separate parent version bump in every changeset, which adds work for no benefit at roughly 20–40 IDs per list.
  2. Use alternate keys so repeated actions can't create duplicates:
     - round on (cycle)
     - individual list on (round, program, PD)
     - composite/meeting list on (round, program)

     A repeated create returns the existing row. Alternatively, create everything in one changeset with GUIDs generated by the app.
  3. Create all individual lists when the round opens, in the same changeset as the round, rather than on first save. That avoids two devices racing to create the same list.

---

## Should fix before build

### S1. Which external scores count and how they are read
*Sections: Proposed details (Seed order); Source findings, rows 6–7.*

- **Verified:** a review counts as submitted when `wmkf_reviewreceivedat` is set (`reviewers-service.js:417, 454`). An informal or no-rating receipt has a null `overallAssessment` (`review-answer-snapshot.js:22-40, 110-113`).
- **Verified:** the scale is 5–1 (`review-form-schema.js:129-140`). Each saved answer row also stores its own option list (`review-answer-snapshot.js:139`), so the scale can be checked per row instead of assumed.
- **Verified:** test reviewers are marked with `wmkf_issyntheticreviewer` behind a feature switch (`test-requests/isolation.js:63-80`). The design mentions test-request isolation but not synthetic reviewers.
- **Minimal fix:**
  - Score basis = received, non-synthetic reviews whose `overallAssessment` row's stored options match the 5–1 Excellent→Poor scale.
  - A proposal is "Not scored" if no review qualifies.
  - A row whose option list is missing or different fails the round opening with a named error, rather than being averaged.
  - Save the score basis with the round: mean, count of rated reviews, count of received reviews, and the distribution.
- **Owner input (optional):** mean-only seeding is labelled as not separately approved, and a single 5 outranks four 5s and a 4. Showing the count is probably enough; just confirm it.

### S2. Snapshot or live values on cards
*Section: Proposed details, last bullet.*

The score summary must come from the snapshot, because it explains the frozen seed order. Showing live scores next to it would contradict the order.

**Owner input** is only needed for amount, title and organization. I recommend snapshotting all card fields at opening for v1, since it's simplest and keeps everything consistent.

### S3. Exposure and generation should be gated per program
*Sections: Agreed decisions (Generation, Publication); privacy bullets.*

The design doesn't say whether publishing SE exposes MR's named individual ranks.

- **Minimal fix:** publication, exposure of named ranks, and spread/disagreement data are all controlled per program.
- **Owner confirmation:** may SE be generated once all SE lists are submitted, even if MR isn't finished? I recommend yes.

### S4. Submit and save racing each other; serializing client saves
*Section: contract bullets ("Serialize client saves").*

- Submit should be one conditional write containing the final order, the version the client last confirmed, the submitted status and the submission time. The client waits for any in-flight save to finish first.
- Every server write to a submitted list is rejected.
- **Verified:** the existing scheduler blocks further changes while a save is busy (`SessionEditor.js:571-591`). For quick repeated drags, keep only the latest pending order and send it after the in-flight save confirms, using the returned ETag. An uncertain outcome is resolved by reading back and comparing the order.

### S5. Summing requested amounts
*Sections: Card contents; Proposed details (Missing amounts).*

- **Verified:** the requested amount is read from `akoya_request` (`resolve-request-service.js:35-40, 116`).
- **Uncertain:** the comment there says the `_base` fields are the transaction-currency copies. In standard Dataverse it's the other way round: `_base` is the organization's base currency.
- **Minimal fix (engineering):** sum `akoya_request_base`, or confirm the request's transaction currency is the same across the pool when the round opens and fail if not.
- Add a step-1 probe check that `akoya_request` holds the Phase II amount for the target cycle.

### S6. Tie-breaking must be deterministic
*Sections: Approved defaults (Ties); Proposed details (request-number ordering).*

- **Verified:** `akoya_requestnum` is a text field (`d26Allowlist.js:32-33`). Sorting it as text gets the order wrong when the numbers have different lengths. Sort numerically.
- Detect composite ties by comparing the integer sums of positions, which is exact because every PD has equal weight, not by comparing floating-point averages.
- Tied composite rows are displayed in seed order. State this explicitly, since "initial order" is currently ambiguous.

---

## Lower priority

- **P1. Pool changes after opening** (owner): for example, a withdrawal. Recommended: keep the row and accept it as fixed for v1. Showing a live status badge would add a live read, so I'd skip it.
- **P2. Superuser access:** the design should say explicitly that superusers who aren't on the roster can't see private lists. That matches the agreed "visible only to the facilitator" and is an engineering clarification.
- **P3. Edge cases:**
  - A program with no eligible proposals creates no lists and needs no generation.
  - A roster of one PD makes the composite equal to that PD's list, with no disagreement highlight.
  - `ceil(n/4)` with n ≤ 3 highlights any variation, which is acceptable.
- **P4. One record per (round, program) for composite and meeting list:** keep the calculation fields (averages, ranges, source list IDs, baseline order) unchanged after generation, and keep the meeting order editable on the same row.
  - Publishing is a conditional PATCH on the version the facilitator last saw, so what gets published is exactly what they reviewed.
  - Because submissions can't change, storing the source list IDs is enough; storing their versions adds nothing.
- **P5. Incomplete reads:** a capped or paged read during opening must fail, as `listCycles` already does (`dashboard-service.js:146-150`). The design says this in general terms; make it a test in build step 2.

---

## Who decides what

| Owner input | Engineering decision |
|---|---|
| B1: deferred and triage rows in the pool; status timing for D26 | B1: the shared constant and the loud failure |
| B2: excuse a PD who hasn't submitted; voiding a mistaken round | B2: opening authority and preview (unless the owner objects) |
| B4: who changes the facilitator, and when | B3, B4 (configured ID, roster check), B5 |
| S2: snapshot or live amount/title/organization | S1 (score basis), S4, S5, S6 |
| S3: generate per program; S1: confirm mean-only seeding (optional) | P2–P5 |
| P1: pool changes after opening | |

**Not raised as findings, because they are owner-approved or deferred:** live synchronization, notes, budget cutoffs, a cross-program list, reopening submissions, facilitator visibility of draft lists, and the facilitator's own vote as a PD.
