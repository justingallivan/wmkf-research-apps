# Per-PD Custom Grantee-Invitation Email Body + Edit Affordance (S272)

**Status:** PLANNED — Codex pre-impl reviews v1 + v2 folded; ready to implement.
**Owner ask (S272):** Give Program Directors a *saved* custom grantee-invitation
email body, plus a clearer edit affordance on the Awardee tab. Today the body is a
single shared `DEFAULT_BODY` constant in `shared/components/workbench/AwardeeTab.js`,
editable per-send in the "Message" textarea but **not saved** between sends.

This mirrors the S271 unified-signature pattern (one per-user Dataverse preference,
edited in Profile Settings) — see `docs/UNIFIED_EMAIL_SIGNATURE_PLAN.md`.

---

## 1. Goal & scope

1. **Saved custom body.** A per-user preference `grantee_invite_body` holding a
   *body-only* email template. When set, the Awardee tab seeds the Message textarea
   from it; when absent, it falls back to the shared `DEFAULT_BODY`.
2. **Edit affordance.** Make it obvious the existing "Message" textarea *is* the
   editable body: relabel it ("Email body — edit before sending") and add a
   "Reset to default" link that restores the seeded template.
3. **Body-only invariant preserved.** The saved body must NOT contain a signature.
   The server still appends the assigned-PD signature at send/preview
   (`resolveSignatureForRequest` + `appendSignatureBlock`). We do not reintroduce
   the double sign-off fixed in S271 (`ed474d41`). **Invariant is convention-only:**
   `appendSignatureBlock` appends the signature after the body and does **not** strip
   a signature the PD may have typed (verified `lib/services/email-signature.js:86-91`).
   We rely on UI copy to steer PDs away from including one; we do not heuristically
   strip (riskier than the disease).
4. **Drop the `Thank you,` closing from the default body (owner decision S272).**
   The shared default ends at the acknowledgment paragraph + "Please do not hesitate
   to contact me…"; it no longer ends with `Thank you,`. The PD's signature
   (server-appended) is the sole closing. This resolves S272 item #2 (the
   double-closing where the body's `Thank you,` collided with the saved Outlook
   signature) — `appendSignatureBlock` does no closing-dedup
   (`lib/services/email-signature.js:86-91`), so the body must not carry a closing.

**Out of scope:** subject line (stays the shared `DEFAULT_SUBJECT`); the chunk-6
reminder body; the reviewer email templates (`reviewer_email_templates`).

---

## 2. Scope decision: whose body? (RESOLVED — Option A, owner S272)

The signature is resolved **server-side from the assigned PD on the request**
(`_wmkf_programdirector_value` → profile → `email_signature`). The body could follow
either model:

| Option | Body source | Pros | Cons |
|---|---|---|---|
| **A (recommended)** | **Sender's** (logged-in user's) pref, read **client-side** from `ProfileContext` in AwardeeTab | Simplest; zero server/API change — the client already passes `bodyText`; placeholder fill already happens client-side | If PD-A sends an invite for a request assigned to PD-B, the body is PD-A's but the signature is PD-B's (mismatch). In practice sender ≈ assigned PD. |
| **B** | **Assigned-PD's** pref, resolved server-side like the signature | Body+signature always come from the same PD | Requires send/preview routes to fetch the pref and inject into the template server-side; larger change; duplicates placeholder-fill logic server-side. |

**Recommendation: Option A** (owner's stated preference in `SESSION_PROMPT.md`).
The send/preview routes are untouched — they keep receiving the fully-rendered
`bodyText` from the client. Flag the A-mismatch to the owner; it is acceptable
because the sender is almost always the assigned PD.

---

## 3. Current state (VERIFIED via source)

- **`DEFAULT_BODY`** + placeholder helpers (`formatCobDate`, `surnameFromName`,
  `buildDefaultBody`) live **inside** `shared/components/workbench/AwardeeTab.js`
  (lines 26–68). `buildDefaultBody({piName, title, baseDate})` substitutes
  `[Name]` (surname), `[title]`, and `COB [date]` (today + 14d).
- **Auto-fill / manual-edit guard** (AwardeeTab lines 106–113): an effect re-fills
  placeholders when recipients/title load, but only if the user hasn't manually
  edited the textarea. It compares the current body against `DEFAULT_BODY` and a
  ref (`autoBodyRef`) holding the last auto-generated value.
- **Send/preview** (lines 129–170) POST `bodyText: body` to
  `/api/workbench/grantee-deliverables/send-invite` and `.../preview-invite`; the
  server appends the signature. **No server change needed for Option A.**
- **Preference plumbing:** `PREFERENCE_KEYS` in
  `shared/config/reviewerFinderPreferences.js`; read client-side via
  `useProfile().preferences[key]`; written via `useProfile().setPreference(key, value)`
  → `POST /api/user-preferences`. `ProfileProvider` wraps the whole app
  (`pages/_app.js:29`), so AwardeeTab can call `useProfile()` (it does not today).
- **Write gating:** `/api/user-preferences` blocks only `PROMPT_OVERRIDES`
  (`RESERVED_WRITE_KEYS`). A new `grantee_invite_body` key passes the generic
  endpoint with no route change and **no `API_ROUTE_SECURITY_MATRIX` entry**
  (existing route, unchanged contract).
- **Not encrypted (VERIFIED).** `DatabaseService.ENCRYPTED_PREFERENCE_KEYS` is only
  the 5 API-key entries (`api_key_claude`, ORCID id/secret, `api_key_ncbi`,
  `api_key_serp`) — `lib/services/database-service.js:444-450`. Neither
  `email_signature` nor the new `grantee_invite_body` is encrypted; both are stored
  as plain serialized preferences. [PLANNED] `grantee_invite_body` will NOT be added to that list.
- **Security matrix unaffected (VERIFIED).** `/api/user-preferences` already has a
  matrix entry (`docs/API_ROUTE_SECURITY_MATRIX.md:150` — "Intended user-owned
  settings", `requireAuthWithProfile`, `profileId`). A new non-reserved key does not
  change the route's contract, so [PLANNED] no matrix edit is required.
- **Storage location (VERIFIED).** Preferences are stored in Dataverse
  `wmkf_appuserpreferences` via the `DatabaseService` dispatcher (the Postgres
  `user_preferences` table was retired 2026-05-12) —
  `shared/config/reviewerFinderPreferences.js:1-6`. Not a Postgres column.

---

## 4. Implementation plan

### 4.1 Extract the shared template + placeholder helpers (new module)

Move `DEFAULT_BODY`, `DEFAULT_SUBJECT`, `formatCobDate`, `surnameFromName`, and a
generalized fill function out of `AwardeeTab.js` into a new shared module
**`shared/config/granteeInviteEmail.js`** so both AwardeeTab and Profile Settings
import one source of truth.

**While moving `DEFAULT_BODY`, drop its trailing `'Thank you,'` line** (owner
decision — see §1 invariant #4). The moved default ends at "Please do not hesitate
to contact me if you need additional information." with no closing word.

```js
export const GRANTEE_INVITE_DEFAULT_SUBJECT = '...';   // moved verbatim
export const GRANTEE_INVITE_DEFAULT_BODY = '...';      // moved, MINUS the 'Thank you,' line

// Generalized: fill placeholders into ANY base template (default OR custom).
export function fillInviteBody(baseTemplate, { piName, title, baseDate } = {}) {
  return String(baseTemplate || '')
    .replace('[Name]', surnameFromName(piName) || '[Name]')
    .replace('[title]', title || '[title]')
    .replace('COB [date]', `COB ${formatCobDate(baseDate)}`);
}
```

AwardeeTab keeps a thin `buildDefaultBody` shim or calls `fillInviteBody(base, …)`
directly. **Verify** no other file imports `DEFAULT_BODY`/`DEFAULT_SUBJECT` from
AwardeeTab before moving (grep first).

### 4.2 Add the preference key

In `shared/config/reviewerFinderPreferences.js`:

```js
export const PREFERENCE_KEYS = {
  // …
  // Per-user custom grantee-invitation email BODY (S272). Body-only — never a
  // signature (server appends the assigned-PD signature). Plain string; absent ⇒
  // fall back to GRANTEE_INVITE_DEFAULT_BODY. Written via the generic
  // /api/user-preferences endpoint (not reserved).
  GRANTEE_INVITE_BODY: 'grantee_invite_body',
};
```

No `DEFAULT_VALUES` entry needed (it's a plain string, default = shared constant).
No normalize/serialize helpers needed (plain string, unlike the JSON signature).

### 4.3 AwardeeTab: seed from the saved body + reset affordance

- `import { useProfile } from '../../context/ProfileContext'` and read
  `const savedBody = preferences?.[PREFERENCE_KEYS.GRANTEE_INVITE_BODY] || '';`
- **Base template** = `savedBody || GRANTEE_INVITE_DEFAULT_BODY`, where `savedBody`
  is the trimmed pref (whitespace-only ⇒ treated as absent — see §5 hazard edge cases).
- **Effect + manual-edit guard (Codex-corrected v1, hazard 1).** The auto-fill
  effect must (a) depend on the **resolved `baseTemplate`** so it reseeds when prefs
  arrive after mount, and (b) gate on an explicit `userEditedBodyRef` set by the
  textarea `onChange`, so a body the PD already typed is never clobbered when prefs
  load late. Concrete shape:

  ```js
  const autoBodyRef = useRef(GRANTEE_INVITE_DEFAULT_BODY);
  const userEditedBodyRef = useRef(false);

  const handleBodyChange = (event) => {
    userEditedBodyRef.current = true;
    setBody(event.target.value);
  };

  useEffect(() => {
    const nextBody = fillInviteBody(baseTemplate, {
      piName: recipients?.pi?.name,
      title: awardTitle,
    });
    setBody((current) => {
      if (userEditedBodyRef.current || current !== autoBodyRef.current) return current;
      autoBodyRef.current = nextBody;
      return nextBody;
    });
  }, [baseTemplate, recipients?.pi?.name, awardTitle]);
  ```

  The textarea uses `onChange={handleBodyChange}` (not a bare `setBody`).
- Relabel the textarea: **"Email body — edit before sending"**; keep the
  "A secure magic-link is added automatically" helper line; add a hint: "Your saved
  signature is added automatically — don't include it here."
- Add a **"Reset to default"** link button that restores the **Foundation default**
  (ignores the saved custom body — that is the most useful reset). It marks the state
  as **user-edited (`= true`)**, not unedited — see the temporal note below:

  ```js
  const resetToFoundationDefault = () => {
    const nextBody = fillInviteBody(GRANTEE_INVITE_DEFAULT_BODY, {
      piName: recipients?.pi?.name,
      title: awardTitle,
    });
    // Mark as a deliberate user choice. baseTemplate still resolves to the saved
    // CUSTOM body (the tab's reset is local; it does not clear the pref), so if we
    // left userEditedBodyRef false the NEXT effect run — e.g. when recipients load
    // — would re-fill from baseTemplate and bounce the body back to the custom text.
    // (Codex v2 Finding 2.) Setting it true freezes the reset for this compose.
    userEditedBodyRef.current = true;
    setBody(nextBody);
  };
  ```

### 4.4 Profile Settings: edit the saved body

Add a card below "Email Signature" in `pages/profile-settings.js`:

- A textarea bound to `grantee_invite_body`, seeded from
  `preferences[GRANTEE_INVITE_BODY] || GRANTEE_INVITE_DEFAULT_BODY` (same
  load-once-per-source ref pattern as the signature form, lines 58–82).
- **Save** → `setPreference(PREFERENCE_KEYS.GRANTEE_INVITE_BODY, value)`.
- **"Reset to Foundation default" → DELETE the key** (Codex v1, Q-1b). Writing the
  default literal would freeze a PD's body at today's default and miss future default
  changes; writing `''` is a sentinel, not truly absent. Deleting restores
  "absent ⇒ canonical default" cleanly. `/api/user-preferences` already supports
  `DELETE` (`pages/api/user-preferences.js:122-140`), but **`ProfileContext`
  currently exposes only `setPreference`** (verified `shared/context/ProfileContext.js:348`)
  — so add a small `deletePreference(key)` to the context. **Do NOT just "mirror
  setPreference"** — two Codex-v2 boundary catches:
  - **Finding 3 (reducer can't express a delete).** The reducer only merges
    (`UPDATE_PREFERENCES → {...state.preferences, ...updates}`,
    `shared/context/ProfileContext.js:76-81`); dispatching `{[key]: undefined}` leaves
    the key PRESENT with value `undefined`, not removed. Add a new reducer action
    `REMOVE_PREFERENCE` that deletes the key from `state.preferences` (e.g. destructure-omit
    or a shallow copy + `delete`), and have `deletePreference` dispatch it.
  - **Finding 4 (DELETE returns 200 on failure).** The single-key DELETE path always
    returns HTTP 200 with a JSON `{success: boolean}` even when the underlying delete
    failed (`pages/api/user-preferences.js:133-140`), and `setPreference` keys only on
    `response.ok` (`shared/context/ProfileContext.js:356-363`). So `deletePreference`
    MUST parse the body and gate on `data.success === true` (not just `response.ok`)
    before mutating local state — otherwise it falsely reports success and drops the
    key locally while Dataverse still holds it.
- After a successful save/delete, **refresh local state** so an open Awardee tab in
  the same session reseeds (the tab reads `preferences` from the same context).
- Helper copy stating the body-only invariant: "Do not include your name or
  signature — your saved Email Signature is appended automatically when you send.
  Keep the `[Name]`, `[title]`, and `COB [date]` placeholders; they're filled in
  per-grantee."

### 4.5 No server changes (Option A)

Send/preview routes and `email-signature.js` are untouched. The signature continues
to be appended server-side from the assigned PD.

---

## 5. Hazards & invariants (for the reviewer to scrutinize)

1. **Auto-fill vs manual-edit ref logic (highest risk — RESOLVED in §4.3).** The
   original effect (AwardeeTab 106–113) decided "did the user hand-edit?" by comparing
   `body` against `DEFAULT_BODY` and `autoBodyRef.current`. Because `preferences` load
   **asynchronously after** first render, two failure modes existed: (a) a saved
   custom body silently never appears (it arrives after mount; the guard treats the
   already-shown default as "manual" and refuses to replace), and (b) text the PD
   already typed gets clobbered when prefs land. §4.3's fix — depend on the resolved
   `baseTemplate` **and** gate on an explicit `userEditedBodyRef` set by `onChange` —
   addresses both. Codex confirmed both failure modes and supplied the corrected shape.
2. **Body-only / no double signature.** Neither the saved body nor the default may
   contain a closing or sign-off block. Per §1 invariant #4 the default now ends at
   "Please do not hesitate to contact me…" with **no `Thank you,`** — the
   server-appended PD signature is the sole closing. `appendSignatureBlock` does no
   closing-dedup (`lib/services/email-signature.js:86-91`), so any closing left in the
   body stacks with the signature. Profile Settings copy steers PDs away from pasting
   a signature; we do not strip (§1 invariant #3). This also resolves S272 item #2.
3. **Placeholder preservation.** If a PD deletes `[Name]`/`[title]`/`COB [date]`
   from their saved body, `fillInviteBody` simply finds nothing to replace — no
   crash, but the grantee gets a literal gap. Acceptable; the helper copy warns.
   `.replace(...)` replaces only the **first** occurrence — confirm the default has
   each token once (it does today).
4. **Scope mismatch (Option A).** Sender's body + assigned-PD's signature can
   differ. Documented & **accepted** by owner (§8 Q1) — sender ≈ assigned PD in practice.
5. **Trust boundary.** `grantee_invite_body` is per-user, written under the
   authenticated profile (no profile id from request input). It is **not** routed
   into any Dataverse selector, so `check:trust-boundary-guid` is unaffected.
6. **`check:fact-consistency` / counts.** No new API route file, no new app
   definition — registered scalar counts (127 routes, etc.) are unchanged.
7. **Edge cases (Codex v1, item 4a).**
   - **Whitespace-only saved body** ⇒ treat as absent (`savedBody.trim()` before the
     `|| DEFAULT` fallback), so a body of only spaces falls back to the default.
   - **Optimistic save / failure.** `setPreference` resolves to a boolean; the
     Profile Settings card already surfaces a save error (mirror the signature
     pattern). The Awardee-tab reset is local-only (no network), so it cannot fail.
   - **Profile switch with an Awardee tab open.** `preferences` changes when the PD
     switches profiles. Because §4.3's effect depends on `baseTemplate` and gates on
     `userEditedBodyRef`, a *typed* body is preserved across a switch and an *unedited*
     body reseeds from the new profile. **Decision: preserve typed text** (don't
     surprise the PD mid-compose); reseed only when untouched. Confirm acceptable.

---

## 6. Files touched

| File | Change |
|---|---|
| `shared/config/granteeInviteEmail.js` | **NEW** — shared default subject/body + `fillInviteBody` |
| `shared/config/reviewerFinderPreferences.js` | Add `GRANTEE_INVITE_BODY` key |
| `shared/components/workbench/AwardeeTab.js` | Seed body from saved pref; `userEditedBodyRef`; reset link; relabel; import shared module; `useProfile()` |
| `shared/context/ProfileContext.js` | Add `REMOVE_PREFERENCE` reducer action + `deletePreference(key)` (DELETE `/api/user-preferences`, gate on parsed `data.success`) |
| `pages/profile-settings.js` | New "Grantee invitation email" card (save + reset-to-default via delete) |

No migration, no new API route, no Atlas/security-matrix/manifest change.

---

## 7. Testing / gates

```bash
npm run build && npm run lint
npm test                                   # full suite
npm run test:grantee-deliverables          # grantee unit set
npm run check:api-routes && npm run check:fact-consistency && npm run check:trust-boundary-guid
```

Manual: in Profile Settings save a custom body → open a workbench Awardee tab →
confirm the textarea seeds from the saved body, placeholders fill, "Reset to
default" restores the Foundation default, Preview shows body + single signature,
and a fresh profile (no saved body) still sees the default.

---

## 8. Open questions — RESOLVED (owner, S272)

1. ✅ **Option A** (sender's body, client-side) — confirmed. Body/signature can differ
   when sender ≠ assigned PD; accepted (sender ≈ assigned PD in practice).
2. ✅ "Reset to default" = restore the **Foundation default**, persisted as a **key
   delete** (not a written literal). See §4.4.
3. ✅ **Drop `Thank you,` from the default body now** — confirmed (owner). Resolves
   S272 item #2 (double-closing). See §1 invariant #4 and §4.1.

Remaining confirm-on-review (not blockers): profile-switch behavior preserves typed
text (§5 hazard 7) — surface to owner if they expect a reseed instead.

---

## 9. Codex pre-impl review v1 — folded (S272)

Each catch and the response folded into this doc:

- **Q1a (Option A) — CONFIRMED.** No change; recommendation already Option A.
- **Q1b (reset semantics) — PARTIAL → folded.** Reset now = DELETE the key (§4.4);
  added `deletePreference` to `ProfileContext` (§6) since only `setPreference` exists.
- **Q1c (drop `Thank you,`) — CONFIRMED → folded.** Owner approved; §1 invariant #4,
  §4.1, §5 hazard 2.
- **Hazard 1 (async-load / clobber) — CONFIRMED → folded.** Codex's corrected
  effect + `userEditedBodyRef` adopted verbatim in §4.3; §5 hazard 1 marked resolved.
- **3a/3b (no server/route change) — CONFIRMED.** No change.
- **3c (security-matrix) — OPEN → VERIFIED.** Existing entry at
  `API_ROUTE_SECURITY_MATRIX.md:150`; non-reserved key doesn't change contract → no
  edit. §3.
- **3d (encryption / storage) — PARTIAL → VERIFIED.** `ENCRYPTED_PREFERENCE_KEYS` is
  the 5 API keys only; preferences live in Dataverse `wmkf_appuserpreferences`, not
  Postgres. §3.
- **4a (edge cases) — folded.** Whitespace-as-absent, save-failure surfacing,
  profile-switch decision → §5 hazard 7.
- **4b (item #2 interaction) — folded.** Resolved by dropping `Thank you,` (§5 hazard 2).
- **4c (body-only is convention-only) — folded.** §1 invariant #3 — server appends,
  does not strip; UI copy is the guard.
- **4d (only `[Name]`/`[title]`/`COB [date]`, first-occurrence) — acknowledged.**
  No curly-token support; placeholders unchanged (§5 hazard 3).

---

## 10. Codex pre-impl review v2 — folded (S272)

v2 reviewed the v1 folds and hunted for issues the folds introduced:

- **Finding 1 (effect stability) — CONFIRMED OK.** `baseTemplate` is a string
  primitive, not a new object each render, so the effect doesn't loop. No change.
- **Finding 2 (reset bounce) — NEW ISSUE → folded.** Reset now sets
  `userEditedBodyRef.current = true` (not false), else the next effect run re-applies
  the saved custom body over the reset. §4.3.
- **Finding 3 (reducer can't delete) — NEW ISSUE → folded.** Added a `REMOVE_PREFERENCE`
  reducer action; merge-only `{[k]:undefined}` would leave the key present. §4.4.
- **Finding 4 (DELETE 200-on-failure) — NEW ISSUE → folded.** `deletePreference` gates
  on parsed `data.success === true`, not `response.ok`. §4.4.
- **Finding 5 (unverifiable-as-built labels) — folded.** The two §3 lines that are
  plan intent (won't-encrypt; no matrix edit) are now tagged `[PLANNED]`.
