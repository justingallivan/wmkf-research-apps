---
title: "Connor email — P1-Update core-gate test (DRAFT, not yet sent — S163, 2026-05-18)"
domain: intake-portal
kind: draft
status: draft
summary: "Send-ready. Consistent with the committed handout INTAKE_PORTAL_ITEM_6_CONNOR_CORE_GATE.md and the locked Select-columns=blank decision. Attach..."
canonical: false
cataloged: 2026-07-02
owner: product-engineering
---

# Connor email — P1-Update core-gate test (DRAFT, not yet sent — S163, 2026-05-18)

Send-ready. Consistent with the committed handout `INTAKE_PORTAL_ITEM_6_CONNOR_CORE_GATE.md` and the locked Select-columns=`blank` decision. Attach that handout when sending.

---

**To:** Connor
**Subject:** ~30-min Power Automate maker-portal test — last gate before the intake-portal schema deploy

Hi Connor,

Thanks for the deactivate-not-delete ruling on Item 6 — that resolved the design cleanly. It leaves exactly **one** thing to verify before we can deploy the slice-0 schema, and it has to be done in the maker portal (we can't answer it from our side). Attached is a self-contained runbook: **`INTAKE_PORTAL_ITEM_6_CONNOR_CORE_GATE.md`**.

**What you need (no codebase/repo access — purely Power Platform):**

- The attached runbook (exact PATCH bodies, filter expressions, and flow config are all in it — you won't need anything else).
- Sandbox Dataverse + maker-portal access: create a cloud flow (Dataverse trigger), create/update/deactivate/reactivate child rows, read flow run history + raw trigger outputs.
- A way to send authenticated Dataverse Web API PATCH calls (Postman / curl / XrmToolBox / a PA HTTP action).
- Dataverse metadata read, to fill the Step 2 placeholders.

If `wmkf_proposalbudgetline` isn't in the sandbox yet, the runbook's **proxy path** (Step 1) lets you run it on any existing parent→child pair — still valid, just flagged as proxy-strength.

**The question (P1-Update):** With the recompute flow triggering on a child **Update whose only change is `statecode`→Inactive**, does a trigger-condition filter that traverses the child→parent lookup to filter on parent `akoya_requeststatus = 'Phase II Pending'` actually bind and fire correctly — firing exactly once when the parent is `Phase II Pending`, and **not** firing during the pre-submit drain window?

**What to run — the core gate, ≈20–35 min** (full step-by-step in the runbook, Steps 1–12):

1. Build one Dataverse-trigger cloud flow (Change type = Modified) with the parent-status filter (Steps 1–6).
2. **Step 7** — child under a *pre-submit* parent, Web API PATCH `{"statecode":1,"statuscode":2}` → expect **zero** runs.
3. **Step 8** — child under a *Phase II Pending* parent, same PATCH → expect **exactly one** run, `SdkMessage` literally `Update`, correct parent attribution.
4. **Step 9** — 3 active children under one Phase-II parent, deactivate one → confirm a List-rows query returns only the two still-active children.
5. **Step 10 — skip it.** Production is leaving the trigger's Select columns **blank** (a locked design decision); just record "Step 10 SKIPPED — production Select columns blank" per the runbook and move on. (Step 10 stays in the doc only as a guardrail in case that decision is ever reversed.)

**Pass bar (one sentence):** On the real `wmkf_proposalbudgetline`, the deactivation PATCH produces **zero** runs under a pre-submit parent and **exactly one** attributable `SdkMessage == Update` run under a `Phase II Pending` parent, and the active-child query in that run excludes the just-deactivated row.

**Why it matters / timing:** a clean result clears the last pre-deploy gate for the slice-0 schema. A **fail is equally useful** — it just routes us to a drain-side fallback with zero schema rework, so don't worry about "breaking" anything by reporting a negative result. Soft target was 2026-05-19; whenever you can fit the ~30 min is appreciated.

**What to send back:** the Step 11 checklist — please paste raw `SdkMessage` literals, run IDs, and trigger-output snippets **verbatim** (don't summarize) — plus the Step 12 verdict line. Happy to hop on a call if any step is ambiguous.

Thanks,
Justin
