# SharePoint storage, recovery, retention, and editing policy — decision-ready question brief

**Written:** 2026-08-11 (S415), by Claude, for Justin.
**Scope:** the governed Initial Assessment / writeup artifacts in the
`akoya_request` document library on
`https://appriver3651007194.sharepoint.com/sites/akoyaGO`.
**Nature:** evidence and routing brief. No code, no live writes, no permission,
retention, or deletion changes were made producing it, and none are proposed in it.

**Evidence labels used throughout:**

| Label | Meaning |
|---|---|
| `[VERIFIED via repository/source]` | Established by our own probe, capture, or tracked source, cited |
| `[VERIFIED via Microsoft documentation]` | Current Microsoft Learn / Microsoft Support text, linked at §12 |
| `[ADMIN REPORT — UNCONFIRMED]` | An administrator told us this; nobody has confirmed it |
| `[ASSUMED]` | Reasonable working position, not evidenced |
| `[OPEN]` | Nobody knows |

---

## 1. Executive summary

One of the four administrator questions is now closed. The version-limit
question was answered from the signed-in Versioning Settings page for the actual
library `[VERIFIED via repository/source]`: **major versions only, no time
limit, keep 500 major versions, drafts unchecked, check-out not required**
(`docs/DATAVERSE_SHAREPOINT_FILE_MODEL.md`, "Version and data-protection
contract"). Accidental version pruning is no longer a material risk. Note the
residual: 500 is a *setting*, not a law — an administrator can lower it, and
lowering it prunes immediately.

Three questions remain genuinely unresolved, and the most important finding of
this brief is that **two of the three are probably not what they look like**:

- **Second-stage recycle bin.** Connor reported "No second-stage recycle bin."
  Microsoft's own documentation says the second-stage bin **is not visible to
  end users at all** — "The second-stage Recycle Bin isn't visible to end users
  (only the first-stage Recycle Bin is), but site collection admins can view and
  restore content from there" `[VERIFIED via Microsoft documentation]`. That
  sentence is a complete alternative explanation for both Connor's answer and
  Justin's 2026-07-30 `AdminRecycleBin.aspx?view=13` access denial. The
  operative question is therefore **not** "does the bin exist" but **"who on
  this tenant is a site collection administrator, and what do they see."**
  Nothing in this brief should be read as evidence that the bin is absent.

- **Editor least privilege.** "Site members have 'limited control'" is not a
  built-in SharePoint permission level. Microsoft's permission table settles the
  underlying fact cleanly: **Edit and Contribute both include Delete Items *and*
  Delete Versions**; `Manage Permissions` is in Full Control and Manage
  Hierarchy only `[VERIFIED via Microsoft documentation]`. So edit-yes /
  delete-no is impossible under an unmodified built-in level — but Microsoft
  also documents that **every default level except Full Control and Limited
  Access can be edited in place**, so a modified "Edit" would produce exactly
  the observed asymmetry while still being *named* Edit. That means **reading
  the level's name is not sufficient. The checkboxes must be read.**

- **Purview retention.** Genuinely unanswered and mis-routed. "Not familiar with
  purview" tells us Connor is not the owner. This belongs with whoever holds
  Microsoft 365 compliance admin rights on the tenant — most likely **DFT, the
  foundation's IT provider** `[ASSUMED — routing; confirm with Justin]`, not the
  akoyaGO-side administrator. It is also the question with the largest *upside*:
  if a retention policy covers this site, Microsoft documents that **versioning
  limits are ignored and users are prevented from deleting versions** for as
  long as the retention period runs `[VERIFIED via Microsoft documentation]` —
  which would close the durability gap from the opposite direction.

Two standing cautions carried forward, both still correct:

1. **The two 2026-08-10 delete attempts are NULL evidence.** Both returned
   `File is checked out to another user` (`0x80060728`), which SharePoint emits
   for any lock including one held by the Office co-authoring service on the
   acting user's own behalf. A rights failure surfaces as `Access denied`. The
   message distinguishes nothing. Do not cite those attempts in either direction.
2. **Do not resolve any of this by deleting a governed artifact.** Until the
   second-stage bin is confirmed, a successful delete would leave the
   first-stage bin as the only remedy — destroying an artifact to test whether
   artifacts survive destruction.

Recommended sequencing (§9): the site-collection-administrator identity question
(Q2) is the cheapest single move and it unblocks Q1 and Q4 at once.

---

## 1a. Live attempt with Connor — 2026-08-11, partial, resumed tomorrow

Justin and Connor worked the Connor-owned questions live. **No question closed**,
but the session produced two real findings and eliminated three access paths.

**Evidence captured:** a screenshot of the **modern Site Permissions pane**
("Manage who has access to this site") for `/sites/akoyaGO`, showing exactly:

| Group shown | Label shown | Members shown |
|---|---|---|
| Site owners | full control | `akoyaGO Owners` |
| Site members | **limited control** | `akoyaGO Members`, **Everyone except external users** |
| Site visitors | no control | None |

**Finding 1 — "limited control" is resolved, and it is not a permission level.**
`[VERIFIED via screenshot 2026-08-11]` The phrase is the modern pane's own fixed
descriptive label for the Site members group, sitting beside "full control" and
"no control" for the other two. Connor's 2026-08-10 reply quoted this UI string
verbatim and was accurate reporting. It is **not** a custom level, and it says
nothing about Delete Items.

*Consequence:* **H2 loses its main support and the lean flips to H1.** The
"custom Contribute-minus-Delete level" hypothesis rested largely on "limited
control" sounding like a real custom level; it isn't one. H1 (transient
self-lock during the acting user's own Word session) is now the more likely
explanation for the 2026-08-10 delete refusal — which would mean ordinary
members **can** delete. Still `[OPEN]`: this shifts the prior, it does not close
Q5. The checkbox read remains the only closing evidence. Note also that Microsoft
has a documented issue where this pane displays inaccurate permission levels, so
nothing in it can serve as a definition either way.

**Finding 2 — NEW, and larger than the question that surfaced it: the editor
audience is the whole tenant directory.** `[VERIFIED via screenshot 2026-08-11]`
**"Everyone except external users"** is a member of Site members, i.e. holds
edit rights on the library containing the governed writeups.
`[VERIFIED via Microsoft documentation]` "This security group is added to the
Members group automatically on Modern Team sites with *Public* privacy settings,
so that users in Microsoft 365 can access and edit the SharePoint site." So this
is a public M365 group-connected team site, and every licensed user in the
tenant — not a granted staff set — can edit these documents today. See Q12.

**Access paths eliminated this session** (all `[VERIFIED via live attempt]`):

- The modern pane's **Advanced permissions settings** link could not be found.
- `_layouts/15/settings.aspx`, `user.aspx?view=perms`, and `role.aspx` "don't
  work" for the accounts tried. This is the **second** time a classic
  `_layouts/15/…` URL has failed on this tenant (after
  `VersionSettings.aspx?List={guid}` on 2026-08-10). Two independent failures
  make "classic pages are reachable here by URL" a claim to stop relying on —
  though note the versioning page *was* reachable through UI navigation, so the
  pages exist; it is the URL entry that fails.
- PowerShell was not available in the session (SharePoint Online Management
  Shell is Windows-only; PnP.PowerShell needs an Entra app client ID since 2024).

**Therefore the remaining Connor-side asks are blocked on tooling, not on
willingness.** Tomorrow's session should open with acquiring *one* working
surface — an admin PowerShell session, or a signed-in path into classic Site
Settings — rather than re-asking the questions.

---

## 2. Open questions

| # | Question | Status | Owner |
|---|---|---|---|
| Q1 | Does a second-stage (site collection) recycle bin exist for this site, and what is in it? | `[ADMIN REPORT — UNCONFIRMED]` negative; contradicted by platform default | Site collection administrator |
| Q2 | **Who holds site collection administrator rights on `/sites/akoyaGO`?** | `[OPEN]` | Justin → Connor / DFT |
| Q3 | Does any Microsoft Purview **retention policy** include this site in scope? | `[OPEN]` | M365/Purview compliance admin |
| Q4 | Does any **retention label**, eDiscovery hold, or Litigation Hold apply to this library or its items? | `[OPEN]` (one item probed, negative, n=1) | M365/Purview compliance admin (+ SCA for the Preservation Hold library check) |
| Q5 | What is the **real permission level** behind "limited control", and does its definition grant **Delete Items**, **Delete Versions**, **Manage Permissions**? | `[ADMIN REPORT — UNCONFIRMED]`, ambiguous | Connor / site owner |
| Q6 | Is Justin **in the Members group** or granted directly/elevated? | `[OPEN]` | Connor / site owner |
| Q7 | Was the 2026-08-10 delete refusal a transient lock (H1) or a level without Delete (H2)? | `[OPEN]` — the attempts settle nothing | Independently verifiable (Justin) |
| Q8 | Do ordinary editors hold **move/rename** authority? | Resolvable from Q5 — see §3 | Independently verifiable (documentation) |
| Q9 | Who can lower the 500-major-version limit, and would we detect it? | `[OPEN]` | Connor / site owner + Justin |
| Q10 | Is Microsoft's 14-day post-deletion backup / point-in-time restore reachable for us, and by whom? | `[OPEN]` | M365 admin (DFT) |
| Q11 | **Acceptance thresholds:** what evidence does Justin require before declaring the artifact system production-ready? | `[OPEN]` — product decision | Justin |
| Q12 | **NEW 2026-08-11.** "Everyone except external users" holds edit rights — is tenant-wide edit access deliberate or an unremoved default, and is the site Public or Private? | `[VERIFIED]` that the group is in Members; `[OPEN]` whether it is intended | Connor / site owner + Justin |
| Q13 | **NEW 2026-08-11.** Which surface can this tenant's classic permission pages actually be reached from, given two URL failures? | `[OPEN]` — blocks Q5, Q6, Q9 | Connor / site owner |

---

## 3. Current evidence and confidence, question by question

### Q1 — Second-stage / site collection recycle bin

- `[ADMIN REPORT — UNCONFIRMED]` Connor, 2026-08-10: "No second-stage recycle bin."
- `[VERIFIED via repository/source]` On 2026-07-30 Justin was **denied access**
  to the second-stage administrator view at `AdminRecycleBin.aspx?view=13`
  (`docs/INITIAL_ASSESSMENT_CONTROLLED_PILOT_2026-07-30.md`).
- `[VERIFIED via Microsoft documentation]` "The second-stage Recycle Bin isn't
  visible to end users (only the first-stage Recycle Bin is), but site collection
  admins can view and restore content from there."
- `[VERIFIED via Microsoft documentation]` The documented SharePoint Online
  lifecycle: an item deleted from the site (first-stage) bin "goes to the site
  collection Recycle Bin, also known as the second-stage Recycle Bin, where they
  stay for the remainder of their retention period. Items deleted from the site
  collection Recycle Bin are purged immediately." A **93-day period spans both
  stages** — it is not 93 + 93.
- `[VERIFIED via Microsoft documentation]` Microsoft's support article notes only
  that if you do not see the Recycle Bin "it might have been disabled or you
  don't have permission to access it" — i.e. the platform documentation itself
  treats *no permission* as a first-class explanation.
- `[ASSUMED — not found in Microsoft documentation]` That the second-stage bin
  cannot be disabled at all in SharePoint Online. We could not find an official
  statement either way, so do **not** write "it cannot be disabled" into a
  durable doc. What is documented is that it exists in the normal lifecycle and
  is admin-only.

**Confidence:** high that Connor's answer is consistent with *not having the
rights to see it*; zero evidence that the bin is genuinely absent.

### Q2 — Site collection administrator identity

- `[OPEN]` Nobody has named the site collection administrators for `/sites/akoyaGO`.
- `[VERIFIED via repository/source]` Justin is **not** one (denied the
  second-stage view on 2026-07-30) yet holds at least Edit/Contribute (he
  produced version `2.0` on Request `1003109` under his own identity).
- `[VERIFIED via Microsoft documentation]` "Microsoft 365 subscriptions create a
  security group called 'Company Administrators', which contains Microsoft 365
  Admins (such as Global and Billing Admins). This security group is added to
  the Site Collection Administrators group." So **tenant global admins are site
  collection admins by default** — which makes the tenant's M365 admin (DFT, per
  §1) a probable answer to Q1 as well as Q3.
- `[VERIFIED via repository/source]` The app cannot answer this itself: the token
  holds only `Sites.Selected`, and `GET /sites/{siteId}/permissions` returns
  `403 accessDenied`.

**Confidence:** this is the highest-leverage unknown in the brief.

### Q3 — Purview retention policy scope

- `[ADMIN REPORT — UNCONFIRMED]` Connor: "Not familiar with purview" — a
  non-answer that correctly routes the question elsewhere.
- `[VERIFIED via repository/source]` The Graph `retentionLabel` response for the
  Request `1003109` item carried no label fields. This rules out **a label on
  that one item**. It says nothing about a site- or library-scoped policy.
- `[VERIFIED via Microsoft documentation]` A retention policy scoped to a site
  causes SharePoint to create a **Preservation Hold library** — "a hidden system
  location", visible only to site collection administrators. Its presence in
  Site contents is therefore an **independent, non-destructive signal**.
- `[VERIFIED via Microsoft documentation]` Purview **Policy lookup** (Microsoft
  Purview portal → Data lifecycle management → Policy lookup) accepts an exact
  site URL and returns both site retention policies and label policies. Exact
  URL only; no wildcards.
- `[VERIFIED via Microsoft documentation]` **The consequence that makes this
  worth chasing:** "For items that are subject to a retention policy (or an
  eDiscovery hold), the versioning limits for the document library are ignored
  until the retention period of the document is reached … old versions aren't
  automatically purged and users are prevented from deleting versions."

**Confidence:** unanswered, and currently owner-less. Route it before anything else on the compliance side.

### Q4 — Retention labels and other hold sources

- `[VERIFIED via repository/source]` One item, no label fields. n=1.
- `[VERIFIED via Microsoft documentation]` Retention labels behave differently
  from policies: with a standard label, editing does **not** copy to the
  Preservation Hold library but deleting does; a label that marks items as
  records blocks deletion outright; a regulatory record blocks edit *and* delete.
  A records-management tenant setting ("Deleting content labeled for retention")
  can independently forbid users deleting labeled items.
- `[VERIFIED via Microsoft documentation]` Retention policies are not the only
  hold source — eDiscovery holds and Litigation Hold preserve content
  independently, and any one is sufficient.

**Confidence:** open. Same owner as Q3; ask both in one message.

### Q5 — What "limited control" actually is

- `[ADMIN REPORT — UNCONFIRMED]` Connor: "Site members have 'limited control'."
- `[VERIFIED via Microsoft documentation]` The built-in levels are Full Control,
  Design, Edit, Contribute, Read, Limited Access, Web-Only Limited Access,
  Approve, Manage Hierarchy, Restricted Read, View Only. **"Limited control" is
  not among them.**
- `[VERIFIED via Microsoft documentation]` List-permission table:

  | Permission | Full Control | Design | Edit | Contribute | Read |
  |---|---|---|---|---|---|
  | Add Items | X | X | X | X | |
  | Edit Items | X | X | X | X | |
  | **Delete Items** | X | X | **X** | **X** | |
  | View Versions | X | X | X | X | X |
  | **Delete Versions** | X | X | **X** | **X** | |
  | Manage Lists | X | X | X | | |

  and site-permission table: **Manage Permissions** is granted only by **Full
  Control** and **Manage Hierarchy**. By default the **Members** group holds
  **Edit**.
- `[VERIFIED via Microsoft documentation]` **"You can change any of the default
  permission levels, except Full Control and Limited Access."** This is the
  decisive nuance: a level can still be *named* Edit while having had Delete
  Items unchecked. **Asking for the level's name does not answer the question —
  the checkboxes must be read.**
- `[VERIFIED via repository/source]` The two 2026-08-10 delete attempts are null
  evidence (§1). Two hypotheses stand, per
  `docs/DATAVERSE_SHAREPOINT_FILE_MODEL.md`: H1 transient self-lock (109 s after
  the same user's own edit) → members **can** delete; H2 custom "Contribute minus
  Delete" → members **cannot**.
- `[VERIFIED via repository/source]` "Limited Access" was **considered and
  rejected** 2026-08-10 as the resolution: it grants no edit at all, which the
  pilot empirically contradicts.

**Confidence:** the platform half is now settled; the tenant half is open and
answerable by one non-destructive read.

### Q6 — Is Justin an ordinary editor?

- `[OPEN]`. Outstanding with Connor since 2026-08-10.
- Why it matters: if Justin holds an elevated or direct grant, **the pilot never
  exercised the ordinary-editor path**, and every "a staff editor can do X"
  conclusion drawn from his session is unsupported for the actual audience.

### Q7 — Lock vs. rights (H1 vs. H2)

- `[OPEN]`, and **independently discriminable without asking anyone**: add the
  **"Checked Out To"** column to the library view. Blank → no check-out exists,
  favouring H1. A name → a real check-out, and the holder is named; if that
  holder is the akoyaGO app or a service account, that is a systemic finding in
  its own right (orphaned check-out from a died Word/upload session, an explicit
  check-out never checked in, or an upload while a required column was empty).
- `[VERIFIED via repository/source]` Check-out is **not required** on this
  library, so any check-out present is incidental, not policy.

### Q8 — Move / rename authority

**Answerable from documentation now; no administrator needed.**
`[VERIFIED via Microsoft documentation]` The documented list-permission set
contains **no separate "move" or "rename" permission** — verified as an absence
across the full documented set, not inferred. Their decomposition — renaming as
an `Edit Items` operation, moving as `Add Items` at the destination plus
`Delete Items` at the source — is `[ASSUMED]`; Microsoft states the permission
set, not the mapping. The consequences hold under either reading:

- Anyone who can edit can rename. **This is already true today** and cannot be
  restricted without removing editing.
- Move-out-of-library authority collapses into **Delete Items** — i.e. Q8 is
  fully determined by Q5 and needs no separate question. A rename or a move is
  also *recoverable* in a way a delete is not: the item ID is stable, and our
  registry resolves artifacts by stable drive/item ID rather than by path or
  filename `[VERIFIED via repository/source]`, so a rename does not orphan an
  artifact.

### Q9 — Administrative change of the version limit

- `[VERIFIED via repository/source]` The limit is 500 majors, no age expiry, and
  **the Versioning Settings page both shows and sets it — lowering the number
  prunes existing versions immediately.** It is a look-and-report page, never a
  change-and-report page.
- `[VERIFIED via repository/source]` The limit is **not readable
  programmatically**: `GET /drives/{driveId}/list` returns `200` for this library
  but the `list` facet carries only `contentTypesEnabled`, `hidden`, `template`;
  a case-insensitive `version*limit` search over the whole body matched nothing.
  This is a permissions-independent gap, not a `Sites.Selected` denial. We
  therefore **cannot monitor for a silent lowering** of this setting.
- `[OPEN]` Who can change it, and whether any change notification exists.

### Q10 — Microsoft-side backup

- `[VERIFIED via Microsoft documentation]` "SharePoint retains backups of all
  content for 14 more days beyond actual deletion … Customers can reach out to
  Microsoft support to initiate a full site collection or subsite point in time
  restore … After this 14 day period, Microsoft no longer retains the data."
- `[OPEN]` Whether the foundation (or DFT on its behalf) can actually open that
  support case, and how quickly. This is the last-resort remedy behind
  everything else, so its reachability is worth knowing before it is needed.

### Q11 — Acceptance thresholds

`[OPEN]` — a product decision, not an evidence question. See §7 for the proposed
closing criteria; Justin's job is to accept, tighten, or waive them.

### Q12 — Tenant-wide edit access (new, 2026-08-11)

- `[VERIFIED via screenshot 2026-08-11]` "Everyone except external users" is in
  the Site members group for `/sites/akoyaGO`.
- `[VERIFIED via Microsoft documentation]` That group is auto-added to Members on
  Modern Team sites with **Public** privacy, granting access and edit to every
  licensed user in the directory.
- `[OPEN]` Whether this is deliberate, whether the site is Public or Private
  today, and whether removing that group in favour of the actual staff group
  would break anything (GOapply, Power Automate flows, and akoyaGO's own service
  identities all touch this site, so this is **not** a safe unilateral change).
- **Why it matters here:** every other question in this brief asks what an
  *ordinary editor* can do. This one asks **how many ordinary editors there
  are** — and the answer today is "everyone with a license." It multiplies
  whatever Q5 turns out to be, in either direction. It is also the one finding
  so far that is actionable without any further evidence.
- **Do not treat this as a defect until Q5 is known.** If Delete Items is
  unchecked, tenant-wide *edit* is a much smaller matter than tenant-wide
  *delete*.

### Q13 — A working administrative surface (new, 2026-08-11)

- `[VERIFIED via live attempt 2026-08-11]` The modern pane's Advanced permissions
  settings link was not findable, and `settings.aspx` / `user.aspx?view=perms` /
  `role.aspx` did not work for the accounts tried. `[VERIFIED via repository]`
  `VersionSettings.aspx?List={guid}` also failed on 2026-08-10.
- `[ASSUMED]` Cause not discriminated: trimmed/redirected classic pages on this
  tenant, an account without the rights those pages require, or the URL forms
  being wrong here. The one counter-data-point is that the Versioning Settings
  page **was** reached by UI navigation on 2026-08-10, so the classic pages
  exist and are permitted to at least one account.
- **This now gates Q5, Q6, and Q9.** Tomorrow's first move is to obtain one
  working surface, not to re-ask the questions.

---

## 4. Decision / evidence owner map

| Owner | Questions | Why this owner |
|---|---|---|
| **Connor / site owner** | Q5, Q6, Q9 | Site Settings → Site permissions and the permission-level definition are site-owner surfaces. He already engaged on these. |
| **Site collection administrator** (identity unknown — Q2) | Q1, Q4 (Preservation Hold library sighting) | Microsoft documents the second-stage bin and the Preservation Hold library as visible **only** to site collection admins. No one else can answer. |
| **M365 / Purview compliance administrator** (likely DFT `[ASSUMED]`) | Q3, Q4, Q10 | Policy lookup, retention labels, hold sources, and Microsoft support cases are tenant-compliance surfaces. Connor explicitly disclaimed this. |
| **Justin / product owner** | Q11, and the Q9 risk-acceptance | These are "what evidence is enough" and "what residual risk do we carry" decisions. |
| **Independently verifiable (us, non-destructively)** | Q7 (Checked Out To column), Q8 (settled above), the item-level `retentionLabel` read (already done, n=1) | No administrator required. |
| **Justin → routing** | Q2 | One question, but it determines who answers Q1 and Q4. |

---

## 5. Exact questions to send each owner

Non-technical wording, one reply-template block each. Full send-ready messages in
§10 and §11; these are the underlying asks.

**To Connor / the site owner:**

1. In Site Settings → Site permissions, what permission level is listed next to
   the **Members** group for `/sites/akoyaGO`? (The exact name as shown.)
2. Open that permission level and read its checkboxes. Are **Delete Items**,
   **Delete Versions**, and **Manage Permissions** checked or unchecked?
   *(This is the actual question — the level's name alone doesn't answer it,
   because built-in levels can be modified in place while keeping their name.)*
3. Is Justin Gallivan in that Members group, or granted access directly /
   at a different level?
4. Who is listed as a **site collection administrator** for this site? (Q2 — the
   routing question.)
5. Who can change the library's versioning settings, and is anyone notified if
   they do?

**To the M365 / Purview compliance administrator:**

1. Using **Policy lookup** in the Microsoft Purview portal (Data lifecycle
   management → Policy lookup → Site), paste the exact site URL: is
   `https://appriver3651007194.sharepoint.com/sites/akoyaGO` in scope of any
   **retention policy**? If yes: retain-only, delete-only, or retain-and-delete;
   how long; and is Preservation Lock applied?
2. Are any **retention labels** published to, or auto-applied in, this site or
   the `akoya_request` library? If yes, do any of them mark items as **records**
   or **regulatory records**?
3. Is the site subject to any **eDiscovery hold** or **Litigation Hold**?
4. Is there a **Preservation Hold library** in this site's Site contents?
5. Who holds **site collection administrator** rights on this site, and can they
   open its **second-stage (site collection) recycle bin** — the view at
   `/_layouts/15/AdminRecycleBin.aspx?view=13`? What does it show?
6. If content were ever hard-deleted, could you open a Microsoft support case for
   a point-in-time restore within the 14-day window?

**To Justin (product decisions, no lookup required):**

1. Are the §7 closing criteria the right bar, or should any be tightened/waived?
2. Given that a lowered version limit prunes immediately and cannot be monitored
   programmatically, is that an accepted residual risk or does it need a control?

---

## 6. Exact UI paths and read-only checks

All read-only. None of these changes a setting, deletes anything, or alters a
governed artifact.

| Check | Path | Who can run it |
|---|---|---|
| Members permission level **name** | Site Settings → Site permissions → the row for the Members group | Site owner / SCA |
| Members level **definition** (the decisive read) | Site permissions → click the level name → read the **Delete Items**, **Delete Versions**, **Manage Permissions** checkboxes | Site owner / SCA |
| Is Justin in Members? | Site permissions → open the Members group → member list; also check for direct grants on the site | Site owner / SCA |
| Second-stage recycle bin | Site contents → **Recycle bin** → at the bottom of the page, **second-stage recycle bin** (equivalently `/_layouts/15/AdminRecycleBin.aspx?view=13`) | **Site collection administrator only** |
| Preservation Hold library sighting | Site contents → look for **Preservation Hold Library** | Site collection administrator only |
| Retention policy scope | Microsoft Purview portal → Data lifecycle management → **Policy lookup** → **Site** → paste the exact site URL | Purview/compliance admin |
| Retention labels in the library | Library view → add the **Retention label** column, or Purview → Records management → label policies | Purview/compliance admin |
| Versioning settings (re-verify only) | `https://appriver3651007194.sharepoint.com/sites/akoyaGO/akoya_request` → gear → Library settings → More library settings → **Versioning settings** | Site owner |
| "Checked Out To" (Q7 half a) | Library view → **Add column** → show existing column → **Checked Out To** | Justin (already has library access) |

**Two operating rules carried forward, both learned the hard way:**

- **Send administrators the UI path, never a reconstructed deep link.** A
  `_layouts/15/VersionSettings.aspx?List={guid}` link built from the verified
  list GUID `fd037f0b-8df4-41f5-8fed-c3984d351918` failed on 2026-08-10 while
  the same user reached the same page through the UI minutes later. Rights were
  ruled out as the cause; the URL form is simply unreliable here.
- **The Versioning settings page sets the value as well as showing it**, and
  lowering the number prunes immediately. Say "read and report, change nothing"
  explicitly whenever you send someone to it.

---

## 7. What closes each gate

| # | Closing evidence | Not sufficient |
|---|---|---|
| Q1 | A named site collection administrator opens the second-stage view and reports what they see (including "empty" — empty is a pass, absent is not) | Connor's report; any end-user's inability to see it; any inference from the first-stage bin |
| Q2 | A name (or names) from Site Settings → Site collection administrators, or from the tenant admin | Assuming the M365 global admin is one, even though documentation says they are |
| Q3 | A Policy lookup result for the exact site URL — positive **or** negative, screenshot or transcribed | The item-level Graph `retentionLabel` read; absence of a Preservation Hold library alone (a delete-only policy creates no copies until triggered) |
| Q4 | Label-policy list plus explicit "no eDiscovery/Litigation Hold" from the compliance admin | n=1 item probe |
| Q5 | The **checkbox state** of Delete Items / Delete Versions / Manage Permissions on the level actually assigned to Members | The level's *name*; a successful or failed delete of any single file; the 2026-08-10 attempts |
| Q6 | The Members group membership list, plus a check for direct site grants to Justin | "He could edit, so he must be a Member" |
| Q7 | Checked Out To blank **and** a retry after Word is fully closed for ~15 minutes → H1; a name in the column → a real check-out, holder identified | Either 2026-08-10 attempt |
| Q8 | Closed — settled by documentation in §3 | — |
| Q9 | A named owner of the setting and an explicit statement about change notification | — |
| Q10 | Confirmation that a support case is openable and by whom | — |
| Q11 | Justin's written acceptance of the bar | — |

**A universal constraint on all of the above:** no gate may be closed by
deleting, restoring, or altering a governed artifact. If an empirical delete test
is ever wanted, it must use a disposable file the tester created, in a
non-governed location, that nobody has open — and even then it establishes only
*delete-own*, since some configurations permit that while restricting
delete-others.

---

## 8. Consequence of each possible answer

**Q1 — second-stage bin**

- *Exists and an SCA can open it* (expected): ordinary deletion has a 93-day,
  two-stage safety net with a named human able to restore. The
  "no administrator safety net" premise in current docs is retired. Editor
  delete rights (Q5) drop from severe to moderate.
- *Genuinely absent*: first-stage recovery is the only remedy before Microsoft's
  14-day backup window. Q5 becomes the single most important control, and the
  retained-copy milestone decision gains a second independent justification.

**Q3/Q4 — retention**

- *A retention policy covers the site*: strongest possible outcome for
  durability. Versioning limits are ignored, users are prevented from deleting
  versions, and deleted originals are copied to the Preservation Hold library —
  Q5 and Q9 both largely defuse. But note the cost: content becomes subject to a
  *disposal* schedule too; if the policy is delete-only or retain-and-delete,
  find out when items age out, because that is a deletion mechanism we do not
  control.
- *A records / regulatory-record label applies*: deletion and possibly editing
  are blocked outright. That is durability, but it may **conflict with the
  editable-writeup product model** — a regulatory record cannot be edited at all.
  Escalate to Justin immediately if this comes back positive.
- *Nothing applies* (also a real possibility): no change to the current risk
  picture, but the question is closed and the Preservation Hold library will
  never appear. Record it as a verified negative, not as "unknown".

**Q5 — editor rights**

- *Delete Items checked* (H1 world): ordinary staff editors can delete governed
  artifacts. Combined with a confirmed second-stage bin this is tolerable;
  combined with a genuinely absent one it is not. Mitigation options, in
  increasing cost: accept + rely on recycle-bin recovery; create a custom level
  without Delete Items for the editor audience; scope the library so only a
  smaller group holds Edit.
- *Delete Items unchecked* (H2 world): member-caused loss drops sharply, the
  administrator-restore feature becomes safe to build, and Connor's "limited
  control" is explained as a real custom level. **This does not reopen the
  milestone copy-the-bytes decision** — delete rights were one of four reasons,
  and copy also survives a lowered version limit, unreadable retention, and a
  missing second-stage bin.
- *Delete Versions unchecked but Delete Items checked* (or the reverse): a real
  and informative combination; record both checkboxes separately rather than
  collapsing to "can/can't delete".
- *Manage Permissions checked*: escalate. That would mean ordinary editors can
  re-permission the library, which is a larger finding than the delete question.

**Q6 — Justin's grant**

- *In Members*: the pilot did exercise the ordinary-editor path; its edit
  evidence generalizes.
- *Direct or elevated grant*: the pilot's edit evidence does **not** generalize,
  and a second edit test by a genuine ordinary member is needed before the
  staff-wide Editor Dashboard audience is assumed to work.

**Q9 — version-limit change**

- Any answer leaves the residual: the limit is administratively lowerable, prunes
  immediately, and cannot be read programmatically. This is the one durability
  argument no administrator answer can remove, and it is why a retained snapshot
  is independent of all the above.

---

## 9. Recommended sequencing

**Revised 2026-08-11 after the live attempt.** Step 0 now precedes everything on
the Connor side: **get one working administrative surface (Q13).** The questions
are already written and Connor is willing; what failed was access. Options, in
order of expected cost: have Connor navigate to classic Site Settings through
the UI rather than by URL (the route that worked for the Versioning page on
2026-08-10); or get a Windows machine with the SharePoint Online Management
Shell and SharePoint-admin credentials; or register an Entra app for
PnP.PowerShell, which also answers the second-stage bin directly via
`Get-PnPRecycleBinItem -SecondStage`. Do not re-ask the questions until one of
these exists.

Then:

1. **Ask Q2 first (site collection administrator identity).** One question, and
   it names the person who can answer Q1 and half of Q4. Cheapest unblock in the
   brief. It can ride along in the Connor message.
2. **Run the free check now: add the "Checked Out To" column** (Q7 half a). No
   administrator, no risk, and it either explains the 2026-08-10 asymmetry or
   surfaces an orphaned check-out — which is itself a finding worth having.
3. **Send both messages in parallel** (§10 Connor, §11 compliance admin). They
   have disjoint owners and no dependency between them. Do not serialize.
4. **When the SCA is named, route Q1 + the Preservation Hold library sighting to
   them.** These are the same person's two clicks.
5. **When Q5's checkboxes come back, update the durability model once** — do not
   re-derive it per answer.
6. **Then, and only then, take Q11 to Justin** with a complete evidence picture.
7. Q10 is genuinely low-priority — it is the remedy of last resort. Ask it, but
   do not let it gate anything.

Independent of all of it: the **milestone snapshot producer** (copy the bytes,
decided 2026-08-10) is not blocked by any question here and can proceed whenever
it reaches the queue. Its whole point is that it depends on none of these answers.

---

## 10. Connor-ready follow-up message

> **Subject:** Follow-up on the SharePoint library questions — two things to look at
>
> Hi Connor,
>
> Thanks for the answers last week — the versioning one checked out exactly as
> you said, and I was able to confirm the library's settings myself.
>
> Two follow-ups, both just "look and tell me what it says" — please don't change
> anything on these pages.
>
> **1. The Members permission level.** You mentioned site members have "limited
> control". I want to make sure I understand what that allows. In Site Settings →
> Site permissions, could you tell me:
>
> - the exact permission level name shown next to the **Members** group; and
> - if you click into that level, whether these three boxes are checked or
>   unchecked: **Delete Items**, **Delete Versions**, **Manage Permissions**.
>
> The checkbox list is really the part I need — the level name on its own doesn't
> tell me, because those levels can be customized while keeping their original
> name. What I'm trying to establish is whether an ordinary staff editor can
> delete one of these documents or its version history, since we're about to have
> a number of staff editing them.
>
> Also: am I in that Members group, or do I have access some other way? I've been
> doing the testing myself and I want to make sure I've been testing the same
> experience everyone else will get.
>
> **2. Who is a site collection administrator on this site?** When I tried to open
> the site collection recycle bin I got an access-denied message, which I now
> think just means I'm not a site collection admin rather than that the bin
> doesn't exist — Microsoft's docs say that view is admin-only and invisible to
> everyone else. If you can point me at whoever holds that role, I'll take it up
> with them directly.
>
> One last small one: who's able to change the library's versioning settings, and
> would anyone be notified if that changed?
>
> Thanks,
> Justin
>
> ```
> Reply template
> ------------------------------------------------
> Members permission level name: ______________
>   Delete Items:        checked | unchecked
>   Delete Versions:     checked | unchecked
>   Manage Permissions:  checked | unchecked
> Justin is in Members:  yes | no (access via: ______________)
> Site collection admin(s): ______________
> Who can change versioning settings: ______________
> Change notification exists: yes | no
> ------------------------------------------------
> ```

---

## 11. Message for the M365 / Purview compliance administrator

> **Subject:** Question — retention and recycle-bin configuration on one SharePoint site
>
> Hi,
>
> We're finalizing how a set of grant documents is stored and protected in
> SharePoint, and I need to understand what compliance configuration is already
> in place on the tenant before we decide what to build on our side. Everything
> below is a read-only lookup — I'm not asking for any change.
>
> The site is:
> `https://appriver3651007194.sharepoint.com/sites/akoyaGO`
> The document library is `akoya_request`.
>
> **1. Retention policies.** In the Microsoft Purview portal, Data lifecycle
> management → **Policy lookup** → choose **Site** and paste that exact URL. Is
> the site in scope of any retention policy? If it is: is it retain-only,
> delete-only, or retain-and-delete; for how long; and is Preservation Lock
> applied to it?
>
> **2. Retention labels.** Are any retention labels published to or auto-applied
> in that site or library? If so, do any of them mark items as **records** or
> **regulatory records**? (This matters to us specifically because staff need to
> keep editing these documents — a records label would prevent that.)
>
> **3. Other holds.** Is the site under any eDiscovery hold or Litigation Hold?
>
> **4. Preservation Hold library.** Does one appear in that site's Site contents?
>
> **5. Second-stage recycle bin.** We were told there isn't one. My understanding
> is that view is only visible to site collection administrators, so I'd like to
> confirm rather than take it at face value. Who holds site collection
> administrator rights on this site, and when they open
> `/_layouts/15/AdminRecycleBin.aspx?view=13`, what do they see? (An empty bin is
> a fine answer — I need to know it exists and that someone can restore from it.)
>
> **6. Last-resort restore.** If content were ever permanently deleted, is
> opening a Microsoft support case for a point-in-time restore something you'd be
> able to do, and within what timeframe?
>
> Happy to jump on a call if that's faster than writing it out.
>
> Thanks,
> Justin
>
> ```
> Reply template
> ------------------------------------------------
> 1 Retention policy in scope:   yes | no
>     if yes — type:             retain-only | delete-only | retain-and-delete
>     duration:                  ____________
>     Preservation Lock:         yes | no
> 2 Retention labels applied:    yes | no
>     marks items as record:     yes | no | regulatory record
> 3 eDiscovery / Litigation Hold: yes | no
> 4 Preservation Hold library present: yes | no
> 5 Site collection admin(s):    ______________
>     second-stage bin opens:    yes | no      contents: empty | ___ items
> 6 Point-in-time restore case openable by you: yes | no
> ------------------------------------------------
> ```

---

## 12. Contradictions and stale claims found in durable documentation

Audited: `docs/DATAVERSE_SHAREPOINT_FILE_MODEL.md`,
`docs/INITIAL_ASSESSMENT_CONTROLLED_PILOT_2026-07-30.md`,
`docs/CURRENT_WORK_QUEUE.md`, `docs/REQUEST_WORKBENCH_NEAR_TERM_EXECUTION_PLAN.md`,
`docs/STRATEGY.md`, `docs/atlas/dataverse-wmkf-requestdocument.md`,
`docs/agent-wiki/topics/strategy-roadmap.md`,
`.claude-memory/project-j27-doc-capture-evolution.md`,
`.claude-memory/project-reviewer-apps-redesign-direction.md`.

**Stale — the version-limit element only. Two present-tense restatements say the
configured limit is unanswered; it was answered on 2026-08-10 from the signed-in
Versioning Settings page.** Both are corrected in the same commit as this brief:

1. `docs/INITIAL_ASSESSMENT_CONTROLLED_PILOT_2026-07-30.md` item 5 —
   "**Version limits — still open.** … the configured *limit* is the unanswered
   part". This contradicts the same document's own evidence-matrix row
   ("version policy now fully ANSWERED"), so the doc disagreed with itself.
2. `docs/CURRENT_WORK_QUEUE.md` row 1 — "major versioning confirmed on but the
   configured limit unanswered".

**Not stale — leave as written.** The remaining restatements are historical
claims about what the 2026-07-30 audit did or did not prove
(`docs/REQUEST_WORKBENCH_NEAR_TERM_EXECUTION_PLAN.md:99–101, 173–179, 1009`;
`docs/STRATEGY.md:159–160`; `docs/agent-wiki/topics/strategy-roadmap.md:268–269`;
`docs/atlas/dataverse-wmkf-requestdocument.md:109–110`;
`.claude-memory/project-j27-doc-capture-evolution.md:89–90`;
`.claude-memory/project-reviewer-apps-redesign-direction.md:69–70`). "That audit
did not prove the version limit" remains true of that audit. Only present-tense
"remains open" phrasing about the **version limit** is stale — and second-stage
recovery, Purview retention, and editor least privilege genuinely do remain open
in all of them.

**Not a contradiction, but a framing to watch.** `docs/DATAVERSE_SHAREPOINT_FILE_MODEL.md`
says of the second-stage bin: "Taken at face value, an item purged from … the
first-stage bin is **unrecoverable**, and there is no administrator safety net
behind ordinary deletion." That sentence is correctly hedged ("taken at face
value", "confirm this one") and should stay. This brief adds the specific
Microsoft-documented mechanism — admin-only visibility — that most likely
explains the report. That strengthens the existing hedge rather than replacing it.

**No claim in this brief converts a platform default into tenant current state.**
Everything about this tenant's second-stage bin, retention posture, and Members
level remains `[OPEN]` or `[ADMIN REPORT — UNCONFIRMED]` until §7's closing
evidence arrives.

---

## Sources

Microsoft documentation cited above, all retrieved 2026-08-11:

- [Understanding permission levels in SharePoint](https://learn.microsoft.com/en-us/sharepoint/understanding-permission-levels) — permission-level tables, Delete Items / Delete Versions / Manage Permissions, "you can change any of the default permission levels, except Full Control and Limited Access", Company Administrators → Site Collection Administrators
- [Microsoft 365 SharePoint Data Deletion](https://learn.microsoft.com/en-us/sharepoint/sharepoint-data-deletion) — two-stage recycle bin lifecycle, immediate purge from second stage, 14-day backup and point-in-time restore
- [Learn about retention for SharePoint and OneDrive](https://learn.microsoft.com/en-us/purview/retention-policies-sharepoint) — Preservation Hold library, "the second-stage Recycle Bin isn't visible to end users … but site collection admins can view and restore content from there", versioning limits ignored under a retention policy, records / regulatory-record restrictions
- [Restore deleted items from the site collection recycle bin](https://support.microsoft.com/en-us/office/restore-deleted-items-from-the-site-collection-recycle-bin-5fa924ee-16d7-487b-9a0a-021b9062d14b) — SCA access, UI path to the second-stage bin
- [Configure Microsoft 365 retention settings](https://learn.microsoft.com/en-us/purview/retention-settings) and [Learn about retention policies & labels](https://learn.microsoft.com/en-us/purview/retention) — Policy lookup by exact site URL
- [Manage the Recycle Bin of a SharePoint site](https://support.microsoft.com/en-us/office/manage-the-recycle-bin-of-a-sharepoint-site-8a6c2198-910e-42dc-9a9c-bc5bc4f327da) — 93-day window spanning both stages
