# SharePoint storage, recovery, retention, and editing policy — decision-ready question brief

**Written:** 2026-08-11 (S415), by Claude, for Justin. Adversarially reviewed
and corrected by Codex on 2026-08-11.
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
contract"). The configured ceiling is no longer unknown. `[VERIFIED via
Microsoft documentation]` If an administrator lowers a count limit, SharePoint
does **not** prune all excess versions immediately: it gradually removes up to
20 old versions each time a new version is created until the library reaches the
new limit. The residual is therefore an administrator-change and later-editing
risk, not an immediate-prune event.

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
  the level's name is not sufficient. Library inheritance and the permissions
  actually effective for ordinary editors must be read.**

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

**Finding 1 — Connor's wording is explained, but the assigned permission level
is not.** `[VERIFIED via screenshot 2026-08-11]` The modern pane displayed
"limited control" beside Site members, "full control" beside Site owners, and
"no control" beside Site visitors. Connor quoted that pane accurately.
`[VERIFIED via Microsoft documentation]` "Limited control" is not a documented
built-in permission-level name. `[OPEN]` Neither the screenshot nor current
Microsoft documentation proves that these three captions are fixed across all
modern panes, and the screenshot does not reveal the actual role definition.
H1 (a transient lock) and H2 (a role without Delete) therefore remain unranked;
library inheritance plus the effective role/permissions are the closing evidence
for Q5.

**Finding 2 — NEW broad site-membership signal, narrower than first reported.**
`[VERIFIED via screenshot 2026-08-11]` **"Everyone except external users"** is
shown in Site members. `[VERIFIED via Microsoft documentation]` EEEU includes
all internal users and excludes guests; it does not mean "every licensed user."
Microsoft automatically adds EEEU to Members on public group-connected team
sites, but also documents that it can be added manually on a private
group-connected site. `[OPEN]` The screenshot therefore does not establish this
site's template/privacy, the actual Members role definition, or whether
`akoya_request` inherits the site's permissions. It proves a broad site-level
principal, not tenant-wide edit rights on the governed library. See Q12.

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
  Shell is Windows-only). `[VERIFIED via PnP documentation]` PnP.PowerShell is
  cross-platform, but interactive tenant use requires an Entra app client ID;
  CLI for Microsoft 365 is another cross-platform option with the same tenant
  registration/consent prerequisite.

**Therefore the failed UI route is a tooling/access blocker, not proof that the
questions are unanswerable.** Tomorrow's session can use signed-in navigation,
or a consented cross-platform PnP/CLI session; §6 records the exact read-only
commands and prerequisites.

---

## 2. Open questions

| # | Question | Status | Owner |
|---|---|---|---|
| Q1 | Does a second-stage (site collection) recycle bin exist for this site, and what is in it? | `[ADMIN REPORT — UNCONFIRMED]` negative; contradicted by platform default | Site collection administrator |
| Q2 | **Who holds site collection administrator rights on `/sites/akoyaGO`?** | `[OPEN]` | Justin → Connor / DFT |
| Q3 | Does any Microsoft Purview **retention policy** include this site in scope? | `[OPEN]` | M365/Purview compliance admin |
| Q4 | Does any **retention label** or **eDiscovery hold** apply to this library or its items? | `[OPEN]` (one item probed, negative, n=1) | M365/Purview compliance admin (+ SCA for the Preservation Hold library check) |
| Q5 | What is the **real permission level** behind "limited control", and does its definition grant **Delete Items**, **Delete Versions**, **Manage Permissions**? | `[ADMIN REPORT — UNCONFIRMED]`, ambiguous | Connor / site owner |
| Q6 | Is Justin **in the Members group** or granted directly/elevated? | `[OPEN]` | Connor / site owner |
| Q7 | Was the 2026-08-10 delete refusal a transient lock (H1) or a level without Delete (H2)? | `[OPEN]` — the attempts settle nothing | Independently verifiable (Justin) |
| Q8 | Do ordinary editors hold **move/rename** authority? | `[OPEN]` — no separate permission name is documented, but the operation-to-permission mapping was not found | SharePoint admin / non-governed test if needed |
| Q9 | Who can lower the 500-major-version limit, and would we detect it? | `[PARTIAL]` — current value is programmatically readable; owner/notification remain open | SharePoint admin + Justin |
| Q10 | Is Microsoft's 14-day post-deletion backup / point-in-time restore reachable for us, and by whom? | `[OPEN]` | M365 admin (DFT) |
| Q11 | **Acceptance thresholds:** what evidence does Justin require before declaring the artifact system production-ready? | `[OPEN]` — product decision | Justin |
| Q12 | **NEW 2026-08-11.** Why is "Everyone except external users" in Site members; what is the site privacy/type; and does `akoya_request` inherit those permissions? | `[VERIFIED]` group shown in Members; all consequences `[OPEN]` | SharePoint admin / site owner + Justin |
| Q13 | **NEW 2026-08-11.** Which non-classic administrative surface will be used? | `[PARTIAL]` — viable PnP/CLI routes identified; tenant app registration/consent still required | SharePoint admin |

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
- `[VERIFIED via Microsoft documentation]` Current SharePoint documentation says
  Company Administrator contains Global Administrators and that Global
  Administrators also have the SharePoint Administrator role. It does **not**
  establish that every Global Administrator is already a site administrator for
  this non-root site. Another Microsoft page still carries older wording that
  includes Billing Administrators, so neither statement is accepted as this
  tenant's current site-admin roster.
- `[VERIFIED via live read-only probe 2026-08-11]` The app token's JWT carries
  only `Sites.Selected`, and `GET /sites/{siteId}/permissions` returned `403
  accessDenied`. `[VERIFIED via Microsoft documentation]` That Graph endpoint
  requires `Sites.FullControl.All` and enumerates Graph permission resources
  (application grants); it is not the human Members/role-definition inventory
  this brief needs.

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
  hold source for a SharePoint site — an eDiscovery case hold can preserve site
  content independently. Litigation Hold is an Exchange mailbox control, not a
  SharePoint-site hold, and is deliberately excluded from the question.

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
- `[VERIFIED via Microsoft documentation]` A separate current article says the
  permissions of default Owners/Members/Visitors groups cannot be modified on a
  team site connected to a Microsoft 365 group. `[OPEN]` Because this site's
  type/connection is not established, that restriction cannot be converted into
  tenant state; it is another reason to read the actual assignment rather than
  infer it.
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

- `[OPEN]`. Adding the **"Checked Out To"** column can establish whether an
  explicit checkout exists *now*. A current name identifies its holder and may
  reveal an orphaned checkout; a blank value now cannot reconstruct the
  historical 2026-08-10 lock and does not favour H1.
- `[VERIFIED via repository/source]` Check-out is **not required** on this
  library, so any check-out present is incidental, not policy.

### Q8 — Move / rename authority

**Not answerable from the documentation reviewed.**
`[VERIFIED via Microsoft documentation]` The documented list-permission set
contains **no separate "move" or "rename" permission** — verified as an absence
across the full documented set, not inferred. Their decomposition — renaming as
an `Edit Items` operation, moving as `Add Items` at the destination plus
`Delete Items` at the source — is `[ASSUMED]`; Microsoft states the permission
set, not that mapping. Therefore Q8 remains `[OPEN]` unless an authoritative
mapping is found or a disposable, non-governed item is used for an authorized
test. `[VERIFIED via repository/source]` If SharePoint preserves the drive/item
identity through an operation, both consumers resolve that identity and refresh
the current `webUrl`; the repository does not prove that SharePoint preserves
identity for every cross-library move.

### Q9 — Administrative change of the version limit

- `[VERIFIED via repository/source]` The limit is 500 majors, no age expiry, and
  the Versioning Settings page both shows and sets it. `[VERIFIED via Microsoft
  documentation]` Lowering a count limit causes gradual trimming on later file
  updates, up to 20 old versions per new version, rather than immediate pruning.
- `[VERIFIED via live Graph probe 2026-08-10]` The version policy is not exposed
  by `GET /drives/{driveId}/list`; its `list` facet carried only
  `contentTypesEnabled`, `hidden`, and `template`. This proves an endpoint gap,
  not a general programmatic gap. `[VERIFIED via Microsoft/PnP documentation]`
  `Get-SPOListVersionPolicy` and cross-platform `Get-PnPListVersionPolicy` are
  read-only programmatic paths. Silent lowering is monitorable once a suitably
  authorized SharePoint-admin/PnP connection exists.
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

### Q12 — Broad site membership and library inheritance (new, 2026-08-11)

- `[VERIFIED via screenshot 2026-08-11]` "Everyone except external users" is in
  the Site members group for `/sites/akoyaGO`.
- `[VERIFIED via Microsoft documentation]` EEEU automatically includes all
  internal users and excludes guests. On a public group-connected team site it
  is automatically in Members; current Microsoft documentation also says it can
  be manually added to a private group-connected site.
- `[OPEN]` The site type/privacy, whether the membership is deliberate, the
  Members role definition, and whether `akoya_request` inherits site
  permissions. Libraries and items can break inheritance, so the screenshot
  alone does not establish access to the governed files.
- **Why it matters here:** if the library inherits the site grant, the effective
  audience is all current and future internal users, which multiplies whatever
  Q5 turns out to be. `[OPEN]` Until inheritance and the role definition are
  read, this is a high-priority exposure question rather than a verified defect.

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
- `[VERIFIED via live read-only probe 2026-08-11]` The configured app can call
  `GET /beta/sites/{siteId}/recycleBin/items` with its current `Sites.Selected`
  token (`200`), despite the current Microsoft permission table not listing
  `Sites.Selected`. The beta resource returns deleted item metadata but no
  stage/`itemState`, so it cannot distinguish or close Q1.
- `[VERIFIED via PnP/CLI documentation]` Cross-platform, non-classic read-only
  routes exist:
  - PnP.PowerShell: `Get-PnPGroupPermissions`, `Get-PnPRoleDefinition`,
    `Get-PnPRecycleBinItem -SecondStage`, and `Get-PnPListVersionPolicy`.
  - CLI for Microsoft 365: `spo site admin list --asAdmin`, `spo site
    recyclebinitem list --secondary`, and `spo roledefinition list`.
  These require a tenant Entra app registration/client ID, the applicable
  delegated/admin consent, and an operator with the documented SharePoint role;
  `Get-PnPRecycleBinItem -SecondStage` specifically requires site collection
  administrator rights (tenant SharePoint Administrator alone is insufficient).
- `[VERIFIED via Microsoft documentation]` Purview Policy lookup in the browser
  is already a non-classic, read-only route for Q3/Q4 and needs a Purview role.
  Q13 is therefore `[PARTIAL]`: the routes exist; tenant authorization/setup is
  the remaining prerequisite.

---

## 4. Decision / evidence owner map

| Owner | Questions | Why this owner |
|---|---|---|
| **Connor / site owner** | Q5, Q6, Q12 | Site permissions and membership are site-owner surfaces if the account has Manage Permissions. He already engaged on these. |
| **Site collection administrator** (identity unknown — Q2) | Q1, Q4 (Preservation Hold library sighting) | Microsoft documents the second-stage bin and the Preservation Hold library as visible **only** to site collection admins. No one else can answer. |
| **M365 / Purview compliance administrator** (likely DFT `[ASSUMED]`) | Q3, Q4, Q10 | Policy lookup, retention labels, hold sources, and Microsoft support cases are tenant-compliance surfaces. Connor explicitly disclaimed this. |
| **SharePoint Administrator** | Q2, Q9, Q13; can route Q1 | Microsoft documents that the Site Collection Administrators link is not shown to site owners. CLI `spo site admin list --asAdmin` is an alternative inventory path. |
| **Justin / product owner** | Q11, and the Q9/Q12 risk-acceptance | These are "what evidence is enough" and "what residual risk do we carry" decisions. |
| **Independently verifiable (us, non-destructively)** | Current Checked Out To state; Graph beta recycle-bin inventory without stage; item-level `retentionLabel` read (already done, n=1) | These are partial signals and do not close Q1, Q5, Q7, or Q8. |

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
4. Does the `akoya_request` library inherit permissions from the site, or does
   it have unique permissions?

**To the SharePoint Administrator:**

1. Who is listed as a site administrator for `/sites/akoyaGO`?
2. Who can change the library's versioning settings, and is anyone notified if
   they do?
3. Please run `Get-SPOListVersionPolicy` or `Get-PnPListVersionPolicy` read-only
   and report the effective policy; do not change it.

**To the M365 / Purview compliance administrator:**

1. Using **Policy lookup** in the Microsoft Purview portal (Data lifecycle
   management → Policy lookup → Site), paste the exact site URL: is
   `https://appriver3651007194.sharepoint.com/sites/akoyaGO` in scope of any
   **retention policy**? If yes: retain-only, delete-only, or retain-and-delete;
   how long; and is Preservation Lock applied?
2. Are any **retention labels** published to, or auto-applied in, this site or
   the `akoya_request` library? If yes, do any of them mark items as **records**
   or **regulatory records**?
3. Is the site subject to any **eDiscovery hold**?
4. Is there a **Preservation Hold library** in this site's Site contents?
5. Who holds **site collection administrator** rights on this site, and can they
   open its **second-stage (site collection) recycle bin** — the view at
   `/_layouts/15/AdminRecycleBin.aspx?view=13`? What does it show?
6. If content were ever hard-deleted, could you open a Microsoft support case for
   a point-in-time restore within the 14-day window?

**To Justin (product decisions, no lookup required):**

1. Are the §7 closing criteria the right bar, or should any be tightened/waived?
2. Given that a lowered count limit gradually trims old versions on later edits,
   should a SharePoint-admin read-only policy check be monitored periodically?

---

## 6. Exact UI paths and read-only checks

All read-only. None of these changes a setting, deletes anything, or alters a
governed artifact.

| Check | Path | Who can run it |
|---|---|---|
| Members permission assignment/definition | Site permissions → Advanced Permissions Settings → inspect Members' assigned role, then its **Delete Items**, **Delete Versions**, **Manage Permissions** checkboxes | Account with Manage Permissions / SCA |
| Is Justin in Members? | Site permissions → open the Members group → member list; also check for direct grants on the site | Account with Manage Permissions / SCA |
| Does the library inherit? | Library settings → Permissions for this document library → read whether it inherits from the parent | Account with Manage Permissions / SCA |
| Site administrators | SharePoint admin center, or `m365 spo site admin list --siteUrl <url> --asAdmin` | SharePoint Administrator |
| Second-stage recycle bin | Site contents → **Recycle bin** → at the bottom of the page, **second-stage recycle bin** (equivalently `/_layouts/15/AdminRecycleBin.aspx?view=13`) | **Site collection administrator only** |
| Preservation Hold library sighting | Site contents → look for **Preservation Hold Library** | Site collection administrator only |
| Retention policy scope | Microsoft Purview portal → Data lifecycle management → **Policy lookup** → **Site** → paste the exact site URL | Purview/compliance admin |
| Retention labels in the library | Library view → add the **Retention label** column, or Purview → Records management → label policies | Purview/compliance admin |
| Versioning settings (re-verify only) | `https://appriver3651007194.sharepoint.com/sites/akoyaGO/akoya_request` → gear → Library settings → More library settings → **Versioning settings** | Site owner |
| "Checked Out To" (Q7 half a) | Library view → **Add column** → show existing column → **Checked Out To** | Justin (already has library access) |
| Effective version policy | `Get-SPOListVersionPolicy -Site <url> -List akoya_request`, or cross-platform `Get-PnPListVersionPolicy -Site <url> -Identity akoya_request` | SharePoint Administrator / suitably consented PnP operator |
| Second-stage bin without classic UI | `Get-PnPRecycleBinItem -SecondStage`, or `m365 spo site recyclebinitem list --siteUrl <url> --secondary` | Site collection administrator; consented PnP/CLI app |

**Two operating rules carried forward, both learned the hard way:**

- **Send administrators the UI path, never a reconstructed deep link.** A
  `_layouts/15/VersionSettings.aspx?List={guid}` link built from the verified
  list GUID `fd037f0b-8df4-41f5-8fed-c3984d351918` failed on 2026-08-10 while
  the same user reached the same page through the UI minutes later. Rights were
  ruled out as the cause; the URL form is simply unreliable here.
- **The Versioning settings page sets the value as well as showing it.** Lowering
  a count limit gradually trims excess old versions on subsequent file updates.
  Say "read and report, change nothing" explicitly whenever you send someone to
  it.

---

## 7. What closes each gate

| # | Closing evidence | Not sufficient |
|---|---|---|
| Q1 | A named site collection administrator opens the second-stage view and reports what they see (including "empty" — empty is a pass, absent is not) | Connor's report; any end-user's inability to see it; any inference from the first-stage bin |
| Q2 | A name (or names) from the SharePoint admin center, or `spo site admin list --asAdmin` run by a SharePoint Administrator | Inferring the roster from a tenant role or site-owner status |
| Q3 | A Policy lookup result for the exact site URL — positive **or** negative, screenshot or transcribed | The item-level Graph `retentionLabel` read; absence of a Preservation Hold library alone (a delete-only policy creates no copies until triggered) |
| Q4 | Label-policy list plus explicit "no eDiscovery hold" from the compliance admin | n=1 item probe |
| Q5 | The **checkbox state** of Delete Items / Delete Versions / Manage Permissions on the role assignment actually effective for ordinary editors at `akoya_request`, plus inheritance/direct-grant confirmation | The site-level Members role alone if the library has unique permissions; the level's *name*; a successful or failed delete of any single file; the 2026-08-10 attempts |
| Q6 | The Members group membership list, plus a check for direct site, library, or item grants to Justin | "He could edit, so he must be a Member" |
| Q7 | A current name in Checked Out To establishes a current explicit checkout; the historical 2026-08-10 lock cause is otherwise not recoverable. Q5's inheritance/effective-permission read settles current delete authority independently. | A blank current column; either 2026-08-10 attempt; any governed-file delete retry |
| Q8 | Authoritative operation-to-permission documentation, or an authorized disposable non-governed test that separately covers rename and same/cross-library move | Absence of separate permission names; assuming Edit/Delete mapping |
| Q9 | Read-only `Get-SPOListVersionPolicy`/`Get-PnPListVersionPolicy` result plus a named owner and explicit statement about notification | Graph list-facet absence |
| Q10 | Confirmation that a support case is openable and by whom | — |
| Q11 | Justin's written acceptance of the bar | — |
| Q12 | Site type/privacy, EEEU assignment intent, and `akoya_request` inheritance/unique-permission result | Inferring public/privacy or library access from the modern site-level pane |

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
- *Delete Items unchecked* (H2 world): member-caused loss drops sharply and the
  administrator-restore feature becomes safer to build. It does not explain the
  modern pane's descriptive wording. **This does not reopen the
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

- The limit is administratively lowerable and gradual trimming follows later
  edits. `[VERIFIED via Microsoft/PnP documentation]` It can be read
  programmatically by a sufficiently authorized operator, so a periodic control
  is feasible. A retained snapshot remains independent protection against both
  policy changes and ordinary version-history loss.

---

## 9. Recommended sequencing

**Revised 2026-08-11 after adversarial review.** Step 0 is to choose a working
read-only administrative surface. Cheapest: signed-in UI navigation if the
account has Manage Permissions. Cross-platform fallback: tenant-consented
PnP.PowerShell or CLI for Microsoft 365. A Windows machine is required only for
Microsoft's SharePoint Online Management Shell, not for PnP/CLI.

Then:

1. **Route Q2 to the SharePoint Administrator first.** Current Microsoft
   documentation says the Site Collection Administrators link is not shown to
   site owners. The admin center or `m365 spo site admin list --asAdmin` can name
   the person who can answer Q1 and inspect the Preservation Hold library.
2. **Optionally add the "Checked Out To" column.** A current name is useful; a
   blank value cannot reconstruct the historical 2026-08-10 lock and does not
   close Q7.
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
> **2. Does this library inherit the site's permissions?** The same pane showed
> "Everyone except external users" in Site members. Could you open the
> `akoya_request` library's permissions page and tell me whether it inherits from
> the site or has unique permissions? If it is unique, please report the group or
> principal that ordinary editors use, its assigned role, and the same three
> permission checks there. Please don't change inheritance or sharing.
>
> If you know who the SharePoint Administrator is, please point me to them; that
> person can identify the site administrators and answer the recycle-bin question.
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
> akoya_request inherits site permissions: yes | no
>   if no — ordinary-editor principal/role: ______________
>   Delete Items / Delete Versions / Manage Permissions: ______________
> SharePoint Administrator contact (if known): ______________
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
> **regulatory records**? (This matters because staff need to keep editing these
> documents — regulatory records cannot be edited, while ordinary record behavior
> also depends on the tenant's record settings.)
>
> **3. Other holds.** Is the site under any eDiscovery hold?
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
> 3 eDiscovery hold:              yes | no
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

**The Codex adversarial pass corrected four places that had converted partial
evidence into tenant state:** EEEU membership did not prove public-site status or
library inheritance; a single pane did not prove fixed global captions; absence
of move/rename permission names did not prove operation mapping; and the Graph
list facet did not prove the policy was unreadable by all programmatic means.
Everything about this tenant's second-stage bin, retention posture, Members role,
library inheritance, and move/rename authority remains `[OPEN]` or `[ADMIN REPORT
— UNCONFIRMED]` until §7's closing evidence arrives.

### Repository-side verification requested by the handoff

| Claim | Result | Evidence |
|---|---|---|
| The app token holds only `Sites.Selected` | **CONFIRMED as live external state, not provable from source alone.** `[VERIFIED via repository/source + live read-only probe 2026-08-11]` Source requests the app registration's Graph `.default` scope; the decoded production JWT contained exactly `Sites.Selected`. | `lib/services/graph-service.js:101-143`; probe printed claims only, never the token |
| The app cannot enumerate site permissions | **CONFIRMED narrowly; broader wording refuted.** `[VERIFIED via live read-only probe]` `/sites/{siteId}/permissions` returned `403`. `[VERIFIED via Microsoft documentation]` it requires `Sites.FullControl.All` and lists Graph application permission resources, not human SharePoint group/role assignments. Delegated PnP/CLI can read the human configuration with the prerequisites in Q13. | `lib/services/graph-service.js:101-143`; Microsoft Graph and PnP sources below |
| The version limit is absent from the Graph list facet | **CONFIRMED for that endpoint; general impossibility refuted.** `[VERIFIED via live probe 2026-08-10]` the returned facet had only `contentTypesEnabled`, `hidden`, `template`. `[VERIFIED via Microsoft/PnP documentation]` `Get-SPOListVersionPolicy` and `Get-PnPListVersionPolicy` can read it programmatically. | Live endpoint evidence; official cmdlet sources below |
| Both consumers resolve by stable drive/item ID, not path/filename | **CONFIRMED, with one nuance.** `[VERIFIED via repository/source]` Dataverse supplies drive/item identity; the service fetches exact `/drives/{driveId}/items/{itemId}`, validates the returned ID, overlays its current `webUrl`, and both consumers render that DTO. The browser link is the refreshed `webUrl`, not a hand-built item-ID URL. | `lib/services/initial-assessment/artifact-service.js:206-244,279-375,1182-1268`; `lib/services/graph-service.js:387-437`; `shared/components/workbench/ArtifactFileMetadata.js:19-37`; `shared/components/workbench/InitialAssessmentTab.js:146-165`; `pages/workbench/artifacts.js:108-128` |
| Current app can read a site recycle-bin inventory | **CONFIRMED, but does not close Q1.** `[VERIFIED via live read-only probe 2026-08-11]` Graph beta returned `200` with the current `Sites.Selected` token. `[VERIFIED via Microsoft documentation]` the beta resource exposes no stage/`itemState`, so first versus second stage cannot be determined from it. | Microsoft Graph beta sources below |

---

## Sources

Microsoft documentation cited above, all retrieved 2026-08-11:

- [Understanding permission levels in SharePoint](https://learn.microsoft.com/en-us/sharepoint/understanding-permission-levels) — permission-level tables, Delete Items / Delete Versions / Manage Permissions, inheritance, and customizable default levels
- [Default SharePoint groups](https://learn.microsoft.com/en-us/sharepoint/default-sharepoint-groups) and [EEEU activity report](https://learn.microsoft.com/en-us/sharepoint/data-access-governance-everyone-except-external-user-report) — EEEU includes internal users/excludes guests; public-site defaults versus manually added membership; current Global Administrator/SharePoint Administrator description
- [Customize SharePoint site permissions](https://learn.microsoft.com/en-us/sharepoint/customize-sharepoint-site-permissions) — Advanced Permissions path; Site Collection Administrators link requires SharePoint Administrator and is hidden from site owners
- [Set version limits for an individual library](https://learn.microsoft.com/en-us/sharepoint/library-version-limits) — `Get-SPOListVersionPolicy` and gradual trimming after a count-limit reduction
- [Get-PnPListVersionPolicy](https://pnp.github.io/powershell/cmdlets/Get-PnPListVersionPolicy.html), [Get-PnPGroupPermissions](https://pnp.github.io/powershell/cmdlets/Get-PnPGroupPermissions.html), [Get-PnPRoleDefinition](https://pnp.github.io/powershell/cmdlets/Get-PnPRoleDefinition.html), and [Get-PnPRecycleBinItem](https://pnp.github.io/powershell/cmdlets/Get-PnPRecycleBinItem.html) — cross-platform read-only alternatives and SCA prerequisite for second stage
- [PnP app registration](https://pnp.github.io/powershell/articles/registerapplication.html) and [CLI for Microsoft 365 login](https://pnp.github.io/cli-microsoft365/cmd/login/) — tenant app/client-ID and consent prerequisites
- [Microsoft Graph site permissions](https://learn.microsoft.com/en-us/graph/api/site-list-permissions?view=graph-rest-1.0) — `Sites.FullControl.All` requirement and Graph permission-resource scope
- [Microsoft Graph beta recycle-bin list](https://learn.microsoft.com/en-us/graph/api/recyclebin-list-items?view=graph-rest-beta) and [recycleBinItem resource](https://learn.microsoft.com/en-us/graph/api/resources/recyclebinitem?view=graph-rest-beta) — read-only site inventory; beta resource has no stage property
- [CLI for Microsoft 365 site-admin list](https://pnp.github.io/cli-microsoft365/cmd/spo/site/site-admin-list/), [secondary recycle-bin list](https://pnp.github.io/cli-microsoft365/cmd/spo/site/site-recyclebinitem-list/), and [role-definition list](https://pnp.github.io/cli-microsoft365/cmd/spo/roledefinition/roledefinition-list/) — cross-platform admin alternatives
- [Microsoft 365 SharePoint Data Deletion](https://learn.microsoft.com/en-us/sharepoint/sharepoint-data-deletion) — two-stage recycle bin lifecycle, immediate purge from second stage, 14-day backup and point-in-time restore
- [Learn about retention for SharePoint and OneDrive](https://learn.microsoft.com/en-us/purview/retention-policies-sharepoint) — Preservation Hold library, "the second-stage Recycle Bin isn't visible to end users … but site collection admins can view and restore content from there", versioning limits ignored under a retention policy, records / regulatory-record restrictions
- [Create holds in eDiscovery](https://learn.microsoft.com/en-us/purview/edisc-hold-create) — SharePoint sites can be locations in an eDiscovery hold; Litigation Hold is not the SharePoint-site control
- [Restore deleted items from the site collection recycle bin](https://support.microsoft.com/en-us/office/restore-deleted-items-from-the-site-collection-recycle-bin-5fa924ee-16d7-487b-9a0a-021b9062d14b) — SCA access, UI path to the second-stage bin
- [Configure Microsoft 365 retention settings](https://learn.microsoft.com/en-us/purview/retention-settings) and [Learn about retention policies & labels](https://learn.microsoft.com/en-us/purview/retention) — Policy lookup by exact site URL
- [Manage the Recycle Bin of a SharePoint site](https://support.microsoft.com/en-us/office/manage-the-recycle-bin-of-a-sharepoint-site-8a6c2198-910e-42dc-9a9c-bc5bc4f327da) — 93-day window spanning both stages
