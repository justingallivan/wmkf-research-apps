/**
 * GET /api/external/review/[token]/context
 *
 * Public endpoint (allowlisted in middleware). Verifies the magic-link token
 * and returns everything the landing page needs to render. The page picks
 * which view to show (Stage 2a invitation vs Stage 2b materials vs
 * confirmation states) based on `engagementState`.
 *
 * Side effect: stamps `wmkf_proposalfirstaccessed` if not already set. The
 * stamp is best-effort — a failed PATCH does not fail the page load.
 *
 * Errors return shape `{ ok: false, reason }` with one of the verifier's
 * discriminated reasons. This lets the landing page show a specific error
 * state (expired vs. revoked vs. malformed) without 500-ing on bad input.
 */

import { verifySuggestionToken } from '../../../../../lib/external/verify-suggestion-token';
import { DynamicsService } from '../../../../../lib/services/dynamics-service';
import { GraphService } from '../../../../../lib/services/graph-service';
import { getRequestSharePointBuckets } from '../../../../../lib/utils/sharepoint-buckets';
import { bypassDynamicsRestrictions } from '../../../../../lib/services/dynamics-context';
import { reviewFormSchema } from '../../../../../lib/external/review-form-schema';
import { isReviewerMaterial } from '../../../../../lib/external/reviewer-materials';
import { getActivePolicies } from '../../../../../lib/external/policy-fetcher';
import { checkRateLimit, recordTokenOutcome } from '../../../../../lib/external/rate-limit';
import { normalizeCountryToIso2 } from '../../../../../shared/config/countries';

// Slots Stage 2a renders. Hardcoded per build plan §4a.
const STAGE_2A_POLICY_SLOTS = ['reviewer-coi', 'reviewer-ai-use'];

// wmkf_reviewstatus picklist values; reversibility lock kicks in at materials_sent.
const REVIEW_STATUS_ACCEPTED = 100000000;
const REVIEW_STATUS_MATERIALS_SENT = 100000001;

// wmkf_responsetype picklist values.
const RESPONSE_TYPE_ACCEPTED = 100000000;
const RESPONSE_TYPE_DECLINED = 100000001;
const RESPONSE_TYPE_NO_RESPONSE = 100000002;
const RESPONSE_TYPE_WITHDRAWN_SUFFICIENT = 100000003;

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ ok: false, reason: 'method_not_allowed' });
  }

  try {
    const token = req.query.token;
    const rl = await checkRateLimit(req, token);
    if (!rl.ok) {
      res.setHeader('Retry-After', String(rl.retryAfterSeconds));
      return res.status(429).json({ ok: false, reason: 'rate_limited' });
    }
    const verified = await verifySuggestionToken(token);
    await recordTokenOutcome(req, token, verified.ok);
    if (!verified.ok) {
      return res.status(verified.reason === 'not_found' ? 404 : 401).json({
        ok: false,
        reason: verified.reason,
      });
    }

    const { suggestion, request, reviewer } = verified;

    // Engagement state — drives which view the page renders.
    const engagementState = computeEngagementState(suggestion);

    // Optimistic-lock token returned to the client (round-tripped as If-Match
    // on /respond). Starts as the row's etag at verify time.
    let etag = suggestion._etag || null;

    // Best-effort first-access stamp. (Existing behavior preserved.)
    if (!suggestion.wmkf_proposalfirstaccessed) {
      try {
        await bypassDynamicsRestrictions('external-first-access', () =>
          DynamicsService.updateRecord(
            'wmkf_appreviewersuggestions',
            suggestion.wmkf_appreviewersuggestionid,
            { wmkf_proposalfirstaccessed: new Date().toISOString() },
          ),
        );
        // The stamp bumped the row's etag; the one we read pre-stamp is now
        // stale. Re-read it so the client's round-tripped If-Match matches
        // current state — otherwise EVERY first-visit accept/decline would
        // false-412. If the re-read fails, return null (disable the lock for
        // this one response) rather than hand back a known-stale etag.
        try {
          const fresh = await bypassDynamicsRestrictions('external-context-refetch-etag', () =>
            DynamicsService.getRecord(
              'wmkf_appreviewersuggestions',
              suggestion.wmkf_appreviewersuggestionid,
              { select: 'wmkf_appreviewersuggestionid' },
            ),
          );
          etag = fresh?._etag || null;
        } catch (e2) {
          console.error('[external context] etag re-read after first-access failed:', e2.message);
          etag = null;
        }
      } catch (e) {
        console.error('[external context] failed to stamp first-accessed:', e.message);
        // Stamp failed → the row was not changed → the pre-stamp etag is still
        // valid, so `etag` is left as-is.
      }
    }

    // Co-PIs: read from the wmkf_apprequestperson junction (role=Co-PI).
    // Per docs/INTAKE_PORTAL_SCHEMA_CHANGES.md, only the PI lookup keeps a
    // UNION with the projectleader field; the legacy `wmkf_copi1..5_value`
    // slots are obsolete read-only legacy. Junction is the sole source for
    // co-PIs. Only consumed by Stage2aView's proposal card, so gate the
    // fetch to views that render that card (matches `needStage2aData`
    // computed below). Non-fatal: a failed fetch returns an empty list.
    let coPIs = [];

    // For Stage 2b (materials view), continue listing files. For pre-materials
    // states, files are not surfaced — and we save the Graph round trip.
    let files = [];
    if (engagementState.view === 'stage2b' || engagementState.view === 'submitted') {
      try {
        files = await bypassDynamicsRestrictions('external-list-files', () =>
          listProposalFiles(request.akoya_requestid, request.akoya_requestnum),
        );
      } catch (e) {
        console.error('[external context] file listing failed:', e.message);
        // Non-fatal — page still renders, file list shows the error.
      }
    }

    // Stage 2a data (policies + prefill) is needed whenever the reviewer
    // could re-render Stage2aView. That includes the initial stage2a view
    // AND the declined view when canFlipState is still true (re-accept path
    // — dispatcher pushes a 'stage2a' override that renders Stage2aView with
    // the cached /context payload). Without this, the re-accept page loses
    // its prefilled contact fields.
    let policies = null;
    let contactPrefill = null;
    const needStage2aData =
      engagementState.view === 'stage2a'
      || (engagementState.view === 'declined' && engagementState.canFlipState);
    if (needStage2aData) {
      try {
        coPIs = await bypassDynamicsRestrictions('external-context-copis', () =>
          fetchCoPIs(request.akoya_requestid),
        );
      } catch (e) {
        console.error('[external context] co-PI fetch failed:', e.message);
      }

      try {
        policies = await getActivePolicies(STAGE_2A_POLICY_SLOTS);
      } catch (e) {
        console.error('[external context] policy fetch failed:', e.message);
        return res.status(500).json({ ok: false, reason: 'policy_misconfigured' });
      }

      // Conditional contact lookup: only if the reviewer has been promoted
      // to a contact (rare today). Used as the lowest-priority prefill source.
      const contactId = reviewer?._wmkf_contact_value;
      if (contactId) {
        try {
          contactPrefill = await bypassDynamicsRestrictions('external-context-contact', () =>
            DynamicsService.getRecord('contacts', contactId, {
              select: [
                'firstname', 'lastname', 'nickname', 'jobtitle', 'emailaddress1',
                'wmkf_orcid', 'adx_organizationname', '_parentcustomerid_value',
                // Payment mailing address — prefills the Stage 2a address card
                // (chunk 5). Only populated when the reviewer is already a
                // promoted contact; new reviewers type it fresh.
                'address1_line1', 'address1_line2', 'address1_city',
                'address1_stateorprovince', 'address1_postalcode', 'address1_country',
              ].join(','),
            }),
          );
        } catch (e) {
          console.error('[external context] contact lookup failed:', e.message);
          // Non-fatal; prefill falls through without contact data.
        }
      }
    }

    return res.status(200).json({
      ok: true,
      engagementState,
      // Optimistic-concurrency token: the suggestion row's _etag at page-load
      // time (processAnnotations renames @odata.etag → _etag). The client
      // round-trips this as an If-Match header on /respond so a concurrent
      // staff edit (e.g. materials-sent) is caught with a 412 instead of being
      // silently clobbered. Null-safe: a missing etag just disables the check.
      // Reflects the post-first-access-stamp row (re-read above) so first
      // visits don't false-412.
      etag,
      proposal: {
        title: request.akoya_title || 'Untitled proposal',
        requestNumber: request.akoya_requestnum,
        meetingDate: request.wmkf_meetingdate || null,
        abstract: request.wmkf_abstract || null,
        applicantInstitution: request['_akoya_applicantid_value@OData.Community.Display.V1.FormattedValue']
          || request._akoya_applicantid_value_formatted
          || null,
        projectLeader: request['_wmkf_projectleader_value@OData.Community.Display.V1.FormattedValue']
          || request._wmkf_projectleader_value_formatted
          || null,
        coPIs,
      },
      reviewer: {
        name: reviewer?.wmkf_name || null,
        email: reviewer?.wmkf_emailaddress || null,
        organization: reviewer?.wmkf_primaryaffiliation || reviewer?.wmkf_organizationname || null,
      },
      // Soft deadline shown on the page. Token expiry is review due + 4 weeks
      // grace, so this is the wall-clock cutoff for self-serve submission.
      tokenExpiresAt: suggestion.wmkf_externaltokenexpires || null,
      submission: {
        receivedAt: suggestion.wmkf_reviewreceivedat || null,
        filename: suggestion.wmkf_reviewfilename || null,
      },
      // Strictly additive: existing review-form fields (affiliation/impact/
      // risk/overallRating) always present so the materials-view page code
      // doesn't break. Stage-2a-specific fields (firstName, etc.) are added
      // when the engagement is in pre-materials state.
      prefill: {
        affiliation:
          suggestion.wmkf_revieweraffiliation || reviewer?.wmkf_primaryaffiliation || reviewer?.wmkf_organizationname || '',
        impact: suggestion.wmkf_reviewerimpact ?? null,
        risk: suggestion.wmkf_reviewerrisk ?? null,
        overallRating: suggestion.wmkf_revieweroverallrating ?? null,
        ...(needStage2aData
          ? buildStage2aPrefill(suggestion, reviewer, contactPrefill)
          : {}),
      },
      // Stage 2a-only: active policy text payloads.
      policies: policies ? Object.fromEntries(
        Object.entries(policies).map(([k, p]) => [k, {
          slotCode: p.slotCode,
          activeVersionId: p.activeVersionId,
          versionLabel: p.versionLabel,
          title: p.title,
          body: p.body,
        }])
      ) : null,
      files,
      formSchema: reviewFormSchema,
    });
  } catch (e) {
    console.error('[external context] unexpected error:', e);
    return res.status(500).json({ ok: false, reason: 'server_error' });
  }
}

/**
 * Compute the high-level engagement state from suggestion fields. Drives
 * page-level view dispatch and the reversibility lock.
 *
 * `view`:
 *   stage2a   — pre-materials, reviewer can still accept/decline/flip
 *   accepted-pre-materials — accepted but materials not yet sent (post-accept screen)
 *   declined  — reviewer declined (post-decline screen)
 *   stage2b   — materials sent; existing review-form view
 *   submitted — review received; post-submission view
 *   withdrawn-sufficient — terminal, "no longer needed" copy
 *
 * `canFlipState`: true if Stage 2a's accept/decline buttons should still
 * permit transitions. Locks once review status reaches materials_sent.
 */
function computeEngagementState(s) {
  const responseType = s.wmkf_responsetype ?? null;
  const reviewStatus = s.wmkf_reviewstatus ?? null;
  const submitted = !!s.wmkf_reviewreceivedat;
  const accepted = s.wmkf_accepted === true;
  const declined = s.wmkf_declined === true;

  // The lock: once staff have released materials, reviewer self-service flip ends.
  const canFlipState = (reviewStatus === null || reviewStatus < REVIEW_STATUS_MATERIALS_SENT)
    && responseType !== RESPONSE_TYPE_WITHDRAWN_SUFFICIENT;

  let view;
  if (responseType === RESPONSE_TYPE_WITHDRAWN_SUFFICIENT) {
    view = 'withdrawn-sufficient';
  } else if (submitted) {
    view = 'submitted';
  } else if (reviewStatus !== null && reviewStatus >= REVIEW_STATUS_MATERIALS_SENT) {
    view = 'stage2b';
  } else if (accepted) {
    view = 'accepted-pre-materials';
  } else if (declined) {
    view = 'declined';
  } else {
    view = 'stage2a';
  }

  return {
    view,
    canFlipState,
    accepted,
    declined,
    responseType,
    responseReceivedAt: s.wmkf_responsereceivedat || null,
    reviewStatus,
  };
}

/**
 * Build the co-PI display list from the wmkf_apprequestperson junction.
 * Returns an array of display name strings ordered by `wmkf_authorposition`
 * then by createdon.
 *
 * Source: junction only. Per docs/INTAKE_PORTAL_SCHEMA_CHANGES.md, the
 * legacy `wmkf_copi1..5_value` slot fields are obsolete read-only legacy
 * post-S139 backfill — new code reads junction exclusively. The UNION
 * strategy in the schema doc applies only to the PI lookup, not co-PIs.
 */
async function fetchCoPIs(requestId) {
  if (!requestId) return [];
  const { records } = await DynamicsService.queryRecords('wmkf_apprequestpersons', {
    select: '_wmkf_contact_value,wmkf_authorposition',
    expand: 'wmkf_Contact($select=fullname,firstname,lastname)',
    filter: `_wmkf_request_value eq ${requestId} and wmkf_role eq 100000001`,
    orderby: 'wmkf_authorposition asc,createdon asc',
    top: 50, // defensive cap; expected cardinality is 0-5 per request
  });

  const byContactId = new Map();
  for (const row of records) {
    const cid = row._wmkf_contact_value;
    if (!cid || byContactId.has(cid)) continue;
    const c = row.wmkf_Contact;
    const name = c?.fullname
      || [c?.firstname, c?.lastname].filter(Boolean).join(' ').trim();
    if (!name) continue;
    byContactId.set(cid, name);
  }
  return Array.from(byContactId.values());
}

/**
 * Stage 2a contact-form prefill. Priority per build plan §3:
 *   1. Suggestion engagement-row value (most recent input)
 *   2. PotentialReviewer snapshot (directory entry)
 *   3. Contact authoritative field (when promoted)
 *   4. For affiliation only: parent-customer account name as a fallback hint
 *   5. Empty
 *
 * Returns the prefill values the form's text inputs render with. The
 * `affiliationHint` field is set when we fall back to parentcustomerid so
 * the UI can show "From your prior role as PI on a {hint} grant".
 */
function buildStage2aPrefill(suggestion, reviewer, contact) {
  const firstNonEmpty = (...vals) => {
    for (const v of vals) {
      if (v !== null && v !== undefined && String(v).trim() !== '') return v;
    }
    return '';
  };

  let affiliation = firstNonEmpty(
    suggestion.wmkf_revieweraffiliation,
    reviewer?.wmkf_primaryaffiliation,
    reviewer?.wmkf_organizationname,
    contact?.adx_organizationname,
  );
  let affiliationHint = null;
  if (!affiliation && contact?.['_parentcustomerid_value@OData.Community.Display.V1.FormattedValue']) {
    affiliationHint = contact['_parentcustomerid_value@OData.Community.Display.V1.FormattedValue'];
  }

  return {
    firstName: firstNonEmpty(suggestion.wmkf_reviewerfirstname, reviewer?.wmkf_firstname, contact?.firstname),
    lastName: firstNonEmpty(suggestion.wmkf_reviewerlastname, reviewer?.wmkf_lastname, contact?.lastname),
    nickname: firstNonEmpty(suggestion.wmkf_reviewernickname, contact?.nickname),
    title: firstNonEmpty(suggestion.wmkf_reviewertitle, reviewer?.wmkf_title, contact?.jobtitle),
    affiliation,
    affiliationHint,
    email: firstNonEmpty(suggestion.wmkf_revieweremail, reviewer?.wmkf_emailaddress, contact?.emailaddress1),
    orcid: firstNonEmpty(suggestion.wmkf_reviewerorcid, contact?.wmkf_orcid),
    honorariumOptOut: suggestion.wmkf_honorariumoptout === true,
    // Payment-address prefill (chunk 5). Sourced from the promoted contact only
    // (no address fields exist on the potentialreviewer snapshot), so this is
    // empty for not-yet-promoted reviewers. `country` is coerced to ISO-2: the
    // stored value is historically a full name ("United States"), but the form
    // picker and the downstream BILL contract are strict ISO-2.
    address: {
      line1: contact?.address1_line1 || '',
      line2: contact?.address1_line2 || '',
      city: contact?.address1_city || '',
      state: contact?.address1_stateorprovince || '',
      postalCode: contact?.address1_postalcode || '',
      country: normalizeCountryToIso2(contact?.address1_country),
    },
  };
}

/**
 * Walk every plausible SharePoint bucket for a request and return only
 * files staff has explicitly shared by placing them in a reviewer-
 * materials subfolder (see `lib/external/reviewer-materials.js` for the
 * folder-name policy). If no matching folder exists or it's empty,
 * returns an empty array — the UI surfaces that as "not yet shared,"
 * not "no files exist."
 *
 * Each file carries its `library` so the proposal-download endpoint can
 * resolve back to the right Graph drive without trusting client input.
 */
async function listProposalFiles(requestId, requestNumber) {
  const buckets = await getRequestSharePointBuckets(requestId, requestNumber);
  const out = [];
  for (const bucket of buckets) {
    try {
      const items = await GraphService.listFiles(bucket.library, bucket.folder, {
        recursive: true,
        maxDepth: 3,
      });
      for (const f of items) {
        if (!isReviewerMaterial(f.folder || '')) continue;
        out.push({
          id: f.id,
          name: f.name,
          size: f.size,
          mimeType: f.mimeType,
          folder: f.folder,
          library: bucket.library,
          source: bucket.source,
        });
      }
    } catch (e) {
      // Archive libraries 404 frequently — that's expected. Log but continue.
      if (process.env.NODE_ENV === 'development') {
        console.log(`[external context] bucket ${bucket.library}/${bucket.folder} unavailable: ${e.message}`);
      }
    }
  }
  return out;
}
