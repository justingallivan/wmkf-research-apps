# Applicant Reviewer Dataverse-First Hydration — Opus Implementation Review

**Date:** 2026-07-29  
**Reviewer:** Claude Opus, high effort, read-only  
**Final verdict:** `PASS` — no P0–P2 findings

## Review sequence

The first implementation review returned `NEEDS FIXES`. It identified:

- a sticky `applicantContactMismatch` marker with no staff-resolution path;
- staff-manual contact not participating in the applicant canonical projection;
- non-convergent cache behavior for stable conflict/mismatch states;
- transient person-read failure replacing actor-confirmed evidence;
- missing mixed partial-success/current-request COI coverage;
- ambiguous owner-none handling and an anti-scrape stored-address gap.

The remediation:

- makes actor-confirmed manual contact an explicit, bounded override while the
  server still freshly revalidates the exact person and active owner;
- clears the historical mismatch on confirmation and self-clears it when fresh
  canonical and roster claims agree;
- preflights unavailable/inactive/conflicted exact-person state before contact
  writes and re-reads after a write;
- caches stable conflict/mismatch results while retrying transient
  `unavailable` hydration;
- preserves prior actor-confirmed canonical evidence across transient reads;
- adds mixed failure/success and current-request COI tests;
- distinguishes missing/failed owner resolution and rejects anti-scrape
  addresses.

A second review found three remaining P2 issues:

1. a vetted enrichment email for a person with no stored address could not
   reach the B1 promotion write, while its source risked being written alone;
2. the staff-manual override checked anti-scrape format after the write;
3. an unavailable hydration-failure row could receive staff confirmation
   without ever running request-specific COI.

The closing remediation:

- persists the vetted enrichment address/source/permission as one roster claim,
  lets only the shared authoritative contact projection make it selectable,
  and writes address plus source atomically through B1;
- withholds `wmkf_emailsource` from the bibliometric writer unless it describes
  the already stored canonical address;
- rejects anti-scrape manual input in both projection and promotion before any
  person write;
- withholds the confirm affordance for unavailable applicant rows and enforces
  the same rule in the authenticated roster endpoint.

## Closing verification

Opus confirmed:

- the no-stored-email B1 flow is paired, authoritative, and atomic;
- no enrichment write can orphan `wmkf_emailsource`;
- anti-scrape staff-manual input cannot reach a person write;
- hydration-unavailable rows cannot be confirmed through UI or direct API;
- recovered rows must re-enter normal enrichment/COI and promotion gates;
- stale mismatch evidence self-clears when current claims agree;
- no new client-spoof, identity/COI bypass, or send-classifier bypass exists.

The final review listed only P3/historical/deployment-smoke notes:

- some fail-closed stored anti-scrape cases provide feedback only at promotion;
- `confirm_identity` can record a no-op attestation for anti-scrape input, but
  projection and promotion still block it before a person write;
- the research adapter has a pre-existing narrow concurrent fill-if-empty
  provenance race outside this change;
- stable inactive/conflict repairs require an explicit re-enrichment;
- live deployment smoke is still required to verify the mocked atomic write
  against Dataverse.

No repository files were edited by Opus.
