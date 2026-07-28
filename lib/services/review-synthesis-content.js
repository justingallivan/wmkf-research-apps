/**
 * Pure review-synthesis input composition.
 *
 * Both the interactive/automatic generator and the Reviews read model use
 * this exact digest and hash. Keeping one composer is what makes
 * `reviewSynthesisState.current` a meaningful statement about the bytes the
 * model would receive, rather than a best-effort lifecycle approximation.
 */

import crypto from 'crypto';

function hasAnswerValue(answer) {
  return answer.answerValue !== null
    && answer.answerValue !== undefined
    && answer.answerValue !== '';
}

function formatAnswerForDigest(answer) {
  const lines = [
    `Question key: ${answer.questionKey || 'unknown'}`,
    `Question type: ${answer.questionType || 'unknown'}`,
    `Question text: ${answer.questionText || ''}`,
  ];
  if (hasAnswerValue(answer)) lines.push(`Answer value: ${answer.answerValue}`);
  if (answer.questionType === 'multiselect' && Array.isArray(answer.answerValues)) {
    lines.push(`Selected categories: ${answer.answerValues.map((pair) => pair.label).join('; ')}`);
  }
  lines.push(`Answer text: ${answer.answerText || ''}`);
  return lines.join('\n');
}

export function buildReviewSynthesisDigest(reviewers) {
  return (Array.isArray(reviewers) ? reviewers : [])
    .map((reviewer) => {
      const heading = `Reviewer: ${reviewer.name || 'Unnamed reviewer'}${
        reviewer.affiliation ? ` (${reviewer.affiliation})` : ''
      }`;
      const body = (reviewer.answers || [])
        .filter((answer) => !answer.answerValuesUnreadable
          && ((answer.answerText && answer.answerText.trim().length > 0)
            || hasAnswerValue(answer)
            || Array.isArray(answer.answerValues)))
        .map(formatAnswerForDigest)
        .join('\n\n');
      return `${heading}\n${body}`;
    })
    .join('\n\n---\n\n');
}

export function hashReviewSynthesisDigest(digest) {
  return crypto.createHash('sha256').update(String(digest || '')).digest('hex');
}
