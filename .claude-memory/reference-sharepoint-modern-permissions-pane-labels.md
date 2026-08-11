---
name: reference-sharepoint-modern-permissions-pane-labels
description: "SharePoint's modern Site Permissions pane shows fixed descriptive labels (full/limited/no control), not permission levels — an admin quoting them is quoting UI, not configuration."
status: active
metadata:
  type: reference
---

The modern SharePoint **Site Permissions** pane ("Manage who has access to this
site") shows exactly three groups with **fixed descriptive labels**:
`Site owners - full control`, `Site members - limited control`,
`Site visitors - no control`. These are the pane's own wording, **not** the
underlying permission level, and Microsoft has a documented issue where the pane
displays inaccurate levels.

**Why this matters:** on 2026-08-10 an administrator answered "site members have
'limited control'" and two sessions treated it as possibly a *custom permission
level* — a hypothesis that materially changed the SharePoint durability model
for the governed Initial Assessment artifacts. A screenshot on 2026-08-11 showed
he was reading the pane verbatim. See [[feedback-verify-external-platform-claims]].

**How to apply:** when a stakeholder quotes a platform capability or setting in
words that don't match the vendor's documented vocabulary, first ask *which
screen they are reading*. A verbatim UI string is accurate reporting of the UI
and says nothing about configuration. The real permission level and its
`Delete Items` / `Delete Versions` checkboxes live behind **Advanced permissions
settings** → the level definition, and only that read closes the question.

Tenant note: on `appriver3651007194` (site `/sites/akoyaGO`), classic
`_layouts/15/…` URLs have failed twice — `VersionSettings.aspx?List={guid}`
(2026-08-10) and `settings.aspx` / `user.aspx?view=perms` / `role.aspx`
(2026-08-11) — while UI navigation to the same Versioning page worked. Send an
administrator a UI path, never a reconstructed deep link, and expect to need
PowerShell or a signed-in navigation route for permission definitions.
Same pane also revealed `Everyone except external users` in Site members, i.e.
tenant-wide edit rights on the governed artifact library
(`outputs/sharepoint-storage-policy-question-brief.md` Q12).
