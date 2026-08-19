# Unresolved institution identity smoke — before and after

Generated: 2026-08-19T05:02:19.887Z

Status: **shadow only; not wired to production authority**

## What was tested

All active unresolved institution-mismatch roster rows retaining both compared institutions (15), plus the 10 most recently updated rows lacking a reconstructable pair; no names, emails, request IDs, or candidate keys retained

The sample contains 15 cards with both compared institutions and 10 cards where the persisted evidence could not reconstruct a pair. “Before” is the observed production result; “after” is the deterministic proposed classifier, not a new live provider call.

## Headline

- Expected obvious same-organization clears: **8**
- Before automatic clears: **0**
- Proposed automatic clears: **6**
- Manufactured reviews remaining: **2**
- Unsafe proposed automatic clears: **0**
- Surfaced cases without a remedy: **0**
- Cases matching the adjudicated disposition: **23/25**

## Case results

| Case | Compared institutions / available evidence | Expected | Before | Proposed after | Reason / remedy |
|---|---|---:|---:|---:|---|
| unresolved-f9b213526332 | Lamont-Doherty Earth Observatory, Columbia University, Palisades, NY 10… ↔ Lamont Doherty Earth Observatory, Columbia University | auto_clear | surface | auto_clear | same_organization_with_safe_decoration; no action required |
| unresolved-a84e6c6e46e5 | Department of Earth, Atmospheric, and Planetary Science, Purdue Univers… ↔ Purdue University | auto_clear | surface | auto_clear | same_organization_with_safe_decoration; no action required |
| unresolved-d70586a585f6 | Department of Microbiology, Harvard Medical School, Boston, MA, USA. ↔ Harvard Medical School | auto_clear | surface | auto_clear | same_organization_with_safe_decoration; no action required |
| unresolved-24810991224e | Department of Biochemistry, Duke University School of Medicine, Durham,… ↔ Duke University | surface | surface | surface | insufficient_structural_evidence; action: Confirm identity or Not a fit |
| unresolved-83ce8914d857 | Department of Biochemistry and Biophysics, University of California, Sa… ↔ University of California, San Francisco | surface | surface | surface | insufficient_structural_evidence; action: Confirm identity or Not a fit |
| unresolved-888808befc3f | Department of Molecular Biology and Genetics, Cornell University, Ithac… ↔ Yale University | surface | surface | surface | insufficient_structural_evidence; action: Confirm identity or Not a fit |
| unresolved-30ef5475b6e0 | University of Texas Institute for Geophysics, Jackson School of Geoscie… ↔ The University of Texas at Austin | surface | surface | surface | insufficient_structural_evidence; action: Confirm identity or Not a fit |
| unresolved-9eb2d6bb6876 | Department of Geology, University of Kansas, Lawrence, KS, USA. ↔ University of Pennsylvania | surface | surface | surface | insufficient_structural_evidence; action: Confirm identity or Not a fit |
| unresolved-2569b1946dd0 | Department of Cancer Biology, Dana-Farber Cancer Institute, Boston, MA,… ↔ Harvard University | surface | surface | surface | insufficient_structural_evidence; action: Confirm identity or Not a fit |
| unresolved-0e43e7bca20d | Nash Family Department of Neuroscience, Friedman Brain Institute, Icahn… ↔ Howard Hughes Medical Institute | surface | surface | surface | insufficient_structural_evidence; action: Confirm identity or Not a fit |
| unresolved-5c277235d507 | Department of Bioengineering, Stanford University, Stanford, CA 94305. ↔ Stanford University | auto_clear | surface | auto_clear | same_organization_with_safe_decoration; no action required |
| unresolved-69090881d690 | Department of Biomedical Engineering, Duke University, Durham, NC, USA. ↔ Duke University | auto_clear | surface | auto_clear | same_organization_with_safe_decoration; no action required |
| unresolved-365d3af38651 | Department of Chemistry and Biochemistry, University of California, San… ↔ University of California Santa Barbara | auto_clear | surface | auto_clear | same_organization_with_safe_decoration; no action required |
| unresolved-97d16b3bdc69 | Department of Chemistry and Biomolecular Sciences, University of Ottawa… ↔ University of Ottawa | auto_clear | surface | surface | insufficient_structural_evidence; action: Confirm identity or Not a fit |
| unresolved-a6e6bd5c0fab | Department of Mechanical and Aerospace Engineering, University of Calif… ↔ University of California, Los Angeles | auto_clear | surface | surface | insufficient_structural_evidence; action: Confirm identity or Not a fit |
| unresolved-07fb76d5ecff | Only one institution retained: Center for Translational Cancer Research, Institute of Biosciences and … | surface | surface | surface | insufficient_pair_evidence; action: Confirm identity or Not a fit |
| unresolved-5eb50b42a355 | Only one institution retained: Division of Bacteriology & Mycology, ICAR-Indian Veterinary Research In… | surface | surface | surface | insufficient_pair_evidence; action: Confirm identity or Not a fit |
| unresolved-72c7eebfb78e | Only one institution retained: UCLA | surface | surface | surface | insufficient_pair_evidence; action: Confirm identity or Not a fit |
| unresolved-aa1df2627290 | Only one institution retained: National Center for Chronic and Noncommunicable Disease Control and Pre… | surface | surface | surface | insufficient_pair_evidence; action: Confirm identity or Not a fit |
| unresolved-a332f3cc7386 | Only one institution retained: Stony Brook University | surface | surface | surface | insufficient_pair_evidence; action: Confirm identity or Not a fit |
| unresolved-082466b29d1e | Only one institution retained: University of Ottawa | surface | surface | surface | insufficient_pair_evidence; action: Confirm identity or Not a fit |
| unresolved-b473c5a6674c | Only one institution retained: Tufts University School of Medicine | surface | surface | surface | insufficient_pair_evidence; action: Confirm identity or Not a fit |
| unresolved-a445d6cbb334 | Only one institution retained: Department of Chemistry, Chicago Center for Theoretical Chemistry, Jame… | surface | surface | surface | insufficient_pair_evidence; action: Confirm identity or Not a fit |
| unresolved-2df9e638deb8 | Only one institution retained: Rice University | surface | surface | surface | insufficient_pair_evidence; action: Confirm identity or Not a fit |
| unresolved-9898c7eec1b4 | Only one institution retained: Department of Chemistry, Stanford University, Stanford, California 9430… | surface | surface | surface | insufficient_pair_evidence; action: Confirm identity or Not a fit |

## Interpretation

- An automatic clear means only that the narrow structural classifier proved the same organization after safe academic/locality decoration. It does not authorize relationship-based equivalence.
- A surfaced result is not called a mismatch unless another authority proves a conflict. The user is told why review is needed and can choose Confirm identity or Not a fit.
- Any proposed automatic clear on a case adjudicated for review is a hard safety failure.
- The ten insufficient-evidence rows remain surfaced by design; their purpose is to test honest wording and a real remedy, not institution equivalence.

## Stop boundary

This artifact evaluates the approved narrow slice. Registry-backed sameness and organizational relationships remain outside production authority and require a later shadow/adjudication promotion decision.

