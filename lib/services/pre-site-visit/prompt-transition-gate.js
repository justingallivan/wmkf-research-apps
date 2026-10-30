/** Server-only operational pause for the reviewed prompt/reader transition.
 * No client/request bypass. Unset/empty/off preserve existing operation; on or
 * any invalid nonempty value blocks. Deployment changes are not an instantaneous
 * distributed lock: operators must also drain ALL older instances and callers.
 */
import { ServiceHttpError } from '../service-http-error.js';
export function assertPreSitePromptTransitionOpen(promptName) {
  if (typeof promptName !== 'string' || promptName.trim().toLowerCase() !== 'pre-site-visit.proposal-core.generate') return;
  const value = process.env.PRE_SITE_PROMPT_TRANSITION_PAUSE;
  if (value === undefined || value === '' || value === 'off') return;
  throw new ServiceHttpError('Pre-Site generation is temporarily paused for a prompt update. Try again after maintenance.', {
    httpStatus: 503,
    code: 'pre_site_prompt_transition_paused',
    body: { error:'Pre-Site generation is temporarily paused for a prompt update. Try again after maintenance.', code:'pre_site_prompt_transition_paused' },
  });
}
