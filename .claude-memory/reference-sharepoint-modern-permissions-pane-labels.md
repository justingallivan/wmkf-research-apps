---
name: reference-sharepoint-modern-permissions-pane-labels
description: "A SharePoint modern Site Permissions screenshot can quote pane wording without proving the assigned permission level; inspect the role definition and inheritance before drawing access conclusions."
status: active
metadata:
  type: reference
---

On 2026-08-11 the modern SharePoint **Site Permissions** pane ("Manage who has
access to this site") for `/sites/akoyaGO` showed three rows with these captions:
`Site owners - full control`, `Site members - limited control`, and
`Site visitors - no control`. **[VERIFIED via that screenshot]** This proves
what the pane displayed and explains Connor's wording. **[VERIFIED via Microsoft
documentation]** "Limited control" is not a documented built-in permission-level
name. **[OPEN]** Neither the screenshot nor current Microsoft documentation
proves those captions are fixed across every modern pane, or what permission
level is actually assigned here.

**Why this matters:** on 2026-08-10 an administrator answered "site members have
'limited control'" and two sessions treated it as possibly a *custom permission
level* — a hypothesis that materially changed the SharePoint durability model
for the governed Initial Assessment artifacts. A screenshot on 2026-08-11 showed
he was reading the pane verbatim. See [[feedback-verify-external-platform-claims]].

**How to apply:** when a stakeholder quotes a platform capability or setting in
words that don't match the vendor's documented vocabulary, first ask *which
screen they are reading*. A verbatim UI string is accurate reporting of the UI
and says nothing by itself about configuration. The actual assignment and its
`Delete Items` / `Delete Versions` permissions must be read through Advanced
Permissions Settings or a suitably authorized PnP/CLI session. Also check whether
the governed library inherits site permissions; a site-level screenshot cannot
prove library-level effective access.

Tenant note: on `appriver3651007194` (site `/sites/akoyaGO`), classic
`_layouts/15/…` URLs have failed twice — `VersionSettings.aspx?List={guid}`
(2026-08-10) and `settings.aspx` / `user.aspx?view=perms` / `role.aspx`
(2026-08-11) — while UI navigation to the same Versioning page worked. Send an
administrator a UI path, never a reconstructed deep link, and expect to need
PowerShell, CLI for Microsoft 365, or a signed-in navigation route for permission
definitions. PnP and CLI are cross-platform but require a tenant Entra app
registration/client ID plus the applicable consent and operator role.

The same pane revealed `Everyone except external users` in Site members.
**[VERIFIED via Microsoft documentation]** EEEU includes all internal users and
excludes guests. **[OPEN]** Site type/privacy, the Members role definition, and
whether `akoya_request` inherits that site grant all remain unknown; do not
convert the screenshot into a tenant-wide library-edit claim
(`outputs/sharepoint-storage-policy-question-brief.md` Q12).
