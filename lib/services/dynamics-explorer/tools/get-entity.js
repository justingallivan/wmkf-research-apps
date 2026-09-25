/**
 * get_entity tool: resolve a Dynamics entity by GUID or human-readable
 * identifier (name/number), with OData search enrichment for accounts.
 *
 * Extracted verbatim from pages/api/dynamics-explorer/chat.js:1159-1362
 * (pre-S2 line numbers); characterization tests are the safety net.
 *
 * The hand-rolled `'` escape below is exempt from the odata-escape gate at
 * this exact path (scripts/check-odata-escape.js EXEMPT_FILES) — owner
 * choice (a) in the S5 extraction plan; do not move or rewrite the escape.
 */

import { DynamicsService } from '../../dynamics-service';
import { stripEmpty } from '../result-shaping';
import {
  projectTestRequestVisibilityRecord,
  withTestRequestIsolationSelect,
} from '../../test-requests/isolation.js';

// ─── get_entity ───

/**
 * Entity type configurations for get_entity lookups.
 * Each type defines its entity set, primary key, curated $select, and
 * the field + strategy used for name/number lookups.
 */
export const ENTITY_TYPE_CONFIGS = {
  request: {
    entitySet: 'akoya_requests',
    idField: 'akoya_requestid',
    select: 'akoya_requestnum,akoya_requeststatus,akoya_submitdate,akoya_fiscalyear,akoya_paid,wmkf_request_type,wmkf_meetingdate,wmkf_numberofyearsoffunding,wmkf_abstract,wmkf_researchconceptstatus,wmkf_mrconcept1title,wmkf_mrconcept2title,wmkf_mrconcept3title,wmkf_mrconcept4title,wmkf_seconcept1title,wmkf_seconcept2title,wmkf_seconcept3title,wmkf_seconcept4title,wmkf_numberofconcepts,wmkf_numberofpayments,wmkf_excludedreviewers,_akoya_applicantid_value,_akoya_primarycontactid_value,_wmkf_programdirector_value,_wmkf_programcoordinator_value,_wmkf_grantprogram_value,_akoya_programid_value,_wmkf_type_value,_wmkf_projectleader_value,_wmkf_researchleader_value,_wmkf_ceo_value,akoya_request,akoya_expenses,akoya_grant,akoya_balance,akoya_originalgrantamount,akoya_loireceived,akoya_decisiondate,akoya_begindate,akoya_enddate,wmkf_phaseistatus,wmkf_phaseiistatus,_wmkf_potentialreviewer1_value,_wmkf_potentialreviewer2_value,_wmkf_potentialreviewer3_value,_wmkf_potentialreviewer4_value,_wmkf_potentialreviewer5_value,statecode,createdon',
    filterField: 'akoya_requestnum',
    filterExact: true, // eq instead of contains
    nameField: 'akoya_requestnum',
  },
  account: {
    entitySet: 'accounts',
    idField: 'accountid',
    select: 'name,akoya_aka,wmkf_legalname,wmkf_dc_aka,akoya_constituentnum,akoya_totalgrants,akoya_countofawards,akoya_countofrequests,wmkf_countofprogramgrants,wmkf_countofconcepts,wmkf_countofdiscretionarygrant,wmkf_sumofprogramgrants,wmkf_sumofdiscretionarygrants,wmkf_eastwest,address1_city,address1_stateorprovince,websiteurl,telephone1,akoya_institutiontype,accountid,createdon',
    filterField: 'name',
    altFilterFields: ['akoya_aka', 'wmkf_dc_aka'], // common name + abbreviation — searched alongside primary name
    filterExact: false, // contains
    nameField: 'name',
    altNameFields: ['akoya_aka', 'wmkf_dc_aka'],
  },
  contact: {
    entitySet: 'contacts',
    idField: 'contactid',
    select: 'fullname,firstname,lastname,emailaddress1,jobtitle,telephone1,akoya_contactnum,statecode,contactid,createdon',
    filterField: 'fullname',
    filterExact: false,
    nameField: 'fullname',
  },
  reviewer: {
    entitySet: 'wmkf_potentialreviewerses',
    idField: 'wmkf_potentialreviewersid',
    select: 'wmkf_name,wmkf_firstname,wmkf_lastname,wmkf_title,wmkf_emailaddress,wmkf_organizationname,wmkf_primaryaffiliation,wmkf_areaofexpertise,wmkf_potentialreviewersid',
    filterField: 'wmkf_name',
    filterExact: false,
    nameField: 'wmkf_name',
  },
  email: {
    entitySet: 'emails',
    idField: 'activityid',
    select: 'subject,description,sender,torecipients,createdon,directioncode,activityid,_regardingobjectid_value,statecode',
    filterField: null, // GUID-only
    nameField: 'subject',
  },
  payment: {
    entitySet: 'akoya_requestpayments',
    idField: 'akoya_requestpaymentid',
    select: 'akoya_paymentnum,akoya_type,akoya_amount,akoya_netamount,akoya_paymentdate,akoya_postingdate,akoya_requirementdue,akoya_requirementtype,akoya_folio,wmkf_reporttype,_akoya_requestlookup_value,_akoya_requestapplicant_value,statecode,createdon',
    filterField: 'akoya_paymentnum',
    filterExact: true,
    nameField: 'akoya_paymentnum',
  },
  staff: {
    entitySet: 'systemusers',
    idField: 'systemuserid',
    select: 'fullname,firstname,lastname,internalemailaddress,systemuserid,isdisabled',
    filterField: 'fullname',
    filterExact: false,
    nameField: 'fullname',
  },
};

const GUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Find a specific entity by human-readable identifier or GUID.
 * Returns full details with resolved lookup display names.
 */
export async function getEntity({ type, identifier }) {
  const cfg = ENTITY_TYPE_CONFIGS[type];
  if (!cfg) {
    return { error: `Unknown entity type: "${type}". Valid types: ${Object.keys(ENTITY_TYPE_CONFIGS).join(', ')}` };
  }

  const isGuid = GUID_PATTERN.test(identifier);
  const select = type === 'request' ? withTestRequestIsolationSelect(cfg.select) : cfg.select;

  // GUID lookup — direct fetch
  if (isGuid) {
    const record = await DynamicsService.getRecord(cfg.entitySet, identifier, {
      select,
    });
    const stripped = stripEmpty(record);
    return type === 'request' ? projectTestRequestVisibilityRecord(stripped) : stripped;
  }

  // Name/number lookup
  if (!cfg.filterField) {
    return { error: `${type} requires a GUID identifier. Use search to find ${type} records first.` };
  }

  const escaped = identifier.replace(/'/g, "''");
  let filter;
  if (cfg.filterExact) {
    filter = `${cfg.filterField} eq '${escaped}'`;
  } else if (cfg.altFilterFields) {
    // Search primary name + all alternate name fields (common name, abbreviation, etc.)
    const clauses = [cfg.filterField, ...cfg.altFilterFields].map(f => `contains(${f},'${escaped}')`);
    filter = `(${clauses.join(' or ')})`;
  } else {
    filter = `contains(${cfg.filterField},'${escaped}')`;
  }

  // For accounts, run Dataverse Search in parallel with OData to catch
  // abbreviation/synonym matches that contains() can't find (e.g. "USC" → "University of Southern California")
  const odataPromise = DynamicsService.queryRecords(cfg.entitySet, {
    select,
    filter,
    top: 10,
  });
  const searchPromise = type === 'account'
    ? DynamicsService.searchRecords(identifier, { entities: ['account'], top: 3 }).catch(() => null)
    : Promise.resolve(null);

  const [result, searchResult] = await Promise.all([odataPromise, searchPromise]);

  // Enrich OData results with high-scoring search results not already found
  if (searchResult?.results?.length) {
    const existingIds = new Set(result.records.map(r => r[cfg.idField]));
    for (const sr of searchResult.results) {
      if (!existingIds.has(sr.objectId) && sr.score > 5) {
        try {
          const fullRecord = await DynamicsService.getRecord(cfg.entitySet, sr.objectId, { select });
          result.records.push(fullRecord);
        } catch (e) { /* search enrichment is best-effort */ }
      }
    }
  }

  if (!result.records.length) {
    // A real zero-result answer, not a tool failure — see deriveRecordCount.
    return { error: `No ${type} found matching "${identifier}"`, _notFound: true };
  }

  // Prefer exact match — check both primary and alternate name fields
  let match;
  if (!cfg.filterExact && result.records.length > 1) {
    const lowerIdent = identifier.toLowerCase();
    const exactMatches = result.records.filter(r => {
      const primary = r[cfg.nameField];
      if (primary && primary.toLowerCase() === lowerIdent) return true;
      if (cfg.altNameFields) {
        for (const altField of cfg.altNameFields) {
          const alt = r[altField];
          if (alt && alt.toLowerCase() === lowerIdent) return true;
        }
      }
      return false;
    });
    // If multiple exact matches, prefer the one with the most requests (most active)
    let exact;
    if (exactMatches.length > 1) {
      exact = exactMatches.sort((a, b) =>
        (b.akoya_countofrequests || b.akoya_countofawards || 0) - (a.akoya_countofrequests || a.akoya_countofawards || 0)
      )[0];
    } else {
      exact = exactMatches[0];
    }

    // If exact match exists but a more-active account also matched (e.g. "USC" matches
    // South Carolina via dc_aka but Southern California has 6x more requests), present
    // all candidates so the model can disambiguate based on conversation context.
    if (exact) {
      const mostActive = [...result.records].sort((a, b) =>
        (b.akoya_countofrequests || 0) - (a.akoya_countofrequests || 0)
      )[0];
      if (mostActive[cfg.idField] !== exact[cfg.idField]) {
        match = mostActive;
        const names = result.records.map(r => {
          const n = r[cfg.nameField] || '';
          const akas = (cfg.altNameFields || []).map(f => r[f]).filter(Boolean);
          const akaStr = akas.length ? ` (aka ${akas.join(', ')})` : '';
          const count = r.akoya_countofrequests || 0;
          return `${n}${akaStr} [${count} requests]`;
        }).filter(Boolean);
        const cleaned = stripEmpty(match);
        cleaned._note = `Ambiguous: "${identifier}" matched multiple accounts. Returning most active. All candidates: ${names.join('; ')}. If the user meant a different one, ask them to clarify.`;
        return cleaned;
      }
    }

    match = exact || result.records[0];

    if (!exact) {
      const names = result.records.map(r => {
        const n = r[cfg.nameField] || '';
        const akas = (cfg.altNameFields || [])
          .map(f => r[f]).filter(Boolean);
        const akaStr = akas.length ? ` (aka ${akas.join(', ')})` : '';
        return n + akaStr;
      }).filter(Boolean);
      const cleaned = stripEmpty(match);
      cleaned._note = `Multiple matches (${result.records.length}). Showing first. All matches: ${names.join('; ')}`;
      return cleaned;
    }
  } else {
    match = result.records[0];
  }

  const stripped = stripEmpty(match);
  return type === 'request' ? projectTestRequestVisibilityRecord(stripped) : stripped;
}
