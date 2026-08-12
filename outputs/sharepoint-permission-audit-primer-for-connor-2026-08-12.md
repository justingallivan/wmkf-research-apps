# SharePoint permission audit — primer for Connor's Claude Code

**Purpose:** paste everything below the line into a fresh Claude Code session on
Connor's machine. It is written to be self-contained — it assumes no access to
the Wilburforce/WMKF repository and no prior conversation.

**Scope:** a strictly read-only diagnosis of permissions, recycle-bin
configuration, and version policy on one SharePoint site and one document
library. No setting is changed, nothing is deleted, and nothing is restored.

---

# Read-only SharePoint permission and recoverability audit

You are helping me (Connor) run a **read-only diagnostic** against one SharePoint
Online site. Someone else (Justin, at the Wilburforce Foundation) needs specific
facts about how this site and library are configured. Your job is to help me get
the prerequisites working, run the read-only checks I'm authorized to run, and
produce a clean report I can send back.

## The target

- **Site:** `https://appriver3651007194.sharepoint.com/sites/akoyaGO`
- **Document library:** `akoya_request`

## Hard safety rules — these override everything else

1. **Read-only, always.** Never run a `Set-PnP*`, `Add-PnP*`, `Remove-PnP*`,
   `New-PnP*`, `Restore-PnP*`, `Move-PnP*`, or any `Set-SPO*` / `Remove-SPO*`
   cmdlet against this tenant. Only `Get-PnP*` / `Get-SPO*` reads. If you think a
   question can only be answered by a write, **stop and say so** — do not do it.
2. **Never delete, move, rename, or restore a file in this library** to test what
   permissions allow. These are governed grant documents. A destructive test to
   learn whether documents survive destruction is not an acceptable trade.
3. **Do not open the SharePoint "Versioning settings" page and change anything.**
   That page both displays and sets the version limit. Reading is fine; lowering
   a count limit causes SharePoint to gradually trim old versions on subsequent
   edits. Read and report only.
4. **Never enter a password, client secret, certificate password, or any
   credential on my behalf.** Interactive sign-in is mine to complete. If a step
   needs a secret, tell me and let me do it.
5. **If a command fails, report the failure verbatim.** Do not work around it by
   escalating privileges, switching to a write operation, or guessing. A failure
   is data — often it tells us exactly which rights the account lacks.
6. **Record "I couldn't determine this" as a real answer.** An honest unknown is
   more useful here than a confident inference. Do not fill gaps with what is
   probably true.

## What I actually need to find out

Six questions. Each has a specific closing answer — please drive toward those,
not toward a general description of the site.

| # | Question | What counts as a real answer |
|---|---|---|
| **A** | What roles do *I* (the signed-in operator) hold on this site? | Whether I am a **Site Collection Administrator**, a SharePoint Administrator, a site owner, or an ordinary member. This determines which of the checks below I can even run. |
| **B** | What permission level is assigned to the **Members** group, and what does that level actually grant? | The role's **name**, plus the checkbox/flag state of **Delete Items**, **Delete Versions**, and **Manage Permissions**. |
| **C** | Is **Justin Gallivan** an ordinary member, or does he have a direct/elevated grant? | His presence or absence in the Members group, plus any direct grant on the site or library. |
| **D** | Does the `akoya_request` library **inherit** the site's permissions, or does it have unique ones? | `HasUniqueRoleAssignments` true/false. If **true**, also the principal ordinary editors use there, its role, and the same three permissions at library scope. |
| **E** | Does a **second-stage (site collection) recycle bin** exist, and can someone open it? | Only answerable by a Site Collection Administrator. "Empty" is a fine answer; "I can't see it" is *not* the same as "it doesn't exist" — see the note below. |
| **F** | What is the library's effective **version policy**? | Version type, whether a count limit is set and its value, and any age limit. |

## Four things that will mislead you if I don't say them up front

These are the traps this audit has already fallen into once. Please hold them in
mind while interpreting anything you see.

1. **"Limited control" is not a real SharePoint permission level.** The modern
   Site Permissions pane shows friendly captions — "full control", "limited
   control", "no control" — beside Owners/Members/Visitors. Those captions are
   pane wording, *not* the assigned role definition. Reporting "Members have
   limited control" does not answer question B.
2. **The level's name does not tell you what it grants.** Microsoft documents
   that every default permission level *except* Full Control and Limited Access
   can be edited in place. A level can still be named "Edit" while having had
   Delete Items unchecked. **You must read the actual permission flags**, not the
   name. (For reference, the *unmodified* built-ins Edit and Contribute both
   include Delete Items **and** Delete Versions; Manage Permissions appears only
   in Full Control and Manage Hierarchy.)
3. **The second-stage recycle bin is invisible to end users by design.** Not
   seeing it is the documented normal experience for anyone who is not a site
   collection administrator. So "I don't see a second-stage recycle bin" is
   **not** evidence that it is absent — it is most likely evidence about the
   account's rights. Please phrase the finding that way.
4. **Classic `_layouts/15/…` URLs have repeatedly failed on this tenant.** Deep
   links like `settings.aspx`, `user.aspx?view=perms`, `role.aspx`, and
   `VersionSettings.aspx?List={guid}` did not work for the accounts tried, even
   though the pages themselves were reachable by ordinary UI navigation. If a
   deep link 404s or denies, that is a **tooling failure, not a finding** — note
   it and try UI navigation or PowerShell instead.

## Step 0 — Establish what tooling is available (do this first)

Please check my environment before proposing commands:

- Is PowerShell 7+ installed? (`pwsh --version`)
- Is the `PnP.PowerShell` module installed? (`Get-Module -ListAvailable PnP.PowerShell`)
- Am I on Windows, macOS, or Linux?

Notes to save us a detour: Microsoft's **SharePoint Online Management Shell**
(the `*-SPO*` cmdlets) is Windows-only. **PnP.PowerShell** is cross-platform and
is the preferred route here. If `PnP.PowerShell` is missing, the install is
`Install-Module PnP.PowerShell -Scope CurrentUser` — walk me through it, but let
me run it.

**The one prerequisite that may block everything:** interactive PnP sign-in
requires a **tenant-consented Entra (Azure AD) application client ID**. PnP no
longer ships a shared multi-tenant app. If our tenant does not already have one
registered with the appropriate delegated SharePoint permissions and admin
consent, `Connect-PnPOnline -Interactive` will fail with a consent or
client-ID error. If that happens:

- Tell me clearly that a tenant app registration is the blocker.
- Do **not** attempt to register an app, grant consent, or modify tenant
  configuration to get past it — that is a change, and it is not mine to make
  unilaterally in the middle of a read-only audit.
- Fall back to the UI route in the appendix below, which answers most of B, C, D,
  and F without PowerShell.

Do **not** use an app secret or certificate for this. Interactive delegated
sign-in is what we want, because the whole point is to observe what a *human*
operator can see.

## Step 1 — Connect (interactive, delegated)

```powershell
$siteUrl  = "https://appriver3651007194.sharepoint.com/sites/akoyaGO"
$library  = "akoya_request"
$clientId = "<TENANT-CONSENTED-ENTRA-APP-CLIENT-ID>"   # I will supply this

Connect-PnPOnline -Url $siteUrl -Interactive -ClientId $clientId
```

Then confirm who I am and what the site is, before anything else:

```powershell
Get-PnPContext
Get-PnPSite    | Select-Object Url, Id
Get-PnPWeb     | Select-Object Title, Url, Id
Get-PnPProperty -ClientObject (Get-PnPSite) -Property Owner | Select-Object LoginName, Title
```

This is question **A**. If a cmdlet returns access-denied, capture the exact
message — it identifies the missing right.

## Step 2 — Site groups and the Members role definition (question B)

```powershell
$members = Get-PnPGroup -AssociatedMemberGroup
$members | Format-List Id, Title, LoginName, OwnerTitle

# The assigned role for the Members group — the ACTUAL level, not the pane caption
Get-PnPGroupPermissions -Identity $members

# Every role definition on the site, with what each one grants
Get-PnPRoleDefinition | Select-Object Name, Description, BasePermissions | Format-List
```

**What I need from this:** the role name(s) bound to Members, and then — for that
specific role — whether `DeleteListItems`, `DeleteVersions`, and
`ManagePermissions` appear in its `BasePermissions`. Please read the flags for
the role that is actually assigned to Members, and report each of the three
separately. "Can/can't delete" collapsed into one word loses information I need:
Delete Items unchecked while Delete Versions stays checked (or the reverse) is a
real and meaningful combination.

If `BasePermissions` renders as an unhelpful enum blob, expand it — for example
by checking membership of each flag individually — rather than reporting the raw
value.

## Step 3 — Membership, including Justin (question C)

```powershell
Get-PnPGroupMember -Group $members | Select-Object Title, Email, LoginName
```

Also check the Owners group and any direct (non-group) grants on the site:

```powershell
Get-PnPGroup | Select-Object Id, Title, LoginName
Get-PnPGroupMember -Group (Get-PnPGroup -AssociatedOwnerGroup) | Select-Object Title, Email, LoginName
```

Report specifically whether **Justin Gallivan** appears in Members, in Owners, in
some other group, or holds a direct grant. Also note whether **"Everyone except
external users"** is present in Members — a previous screenshot showed it there,
and Justin needs to know whether that is deliberate.

## Step 4 — Library inheritance and library-scope permissions (question D)

```powershell
$list = Get-PnPList -Identity $library -Includes HasUniqueRoleAssignments
$list | Select-Object Title, Id, HasUniqueRoleAssignments, ItemCount
```

**Interpretation:** `HasUniqueRoleAssignments = False` means the library inherits
site permissions, so the Step 2 answer governs it. `True` means the library has
its own permissions and Step 2 does **not** describe access to these documents —
in that case, enumerate the library's own role assignments and report the
principal ordinary editors use, its role, and the same three permission flags at
library scope:

```powershell
Get-PnPListPermissions -Identity $library -PrincipalId $members.Id
```

This distinction matters a lot, so please state it explicitly rather than
leaving it implied.

## Step 5 — Version policy (question F)

```powershell
Get-PnPListVersionPolicy -Identity $library
```

Report version type (major only vs. major+minor), whether a count limit is
enabled and its value, and whether any age/expiry limit is set. **Read only — do
not set anything.**

## Step 6 — Second-stage recycle bin (question E) — only if I am a Site Collection Administrator

```powershell
Get-PnPRecycleBinItem -SecondStage |
  Select-Object Title, DirName, DeletedByName, DeletedDate
```

**This requires Site Collection Administrator rights on this specific site. A
tenant-wide SharePoint Administrator role is not sufficient by itself.** If Step
1 showed I am not an SCA, skip this and record it as "not runnable by this
operator" — and please name, if you can determine it, who *would* be able to run
it.

If it runs and returns nothing, the correct finding is **"second-stage bin exists
and is currently empty"** — which is a good answer. The finding to avoid is
"there is no second-stage recycle bin," which the command cannot establish.

## Step 7 — Produce the report

Fill this in and give it to me as a single block I can paste into an email.
Every line should be an observation or an explicit unknown — please don't
smooth over gaps.

```
SharePoint read-only audit — /sites/akoyaGO, library akoya_request
Run by: ______________   Date: ____________
Tooling used: PnP.PowerShell | UI navigation | both | blocked (reason: ______)

A. Operator roles
   Site Collection Administrator:   yes | no | undetermined
   SharePoint Administrator:        yes | no | undetermined
   Site owner / member:             ______________

B. Members group
   Group name:                      ______________
   Assigned permission level:       ______________
   Delete Items (DeleteListItems):  granted | not granted | undetermined
   Delete Versions (DeleteVersions):granted | not granted | undetermined
   Manage Permissions:              granted | not granted | undetermined

C. Membership
   Justin Gallivan in Members:      yes | no
     if no — access via:            ______________
   "Everyone except external users" in Members: yes | no

D. Library akoya_request
   HasUniqueRoleAssignments:        true | false
     if true — ordinary-editor principal: ______________
                its role:                 ______________
                Delete Items / Delete Versions / Manage Permissions: ______________

E. Second-stage recycle bin
   Runnable by this operator:       yes | no (not an SCA)
     if yes — opens:                yes | no
              contents:             empty | ____ items
     if no  — who could run it:     ______________ | unknown

F. Version policy
   Version type:                    major only | major + minor
   Count limit:                     ______  | none
   Age/expiry limit:                ______  | none

Failures / access denials encountered (verbatim):
   ______________________________________________

Anything I could not determine:
   ______________________________________________
```

## Appendix — UI-only fallback if PowerShell is blocked

All read-only. Navigate through the UI rather than pasting deep links (deep links
have failed on this tenant).

| Question | Path |
|---|---|
| B — Members role and its flags | Site Settings → Site permissions → **Advanced permissions settings** → note the level beside Members → **Permission Levels** → open that level → read the **Delete Items**, **Delete Versions**, **Manage Permissions** checkboxes |
| C — membership | Site permissions → open the Members group → member list; also scan for direct grants |
| D — library inheritance | Open the `akoya_request` library → gear → **Library settings** → **More library settings** → **Permissions for this document library** → it will say whether it inherits from the parent |
| E — second-stage bin | Site contents → **Recycle bin** → link to the **second-stage recycle bin** at the bottom of the page (SCA only) |
| F — version policy | Library → gear → Library settings → More library settings → **Versioning settings** — **read only, change nothing** |
| Preservation Hold library (bonus signal) | Site contents → look for a **Preservation Hold Library**; if present, a retention policy covers this site |

If the **Advanced permissions settings** link is not visible in the modern pane,
that usually means the account lacks Manage Permissions — record that as the
finding rather than hunting for a URL that bypasses it.

---

**One last thing.** If anything here turns out to be wrong about how this tenant
is configured, say so plainly in the report. Justin would much rather receive
"the pane says X but I couldn't verify the underlying role" than a tidy answer
that turns out to be the pane caption again.
