---
target: Admin Messages & policies page
total_score: 12
max_score: 40
na_heuristics: 
p0_count: 2
p1_count: 1
timestamp: 2026-09-11T03-39-34Z
slug: pages-admin-js-governance
---
# Critique: Admin → Workflows → Messages & policies (pages/admin.js `governance`)

Method: dual-agent. A: design review, source-only (live page redirected to sign-in). B: detector scan ran; browser evidence blocked (sign-in, then navigation permission). Source at main e1433dc8, 2026-09-10.

## Heuristics (12/40)
1 Visibility 1 · 2 Real world 1 · 3 Control 1 · 4 Consistency 0 · 5 Error prevention 1 · 6 Recognition 2 · 7 Flexibility 1 · 8 Minimalist 1 · 9 Recovery 2 · 10 Help 2.

## Deterministic scan
7 advisory `design-system-font-size` findings, all in shared/components/admin/PoliciesSection.js (lines 316 [11px], 360, 374, 450, 460, 488, 495 [10px]). Zero in AdminWorkspaceNavigation.js, EmailDefaultsSection.js, DataverseFieldInfoButton.js, pages/admin.js.

## Priority issues
- P0 Publish has no confirmation and starts from an empty body (PoliciesSection.js:259, :383-399). Prefill from active version by default; confirm step reusing DiffBlock. → harden
- P0 Three disclosure idioms, no shared item chrome (AdminWorkspaceNavigation.js:200-208; EmailDefaultsSection.js:184-194; PoliciesSection.js:145-150, :478). One DisclosureRow primitive at all depths; policy slots as closed rows. → layout
- P1 No dirty state; save confirmation self-erases (EmailDefaultsSection.js:41, :120-122). Changed-field marker, persistent "Saved · time", save-all per card, navigate-away guard. → harden
- P2 Off-system controls: bg-blue-700 Save without hover/focus (EmailDefaultsSection.js:137); `rounded` everywhere vs DESIGN.md 0.5rem; `text-sm text-xs` collision (PoliciesSection.js:357); no input focus rings. Route through shared Button/Input. → polish
- P2 Six chip treatments; "Active version" has no chip; blank-invitation is amber though it blocks sends (pages/admin.js:3164). One StatusChip. → typeset
- P3 Developer copy in production strings (PoliciesSection.js:54,55,57,388; editableTextDefaults.js:173). → clarify
- P3 h4/h5 same size (EmailDefaultsSection.js:198, :86); Policies has no headings; redundant Email panel-level popover (pages/admin.js:196-201). → distill

## Persona red flags
Weekly editor: no search/save-all/deep link, mono subject lines. First-time superuser: slot codes and schema names unexplained; panels look like different products. PD changing one sentence: blank publish body, "Prefill" link hidden as a 12px developer note, no confirm, no undo.

## Minor
Mixed ellipses; red-600 vs red-700; chip text case; lowercase "dismiss"; block-in-inline in email summary; label vs aria-label; "Reload" instruction with no control.

## Questions
Should a PD ever see "publish"? Why is Messages & policies one page? Who is the field-mapping popover for?
