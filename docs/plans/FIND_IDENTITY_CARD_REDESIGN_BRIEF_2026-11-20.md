# Find-tab identity card redesign — design brief

Status: **design brief for owner review; nothing built.** Written 2026-11-20
(Session 693) with Impeccable `shape`, after the critique and audit at
`.impeccable/critique/2026-11-21T03-48-37Z__ponents-reviewers-search-candidatecard-js-9b296c32.md`
(design health 12/40, technical audit 11/20). Mock-up:
`.impeccable/mockups/find-identity-card.html` (fictitious people).

Target: `shared/components/reviewers/search/CandidateCard.js` and the Confirm
dialog (`shared/components/reviewers/CandidateEditModal.js` in confirm mode,
opened through `SearchContactModals.js`). The card is shared by every Find-tab
candidate, applicant-recommended and search-found.

## Owner decisions (2026-11-20)

Decided, not built:

1. **Rebuild the card around one decision**, rather than cleaning up the
   current stack of notices or starting with the promotion flow.
2. **One shared card with an applicant variant**, not a separate card for
   applicant-recommended reviewers.
3. **Skip the evidence link when the email is not in doubt.** When the email
   the applicant gave matches the linked AkoyaGO record's stored email,
   confirming needs no evidence link; the evidence is recorded as that stored
   address. An evidence link is required only for uncertain addresses (a role
   or lab mailbox, a domain mismatch, or no address found). Refined by
   decision 5.
4. **Process for decisions 3 and 5:** `/contract-reconcile` and a Codex plan
   review before any server change.
5. **Three evidence levels for applicant-recommended reviewers** (refines
   decision 3, after the owner learned that step 1 finds the AkoyaGO record by
   the applicant's email, so the stored and applicant emails match almost by
   construction):
   - **Confirmed elsewhere → one click, no dialog.** The applicant's exact
     address also appears on the person's ORCID, an institution page, their
     papers (the existing `ready` sources), or a past invitation they accepted.
   - **Plausible → dialog with one checkbox, no evidence link.** Not found
     elsewhere, but the domain fits the listed institution and accepts mail.
   - **Something is off → evidence link required.** A role or lab mailbox, a
     domain that doesn't fit the institution or doesn't accept mail, or
     publications that point to a different institution and field.
   - The invite dialog's per-recipient acknowledgement before sending is
     unchanged in every case. (Corrected 2026-11-20: today a staff
     confirmation already removes that acknowledgement; see "Facts" and open
     decision A.)
6. **Confirm step is a small dialog** showing name, institution, the exact
   email and where it came from. The one-click level skips it.
7. **Remove the "Applicant-referred reviewers" list** from the Find tab. The
   cards carry the applicant's listed details; a suggested-reviewer row that
   fails to load shows a warning at the top of the Find tab.
8. **An older AkoyaGO contact counts as confirmation.** When exactly one active
   AkoyaGO contact has the applicant's exact address, and that contact existed
   before the suggestion, the address is *confirmed elsewhere* (one click).
   A contact created after the suggestion does not count. Evidence in §7
   item 6.
9. **Validate the applicant's listed details against AkoyaGO** (§7 item 7);
   mismatches are flags that require the evidence link, never blocks.

Earlier owner targets carried into this brief (SESSION_PROMPT, Session 693
item 1): one plain question per card; the match result as one line; one pair
of buttons with evidence folded away; a single **Confirm and add to Invite**
action when the evidence is clean.

## Facts the brief rests on

- **The applicant's email and affiliation are on the suggestion row.** Step 1
  copies them to `wmkf_revieweremail` / `wmkf_revieweraffiliation` on
  `wmkf_appreviewersuggestion` [REPORTED by Connor, recorded in
  `docs/POWER_AUTOMATE_RESEARCH_INTAKE_FLOWS.md` §3]. The adapter's row read
  already selects them (`FIELD_SELECT` at
  `lib/dataverse/adapters/reviewer-suggestion.js:59` is built from the registry,
  which lists both at `lib/dataverse/core/entity-registry.js:182,191`)
  [VERIFIED]. The Find-tab applicant list projects only the person lookup and
  its formatted name [VERIFIED via
  `lib/services/workbench/applicant-reviewers-service.js:169,178-196`].
  The reviewer's own accept/decline contact edits write the same columns
  (`applyStage2aResponse`, `reviewer-suggestion.js:2240-2265`), so they hold
  the applicant's values only until the reviewer responds; that does not
  affect unengaged Find rows.
- **The AkoyaGO reviewer record is found by that same email.** Step 1 matches
  or creates `wmkf_potentialreviewer` on `wmkf_emailaddress` [REPORTED by
  Connor, recorded in the flow map §3]. So for an applicant row the stored
  email equals the applicant-listed email almost by construction; they differ
  only if the record's email changed later [ASSUMED; not probed].
- **Server evidence rules.** Address evidence types are
  `publication_corresponding_author`, `institution_page`,
  `direct_correspondence`, `staff_address_choice` and `other`; only the first
  two require a URL, and `other` requires a note
  [VERIFIED via `lib/utils/reviewer-address-trust.js:17-23,89-92`]. No type
  means "the applicant listed this address". Promotion reads the saved
  receipt's type [VERIFIED via
  `lib/services/workbench/promote-applicant-reviewer-service.js:271-339`].
- **Corrected 2026-11-20: a staff confirmation already skips the send-time
  check.** A `staff_verified` source with a valid exact-address bundle is
  `ready` (`lib/utils/reviewer-invite.js:197-206`), and the send step asks for
  the per-recipient acknowledgement only on `quick_check`
  (`lib/services/review-manager/send-emails-service.js:855`) [VERIFIED].
  Promotion writes that source from the confirm receipt
  (`promote-applicant-reviewer-service.js:330-345`). This is the exact-address
  attestation model the lifecycle doc records as implemented in S391; its §1
  "Today" text describes the earlier S387 behaviour [STALE/CONFLICT in
  `docs/REVIEWER_CONTACT_PROMOTION_AND_ADDRESS_LIFECYCLE.md` §1]. So owner
  decision 5's line "the send-time acknowledgement is unchanged" is wrong as
  written: under today's model, the checkbox level would also make the address
  `ready`. See open decision A.

## Brief

### 1. Job and audience
A program director on the Find tab deciding, for each candidate, whether this
is the right person and whether we can email them. Operate mode, desktop.
They know many of these scientists by name; they do not know the pipeline.

### 2. Outcome
Each card answers one question: **Is this the right person?** Success is a
director confirming a clean applicant-recommended reviewer and adding them to
Invite in one action, and spotting a real namesake in two seconds.

### 3. Direction
Stay inside the established Clear Workbench system (`DESIGN.md`): white card,
0.75rem radius, Foundation Ink primary, semantic colour only for status. The
structural thesis is **status → match → evidence → action**, replacing the
current stack of independently added notices (Section Order Rule 6,
Status-Once Rule 10, One Button Vocabulary Rule 11).

Card anatomy, top to bottom:

1. **Header row.** Name as the card title (an `h4`), institution in muted text,
   then the source line: *Recommended by the applicant* or *Found by literature
   search*. One status chip on the right.
2. **Match line.** One sentence with a glyph that summarises the identity
   check (see the wording table).
3. **Compare details** (disclosure). A three-column comparison: *Applicant
   listed* | *AkoyaGO record* | *Publications*, with rows for institution,
   email and field. Differences are highlighted. It opens automatically when
   any value differs or when the status is *Check identity*; otherwise it
   starts closed. For search-found candidates the *Applicant listed* column is
   absent. The paper list and the "do these papers match the proposal?" prompt
   live here.
4. **Blocking line** (only when present): a conflict of interest, an applicant
   exclusion, or a record that needs repair, in red or amber.
5. **Action row.** At most one ink primary, with *Not a fit* beside it as a
   quiet link, not pushed to the far edge.

Nothing else renders on the card: no restated requirement, no free-text server
reasoning, no record IDs, no pointer to another section.

### 4. Scope and boundaries
- In scope: the candidate card in every Find-tab section, its Confirm dialog,
  and the applicant-referred list near the bottom of the tab (removed by
  owner decision 7).
- Untouched: namesake safety (contact details and metrics stay hidden until
  identity is confirmed; the Scholar link stays a name search), the send-time
  acknowledgement, the admin identity comparison panel, search controls and
  the footer bar.
- Anti-goals: no new status vocabulary per subsystem; no server text rendered
  as-is; no second action row.

### 5. States and wording

Every current variant maps to one of these statuses (chip label → match line →
primary action). The full variant inventory with source lines is in the
critique snapshot's Assessment A notes; it is not repeated here.

| Status chip | When | Match line (examples) | Primary action |
|---|---|---|---|
| **Ready** (green) | Identity and email confirmed | ✓ Confirmed: *email* | Add to Invite |
| **Confirm identity** (amber) | Identity not yet confirmed; evidence agrees or is merely thin | ✓ Publications match *institution, field* · or · No publications found under this name | Confirm and add to Invite |
| **Check identity** (amber) | Evidence points to someone else: a different institution and field, or an ORCID/email split | ⚠ Publications under this name are from *institution, department* | Review and confirm |
| **Check email** (amber) | Identity fine, but the address is a role or lab mailbox, its domain doesn't match, or no address was found | ⚠ *email* looks like a lab mailbox · or · No email address found | Confirm email (evidence link) · or · Add email |
| **Email conflict** (red) | The address belongs to another AkoyaGO reviewer record | ⚠ This email is on another reviewer's record | Review email choice |
| **Fix record** (amber) | The linked AkoyaGO record is inactive, its email is ambiguous, or it could not be loaded | The AkoyaGO record is inactive · could not be loaded | Check again (plus Request repair where allowed) |
| **Conflict** (red) | Same institution as the PI, or a likely coauthor | Same institution as the PI (*institution*) · Coauthored *N* papers with *author* | none; Not a fit only |
| **Possible conflict** (amber) | Possible coauthor overlap | Possible coauthor overlap with *author*; may be a large collaboration | Confirm and add to Invite |
| **Excluded by applicant** (grey) | Name matches the applicant's exclusion list | The applicant asked that this person not review | none |
| **Check unavailable** (grey) | A lookup failed | We couldn't finish checking this reviewer | Try again |
| *Not a fit* (Excluded section) | Staff chose Not a fit | one line | Reconsider |

Modifiers, not statuses: *Emeritus / retired* chip; *Found in an earlier
search*; career stage. Deceased candidates stay in their existing list.

Wording rules: plain sentences mapped from closed reason codes, never server
free text; the system is called AkoyaGO everywhere on the card; no
"enrichment", "gate", "resolver" or "Dataverse".

### 6. Interaction
- **Confirm and add to Invite** follows owner decision 5. When the address is
  confirmed elsewhere it adds the reviewer directly. When it is only plausible
  it opens a small dialog showing the name, institution, the exact email and
  its source, with one checkbox: *This is the person the applicant meant, and
  this address reaches them.* Either way, one action confirms identity and
  adds the reviewer to Invite.
- **Review and confirm** and **Confirm email** open the same step with the
  comparison visible and an evidence link or note required.
- *Not a fit* stays recoverable through Reconsider.
- Partial failures are reported as failures, not in a green toast.
- Accessibility: card names are headings; one control per action with a
  per-candidate accessible name; dialog labels tied to inputs; errors
  announced.

### 7. Dependencies outside the design work (not in this brief's scope)
1. **Server reason codes.** Replace free-text identity and institution
   reasoning (for example `lib/services/workbench/enrich-recommended-service.js:372`)
   with closed codes the card maps to wording.
2. **Institution comparison.** Identical addresses resolve as compatible; a
   different institution *and* field surfaces as a namesake signal
   (`lib/services/institution-affiliation-stage2.js`).
3. **Applicant-listed address as evidence.** A new evidence type, or another
   way to record "the applicant listed this address and the AkoyaGO record
   matches", in `lib/utils/reviewer-address-trust.js` and the promotion
   receipt handling. Requires `/contract-reconcile` and a Codex plan review.
4. **One combined promotion entry point.** *Confirm and add to Invite* joins
   confirmation and promotion. Branch 2 (exclusion enforcement) must cover it.
5. **Applicant columns.** The Find tab must read the row's applicant-listed
   email and affiliation to fill the *Applicant listed* column.
6. **Automatic pre-validation for decision 5.**
   - Compare the applicant's exact address with addresses the existing lookups
     already find (`READY_EMAIL_SOURCES` in `lib/utils/reviewer-invite.js:82`).
   - Treat a past accepted invitation at that address as confirmation
     (acceptance evidence is collected but not written back; see
     `docs/REVIEWER_CONTACT_PROMOTION_AND_ADDRESS_LIFECYCLE.md` §5.4).
   - Add a domain-fits-institution check and a does-the-domain-accept-mail
     (DNS MX) check. Neither exists today [VERIFIED via a repo grep for MX and
     DNS imports in `lib/`, `pages/`, `shared/` and `scripts/`; only `lib/utils/safe-fetch.js` uses DNS, to resolve hosts].
   - Not chosen: mailbox probing or an outside verification service
     (unreliable at universities, and sends reviewer emails to a third party).
   - **How often the existing lookups find the applicant's address**
     [VERIFIED 2026-11-20 via an owner-approved, read-only, counts-only query
     of `reviewer_find_roster` (Postgres host from `.env.local`)]. Population:
     applicant-suggested rows saved in the current data format
     (`applicantEnrichmentCacheVersion` 4): 62 reviewers on 14 requests, first
     seen June–August 2026, all with a stored AkoyaGO address. Of the 62:
     - 8 (13%): a ready-tier source found the **same** address (one click);
     - 11: the same address from a weaker source (10 of them `manual`, which
       is staff-entered rather than an independent lookup);
     - 3: a **different** address (1 ready-tier, 2 weaker);
     - 40 (65%): no address found.

     Older-format rows (155 on other cache versions or none) lack the fields
     and were excluded. So without past acceptances, most applicant reviewers
     would land at the checkbox level. Whether a lookup that finds the stored
     address always records it in `contactEnrichment.email` is not checked
     [ASSUMED], so 13% may be an undercount.
   - **Past acceptances add nothing for this population yet** [VERIFIED
     2026-11-20 via an owner-approved, read-only, counts-only Production
     Dataverse query of `wmkf_appreviewersuggestion` rows with
     `wmkf_accepted eq true` for the same 61 linked reviewers]. Only 4 accepted
     rows exist for them. None is on another request before the roster row was
     first seen with the same address (1 earlier acceptance carries a
     different or blank address; 2 acceptances came later or on the same
     request). Acceptances on these rows are app-era records, so earlier
     reviewing history kept elsewhere in AkoyaGO is not covered [ASSUMED].
     Combined result for the 62: 8 one click, 51 checkbox, 3 evidence link.
   - **AkoyaGO contacts are a better second route** [VERIFIED 2026-11-20 via
     owner-requested, read-only, counts-only Production queries using
     `lib/dataverse/adapters/contact.js` `findByEmailCandidates` and
     `searchByName`]. Of the 62:
     - 16 have exactly one active contact whose `emailaddress1` is the stored
       address. 12 of those contacts were created before the roster row was
       first seen (8 more than a year before), and 4 after;
     - 2 have no email match but a same-name contact with a different address;
     - 44 have no contact found.

     If an exact, older contact address counted as confirmation, one click
     would rise from 8 to roughly 18–20 of 62 (14 contact-only matches, at
     most 12 of them older; the exact overlap was not computed). Who entered
     each contact's address (the person in GOApply, staff, or an earlier
     import) is not known [ASSUMED unknown], so an older contact address is
     corroboration of age, not proof the person typed it. The owner chose to
     count it (owner decision 8).
7. **Validate the applicant's listed details against AkoyaGO** (owner request,
   2026-11-20). Each mismatch below puts the card in *Check email*, highlights
   the cell in Compare details, and requires the evidence link:
   - the applicant's listed institution vs the applicant's email domain (for
     example "Stanford" with an `@harvard.edu` address); this is the
     "domain doesn't fit the institution" case of owner decision 5;
   - the applicant's listed institution vs the AkoyaGO reviewer record's
     institution (the person may have moved and the record is stale);
   - the applicant's email vs a same-name AkoyaGO contact with a different
     address.

   Reuse existing parts rather than raw string comparison: institution name
   to domain through OpenAlex and email-domain relatedness
   (`buildInstitutionDomainEvidence`, `emailDomainRelatedToAny` in
   `lib/services/contact-enrichment/domain-evidence.js`), and the stage-2
   institution comparison for affiliated institutions. These are flags, never
   blocks: affiliated institutes (Broad, HHMI, hospital or medical-school
   domains), personal addresses and recent moves are legitimate.

   When step 1 finds an existing reviewer record by email, it does not
   overwrite that record's institution with the applicant's [REPORTED by the
   owner 2026-11-20; not yet confirmed with Connor or in data], so the
   record-vs-applicant comparison can catch stale records.

   **D26 measurement** [VERIFIED 2026-11-20 via an owner-approved, read-only,
   counts-only query of the same 62 roster rows; only institution names were
   sent to the public OpenAlex API, using the existing
   `strongInstitutionDisplayMatch` and `domainRelated` helpers]. The listed
   institution was the candidate's affiliation, else the AkoyaGO record's
   (both applicant-originated for D26 [ASSUMED]):
   - 22 email domains fit the institution and 2 do not (about 8% of the 24
     that could be compared);
   - 4 are personal addresses (gmail and similar);
   - 33 institutions could not be resolved to a domain, because long
     department strings ("Department of X, University Y, City") fail the
     strong-match rule. The build must clean institution names first or this
     check rarely fires;
   - 1 had no institution.
   - Listed vs AkoyaGO record institution: 0 contradictions among the 20 rows
     with both. For D26 both came from the applicant, so this says nothing
     about J27, where the record keeps its own institution.

### 8. Contract review (2026-11-20, Session 693)

`/contract-reconcile` Mode A trace of §7 and owner decisions 3, 5, 8, 9.
Verdict: **needs rework for the server items; the design-only and
projection items can proceed.** Required changes, in order:

1. **Open decision A (below)** before any server work.
2. **The server decides the evidence level.** Today the browser picks the
   evidence type and the route accepts any member of the set
   (`pages/api/workbench/reviewer-address-trust.js:69-80`;
   `lib/utils/reviewer-address-trust.js:89-92`). Corroboration types ("older
   contact", "lookup found the same address", "accepted before") must be
   written only by the server after re-deriving the fact, and URL-less types
   must be refused when a "something off" flag is set. Otherwise the levels
   are a client-only exemption from the evidence gate.
3. **Keep the lookup source through confirm.** `confirm_identity` overwrites
   `contactEnrichment.email`/`emailSource` with the submitted email and
   `manual` (`lib/services/reviewer-roster-store.js:337-353`;
   `lib/services/workbench/reviewer-roster-service.js:557-572`), which erases
   the evidence a server check would read. Compute the level before that
   write, or from the person record, and compare the exact final email.
4. **Decision 8 specifics.** `createdon` is in neither the contacts select nor
   the suggestion select (`lib/dataverse/core/entity-registry.js`); choose the
   reference time (suggestion `createdon` or roster `first_seen_at`); require
   a name match on the single contact (`findByEmailCandidates` checks email
   only, `lib/dataverse/adapters/contact.js:161-185`).
5. **DNS MX semantics.** Server only, bounded timeout, per-domain cache; no
   record → "something off"; timeout or server failure → "check
   unavailable", which goes to the evidence-link level, never to "plausible".
   Account for the A-record-only implicit-MX case.
6. **Institution-name cleanup and a role-mailbox detector** at the new call
   site, not inside `strongInstitutionDisplayMatch` (it also gates
   enrichment's anchored domains, `domain-evidence.js:134-143`). Neither
   helper exists today.
7. **Reason codes alongside `reasoning`, not instead.** `reasoning` also
   carries the positive "why suggested" text for search rows and is persisted
   to Dataverse `wmkf_matchreason` (`save-candidates-service.js:1028-1032`,
   `manual-reviewer-service.js:364`) and exported. Add a closed code field to
   the roster allowlist with a card fallback for rows that lack it.
8. **Combined action as client orchestration of the existing verify and
   promote routes for one candidate** (not the multi-row `saveSelected`).
   Partial failure (confirmed but not added) must show as a failure. Branch 2
   must cover `confirm_identity` plus the five `wmkf_selected` writers:
   `upsert` (save-candidates), `ensureStaffManualCandidate` (manual add),
   `selectIfUnengaged` (applicant and Factory promotion), `restore`
   (my-candidates) and `applyStage2aResponse` (reviewer accept).
9. **Removing the applicant list must keep what only it renders**
   (`shared/components/reviewers/search/ApplicantReviewerStatus.js:41-176`):
   the Factory promote button, the enrichment re-run with progress and
   errors, the ingest and read-failure retries, the "applicant listed nobody"
   empty state, and rows that have no card yet.
10. **Institution comparison:** the identical-string short-circuit is small;
    "different institution and field" needs a field signal that nothing feeds
    to `institution-affiliation-stage2.js` today.
11. **Search-found rows** confirm through save-candidates, not promotion; the
    three levels apply only to applicant rows.

Build order:
- **Independent now:** card anatomy and wording mapped from current
  `reasoning` and `institutionPresentation.kind`; projecting the applicant
  columns in `applicant-reviewers-service.js`; the identical-string
  short-circuit; moving the applicant warnings, re-run and Factory button to
  the top of Find before removing the list.
- **Next:** the closed reason-code field.
- **After decision A and a Codex plan review:** the evidence-type contract,
  the server-computed level (contact age, MX, domain fit), the combined
  action, then Branch 2 enforcement across every entry point.
- No Postgres migration (JSONB). Atlas pages
  `postgres-reviewer-find-roster.md` and `dataverse-wmkf-potentialreviewers.md`
  change; `check:dataverse-access-layer` for the select changes.

### 9. Open decisions
**A. What should a staff confirmation mean at send time?** Today a confirmed
address becomes `ready`, so the invite skips the per-recipient check (S391
exact-address model). Options: keep that for every level (the checkbox
level then removes both the evidence link and the send-time check), or make
the checkbox level `quick_check` so the send-time check returns for those
reviewers only.

Owner decisions 5–9 settled the brief's earlier questions on 2026-11-20.
