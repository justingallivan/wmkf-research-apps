---
title: "Build E — Messages & policies admin page: one disclosure system, safe publish, dirty state, polish"
status: active
owner: Claude Fable (orchestrating); Sonnet builder; Opus reviewer
created: 2026-09-10
---

# Build E — Messages & policies admin page refinement

Source: the Impeccable critique of Admin → Workflows → Messages & policies (snapshot
`.impeccable/critique/2026-09-11T03-39-34Z__pages-admin-js-governance.md`, score 12/40,
owner chose all four fixes). Surface mode is Operate: staff completing an edit. Follow
`DESIGN.md` ("The Clear Workbench": neutral surfaces, Foundation Ink primary actions,
`rounded-lg` controls, semantic color only for status). This is a refinement: keep the
incumbent identity, behavior, copy facts, routes, and everything outside scope.

Files in play: `shared/components/admin/AdminWorkspaceNavigation.js` (`AdminEditorPanel`,
`SettingScopeBadge`), `shared/components/admin/PoliciesSection.js`,
`shared/components/admin/EmailDefaultsSection.js`, `pages/admin.js` (only the
`case 'governance':` block and the two `*_DATAVERSE_FIELDS` constants if needed),
`shared/components/Layout.js` (read `Button`; do not change it).

## Item 1 — One disclosure system and one item chrome (P0)

Today: the panel uses a chevron `<details>`, email audience groups use the same chevron nested,
policy version history uses text triangles (`▶`/`▼`), and policy slots have no disclosure at
all (a dark primary button that flips to "Cancel"). Email "cards" have no visible container and
their h4 and h5 are the same size.

- Create `shared/components/admin/DisclosureRow.js`: a native `<details>`/`<summary>` row with
  props `{ id, title, meta, description, defaultOpen, groupName, children, headingLevel }`.
  Summary shows the title (rendered as the given heading level), optional meta text on the
  right (e.g. "9 cards", "Active version · 2026-06-24"), the chevron SVG that rotates only on
  its own open state (use Tailwind named groups: `group/<groupName>` on the details and
  `group-open/<groupName>:rotate-180` on the chevron; never the bare `group`), `cursor-pointer`,
  a hover background, a visible keyboard focus ring on the summary, and
  `[&::-webkit-details-marker]:hidden`. Summary content must be valid HTML (no block elements
  inside inline spans).
- Use it at every depth on this page: the two panels (via `AdminEditorPanel`'s collapsible
  variant, which should render it rather than its own inline markup), the four email audience
  groups, each policy slot, and policy version history (replace the text triangles).
- Policy slots become closed rows by default. The row summary shows the slot display name and
  "Active version <label> · effective <date>" (or "No active version") as meta. Opening a slot
  shows the rendered policy body, then the version history row, then the actions. The
  `slot: <code>` line moves into the field-mapping popover (it is already listed there as
  the slot code row); it is not shown in the summary.
- Email cards get real card chrome: a bordered `rounded-lg` container with `p-4`, an `h4` at
  `text-base font-semibold`, and field labels as real `<label>` elements at
  `text-sm font-medium text-gray-700` reading "Subject", "Body", "Button label" (the catalog
  `label` remains the `aria-label`/tooltip and the field-mapping popover title; do not change
  the catalog). Remove the "N cards" count from the group summary if the cards now read as
  cards; keep it if you judge it still helps, and say why in the handoff.
- The panel-level field-mapping button no longer floats alone in a strip under the header:
  place it inline at the right end of the panel summary row, with a click handler that stops
  the summary toggle (`onClick={(e) => e.preventDefault()}` on the button wrapper works for
  `<summary>`; verify in the test that clicking it does not toggle `open`).

## Item 2 — Safe publish flow (P0)

Today `PublishForm` starts with an empty body while the current text sits rendered above it,
the form mounts below ~700px of prose so the click appears to do nothing, "Prefill from active
version" is a 12px link with a developer tooltip, and Publish fires with no confirmation.
`DiffBlock` exists but only renders after a `label_conflict` failure.

- Keep the server contract (`POST /api/admin/policies` with `slotCode, versionLabel, title,
  body, effectiveDate, parentEtag`) unchanged. Keep every `STATUS_COPY` outcome path.
- Default prefill: when the form opens and an active version exists, `title` and `body` start
  from the active version, `effectiveDate` from today, and `versionLabel` from the existing
  unique-label suggestion (NOT the active label, which is taken). Replace the "Prefill from
  active version" link with a small outline "Reset to active version" action that restores
  those defaults; drop the developer tooltip.
- Placement: the action in the slot row is a Foundation Ink `Button` labeled "Edit policy"
  (it opens the form; the second click is "Cancel editing" as an outline button). The form
  mounts directly under the actions, above the rendered body, and the rendered body collapses
  to a "Current version" `DisclosureRow` (closed) while the form is open so the editor is
  not looking at two copies.
- Confirm step: Publish opens an inline confirm panel (not a browser dialog): "Publish version
  <label>, effective <date>? Published versions cannot be edited later." followed by
  `DiffBlock` comparing the active body to the submitted body (reuse the component; when there
  is no active version say "This will be the first version."), then "Publish" (primary) and
  "Back" (outline). Only the confirm's Publish calls the API.
- Copy: the label-collision helper, its "Use “<label>”" suggestion, and the min-50-chars guard
  stay. Rewrite operator strings for staff: `slot_not_provisioned` → "This policy has not been
  set up in Dataverse yet. Contact an administrator."; `duplicate_slot_rows` → "This policy
  has more than one Dataverse record. Contact an administrator before publishing.";
  `audit_unavailable` → "The audit log is unavailable, so publishing was refused. Try again
  later."; `failed` → "Publishing failed. Try again; if it keeps failing, contact an
  administrator." Keep the codes and tones.
- Tests: `tests/unit/policies-section-label-guidance.test.js` covers the label logic through
  the old "Prefill" button; rewrite those cases for the new default prefill and the Reset
  action so they still discriminate (the taken-label warning must still be reachable by
  typing the active label). Add: opening "Edit policy" shows the active body in the textarea;
  Publish shows the confirm with the diff and does not call fetch until confirmed; Back
  returns to the form with values intact; a mutant that skips the confirm must fail.

## Item 3 — Dirty state and a persistent Saved marker (P1)

Today each email field's status text replaces the character count and is wiped on the next
keystroke; there are ~19 independent Save buttons and no indication of what is unsaved.

- Track `savedValues` (from GET and after each PUT) alongside `drafts`. A field is dirty when
  `drafts[key] !== savedValues[key]`.
- Dirty field: the card shows a small "Unsaved changes" chip in its heading row and the
  field's Save button is enabled; a clean field's Save button is disabled (it has nothing to
  save). Status line after a save: "Saved · 2:14 PM" using the browser locale time, kept until
  the field becomes dirty again; on a failed save, the error stays until the next edit.
- Card-level "Save all changes" button (Foundation Ink) in the card heading row, enabled only
  when any field in the card is dirty; it PUTs each dirty key sequentially through the same
  per-key route and reports per-field status. No batching route.
- Navigate-away guard: register a `beforeunload` handler while any field is dirty; remove it
  on clean. Do not add in-app route guards.
- Tests in `tests/unit/email-defaults-section.test.js`: dirty chip appears on edit and clears
  after save; Save disabled when clean; Saved timestamp persists across a re-render and clears
  on the next edit; Save all PUTs only dirty keys in catalog order; beforeunload registered
  while dirty and removed when clean (spy on `window.addEventListener`).

## Item 4 — Controls, chips, copy, sizes (P2–P3)

- Buttons: every button in both sections renders through `Button` from
  `shared/components/Layout.js` (primary = Foundation Ink, outline for secondary/cancel, no
  `bg-blue-700` anywhere). Inputs and textareas share one class string: `rounded-lg`,
  `border-gray-300`, `px-3 py-2`, `text-sm`, and a focus ring (`focus:outline-none
  focus:ring-2 focus:ring-gray-300 focus:border-gray-500`). Monospace only on the policy
  markdown body and email body textareas, never on single-line subject or label fields.
  Textarea rows: body 8, policy markdown 12. Fix the `text-sm text-xs` collision on the
  policy body textarea.
- One `StatusChip` (local to `AdminWorkspaceNavigation.js`, exported): `rounded-full`, pale
  semantic background, Title case. Use it for: "Active version" (green), "No active version"
  (amber), "Repair needed" (red), "Retired" (gray), email "Blank" (red when the panel
  description says blank blocks sends, i.e. the invitation keys; amber otherwise — derive
  from a small set of blocking keys `email.reviewer_invitation.subject` / `.body` and
  `email.grantee_invite.subject` / `.body`; state the set in a comment), "Unavailable" (red),
  "Unsaved changes" (amber).
- Remove every `text-[10px]` and `text-[11px]` in `PoliciesSection.js` (seven sites: 316,
  360, 374, 450, 460, 488, 495 on `main`); use `text-xs`.
- Unify feedback: both sections use one `OutcomeBanner`-style toned band for outcomes
  (`PoliciesSection.js` already has it; extract to `shared/components/admin/OutcomeBanner.js`
  and use it in `EmailDefaultsSection.js` for save errors). Same ellipsis character ("…") in
  every progress label; `text-red-700` for inline errors in both.
- Copy: the "Other" group description in `editableTextDefaults.js` is developer text
  ("check EDITABLE_TEXT_DEFAULTS…"); change it to "Settings that are not assigned to a group
  yet." (this is the one catalog edit allowed). "dismiss" → "Dismiss". Loading text
  "Loading…" in both.
- Heading structure: panel `h2`, group/slot `h3`, card `h4`, fields are `<label>`s. Policies
  gets real headings so it is navigable by heading.

## Forbidden

`pages/api/**`, `lib/**`, `scripts/**`, `shared/config/editableTextDefaults.js` beyond the one
description string, `shared/components/Layout.js`, every other admin section, migrations,
docs other than those named below. No new dependencies. Do not change what the field-mapping
popover displays.

## Docs

`docs/API_ROUTE_SECURITY_MATRIX.md` unchanged (no route change). Add a short entry to
`docs/agent-wiki/topics/security-auth.md` only if it describes the admin email-defaults or
policies UI (grep first); otherwise no wiki change. Fill in this brief's Handoff.

## Verification (sequentially, in the worktree)

```bash
npx jest tests/unit/policies-section-label-guidance tests/unit/email-defaults-section tests/unit/admin-workspace-navigation tests/unit/editable-text-defaults-catalog tests/unit/seed-email-defaults tests/unit/email-defaults-routes
npm run check:types
npm run check:status-enum-parity && npm run check:status-enum-parity:self-test
npm run check:fact-consistency && npm run check:fact-consistency:self-test
npx eslint shared/components/admin/DisclosureRow.js shared/components/admin/OutcomeBanner.js shared/components/admin/AdminWorkspaceNavigation.js shared/components/admin/PoliciesSection.js shared/components/admin/EmailDefaultsSection.js pages/admin.js
node /Users/gallivan/.claude/skills/impeccable/scripts/detect.mjs --json shared/components/admin/PoliciesSection.js shared/components/admin/EmailDefaultsSection.js shared/components/admin/AdminWorkspaceNavigation.js shared/components/admin/DisclosureRow.js   # expect exit 0
```

## Handoff (builder fills in)

**Branch / commits**: `claude/messages-policies-refinement` off `ee7de9eb`. One commit,
`6223fb1d` ("Build E: one disclosure system, safe publish flow, dirty state (Items 1-3)"),
plus this handoff commit. Item 4 landed inside the same files as Items 1-3 (StatusChip,
`text-[…]` removal, OutcomeBanner extraction, Button/field-class unification, and the
one catalog-adjacent description edit were all done in the same pass as the components
they touch) rather than as a separate commit — [VERIFIED via git log] there is no
meaningful way to split "make every button in this file go through `Button`" from the
component rewrite that already replaced every `<button>`.

**Files changed**: `shared/components/admin/DisclosureRow.js` (new),
`shared/components/admin/OutcomeBanner.js` (new),
`shared/components/admin/AdminWorkspaceNavigation.js`,
`shared/components/admin/PoliciesSection.js`, `shared/components/admin/EmailDefaultsSection.js`,
`tests/unit/policies-section-label-guidance.test.js`, `tests/unit/email-defaults-section.test.js`,
`tests/unit/admin-workspace-navigation.test.js`. `pages/admin.js` was read in full
[VERIFIED] and needed no change — the `case 'governance':` block already passes
`collapsible`/`defaultOpen={false}` into `AdminEditorPanel`, which now internally renders
`DisclosureRow`.

**Brief-vs-source discrepancies** (followed source per Universal Operating Rule 1):
- The "Other" group description brief calls out as living in
  `shared/config/editableTextDefaults.js` actually lives in
  `shared/components/admin/EmailDefaultsSection.js:173` (formerly ~173, the runtime-built
  fallback group object) [VERIFIED via grep — no `unrecognized group` string anywhere in
  `editableTextDefaults.js`]. Edited it there instead; `editableTextDefaults.js` itself was
  not touched, which is stricter than the Forbidden list required, not looser.
- Item 1's ordering ("body, then version history, then actions") and Item 2's ordering
  ("form directly under the actions, above the rendered body") cannot both hold for the
  same slot row. Resolved as: actions (Edit policy / Cancel editing) always render first,
  then — while editing — the form followed by a closed "Current version" `DisclosureRow`;
  while not editing, the rendered body directly; version history is always last. This
  satisfies Item 2 literally and is the only reading of Item 1 consistent with it.
- `DisclosureRow`'s prop surface extends the brief's literal
  `{ id, title, meta, description, defaultOpen, groupName, children, headingLevel }` with
  two additions no caller could do without: `titleAdornment` (renders next to the heading,
  never inside it, so `SettingScopeBadge` doesn't pollute the heading's accessible name —
  the existing `admin-workspace-navigation` test queries
  `getByRole('heading', { name: 'Workflow policies' })` exactly) and `actions` (right-aligned
  interactive content, e.g. the field-mapping button, that the caller must guard itself).
- The guard for "click the field-mapping button without toggling the panel" needed
  `onClickCapture={(e) => e.preventDefault()}`, not the brief's literal
  `onClick={(e) => e.preventDefault()}` on the wrapper. [VERIFIED via a jsdom spike, kept
  as `tests/unit/admin-workspace-navigation.test.js`'s new "never toggles" test]: a
  bubble-phase guard on a wrapper never runs once `DataverseFieldInfoButton`'s own popover
  content calls `stopPropagation()` first (it sits below the wrapper in the tree, so the
  bubble is cut off before reaching it) — yet `<summary>`'s native toggle is a UA default
  action that fires regardless of where propagation stopped, unless `preventDefault()` was
  called at any point during dispatch. Capture phase runs before any of that.

**"N cards" decision**: kept. Even with real card chrome, the count is the only size
signal visible while a group is collapsed (the default state) — you cannot see the cards
to count them until you open the group. Dropping it would remove information, not
redundancy.

**Tests**: `tests/unit/policies-section-label-guidance.test.js` — 8 tests (was 4), all
passing [VERIFIED]. `tests/unit/email-defaults-section.test.js` — 10 tests (was 6), all
passing [VERIFIED]. `tests/unit/admin-workspace-navigation.test.js` — 7 tests (was 6), all
passing [VERIFIED]. Full named suite:
`npx jest tests/unit/policies-section-label-guidance tests/unit/email-defaults-section tests/unit/admin-workspace-navigation tests/unit/editable-text-defaults-catalog tests/unit/seed-email-defaults tests/unit/email-defaults-routes`
→ 6 suites, 69 tests, 0 failures [VERIFIED, run 2026-09-10].

**Mutation checks** (applied locally, ran, watched fail, reverted — diffs not left in the
tree):
- Confirm-skip: changed the Publish button in `PoliciesSection.js` from
  `onClick={() => setConfirming(true)}` to `onClick={() => submit()}`. The new
  "Publish opens a confirm panel … and does not call fetch until confirmed" test failed
  (`getByText(/published versions cannot be edited later/i)` not found). Reverted;
  suite green again.
- Save-all-PUTs-clean-keys: changed `saveAllForCard`'s `dirtyKeys` to drop the
  `.filter(...)` (PUT every key in the card, not just dirty ones). The rewritten
  "Save all changes PUTs only dirty keys…" test failed (expected 1 PUT, got 2). Reverted;
  suite green again.
- Forget-to-clear-dirty-on-save: commented out `setSavedValues(...)` in `saveKey`. The
  "dirty chip … clears after save" test failed (`Unsaved changes` still present after
  save). Reverted; suite green again.

**Gates** (run sequentially, each gate then its self-test):
- `npm run check:types` → clean, no errors [VERIFIED].
- `npm run check:status-enum-parity` → "OK — 8 producer↔consumer invariant(s) in sync."
  [VERIFIED]. `check:status-enum-parity:self-test` → "OK — 17/17" [VERIFIED].
- `npm run check:fact-consistency` → OK, 736 files scanned, no drift [VERIFIED].
  `check:fact-consistency:self-test` → OK [VERIFIED].
- `npx eslint shared/components/admin/DisclosureRow.js shared/components/admin/OutcomeBanner.js shared/components/admin/AdminWorkspaceNavigation.js shared/components/admin/PoliciesSection.js shared/components/admin/EmailDefaultsSection.js pages/admin.js`
  → 0 errors. Warnings present are all pre-existing `react-hooks/set-state-in-effect`
  advisories on `useEffect(() => { load(); }, [])`-shaped effects already common
  throughout `pages/admin.js` (same pattern predates this build in every other admin
  section); none are new to the files this build authored.
- `node .../impeccable/scripts/detect.mjs --json <the four files>` → `[]`, **exit 0**
  [VERIFIED]. Baseline (pre-edit) run on `PoliciesSection.js` alone found the seven
  `text-[10px]`/`text-[11px]` font-size findings at exactly the lines the brief named
  (316, 360, 374, 450, 460, 488, 495); all seven are gone post-rewrite (replaced with
  `text-xs`, per Item 4).

**Left open**: nothing known. `pages/api/admin/email-defaults.js` and
`pages/api/admin/policies.js` were not touched (Forbidden); no new dependencies added;
`docs/API_ROUTE_SECURITY_MATRIX.md` untouched (no route change); grepped
`docs/agent-wiki/topics/security-auth.md` for existing admin email-defaults/policies UI
coverage — none found, so no wiki edit made.
