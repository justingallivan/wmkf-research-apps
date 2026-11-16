export const SCORING_STATUS = Object.freeze({ yes: 100000004, no: 100000005 });

export function isScoringEditable(status) {
  return status === null || status === 100000000
    || status === SCORING_STATUS.yes || status === SCORING_STATUS.no;
}

export const CHAIRS_RECOMMENDATION_STATUS = Object.freeze({ yes: 707510005, no: 707510006 });

export function hasChairsRecommendation(status) {
  return status === CHAIRS_RECOMMENDATION_STATUS.yes || status === CHAIRS_RECOMMENDATION_STATUS.no;
}

export function isChairsRecommendationEditable(status) {
  return status === SCORING_STATUS.yes || hasChairsRecommendation(status);
}
