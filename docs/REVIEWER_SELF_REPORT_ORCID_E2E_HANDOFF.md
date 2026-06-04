# Handoff: e2e testing for reviewer self-reported ORCID capture (PR4)

**Audience:** Codex, taking over development of the e2e test suite for this feature.
**Author:** Claude (S217). **Branch:** `feature/reviewer-self-reported-orcid` (head `c5e0ec0`, off `main`).
**Status:** feature built + unit-tested + Codex-reviewed (adversarial pass folded); a
manual browser e2e strategy + scaffolding scripts exist; **automating/expanding the e2e is your task.**

---

## 1. Objective

The feature writes to **prod Dataverse on every reviewer Accept/Decline** through the
external magic-link flow. Unit tests cover the pure logic, but nothing exercises the
real **token → Stage 2a form → respond.js → Dataverse** path. We want a repeatable e2e
that proves the self-reported ORCID actually lands on the person + contact in prod (or a
clean equivalent), so this can ship and future reviewer-flow changes don't silently
regress it. Today the e2e has a **manual browser step**; the most valuable thing you can
build is a **headless, scripted** version (see §7) plus the missing variants.

---

## 2. What the feature does (the thing under test)

At Stage 2a a reviewer confirms/corrects their **own** ORCID on the authenticated
magic-link form. Pre-PR4 that value only landed on the engagement row
(`wmkf_appreviewersuggestion.wmkf_reviewerorcid`). PR4 captures it onto the **person** and
the **contact** join key so it feeds the ORCID de-fragmentation flow (PR1/PR2, already
shipped — see `docs/REVIEWER_ORCID_BACKPROPAGATION_DESIGN.md`).

Full design: **`docs/REVIEWER_ORCID_BACKPROPAGATION_DESIGN.md` §14** (read it first).

**Code surface (all verified by reading):**
| File | Role |
|---|---|
| `shared/components/external/Stage2aView.js:385` | the editable **ORCID** form field (prefilled) |
| `pages/api/external/review/[token]/context.js:375` | prefill source: `firstNonEmpty(suggestion.wmkf_reviewerorcid, contact.wmkf_orcid)`; also returns the `_etag` the form round-trips |
| `pages/api/external/review/[token]/respond.js` | accept/decline handler. `selfReportedOrcidOf(body, suggestion)` = `contactEdits.orcid ?? suggestion.wmkf_reviewerorcid`. On accept it reflects a valid self-report onto the in-memory `reviewer` BEFORE honorarium, then calls the capture after; on decline it calls the capture before the decline return. All NON-FATAL. |
| `lib/services/capture-self-reported-orcid.js` | the capture: normalize (checksum) → person `updateById` OVERWRITE `wmkf_orcid`+`wmkf_orcidurl` + `writeIdentityDecision('confirmed')` → contact `setOrcidIfAbsent` (fill-only) |
| `lib/dataverse/adapters/researcher.js` `writeIdentityDecision` / `clearIdentityFields` | the **sticky `confirmed` sentinel**: the resolver never emits `confirmed`, so these refuse to downgrade/clear a `confirmed` record (fail-closed on the status read) |
| `lib/external/verify-suggestion-token.js` | token verify + expands the reviewer with `wmkf_orcid`,`wmkf_identitystatus`,`_wmkf_contact_value` |

**Trust model:** a reviewer self-attestation via authenticated magic link = the
highest-trust ORCID source. It is persisted as `wmkf_identitystatus='confirmed'`, which
the automated resolver must never overwrite (the lynchpin invariant).

---

## 3. Already covered by unit tests — DON'T re-do these, cover the integration instead

- `tests/unit/capture-self-reported-orcid.test.js` — the capture service (valid/invalid/no-contact/no-person, overwrite+confirmed, contact fill).
- `tests/unit/researcher-identity-confirmed-sticky.test.js` — the `confirmed` sentinel guards on `writeIdentityDecision`/`clearIdentityFields`, incl. **fail-closed** on a status-read error.

These mock Dataverse. The e2e must cover what they mock out: **the real token verify →
form/respond contract → live Dataverse writes**, and the cross-component interactions
(honorarium ordering, prefill fallback).

---

## 4. What I already built (scaffolding to build ON, not replace)

Three scripts on this branch (committed alongside this handoff). Each loads `.env.local`
and runs inside `bypassDynamicsRestrictions`.

- **`scripts/pr4-e2e-setup.js`** `--request <GUID|requestNum> --email <proxy@x> --name "..." [--prefill-orcid <id>] [--no-promote]`
  Creates a test person (proxy email), pre-promotes a contact + links it (so the
  contact-write path runs without honorarium), creates a `wmkf_appreviewersuggestion`
  row on the request, mints+stores a token via the app's own `mintAndStore`, prints the
  **localhost magic link** + the ids. `--prefill-orcid` pre-seeds `wmkf_reviewerorcid` to
  test the confirm-without-edit path.
- **`scripts/pr4-e2e-verify.js`** `--person <GUID> [--contact <GUID>] --suggestion <GUID> --expect-orcid <id>`
  Reads person/contact/engagement and asserts the ORCID propagated everywhere +
  `wmkf_identitystatus='confirmed'`. Exit 1 on FAIL.
- **`scripts/pr4-e2e-cleanup.js`** `--person <GUID> --suggestion <GUID>`
  Revokes the token, deletes-or-deactivates the person + suggestion. (Contact is left —
  see §6.)

---

## 5. The current (manual) strategy

1. Add to `.env.local`: `EXTERNAL_LINK_SECRET=<any 32+ chars>` and `NEXTAUTH_URL=http://localhost:3000` (throwaway — see §6).
2. `node scripts/pr4-e2e-setup.js --request <num> --email <fresh-proxy> --name "Ada Lovelace"` → magic link + ids.
3. Run the dev server **on this branch**: `AUTH_REQUIRED=false NEXTAUTH_SECRET=dev-throwaway NEXTAUTH_URL=http://localhost:3000 ./node_modules/.bin/next dev`.
4. Open the link → enter ORCID `0000-0002-1825-0097` → ack policies → **Accept** (opt out of honorarium).
5. `node scripts/pr4-e2e-verify.js …` → expect ✓ PASS.
6. `node scripts/pr4-e2e-cleanup.js …`.

---

## 6. Key facts & constraints (probed ground truth — trust these, they cost time to find)

- **Local-dev hits PROD Dataverse.** There is no isolated test store (a stale sandbox
  exists but lacks the reviewer schema — see memory `project-dynamics-sandbox-state`). So
  e2e data is real prod data; keep it minimal + clean up.
- **`EXTERNAL_LINK_SECRET` can be a local throwaway.** The token is minted (setup script,
  reads `.env.local`) AND verified (dev server, reads `.env.local`) by the **same local
  env**, so it need NOT match the prod secret — any 32+ char value works. `lib/services/external-token.js` enforces the 32-char minimum.
- **`buildExternalUrl` uses `NEXTAUTH_URL`** (`lib/external/token-lifecycle.js`). Set it to
  `http://localhost:3000` locally, or build the URL yourself from the jwt.
- **Contact has no DeleteAccess** for the app user (memory `project-contact-promotion-permission`);
  `findByEmail` ignores `statecode`. ⇒ **use a fresh proxy email per run** or the promoted
  contact from a prior run is reused (and can't be torn down).
- **Accept requires** active COI + AI-use policy versions (`getActivePolicies` in respond.js —
  they exist in prod), the form's `policyAcks` for each `STAGE_2A_POLICY_SLOTS` slot, and an
  **`If-Match`** header carrying the `_etag` from `/context` (optimistic lock). A raw POST
  must replicate all three (see §7).
- **External routes are public** (allowlisted in `proxy.js`), so the reviewer form works
  even with auth on.
- **Honorarium runs on accept unless opted out**, and creates a BILL vendor + a honorarium
  `akoya_request` (chunk-4). For a clean capture-only test, **opt out** (and pre-promote
  the contact in setup). For the #2-interaction test, leave it on.
- Primitives to reuse: `mintAndStore`/`revoke`/`buildExternalUrl` (`lib/external/token-lifecycle.js`),
  `reviewer-suggestion.upsert` (`:222`), `potential-reviewer.upsertByEmail`/`setContactLink`,
  `contact.findOrCreateByEmail`/`setOrcidIfAbsent`, `normalizeOrcid` (`lib/utils/orcid-normalize.js`).
- Entity sets: `wmkf_potentialreviewerses`, `wmkf_appreviewersuggestions`, `contacts`, `akoya_requests`.

---

## 7. Suggested work (the actual ask)

**A. Headless e2e (highest value — removes the browser).** Replicate the form's API
contract instead of a browser:
  1. mint a token (reuse setup).
  2. `GET /api/external/review/<token>/context` → grab the `_etag` + the policy version
     ids the form would ack.
  3. `POST /api/external/review/<token>/respond` with `{ action:'accept', contactEdits:{orcid},
     policyAcks:{<slot>:true,…} }` and the `If-Match: <etag>` header.
  4. run the verify reads.
  Read `respond.js` + `context.js` for the exact `policyAcks`/`contactEdits`/header shape
  (don't guess — the slots + etag plumbing are explicit there). This can run against a
  local dev server (fetch `http://localhost:3000`) OR, if you can import the handler logic
  directly, as a supertest-style integration test. Either way it becomes a single
  `node scripts/pr4-e2e.js` or a jest integration spec.

**B. Cover the full matrix** (today only "typed accept" is documented):
  | case | how | assert |
  |---|---|---|
  | typed accept | enter iD in form / POST `contactEdits.orcid` | person+contact+engagement = iD, status `confirmed` |
  | confirm-without-edit | `--prefill-orcid`, then accept sending NO `contactEdits.orcid` | still propagates (the `wmkf_reviewerorcid` fallback — Codex #3 fix) |
  | decline | action `decline` + a self-report | person (+contact if promoted) captured |
  | honorarium-on interaction | don't opt out; reviewer had a DIFFERENT prior resolver iD | self-report wins on person; contact carries self-report (no fill-then-conflict — Codex #2 fix) |
  | sticky guard (regression) | after a `confirmed` capture, run an enrich/resolver pass that computes a sub-`probable` verdict on that person | the `confirmed` status + ORCID are NOT wiped (Codex #1 / the lynchpin) |

**C. Robustness**: make cleanup idempotent; consider a `--dry-run` on setup; tag test rows
distinctly (the setup already stamps `wmkf_sources='pr4-e2e-test'` + a dated label) so a
sweep can find orphans.

**D. CI consideration**: a prod-touching e2e can't run in normal CI. Decide whether this is
a **manual gated script** (documented, run before reviewer-flow releases) or whether the
headless variant can run against a disposable fixture. Lean manual unless you find a clean
isolated store.

---

## 8. Verify-time assertions (what "passing" means)

After an Accept with self-reported ORCID `X`:
- `wmkf_potentialreviewers.wmkf_orcid == X` AND `wmkf_orcidurl == https://orcid.org/X` AND `wmkf_identitystatus == 'confirmed'`
- `contact.wmkf_orcid == X` (when a contact exists) — UNLESS the contact already held a
  *different* valid iD, in which case PR4 correctly logs a **conflict** and does NOT clobber
  (this is intended per §4 of the design — assert "no clobber", not "X wins").
- `wmkf_appreviewersuggestion.wmkf_reviewerorcid == X` (the raw engagement record).

---

## 9. Codex operating notes

- **No outbound network.** Everything you need is in-repo; do not fetch external docs. The
  ORCID/Dataverse calls happen only when a human (or your runtime, if it has the dev server
  + prod creds) actually RUNS the scripts — your job is to author them.
- You share the filesystem with this branch. Build on `scripts/pr4-e2e-*.js`; commit your
  work with the feature branch.
- `git --no-pager diff main..HEAD` shows the full PR4 change if you want the exact diff.
- Honor the project's ground-truth rule: every state claim verified against live code, not
  assumed. The facts in §6 were each read out of the cited files.

---

## 10. Codex addition: headless runner

Codex added `scripts/pr4-e2e.js` plus the `npm run e2e:pr4` alias. This is a manual,
prod-touching rehearsal script, not a CI test. It creates a real test person, contact,
reviewer suggestion, and magic-link token; calls `/context` and `/respond` headlessly;
verifies person/contact/engagement ORCID propagation; then best-effort revokes and
deletes/deactivates the test rows it owns.

Run a local server first:

```bash
AUTH_REQUIRED=false NEXTAUTH_SECRET=dev-throwaway NEXTAUTH_URL=http://localhost:3000 npm run dev
```

Then run one case:

```bash
npm run e2e:pr4 -- --request <GUID|requestNum> --case typed-accept --confirm-prod-dataverse
```

Supported cases:

- `typed-accept` — sends `contactEdits.orcid` and accepts with `honorariumOptOut:true`.
- `prefill-accept` — pre-seeds `wmkf_reviewerorcid`, sends no ORCID edit, and accepts.
- `decline` — sends `contactEdits.orcid` and declines.
- `all` — runs the three cases sequentially with independent test rows.

Safety notes:

- `--confirm-prod-dataverse` is required because this creates real production Dataverse rows.
- Contacts are intentionally left in place, matching the existing cleanup-script constraint.
- Use a fresh proxy email per run, or omit `--email` and let the runner generate one.
- `--keep` skips cleanup for debugging; otherwise cleanup is best-effort and intentionally narrow.

Verification run while authoring:

```bash
node --check scripts/pr4-e2e.js
npx eslint scripts/pr4-e2e.js
npm test -- tests/integration/external-review-routes.test.js --runInBand
```
