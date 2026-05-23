# Connor email — drain critical path: 4 questions (DRAFT — S180, 2026-05-23)

Send-ready. Same shape as the prior `INTAKE_PORTAL_ITEM_6_CONNOR_EMAIL.md` —
specific asks with reply templates, no codebase access required.

---

**To:** Connor
**Subject:** Intake-portal drain — 4 questions blocking the last two state transitions

Hi Connor,

The intake-portal drain shipped 5 of the 7 state transitions this week — applicant submits land cleanly through to **dynamics_patched (budget-lines half)**. The remaining two transitions are blocked on answers only you can give. None of these need code from you (no PA flow work to do); the answers go straight into the drain configuration.

**Current drain state machine (live on `main`):**

```
queued → scanning → request_created → files_moved → dynamics_patched (budget-lines)
                                                                ↓
                                                  [parks: persons + parent aggregates,
                                                          waiting on Q2 + contact-resolution]
                                                                ↓
                                                  [status_flipped]    [completed]
                                                     ↑ waits on Q1
```

A row that finishes the budget-lines half currently parks for 1 hour with a `system_alerts` warning; when your answers land, the unpark SQL in `docs/INTAKE_PORTAL_DRAIN_PLAN.md` §"Phase B deploy handoff" wakes them up.

---

## Q1 — Source picklist field for portal-submitted single-phase requests

**Background.** `akoya_request.akoya_requeststatus` is a **derived** string rollup (per `INTAKE_PORTAL_ITEM_6_STATUS.md:103-119`). The source-of-truth picklists are `wmkf_phaseistatus` (S/T: `wmkf_PhaseIStatus`) and `wmkf_phaseiistatus` (S/T: `wmkf_PhaseIIStatus`). With the single-phase pivot, there's no Phase I/II distinction — so we need to know which picklist (and which value on it) represents "applicant submitted via the portal, awaiting staff/committee review."

**What we need from you (all four):**

1. **Field logical name** the drain should PATCH (`wmkf_phaseistatus`, `wmkf_phaseiistatus`, or something new).
2. **Option integer value** for the post-portal-submit / pre-committee-review state.
3. **Display label** (so the AkoyaGO views show it in plain English).
4. **Existing-vs-new** — does this value exist on the chosen picklist today, or do you need to add it?

**Reply template:**

```
Q1.1 field logical name:    wmkf_______
Q1.2 option integer:        ________
Q1.3 display label:         "________"
Q1.4 existing or new:       existing | needs-add-by-me
```

---

## Q2 — PI / contact attribution at parent Create

**Background.** Three contact-role lookups on `akoya_request` are semantically load-bearing (per the institution-foundation-liaison memo at `.claude-memory/project-institution-foundation-liaison.md`):

- `wmkf_projectleader` — PI / scientific lead
- `akoya_primarycontactid` — foundation liaison / steward (NOT the PI)
- `wmkf_researchleader` — institutional research officer

The drain currently does a minimal `akoya_request` Create that sets only `akoya_Account@odata.bind`. It leaves all three PI fields null. Before we wire the persons children (`wmkf_apprequestperson`), we need to know how each of these three should be populated.

**Specific use case:** Jane Doe authenticates against the portal as a Submitter for Stanford. **Jane is not the PI** — she's submitting on behalf of PI John Smith, who appears as a roster row in the form.

**What we need from you (per each of the three fields):**

1. **Exact lookup field name** and the entity each points to (`contact`? `systemuser`? both?).
2. **Required at Create vs. optional** for portal-originated requests.
3. **Source of value:** authenticated portal applicant (Jane)? account defaults? a roster row picked by name match? null-at-Create-fill-later by staff?
4. **Fallback** when the source doesn't yield a value.

**Reply template:**

```
wmkf_projectleader:
  Q2.1 entity:                contact | systemuser
  Q2.2 required at Create:    yes | no
  Q2.3 source:                applicant | account-default | roster-row | null-fill-later
  Q2.4 fallback:              ________

akoya_primarycontactid:
  Q2.1 entity:                contact | systemuser
  Q2.2 required at Create:    yes | no
  Q2.3 source:                applicant | account-default | roster-row | null-fill-later
  Q2.4 fallback:              ________

wmkf_researchleader:
  Q2.1 entity:                contact | systemuser
  Q2.2 required at Create:    yes | no
  Q2.3 source:                applicant | account-default | roster-row | null-fill-later
  Q2.4 fallback:              ________
```

**Why this is on the critical path:** the drain's persons handler (`wmkf_apprequestperson` POSTs) needs to resolve roster rows to `contact` GUIDs. The answers here also determine whether the auth-bridge / contact-resolution service has to handle the parent's PI fields or just the persons children.

---

## Q3 — AkoyaGO staff working-view filters

**Background.** Portal-submitted requests will start appearing in AkoyaGO immediately when each drain tick runs. Without an explicit view filter, they'll mix with staff-created requests and could confuse the review workflow.

**What we need from you:**

1. **View names** (system view vs. personal view, with owners) on `akoya_request` that might surface portal-submitted-but-not-staff-reviewed rows. The Q1 picklist value will gate the filter, but we need the view list to know **where** to add it.
2. **Exact filter clause** to add before pilot opens — e.g. "`wmkf_______ NOT EQUAL <Q1 value>`" or equivalent.
3. **Who applies the filter** — you in the maker portal, or do we need to coordinate with the AkoyaGO admin?

**Reply template:**

```
Q3.1 views needing the filter (one per line):
       - ________ (system | personal — owner)
       - ________
Q3.2 exact filter clause:    ________
Q3.3 who applies:            connor | akoyago-admin (name: ____)
```

---

## Q4 — Option A′ recompute-flow gate value

**Background.** Option A′ (the conditional inside the recompute-flow body, per `docs/INTAKE_PORTAL_ITEM_6_STATUS.md`) gates the aggregate recompute on the parent's current status. It runs *after* the parent has been fetched via `Get a row by ID`, then checks whether the parent is in the post-submit lifecycle state we should recompute.

**What we need from you (all four):**

1. **Exact condition expression** in the flow body, e.g.:
   ```
   @equals(body('Get_parent')?['<Q1 field logical name>'], <Q1 integer value>)
   ```
2. **Source field fetched** (matches Q1).
3. **Integer value compared against** (matches Q1).
4. **P4 evidence artifacts** on the real-schema re-run — same rubric as the original core-gate test:
   - Run IDs (the flow run ID for the gate-pass and gate-skip cases)
   - `SdkMessage` literals observed in the run history
   - Parent-lookup GUIDs (the `akoya_requestid` used for each test row)
   - Active-subset list (which child rows the recompute affected vs. left alone)

**Reply template:**

```
Q4.1 condition expression:   @equals(body('Get_parent')?['wmkf_______'], _____)
Q4.2 source field:           wmkf_______       ← matches Q1.1
Q4.3 integer value:          _____             ← matches Q1.2
Q4.4 P4 evidence:
       gate-pass run id:     ________
       gate-skip run id:     ________
       SdkMessage literals:  ________
       parent GUIDs:         pass=________  skip=________
       active-subset rows:   ________
```

---

## What unblocks when answers land

| Answer | Unblocks |
|---|---|
| Q1 | `status_flipped` drain handler (last state transition) |
| Q2 | `wmkf_apprequestperson` POSTs + parent PI fields at Create |
| Q3 | Pilot opening — staff views ready for portal-submitted rows |
| Q4 | Connor's PA recompute flow ships → live aggregate maintenance |

You can answer them in any order; the drain build queues to whichever unblocks first. **Q1 + Q4 are paired** (both reference the same field/value) — easiest to do those together. **Q2 is the largest** because of the three-fields-times-four-questions matrix, but each cell is one decision.

---

**Reply by email or drop the filled-in templates in Teams** — whichever you prefer. No deadline pressure on our side; let me know your bandwidth and I'll plan the build queue around it.

Thanks!
Justin
