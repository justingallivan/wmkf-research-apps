# Critique ignore list

Owner decisions that later critiques must not re-raise as findings. Each entry
names the surface, the settled decision, and when the owner made it.

## Proposal Ranking (`shared/components/proposal-ranking/AssessmentWorkflow.js`)

- **PD tile order on group cards.** Lead PD first, then the other PDs
  alphabetically by first name, lead name underlined. Columns may therefore
  shift between cards; do not propose a fixed column order. Owner, 2026-10-14.
  The numeric sort artifact (PD 1, 10, 11…) appears only with numbered fixture
  names.
- **Recommended total placement.** The total, count and East/West counts live on
  the Recommended cutoff line, with no targets anywhere on the page. The pinned
  group bar repeats them only while that line is out of view. Owner,
  2026-10-14 and 2026-10-15.
- **Unanswered confidence styling.** The amber "Choose one" box shows on every
  unanswered card from the start of preparation; the red outline and banner
  appear after Continue. It only appears while a PD works their own list, which
  is about 12 cards per program in a real cycle. Owner, 2026-10-14 and
  2026-10-15.
- **Narrow and phone layouts.** Ranking is used on desktop and iPad, not phones.
  Do not raise phone-width card height or PD grid wrapping. Owner, 2026-10-15.
- **Confidence shown by tile border.** Solid border means confident and dashed
  means not sure; there are no check or question-mark symbols. Owner,
  2026-10-14.
- **No peer-grade legend.** The legend was removed; each tile exposes its full
  rating name to assistive technology. Owner, 2026-10-15.
- **Neutral cards.** No amber or colored card backgrounds; no request numbers, no
  peer-review mean, no "grades differ" note. Owner, 2026-10-14.
- **Rank number as a quiet move control.** Moving a card by its rank number stays
  visually unaccented; only its hit area may grow. Owner, 2026-10-14.
