# Keck Reviewer Matching Module

This module supports the W.M. Keck Foundation in matching research proposals to qualified reviewers from a database of consultants, board members, and research program staff.

## Key Files

- `data/consultant_expertise.csv` — Master reviewer database
- `src/reviewer_matcher.jsx` — React dashboard for browsing and AI-assisted matching
- `docs/SKILL_reviewer_matching.md` — Full operational procedures for Phase I batch and Phase II individual matching
- `docs/PROJECT_CONTEXT.md` — Complete project context including roster details, matching conventions, and known gaps
- `docs/J26_usage_report.md` — J26 usage statistics and per-reviewer profiles

## Matching Rules — Always Enforce

1. **Depth over breadth** — prefer reviewers who can evaluate central scientific claims over generalists covering peripheral aspects
2. **Flag gaps honestly** — if no roster member covers a proposal's core domain, say so explicitly and describe the missing expertise
3. **S&E vs. MR labels are not constraints** — these are committee structure artifacts, not expertise boundaries
4. **Research Program Staff are eligible reviewers** — treat them like any other roster entry
5. **Consultant cap** — maximum 10 proposals per consultant in batch mode

## Expertise Boundaries — Never Conflate

- **Goldhaber-Gordon**: condensed matter physics / quantum materials ≠ quantum computing algorithms
- **Gallivan**: biochemistry / synthetic biology ≠ synthetic organic / medicinal chemistry
- **Marchetti**: active matter theory ≠ experimental cell biology
- **Djorgovski**: astrophysics data science ≠ general ML for biology
- **Bradway**: industry/translational perspective only — NOT scientific peer review
- **Foster**: strategy perspective only — NOT scientific peer review
- **Kresa**: systems engineering perspective only — NOT scientific peer review

## Lead PD Assignment Domains

| PD | Core domains |
|---|---|
| Jean Kim | iPSC disease modeling; neurodegenerative disease; stem cell biology; cancer genomics; immune-cell biology |
| Justin Gallivan | Synthetic biology; RNA regulatory mechanisms; microbiome; chemical biology; biochemistry-adjacent SE |
| Kevin Moses | Developmental biology; genetics; model organisms; Wnt/Hedgehog/Notch/EGF signaling; broadest generalist backup |
| Beth L. Pruitt | ALL condensed matter physics; MEMS/NEMS; quantum sensing; instrumentation; soft matter mechanics; cell mechanics |

## Known Roster Gaps (Recurring)

1. Alzheimer's disease / neurodegeneration cell biology (tau, amyloid, microglia)
2. Quantum computing / quantum algorithms
3. Seismology / tectonic geophysics
4. Synthetic organic / medicinal chemistry
5. Plasma physics
6. Atmospheric science / cloud microphysics

## When Editing the CSV

- No commas in any field — use semicolons
- Keywords: 5–6 terms max; no institution or award names
- Expertise: domain-level only — no citations, paper titles, lab names, or program names
- ORCID: full URL format or N/A
- Distinctions: fellowships/honors only; no pre-PhD (except Hertz/NIH/NSF)
- After any edit, verify no commas were introduced

## For Full Procedures

Read `docs/SKILL_reviewer_matching.md` before executing any batch assignment or individual matching task. It contains the complete step-by-step workflows for Mode A (Phase I batch) and Mode B (Phase II individual matching).
