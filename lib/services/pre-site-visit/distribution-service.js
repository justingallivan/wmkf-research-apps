/**
 * Frozen Pre-Site informational distribution compatibility facade.
 *
 * Public orchestration and helper names remain available from this original
 * module while implementation ownership lives in the neutral distribution
 * leaves. The facade carries no default dependency object or orchestration.
 */
import { TEMPLATE_VERSION } from './distribution/model.js';
import { preparePreSiteDistribution } from './distribution/prepare.js';
import { sendPreSiteDistribution } from './distribution/send.js';
import { getPreSiteDistributionHistory } from './distribution/history.js';
import {
  BRIEFING_LINK_PLACEHOLDER,
  REVIEW_BUNDLE_LINK_PLACEHOLDER,
  distributionBodyHtml,
  normalizeDistributionRecipients,
  renderBriefingBody,
  reviewBundleDocumentUrl,
  sessionLineText,
  sessionSnapshotOf,
  sessionSnapshotsMatch,
} from './distribution/composition.js';
import { projectDistributionAttempt } from './distribution/model.js';
import { retainReviewBundle } from './distribution/retained-snapshot.js';
import { readDeliberationShareDefaults } from './distribution/context.js';

export const PRE_SITE_DISTRIBUTION_TEMPLATE_VERSION = TEMPLATE_VERSION;

export {
  preparePreSiteDistribution,
  sendPreSiteDistribution,
  getPreSiteDistributionHistory,
  BRIEFING_LINK_PLACEHOLDER,
  REVIEW_BUNDLE_LINK_PLACEHOLDER,
  distributionBodyHtml,
  normalizeDistributionRecipients,
  projectDistributionAttempt,
  retainReviewBundle,
  readDeliberationShareDefaults,
  renderBriefingBody,
  reviewBundleDocumentUrl,
  sessionLineText,
  sessionSnapshotOf,
  sessionSnapshotsMatch,
};
