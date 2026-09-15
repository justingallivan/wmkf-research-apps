/**
 * True while a completed structured review is waiting for the automatic DOCX
 * filer to commit its durable SharePoint pointer.
 *
 * A file-backed row is ready, not pending. A row without any rich-text answer
 * is not in the automatic filer's actionable population, so it must not cause
 * a misleading pending control or background polling.
 */
export function reviewerDocumentIsPending(reviewer) {
  return reviewer?.reviewStatus === 'complete'
    && !reviewer?.reviewSharePointFolder
    && Array.isArray(reviewer?.answers)
    && reviewer.answers.some((answer) => answer?.questionType === 'richtext');
}
