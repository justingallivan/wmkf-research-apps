# Contacts dedup ↔ reviewer linking — notes + questions for Connor

Date: 2026-06-25 (S289). Author: Justin + Claude. Status: discussion / questions.

Purpose: we (Justin + Claude) started looking at a reviewer-merge bug and it
opened up the broader reviewer-identity / contact-dedup picture. You're taking the
**contacts ↔ contacts** dedup via native Dynamics merge; we're taking
**`wmkf_potentialreviewers` ↔ contacts** linking. This doc records what we found in
live data and asks you a few questions that decide how the two efforts interleave.

All numbers below are from **read-only** probes against prod on 2026-06-25
(`scripts/probe-contact-dedup.js`, `scripts/probe-pr-contact-email-overlap.js`,
`scripts/probe-reviewer-duplicates.js`). They're point-in-time snapshots, not
canonical counts.

## The three distinct problems (so we don't conflate them)

1. **`wmkf_potentialreviewers` ↔ `wmkf_potentialreviewers`** — two reviewer-finder
   person rows for one person (e.g. a misspelling: "Joshua Ravinowitz" holds the
   email, "Joshua Rabinowitz" holds the candidacy). This is the original bug a
   colleague hit (alt-key 412 on `wmkf_emailaddress_unique`). Small; design at
   `docs/REVIEWER_MERGE_DESIGN.md`.
2. **`wmkf_potentialreviewers` ↔ `contacts`** — linking a reviewer to its CRM
   contact (`wmkf_contact` lookup), plus keeping identity in sync. **Our half.**
3. **`contacts` ↔ `contacts`** — duplicate contact rows. **Your half (native merge).**

## What the data shows

**Contact-side duplicates (your half).** Filtering to the high-precision signal
(**same normalized name AND same email** — this excludes shared-inbox false
positives and namesakes): **~547 duplicate clusters, ~1,154 rows → ~600 redundant
contacts**. 508 clusters all-active, 39 mixed active/inactive. Examples: Aneel
Aggarwal ×6, Lisandra Vila Ellis ×6, Tony De Tomaso ×4, plus many ×3 (Ruth Lehmann,
Kevin Reed, Brittany Anderton…), and internal WMKF staff with active+inactive
copies (import churn).

**Matching caveats — please don't merge on email alone:**
- **Shared institutional inboxes** put *different real people* on one email:
  `president@temple.edu`, `recsec@mit.edu`, `wire_transfers@lists.stanford.edu`,
  grants-office addresses, etc. Email-only clustering produced 790 "clusters" but
  many are these — merging them would be wrong.
- **Test data** pollutes too: `sarahihibler@icloud.com` has 24 fake names (Hunter
  Hotdog, Tommy Lee Jones, "ham burger"); also `bagels@bagels.com`, "John Doe",
  "test test". Worth excluding `@wmkeck.org` + known test emails up front.
- ORCID is **not** a useful signal on contacts (barely populated — 3 clusters total).

**Reviewer↔contact linking (our half).** Of 4,298 active potential-reviewer rows
with an email, **458 already match a CRM contact by email but only 3 carry the
`_wmkf_contact_value` link** — i.e. **455 reviewers already exist as a contact but
aren't linked**. The link is currently only made on the fly (first email send /
accept+honorarium / manual add, all via `contactAdapter.findOrCreateByEmail` →
`potentialReviewerAdapter.setContactLink`). So most reviewers aren't linked yet.

## How our two efforts interact (the important part)

Your suggestion was: we can link reviewers to *a* contact now, and whoever wins
your merge will end up with the reviewer attached. That's the right spirit, but it
depends on a Dynamics relationship behavior we **can't confirm from our
schema-as-code**, and on a uniqueness constraint that our linking work will make
more relevant. Hence the questions below.

Relevant schema facts (verified in this repo):
- `wmkf_contact` is a **single-valued lookup** on `wmkf_potentialreviewers`
  (one contact per reviewer) with a **1:1 alternate key `wmkf_contact_unique`**
  (`lib/dataverse/schema/wave2-existing/wmkf_potentialreviewers-extensions.json:18`).
  So a reviewer can't be linked to "all" duplicate contacts — only one.
- The `wmkf_contact` relationship pre-dates our managed schema, so its cascade
  config isn't in the repo. The **one** place we *do* declare a Merge cascade
  (`lib/dataverse/schema/wave4/wmkf_proposalbudgetline.json:104`) sets
  **`"Merge": "NoCascade"`** — so "merge reparents children" is **not** a safe
  default assumption in this org.

## Questions for you

**Q1 — Does native contact-merge reparent the `wmkf_contact` lookup?**
When you merge contact L (loser, deactivated) into contact M (master), does a
`wmkf_potentialreviewers` row whose `wmkf_contact` points at L get **reparented to
M**, or is it left pointing at the now-deactivated L? Concretely: what is the
**Merge cascade** on the contact → `wmkf_potentialreviewers` relationship
(`wmkf_contact`)?
- If **Cascade** → reviewers follow the merge; we can link to any contact now.
- If **NoCascade** → a reviewer linked to a loser is orphaned; we must link *after*
  your dedup (or re-link afterward). We're planning an idempotent re-runnable linker
  precisely so we don't have to bet on this — but we'd still like to know.

**Q2 — How does merge handle the 1:1 `wmkf_contact_unique` collision?**
That alt-key allows **one reviewer per contact**. If two duplicate contacts *each*
have a linked reviewer and you merge them, reparenting both reviewers onto the
master would violate the key. Today this is near-zero (only 3 reviewers linked), but
**our linking work will link thousands more**, raising the odds that both members of
one of your ~600 dup clusters carry a reviewer link. When the merge hits that, does
it **block, skip the reparent, or error**? (This also tells us whether we should
avoid linking both members of a known dup pair before you've merged them.)

**Q3 — Will you emit a loser→master GUID map we can consume?**
Some contact GUIDs live in **our Postgres**, which your Dynamics merge can't touch —
notably `bill_onboarding_state.reviewer_contact_id` (a contact GUID for a
previously-paid reviewer). After a merge, that ref can point at a deactivated loser.
If your process can output the **(loser contactid → master contactid)** pairs it
merged, we can run a small reconcile to repoint our Postgres refs (and any
`wmkf_contact` links, if Q1 is NoCascade). Is that list available?

**Q4 — Any contacts we must NOT touch?**
Are the shared-institutional-inbox contacts (grants offices, presidents' offices,
wire-transfer desks) something your dedup already excludes, or should we compare
notes on an exclusion list so neither process collapses distinct people on a shared
email?

## Our plan (FYI), and what would help

We're going to build the reviewer→contact linker as an **idempotent, re-runnable
reconciliation**: for each reviewer, find its best contact match (email **plus** a
name/ORCID corroboration guard — so we don't repeat a real mismatch we found,
"David Schweppe" reviewer vs. "Devin Schweppe" contact on a shared email) and ensure
`wmkf_contact` points at it. Running it **after** your dedup wave means every
reviewer lands on the surviving master regardless of the Q1 cascade answer.

What would help us: your answer to Q1/Q2, and (if available) the Q3 loser→master
map so we close the Postgres/BILL side.
