---
title: Personal email defaults inventory — Codex Brief (2026-09-24)
domain: platform
kind: plan
status: active
summary: "Codex brief: read-only inventory of every email the app suite sends, recording for each whether the sender gets a shared default, a personal default and an editable preview, and the gap against the owner's personal-defaults requirement."
cataloged: 2026-09-24
last_verified: 2026-09-24
owner: product-engineering
related:
  - docs/plans/PERSONAL_EMAIL_DEFAULTS_TODO_2026-09-20.md
  - docs/plans/MATERIALS_EMAIL_PERSONALIZATION_PLAN_2026-09-20.md
  - docs/EMAIL_SEND_FEEDBACK_AUDIT_2026-09-15.md
  - shared/config/editableTextDefaults.js
---

# Personal email defaults inventory — Codex Brief (2026-09-24)

## Where you are

You are in `/Users/gallivan/Code/WMKF_Apps-codex` on branch
`codex/personal-email-inventory`, cut from `origin/main` at `f1178bfda`. Run
`/start` there. Claude works in the main checkout at the same time on the
sandbox schema-parity branch; **stay on this branch and directory**. Do not
check out other branches, touch the main checkout, merge, deploy, run any
Dataverse/Vercel/production command, or edit `SESSION_PROMPT.md`. Push after
each meaningful commit (`git push -u origin codex/personal-email-inventory`);
pushing a feature branch does not deploy. Record your handoff at the bottom of
this brief.

Use `--model gpt-5.6-sol` if you are asked to choose a model.

## Why (owner, 2026-09-20)

Read `docs/plans/PERSONAL_EMAIL_DEFAULTS_TODO_2026-09-20.md` first; its owner
requirements and interaction contract are settled and not yours to reopen. In
short: every user permitted to use an app can save their own wording for that
app's emails; the send preview stays editable after personal defaults apply;
saving personal defaults is explicit; one send's edits never overwrite saved
defaults or another user's settings; shared Admin templates stay the starting
point. Meeting Tracker's materials invitation and reminder already do this
(PR #320). The open to-do is: "Inventory suite-wide email flows and record each
gap against this requirement." That inventory is this task. **It is read-only:
no code, config, template or test changes.**

## Deliverable

One new document, `docs/plans/PERSONAL_EMAIL_DEFAULTS_INVENTORY_2026-09-24.md`
(same frontmatter shape as this brief), plus, in the TODO doc, ticking the
inventory checkbox with a pointer to it. Nothing else changes.

The inventory has one row per **distinct email a person or job sends**, not per
route. For each row record:

1. **Email** — what it is, in plain words, and its template key if it has one
   (`shared/config/editableTextDefaults.js` registry key, a send-emails template
   id, or "hard-coded in `<path>`").
2. **Where it is sent from** — page/component and API route, or cron/job.
3. **Who can send it** — the app key(s) gating the route (`requireAppAccess`
   arguments, cross-checked against `docs/API_ROUTE_SECURITY_MATRIX.md`), or
   "system job".
4. **Shared default** — is the wording editable by an administrator (where), or
   fixed in code?
5. **Personal default** — can the sending user save their own version? Name the
   store and key if yes.
6. **Editable preview** — does the sender see and edit the message before
   sending?
7. **Content the server must keep controlling** — recipients, links/tokens,
   required items, amounts, dates; anything a personal template must not be
   able to remove or alter.
8. **Gap** — what is missing against the owner requirement, or "meets it", or
   "not applicable" with the reason (for example an automatic system email
   with no human sender).
9. **Evidence** — `path:line` for every claim, labelled `[VERIFIED via …]`.

After the table, add:

- **Shared mechanisms**: the existing preference store(s), preview/send-proof
  pattern and Admin template editor that a bounded follow-up would reuse,
  traced from Meeting Tracker's implementation (read
  `docs/plans/MATERIALS_EMAIL_PERSONALIZATION_PLAN_2026-09-20.md` for where it
  lives). Say where each would need to change to serve another email, without
  designing a generalized editor.
- **Proposed follow-up slices**: a short ordered list of bounded changes
  (one email family per slice), each naming its files, whether it needs a new
  API route or schema (flag either as plan-first), and a one-line "met when".
  These are proposals for the owner; do not start any of them.
- **Residuals**: things you could not determine from source alone, stated as
  open questions, never guessed.

## How to find every email

Start from `docs/EMAIL_SEND_FEEDBACK_AUDIT_2026-09-15.md`, which already holds a
complete send-path inventory as of 2026-09-15; treat it as the seed list, then
verify each entry against current source and look for anything added since.
Grep at least for the send primitives (`createAndSendEmail`, the send-emails
route, Graph `sendMail`, and any other mail transport you find) and for
`email.` keys in `editableTextDefaults.js`. Include cron-triggered and
drain-triggered emails, marking them "system job". Print the denominators:
how many send call sites you found, how many distinct emails they map to, and
how many rows meet, partly meet, or miss the requirement.

## Guardrails

- Derive every identifier (route, key, table, field, app key) from real source
  or the Atlas; never invent one. If something is ambiguous, say so in
  Residuals.
- Do not read or send any email, query Dataverse, or run scripts that touch an
  external service. Unit tests may be run locally if useful; nothing else.
- Keep product copy out of the document beyond short quotes needed to identify
  an email.
- Before handing off, run `npm run check:doc-symbol-refs`,
  `npm run check:build-claim-freshness`, `npm run check:scaffolding-tokens` and
  `npm run check:harness-framing` (each sequentially), and fix any failure your
  document causes.

## Handoff

Codex delivered `docs/plans/PERSONAL_EMAIL_DEFAULTS_INVENTORY_2026-09-24.md`
and ticked the inventory item in
`docs/plans/PERSONAL_EMAIL_DEFAULTS_TODO_2026-09-20.md`. Source-only inventory:
17 transport send expressions map to 56 distinct email cases (22
workflow/diagnostic and 34 conditionally emailed operational notifications).
Four meet the owner contract, nine partly meet it, three miss it, and forty
are not applicable because they have no human sender. No runtime, template,
configuration, test, schema, or production state changed. No email was read
or sent; no Dataverse/Vercel/production command ran.

Verification: all 67 `/start` local `check:*` gate runs, including paired
self-tests, passed before inventory work. The brief's four required final
gates passed sequentially:
`check:doc-symbol-refs`, `check:build-claim-freshness`,
`check:scaffolding-tokens`, and `check:harness-framing`. Citation path/line
validation found 222 valid `path:line` references and 56 numbered rows;
`check:doc-currency` and its self-test also passed sequentially, as did
`git diff --check`. Residual product decisions and source-only limits are
recorded in the inventory's Residual questions section. No follow-up
implementation was started.

Justin explicitly authorized the feature-branch push in this session.
Commit `dcbbda8bc` was pushed to `origin/codex/personal-email-inventory`,
and docs-only Tier 0 PR #329, **Personal email defaults inventory**, was
opened against `main`. The owner will decide whether to merge it. The three
residual product questions were sent to the owner before any follow-up slice;
their answers and the slice order are pending. No slice has started.
