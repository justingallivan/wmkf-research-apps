# DFT email — SharePoint / M365 malware scanning posture (DRAFT — S183, 2026-05-24)

Send-ready. Specific asks with reply template; questions are answerable from
Microsoft 365 admin center without needing context on our application stack.

---

**To:** DFT (WMKF IT provider)
**Subject:** Question — SharePoint / M365 file scanning on the WMKF tenant

Hi,

We're building file-upload paths in our in-house grant-management apps and need to understand what malware scanning is already running at the Microsoft 365 / SharePoint layer on our tenant before we decide how much defensive scanning to put inside our own applications. The SharePoint site in question is the one our apps write to (`https://appriver3651007194.sharepoint.com/sites/akoyaGO` — the same site staff use day-to-day for grant files).

A few specific questions; each should be answerable from the Microsoft 365 admin center / Defender portal without needing to dig into our apps.

---

## Q1 — Microsoft Defender for Office 365 licensing

Is **Microsoft Defender for Office 365** (a.k.a. MDO; historically "Office 365 ATP") licensed on the WMKF tenant?

- Plan 1, Plan 2, or not at all.
- If yes, roughly when did it take effect (so we know whether files from before that date were ever scanned).

```
Q1.1 MDO licensed:           yes-plan-1 | yes-plan-2 | no
Q1.2 if yes, effective date: ________
```

---

## Q2 — Safe Attachments for SharePoint, OneDrive, and Microsoft Teams

Independent of licensing, the specific policy that scans uploaded files is **Safe Attachments for SharePoint, OneDrive, and Microsoft Teams** (sometimes called SAFE Docs). It's off by default even on tenants that have MDO.

- Is this policy currently enabled?
- If yes, does it cover the `appriver3651007194.sharepoint.com/sites/akoyaGO` site specifically (some configurations scope to particular sites; others are tenant-wide).

```
Q2.1 Safe Attachments for SP/OD/Teams enabled:  yes | no
Q2.2 scope:                                     tenant-wide | site-scoped | n/a
Q2.3 if site-scoped, includes WMKApp site:      yes | no | n/a
```

---

## Q3 — Detection behavior

If the scanner flags an uploaded file as malicious, what actually happens?

- Is the file **blocked** before it lands in SharePoint, **quarantined in place** (visible as a locked stub), or just **flagged** in an audit log while staying accessible?
- Are users / file owners **notified** on detection, and via what channel (email, in-product banner, nothing)?

This matters to us because if files are quarantined *after* upload, our app may end up holding a Dataverse pointer to a file that no longer exists — we'd need to detect that case in our own code.

```
Q3.1 on-detection behavior:  block-pre-upload | quarantine-post-upload | flag-only | other: ___
Q3.2 user notification:      yes-email | yes-banner | no | other: ___
```

---

## Q4 — Audit / history visibility

- Is there an **audit log** (Defender portal, Purview compliance, or other) we can query to see whether any files in our SharePoint site have ever been flagged?
- If yes, how far back does the retention go?

```
Q4.1 audit visibility:       defender-portal | purview | other: ___ | none
Q4.2 retention window:       ________
```

---

## Q5 — Workstation-side coverage (briefer)

Last one, separate channel: are WMKF staff workstations running **Microsoft Defender for Endpoint** (or equivalent), so that files staff drop into SharePoint via OneDrive sync are scanned at the workstation before they reach the cloud?

```
Q5.1 endpoint AV on staff machines:  defender-for-endpoint | other: ___ | none
```

---

## Context — why we're asking

We have multiple upload paths into the SharePoint site:

- **Our apps' writes:** reviewer file uploads (active today, ~150/cycle), applicant intake portal (launching mid-June 2026, ~200/cycle), grant-reporting attachments, expense receipts.
- **Staff direct:** SharePoint web UI, OneDrive desktop sync, Outlook "save attachment," Teams shares.
- **Integrations:** Power Automate flows, GOapply (until we retire it), historical migrations.

We're evaluating whether to add app-side virus scanning (commercial API: Cloudmersive) to the upload paths *we* control. The answers above determine whether app-side scanning is:

- **The primary line of defense** (if MDO / Safe Attachments isn't running) — in which case we'll prioritize wiring it in and you'll likely want to think about the staff-direct paths too.
- **Defense in depth on top of Microsoft's scanning** (if MDO + Safe Attachments are on) — in which case we still want pre-upload scanning so we never write a Dataverse pointer to an infected file, but the urgency is lower and the value proposition is different.

Either answer is useful; we're trying to size the work appropriately, not push for a particular outcome.

No deadline pressure — happy to take the answers as your bandwidth allows, but if a quick answer to Q1 + Q2 is easy to give before the others, that alone unblocks most of our planning.

Thanks!
Justin
