---
title: Personal email defaults inventory — historical Codex brief (2026-09-24)
domain: platform
kind: plan
status: complete
summary: "Historical assignment and handoff for the completed source inventory. Current owner decisions, slice order and PR status live in PERSONAL_EMAIL_DEFAULTS_INVENTORY_2026-09-24.md."
cataloged: 2026-09-24
last_verified: 2026-09-24
owner: product-engineering
related:
  - docs/plans/PERSONAL_EMAIL_DEFAULTS_TODO_2026-09-20.md
  - docs/plans/MATERIALS_EMAIL_PERSONALIZATION_PLAN_2026-09-20.md
  - docs/EMAIL_SEND_FEEDBACK_AUDIT_2026-09-15.md
  - shared/config/editableTextDefaults.js
---

# Personal email defaults inventory — historical Codex brief (2026-09-24)

This file preserves the original read-only inventory assignment and its handoff.
It is historical, not the current work order. The
[`PERSONAL_EMAIL_DEFAULTS_INVENTORY_2026-09-24.md`](PERSONAL_EMAIL_DEFAULTS_INVENTORY_2026-09-24.md)
records resolved owner decisions, bounded follow-up slices, and current PR status.

## Original checkout and constraints (historical)

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

## Original purpose (owner, 2026-09-20; historical)

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

## Original deliverable (historical)

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

## Original search method (historical)

Start from `docs/EMAIL_SEND_FEEDBACK_AUDIT_2026-09-15.md`, which already holds a
complete send-path inventory as of 2026-09-15; treat it as the seed list, then
verify each entry against current source and look for anything added since.
Grep at least for the send primitives (`createAndSendEmail`, the send-emails
route, Graph `sendMail`, and any other mail transport you find) and for
`email.` keys in `editableTextDefaults.js`. Include cron-triggered and
drain-triggered emails, marking them "system job". Print the denominators:
how many send call sites you found, how many distinct emails they map to, and
how many rows meet, partly meet, or miss the requirement.

## Original guardrails (historical)

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

## Inventory handoff and subsequent status

Codex delivered `docs/plans/PERSONAL_EMAIL_DEFAULTS_INVENTORY_2026-09-24.md`
and ticked the inventory item in
`docs/plans/PERSONAL_EMAIL_DEFAULTS_TODO_2026-09-20.md`. Source-only inventory:
17 source-level send expressions map to 56 distinct email cases (22
workflow/diagnostic and 34 conditionally emailed operational notifications).
Four meet the owner contract, nine partly meet it, three miss it, thirty-six
are not applicable, and four automated reviewer cases that can send from a PD mailbox have an
open personal-default policy decision. They have no staff compose action.
The syntax count includes the default
site-visit materials send dependency and two of its callers, rather than 17
independent transports. No runtime, template,
configuration, test, schema, or production state changed. No email was read
or sent; no Dataverse/Vercel/production command ran.

Verification: all 67 `/start` local `check:*` gate runs, including paired
self-tests, passed before inventory work. The brief's four required final
gates passed sequentially:
`check:doc-symbol-refs`, `check:build-claim-freshness`,
`check:scaffolding-tokens`, and `check:harness-framing`. Citation path/line
validation found 222 valid `path:line` references and 56 numbered rows;
`check:doc-currency` and its self-test also passed sequentially, as did
`git diff --check`. Source-only limits, the original questions, and the newly
identified automated-reviewer policy question are recorded in the inventory's
“Questions raised by source-only inspection” section. The owner's answers to
the original questions are in its “Owner decisions” section. No follow-up
implementation had started at this historical handoff.

Justin explicitly authorized the feature-branch push in this session.
Commit `dcbbda8bc` was pushed to `origin/codex/personal-email-inventory`,
and docs-only Tier 0 PR #329, **Personal email defaults inventory**, was
opened against `main` and remains unmerged. Justin then answered the three
product questions and selected the follow-up order recorded in the inventory.
Slice 4, the grantee invitation, was built separately in unmerged PR #330 and
is awaiting owner review; later slices have not started. These later changes
do not alter this brief's original read-only assignment.
