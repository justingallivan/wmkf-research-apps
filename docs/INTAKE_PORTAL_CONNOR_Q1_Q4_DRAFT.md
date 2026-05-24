# Connor email — 4 questions on the portal-to-AkoyaGO handoff (DRAFT — S183, 2026-05-24)

Send-ready. Plain-language rewrite of the S180 draft after feedback that
the prior version leaned too hard on internal subsystem names and
engineering abstractions.

---

**To:** Connor
**Subject:** Intake portal — 4 questions on what a portal-submitted application should look like in AkoyaGO

Hi Connor,

The intake portal can now take an applicant submission and create the matching `akoya_request` in AkoyaGO, along with the budget detail. Before we can finish the last two pieces — adding the project team (the PI and other roster people) and flipping the status so the right committee picks it up — we need your call on four things. None of this requires you to build anything; we just need the answers so we can wire the portal to set the right fields.

---

## Q1 — Which status should a fresh portal submission land in?

When an applicant clicks Submit, the new `akoya_request` lands in AkoyaGO. Right now we'd leave its status blank, but that means it won't appear in any of the committee work queues until someone manually moves it.

We need to know which field and which value represents "applicant submitted via the portal, waiting for staff/committee review." Historically that's been one of the phase status fields (`wmkf_phaseistatus` or `wmkf_phaseiistatus`), but with the move to single-phase submissions there's no Phase I/II split anymore — so it might be one of those repurposed, or a new value, or something else entirely. Your call.

```
Q1.1 field logical name:    wmkf_______
Q1.2 option integer:        ________
Q1.3 display label:         "________"
Q1.4 already exists, or do you need to add it?:  existing | needs-add-by-me
```

---

## Q2 — Who's the PI, who's the contact, who's the research officer?

`akoya_request` has three contact-role fields that matter for downstream routing:

- `wmkf_projectleader` — the PI / scientific lead on the project
- `akoya_primarycontactid` — the foundation's main point of contact at the institution (typically a grants officer or development director, not the PI)
- `wmkf_researchleader` — the institution's research officer / VP for research

In the portal, the applicant signing in (let's call her Jane) is a Submitter for, say, Stanford. **Jane isn't necessarily the PI** — she might be a grants administrator submitting on behalf of PI John Smith, who appears as a row on the project-team form.

We need to know, for each of those three fields:

1. What entity it points to (`contact`? `systemuser`? both?).
2. Whether it must be set at submission time, or can be filled in later by staff.
3. Where the value should come from — the person signing in? a default tied to the institution? a row from the project-team form? leave blank for staff?
4. What to do if that source doesn't yield a value.

```
wmkf_projectleader:
  Q2.1 entity:                contact | systemuser
  Q2.2 required at submission:  yes | no
  Q2.3 source:                applicant | account-default | project-team-row | leave-blank
  Q2.4 fallback if source empty:  ________

akoya_primarycontactid:
  Q2.1 entity:                contact | systemuser
  Q2.2 required at submission:  yes | no
  Q2.3 source:                applicant | account-default | project-team-row | leave-blank
  Q2.4 fallback if source empty:  ________

wmkf_researchleader:
  Q2.1 entity:                contact | systemuser
  Q2.2 required at submission:  yes | no
  Q2.3 source:                applicant | account-default | project-team-row | leave-blank
  Q2.4 fallback if source empty:  ________
```

---

## Q3 — Hiding portal-submitted rows from staff views until they're ready

The moment an applicant submits, the new `akoya_request` will start showing up in AkoyaGO views — which means it'll mix in with staff-created requests in the same lists. Until staff have reviewed it for completeness, that's probably not what you want.

Once Q1 is settled, we can add a "hide rows in this status" filter to the relevant views. We need:

1. Which views (system or personal) should get the filter — basically, anywhere staff look when they want to see "requests that need our attention."
2. The exact filter clause to add (something like "status NOT EQUAL <Q1 value>" or equivalent).
3. Whether you'll apply the filter in the maker portal yourself or whether the AkoyaGO admin needs to do it.

```
Q3.1 views needing the filter (one per line):
       - ________ (system | personal — owner)
       - ________
Q3.2 exact filter clause:    ________
Q3.3 who applies:            connor | akoyago-admin (name: ____)
```

---

## Q4 — Recompute-flow condition + verification

You're building the recompute flow that updates the aggregate fields on `akoya_request` when a child row changes (the one we settled on in the 2026-05-14 sync). The flow checks the parent's status before recomputing, so it only runs on requests in the right lifecycle state — typically the same value as Q1.

What we need:

1. The exact condition expression you used in the flow body.
2. The field it reads (should match Q1.1).
3. The integer value it compares against (should match Q1.2).
4. Test evidence from a real-schema run — same shape as the original core-gate test:
   - The flow run IDs for one gate-pass case and one gate-skip case.
   - The `SdkMessage` literals you saw in the run history.
   - The `akoya_requestid` of the test requests used for each case.
   - Which child rows the recompute affected vs. left alone.

```
Q4.1 condition expression:   @equals(body('Get_parent')?['wmkf_______'], _____)
Q4.2 source field:           wmkf_______       ← matches Q1.1
Q4.3 integer value:          _____             ← matches Q1.2
Q4.4 test evidence:
       gate-pass run id:     ________
       gate-skip run id:     ________
       SdkMessage literals:  ________
       parent GUIDs:         pass=________  skip=________
       affected child rows:  ________
```

---

## What each answer unblocks

| Answer | Unblocks |
|---|---|
| Q1 | Portal can flip the status correctly when an applicant submits |
| Q2 | Portal can populate PI / contact / research officer on the new request, and we can wire the project-team form |
| Q3 | Staff views stay clean once portal submissions start arriving |
| Q4 | Recompute flow ships and aggregate fields stay correct |

You can answer them in any order. **Q1 and Q4 are paired** (Q4 uses the same field and value as Q1, so it's easiest to do those together). **Q2 is the biggest** because it's three fields × four questions each, but each cell is one decision.

---

**Reply by email or drop the filled-in templates in Teams** — whichever is easier. No deadline pressure on our side; let me know when you have bandwidth and I'll plan the work around it.

Thanks!
Justin
