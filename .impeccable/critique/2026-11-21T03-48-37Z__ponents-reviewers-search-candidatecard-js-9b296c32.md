---
target: Find-tab identity-review candidate card — critique and audit
total_score: 12
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 4
target_identity: "file:/Users/gallivan/Code/WMKF_Apps/shared/components/reviewers/search/CandidateCard.js"
target_fingerprint: "sha256:b7cbde456478214e35d7dd124c067bb7754fbedcdb486cf08edbeed4959cb601"
target_path: /Users/gallivan/Code/WMKF_Apps/shared/components/reviewers/search/CandidateCard.js
timestamp: 2026-11-21T03-48-37Z
slug: ponents-reviewers-search-candidatecard-js-9b296c32
---
Method: dual-agent (A: design review · B: detector + browser evidence + technical audit)

# Find-tab identity-review card — critique and audit

2026-11-20. View-only Production inspection of request 1003526 (Peer Review → Find), five applicant-recommended cards, all identity-unverified. Other card states and the Confirm dialog reviewed from source only. Commit dc6847a16.

## Verdict
The card reports pipeline checkpoints, not a decision. Each subsystem adds its own notice, voice and sometimes buttons; nothing is organized around "is this the person the applicant meant, and can we email them?"

## Design health — 12/40, Poor
| # | Heuristic | Score | Key issue |
|---|---|---:|---|
| 1 | System status | 1 | "Existing reviewer record linked" beside "could not confirm this is the right person"; green ✓ for same people in bottom list |
| 2 | Real-world match | 0 | "explanatory institution assessment… existing verification gate", "identity resolver", quick_check, "Retry enrichment" |
| 3 | User control | 3 | Not a fit recoverable (Excluded → Reconsider) |
| 4 | Consistency | 1 | Confirm identity / Not a fit twice per card in two styles |
| 5 | Error prevention | 2 | Strong server gates; likely namesake (Pyle, UAB Psychology) styled like a benign result |
| 6 | Recognition | 1 | Email hidden on card; only in separate list below |
| 7 | Efficiency | 1 | No batch confirm; inert Select all; evidence URL per person |
| 8 | Minimalism | 0 | 5–6 boxes before actions; three say "needs confirmation" |
| 9 | Error recovery | 1 | Contradictory status words; empty evidence panel |
| 10 | Help | 2 | Tooltips exist; two dangling pointers |

## Audit — 11/20, Acceptable
Accessibility 2 (duplicate same-name buttons, no headings, modal labels not associated); Performance 3; Theming 2 (two primary colours, text-[11px] ×4, shared Button unused); Responsive 3 (text targets 14–16px); Implementation Integrity 1 — FAIL.

Detector: CLI 0 findings on .js (regex-only, element rules skipped — undercount, not clean). Overlay blocked by Production CSP (script-src self + nonce). Measured contrast all AA (min 4.63:1).

## Priority issues
1. [P1] Card shows every check instead of one decision — CandidateCard.js:39-72 notice remedies duplicate :889-926 action row. Fix: one status line, one evidence block, one action row. distill → layout.
2. [P1] Internal gate text shown; real reason demoted — enrich-recommended-service.js:372 labelled "Why this reviewer was suggested" via reviewer-search-logic.js:270-276 fallthrough; record ID in <code> at :833. Fix: lead with "Recommended by the applicant"; map closed reason codes to plain copy. clarify.
3. [P1] Asked to confirm against absent evidence while facts live elsewhere — evidence panel :608-711 shows none retrieved; notice quotes UCSF; bottom list shows stored UCSF + email. Fix: applicant listed | AkoyaGO record | publications comparison. layout → clarify.
4. [P1] Warnings weighted backwards — identical UTSW addresses "could not establish"; Pyle UAB Psychology vs Yale grey; generic gate amber (institution-affiliation-stage2.js:138-145, CandidateCard.js:53-55). clarify + server fix.
5. [P2] Six-step promotion; audit-form Confirm dialog (CandidateEditModal.js, two attestations, URL by default; labels not associated, errors not announced). Fix: single "Confirm and add to Invite"; stored-address evidence without URL (owner decides). distill/onboard → harden.

## Persona red flags
First-cycle PD: dangling "Contact readiness is shown under Identity below" (:374 vs :465) and "see the Identity review section"; unclear evidence link. Power user: no batch, inert Select all, ~350px cards, email in second list. Stress tester: repair-retry copy with no control (:511); partial failure in green toast (useReviewerPromotion.js:605-611).

## Minor
Name text-sm, not a heading (:337); Not a fit ~1100px from Confirm; purple Scholar link; text-blue-500 "[link]" 3.7:1; default focus ring; Dataverse vs AkoyaGO naming; triple "nothing ready"; duplicate applicant-referred list.

## Questions
1. If applicant-named person + linked record email agree, what is the PD confirming?
2. Separate card for applicant-recommended vs search-found?
3. Two top-level outcomes, Add to Invite / Not a fit?
4. Does the applicant-referred list still need to exist?
