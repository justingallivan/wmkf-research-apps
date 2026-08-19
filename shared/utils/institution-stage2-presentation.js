'use strict';

const INSTITUTION_STAGE2_PRESENTATION_FLAG = 'NEXT_PUBLIC_INSTITUTION_STAGE2_PRESENTATION';
const INSTITUTION_STAGE2_PRESENTATION_VERSION = 'institution-stage2-presentation/v1';

function isInstitutionStage2PresentationEnabled(
  value = process.env.NEXT_PUBLIC_INSTITUTION_STAGE2_PRESENTATION,
) {
  return String(value || '').trim().toLowerCase() === 'on';
}

function activeInstitutionStage2Presentation(
  candidate,
  flagValue = process.env.NEXT_PUBLIC_INSTITUTION_STAGE2_PRESENTATION,
) {
  const presentation = candidate?.institutionPresentation;
  return isInstitutionStage2PresentationEnabled(flagValue)
    && presentation?.version === INSTITUTION_STAGE2_PRESENTATION_VERSION
    && presentation.visible === true
    ? presentation
    : null;
}

module.exports = {
  activeInstitutionStage2Presentation,
  INSTITUTION_STAGE2_PRESENTATION_FLAG,
  INSTITUTION_STAGE2_PRESENTATION_VERSION,
  isInstitutionStage2PresentationEnabled,
};
