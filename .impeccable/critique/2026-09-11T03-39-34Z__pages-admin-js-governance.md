
## Addendum — live-page pass (Assessment A retry succeeded, desktop only; narrow width unverified)
- P1 DEFECT (fixed same night, PR "scope chevron rotation"): group chevrons pinned upright once the panel is open; generic `.group` + `group-open:` matched the open ancestor (AdminWorkspaceNavigation.js:200/206, EmailDefaultsSection.js:184/192).
- P1: email card/field headings identical in size, weight, color; "N cards" promises chrome that does not render; `divide-y divide-gray-100` invisible at render.
- P2: panel-level info button sits alone in a ~60px dead band under the header (AdminWorkspaceNavigation.js:212); policy slot `bg-gray-50` header indistinguishable from white; ~19 saturated blue Save buttons vs black Publish buttons in one scroll.
- Confirmed: 3 policy slots (reviewer-coi 5 versions, reviewer-ai-use 3, grantee-waiver 1); expanding Policies yields ~2,200px of prose; Publish form mounts below the rendered body so the click appears to do nothing; `slot: reviewer-coi` outranks "Active version" visually; textareas rows=12 leave ~40% empty.
