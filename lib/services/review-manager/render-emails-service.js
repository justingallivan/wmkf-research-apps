/**
 * Review Manager — per-recipient email draft rendering service
 * (Route→Service Consolidation Plan, Stage 2 wave).
 *
 * Holds ALL business logic for POST /api/review-manager/render-emails;
 * the route is a thin shell (method dispatch, auth, rate limit, input
 * validation, DAL context, HTTP mapping — the 500 envelope incl. its
 * dev-only `details` branch stays in the shell).
 *
 * Contract (plan Decision 3):
 *   - takes a plain argument object, never req/res;
 *   - returns { drafts, stats } (per-recipient skip semantics INSIDE the one
 *     200: a recipient without an email yields a draft row with
 *     skipped:'no_email'; every row carries emailConfidence; an invitation
 *     skipped as email_research_only carries the already-minted manualLink so
 *     staff can send it outside the app without weakening the send gate);
 *   - throws RenderEmailsError (extends ServiceHttpError) for the 404
 *     no-reviewers case — this route speaks `{ error }`, so no `body`;
 *   - token minting is BEST-EFFORT PER RECIPIENT: a mint failure leaves that
 *     recipient's externalLink empty ("" after substitution) and never fails
 *     the render;
 *   - ASSUMES a trusted DAL context already exists — never establishes one.
 *
 * Recipient + proposal data come from Dataverse so the preview matches what
 * `send-emails` will use. Cycle-level template config lives on Dataverse
 * `wmkf_appgrantcycle` (W3 cutover); `loadCycleConfigs` keeps the snake_case
 * shape the renderer consumes.
 */

import { loadCycleConfigs } from './cycle-config-loader';
import {
  replacePlaceholders,
  buildTemplateData,
} from '../../utils/email-generator';
import { ContactParser } from '../../utils/contact-parser';
import { meetingDateToCycleCode } from '../../utils/cycle-code';
import { formatNameList, stripHonorific } from '../../utils/format-name-list';
import { reflowAbstract, abstractNeedsReflow } from '../../utils/abstract-format';
import { getHonorariumAmount } from '../honorarium-config';
import * as suggestionAdapter from '../../dataverse/adapters/reviewer-suggestion';
import { getByIdWithSelect as getReviewerByIdWithSelect } from '../../dataverse/adapters/potential-reviewer';
import { getById as getRequestById } from '../../dataverse/adapters/grant-request';
import { fetchCoPIs } from '../proposal-participants';
import { mintAndStore } from '../../external/token-lifecycle';
import { emailConfidence } from '../../utils/reviewer-invite';
import { computeReviewerTokenExpiry } from '../../external/reviewer-token-ttl';
import { ServiceHttpError } from '../service-http-error';

const EXTERNAL_LINK_PLACEHOLDER = '{{externalLink}}';

/**
 * Domain error carrying an HTTP status for the route shell to map.
 * This route speaks `{ error }`, so no explicit `body` is set.
 */
export class RenderEmailsError extends ServiceHttpError {
  constructor(message, httpStatus) {
    super(message, { httpStatus });
    this.name = 'RenderEmailsError';
  }
}

/**
 * Render per-recipient email drafts for a set of reviewer suggestions.
 *
 * @param {Object} args
 * @param {string[]} args.suggestionIds - GUIDs (already validated by the shell)
 * @param {{subject: string, body: string}} args.template
 * @param {Object} args.settings - { signature, reviewerFormLink, customFields, ... }
 * @param {string|null} args.actingUserSystemId - Dynamics systemuser of the staff actor
 * @returns {Promise<{ drafts: Array, stats: { total: number, ready: number, skipped: number } }>}
 * @throws {RenderEmailsError} httpStatus 404 when no suggestion rows resolve
 *
 * templateType is validated (and defaulted) in the shell. Invitation renders
 * refuse research-only address leads; post-engagement messages are unaffected.
 */
export async function renderEmails({
  suggestionIds,
  template,
  settings = {},
  templateType = 'invitation',
  actingUserSystemId,
}) {
  // Hydrate each suggestion: suggestion row + linked person + linked request.
  const rows = [];
  for (const suggestionId of suggestionIds) {
    const sug = await suggestionAdapter.findById(suggestionId);
    if (!sug) continue;
    const personId = sug._wmkf_potentialreviewer_value;
    const requestId = sug._wmkf_request_value;
    const [person, request] = await Promise.all([
      personId ? getReviewerByIdWithSelect(personId, {
        select: 'wmkf_name,wmkf_emailaddress,wmkf_organizationname,wmkf_primaryaffiliation,wmkf_emailsource,wmkf_identitystatus,wmkf_addresstruststatejson',
      }).catch(() => null) : null,
      requestId ? getRequestById(requestId, {
        select: 'akoya_requestid,akoya_requestnum,akoya_title,wmkf_abstract,wmkf_organizationname,_akoya_applicantid_value,_wmkf_projectleader_value,wmkf_meetingdate,wmkf_reviewduedate',
      }).catch(() => null) : null,
    ]);
    rows.push({ suggestionId, sug, person, request });
  }

  if (rows.length === 0) {
    throw new RenderEmailsError('No reviewers found for the provided IDs', 404);
  }

  // Co-PIs come from the wmkf_apprequestperson junction (role=Co-PI), the same
  // source the external-reviewer Proposal card uses. Fetch once per distinct
  // request (a batch usually shares one). Best-effort: a failed lookup yields no
  // co-PI line rather than blocking the render. Runs inside the route-established
  // trusted DAL context, which fetchCoPIs requires.
  const coPIsByRequest = new Map();
  const distinctRequestIds = [...new Set(rows.map((r) => r.request?.akoya_requestid).filter(Boolean))];
  await Promise.all(distinctRequestIds.map(async (rid) => {
    coPIsByRequest.set(rid, await fetchCoPIs(rid).catch(() => []));
  }));

  // Cycle-level config from Dataverse `wmkf_appgrantcycle` (W3 cutover).
  const distinctCycleCodes = [...new Set(
    rows.map((r) => r.request?.wmkf_meetingdate ? meetingDateToCycleCode(r.request.wmkf_meetingdate) : null).filter(Boolean)
  )];
  // Shared loader (stage 2b extraction); this caller's historical snake_case
  // projection is preserved exactly — see cycle-config-loader.js.
  const cycleByCode = await loadCycleConfigs(distinctCycleCodes, {
    fields: {
      name: 'name',
      program_name: 'programName',
      review_deadline: 'reviewDeadline',
      custom_fields: 'customFields',
    },
  });

  // Honorarium amount is a single Dataverse ground-truth (decided S199);
  // read once server-side and override any client/cycle value so the
  // {{customField:honorarium}} placeholder can't drift per-user. On a read
  // failure, leave the existing customFields value rather than fail the whole
  // render (email is lower-stakes than the money-stamping create path).
  let honorariumOverride = {};
  try {
    honorariumOverride = { honorarium: String(await getHonorariumAmount()) };
  } catch (e) {
    console.warn('[render-emails] honorarium amount read failed; using existing customField:', e.message);
  }

  // Mint external links only when the template body actually references
  // them — avoids churning the stored hash for templates (thankyou,
  // older customs) that don't use the placeholder. Each render produces
  // a fresh JWT and overwrites the prior hash, so any link previously
  // copied from the UI for the same recipient stops verifying. That's
  // intentional: the email body becomes the canonical link.
  const needsExternalLink = (template.body || '').includes(EXTERNAL_LINK_PLACEHOLDER) ||
    (template.subject || '').includes(EXTERNAL_LINK_PLACEHOLDER);
  const externalLinkBySuggestion = {};
  if (needsExternalLink) {
    for (const { suggestionId, sug, person, request } of rows) {
      const requestId = sug?._wmkf_request_value;
      if (!requestId) continue;
      // A pending exact-address contradiction blocks every new outbound
      // reviewer message and therefore must not mint/rotate a new token during
      // preview. Already-issued historical tokens are left untouched.
      if (emailConfidence(person).action === 'blocked') continue;
      // §3.D: expiry is per-recipient — an accepted reviewer gets the long review
      // window; an invitee/non-responder gets the early cap at review-due + grace.
      const expiresAt = computeReviewerTokenExpiry({
        accepted: sug?.wmkf_accepted === true,
        reviewDueDate: request?.wmkf_reviewduedate || null,
      });
      try {
        const { url } = await mintAndStore({ suggestionId, requestId, expiresAt, actingUserSystemId });
        externalLinkBySuggestion[suggestionId] = url;
      } catch (e) {
        console.error(`[render-emails] mint failed for ${suggestionId}: ${e.message}`);
        // Leave externalLink empty for this recipient; placeholder
        // substitution will yield "" rather than crash the render.
      }
    }
  }

  const drafts = rows.map(({ suggestionId, sug, person, request }) => {
    const requestNumber = request?.akoya_requestnum || null;
    const candidateName = ContactParser.normalizeDisplayName(person?.wmkf_name);
    const candidateEmail = person?.wmkf_emailaddress || null;
    const confidence = emailConfidence(person);
    // Per-proposal abstract-quality signal for the invite modal's "edit abstract"
    // gate. Carried on every draft (the modal is single-proposal, so they agree)
    // so the modal can flag the proposal and seed the editor with the reflowed
    // text without a second round-trip. `requestId` (the GUID) is what the edit
    // save writes back to — the draft otherwise only carries requestNumber.
    const rawAbstract = request?.wmkf_abstract || null;
    const reflowedAbstract = reflowAbstract(rawAbstract || '');
    const abstractFields = {
      requestId: request?.akoya_requestid || null,
      // Flag exactly when the reflow would change the stored text (see
      // abstractNeedsReflow): that makes the modal's "auto-cleaned for these
      // emails" claim true whenever the banner shows, lets a save of the reflowed
      // text clear the flag on re-render, and leaves a header-style intentional
      // break (which reflow does not touch) correctly UN-flagged.
      abstractFlagged: abstractNeedsReflow(rawAbstract),
      currentAbstract: rawAbstract,
      reflowedAbstract,
    };

    if (!candidateEmail) {
      return {
        suggestionId,
        candidateName,
        candidateEmail: null,
        requestNumber,
        subject: '',
        body: '',
        skipped: 'no_email',
        emailConfidence: confidence,
        ...abstractFields,
      };
    }

    if (confidence.action === 'blocked') {
      return {
        suggestionId,
        candidateName,
        candidateEmail,
        requestNumber,
        subject: '',
        body: '',
        skipped: 'address_conflict_pending',
        emailConfidence: confidence,
        remediation: confidence.remediation || [],
        ...abstractFields,
      };
    }

    if (templateType === 'invitation' && confidence.action === 'research_only') {
      return {
        suggestionId,
        candidateName,
        candidateEmail,
        requestNumber,
        subject: '',
        body: '',
        skipped: 'email_research_only',
        emailConfidence: confidence,
        // The normal invitation render already minted this token above using
        // computeReviewerTokenExpiry. Return it only as a manual staff fallback:
        // the UI may copy it, but the research-only row remains skipped and can
        // never enter send-emails through this draft.
        manualLink: externalLinkBySuggestion[suggestionId] || null,
        ...abstractFields,
      };
    }

    const candidate = {
      name: candidateName,
      affiliation: person?.wmkf_primaryaffiliation || person?.wmkf_organizationname || null,
      email: candidateEmail,
    };
    const coPINames = coPIsByRequest.get(request?.akoya_requestid) || [];
    const cycleCode = request?.wmkf_meetingdate
      ? meetingDateToCycleCode(request.wmkf_meetingdate)
      : null;
    const cycle = cycleByCode[cycleCode] || {};
    const proposal = {
      title: request?.akoya_title || null,
      abstract: request?.wmkf_abstract || null,
      // PI ONLY — do NOT fall back to the applicant account, which is an
      // ORGANIZATION and would wrongly be labeled the Principal Investigator
      // (Codex S274). A missing PI drops the line via the composed details block.
      // Honorifics are stripped: the PI/co-PI listing uses plain full names
      // (the reviewer's own greeting still keeps its honorific).
      authors: stripHonorific(request?._wmkf_projectleader_value_formatted) || null,
      institution: (request?.wmkf_organizationname || request?._akoya_applicantid_value_formatted || '').trim() || null,
      // Co-PI display names from the apprequestperson junction (names only),
      // joined into a grammatical serial list ("A", "A and B", "A, B, and C")
      // so the email reads correctly for any number of co-PIs.
      coInvestigators: formatNameList(coPINames.map(stripHonorific)) || null,
      coInvestigatorCount: coPINames.length,
    };
    const templateSettings = {
      signature: settings.signature || '',
      // Per-send override wins, then the request's campaign date, then the
      // cycle-level default. The request date is already loaded above for token
      // expiry and is the authoritative fallback when the Workbench composer
      // does not supply a client value.
      reviewDueDate: settings.reviewDueDate || request?.wmkf_reviewduedate || cycle.review_deadline || null,
      reviewerFormLink: settings.reviewerFormLink || '',
      externalLink: externalLinkBySuggestion[suggestionId] || '',
      grantCycle: {
        programName: cycle.program_name || '',
        reviewDeadline: cycle.review_deadline || null,
        customFields: { ...(cycle.custom_fields || {}), ...(settings.customFields || {}), ...honorariumOverride },
      },
    };

    const templateData = buildTemplateData(candidate, proposal, templateSettings);
    return {
      suggestionId,
      candidateName,
      candidateEmail,
      requestNumber,
      subject: replacePlaceholders(template.subject, templateData),
      body: replacePlaceholders(template.body, templateData),
      // Slice G — per-recipient email confidence (Opt-B: stamped server-side; the modal's
      // recipient DTO is too thin to compute it client-side). Drives the modal's
      // Quick-check warning + per-recipient acknowledgement; research-only rows
      // are returned as skipped and cannot be promoted by the client.
      // the modal then sends to `send-emails` (which re-derives and enforces it).
      emailConfidence: confidence,
      ...abstractFields,
    };
  });

  return {
    drafts,
    stats: {
      total: drafts.length,
      ready: drafts.filter((d) => !d.skipped).length,
      skipped: drafts.filter((d) => d.skipped).length,
    },
  };
}
