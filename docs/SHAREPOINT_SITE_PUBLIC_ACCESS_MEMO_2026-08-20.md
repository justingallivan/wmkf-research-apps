---
title: SharePoint akoyaGO Site Public Access Memo — 2026-08-20
domain: security-auth
kind: decision
status: active
summary: "The akoyaGO site's M365 group is Public, so every tenant account can edit grant documents; asks IT whether that is intentional or required."
canonical: false
cataloged: 2026-08-20
last_verified: 2026-08-20
owner: product-engineering
related:
  - docs/DATAVERSE_SHAREPOINT_FILE_MODEL.md
  - docs/INITIAL_ASSESSMENT_CONTROLLED_PILOT_2026-07-30.md
---

# SharePoint akoyaGO site access — a question for IT

**From:** Justin Gallivan (with analysis by Claude, the AI assistant working on
the document tooling)
**Date:** 2026-08-20
**Regarding:** the akoyaGO SharePoint site
(`https://appriver3651007194.sharepoint.com/sites/akoyaGO`) and the grant
document libraries on it

## What we noticed

While reviewing the permission screenshots IT provided on 2026-08-20 (thank
you — they answered nearly all of our earlier questions), we noticed that the
Microsoft 365 group connected to the akoyaGO site is set to **Public** (the
site header shows "Public group" with 4 members).

We were wondering whether that was an intentional decision or an operational
requirement — for example, something the akoyaGO platform needs in order to
function. We are not asking for a change; we'd just like to know which it is.

## Why it caught our attention

A Public group is not visible outside the organization — nothing is exposed to
the internet. What it does mean is:

- **Anyone with an account in our Microsoft 365 tenant can open the site**, and
  can join the group themselves without anyone approving it.
- The same screenshots show the site's Members group holds the **Edit**
  permission level, and the document libraries inherit the site's permissions.
- Put together: **every current and future account in our tenant can edit —
  and, under a standard Edit level, delete — the grant documents on this
  site.** The "4 members" count understates the real audience; the effective
  membership is the whole tenant.

## Claude's concerns, specifically

Claude is concerned that:

1. **The editor list grows on its own.** With a Public group, access is defined
   by "whoever has a tenant account" rather than a list someone maintains. If a
   contractor, auditor, intern, or vendor support account is ever given a
   login, that account silently gains edit and delete rights over grant records
   — without anyone deciding it should.

2. **A single compromised account reaches the grant libraries.** If any one
   mailbox in the tenant is phished, the attacker can modify or delete grant
   documents. If the group were Private, compromising an account that isn't a
   member would yield no access to these libraries.

3. **Deletion protection carries more weight than intended.** We have verified
   the safety nets are healthy — version history keeps 500 versions with no age
   limit, and both recycle-bin stages work (the second-stage bin screenshot
   confirmed it). But those nets were designed as backstops for a known group
   of staff editors, and the second-stage window is finite (about 93 days).
   With org-wide edit access, they are the primary protection rather than a
   backup.

## What we are asking

1. **Was Public chosen deliberately, or is it the creation-time default?**
   Group-connected sites are often created Public by default, so it's entirely
   possible nobody ever chose it.
2. **Does akoyaGO (the vendor platform) require the group to be Public?** If
   the platform's access model depends on it, that settles the question — we
   would not want to change it and break the vendor integration.
3. **Should everyone with a tenant account be able to edit grant documents?**
   If the answer is yes — if every account belongs to staff who legitimately
   work with these records, and that is expected to stay true — then Public is
   a reasonable setting and we'll record it as intentional.

If the answers are "it was the default" and "the vendor doesn't need it," the
simple option would be switching the group from Public to **Private** (adding
the staff who need access as actual members first, and confirming with akoyaGO
support that nothing on their side depends on Public). That single setting
change would shrink the editor audience from the whole tenant to the intended
staff without touching any SharePoint permission levels. But again — we're
asking, not requesting a change.

## Status

Question raised 2026-08-20; awaiting IT's answer. The underlying evidence and
classifications live in `docs/DATAVERSE_SHAREPOINT_FILE_MODEL.md`
("Controlled target-library audit" section). Once IT answers, record the
outcome here (intentional / operational requirement / changed) and reconcile
that section.
