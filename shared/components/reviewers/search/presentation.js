/**
 * Ownership: canonical helper module: owns reviewer-search presentation helpers; controller and operation/view modules consume them.
 */
import { leadSourceLabel } from '../ContactLeads';

export function addressTrustFailureMessage(data, fallback) {
  const base = data?.message || data?.error || fallback;
  const actions = Array.isArray(data?.remediation) ? data.remediation : [];
  const repair = actions.find((item) => item?.action === 'create_repair_request');
  const action = repair || actions[0];
  if (!action?.label
    || base.toLowerCase().includes(action.label.toLowerCase())
    || (action.action === 'create_repair_request' && /repair request/i.test(base))) return base;
  return `${base} If the problem persists, use “${action.label}” on this reviewer card.`;
}
export function formatSaveFailureDetails(errors = []) {
  const first = Array.isArray(errors) ? errors.find((e) => e?.error || e?.name) : null;
  if (!first) return '';
  const name = first.name || 'Unknown candidate';
  const error = first.error || 'Save failed';
  return `${name}: ${error}`;
}

// State exactly what each affiliation source can support. PubMed is historical
// publication evidence; OpenAlex exposes a last-known institution, not a current
// employment guarantee. Only ORCID-current / staff-confirmed evidence says current.
export function affiliationEvidenceLabel(source) {
  if (source === 'pubmed_recency') return 'publication affiliation';
  if (source === 'orcid_current') return 'current (per ORCID)';
  if (source === 'openalex_current') return 'last known (per OpenAlex)';
  if (source === 'scholar_current') return 'reported by Scholar'; // legacy roster rows
  if (source === 'staff_manual' || source === 'staff_confirmed') return 'staff confirmed';
  return null;
}
export function affiliationSourceLabel(source) {
  return affiliationEvidenceLabel(source) || 'unspecified source';
}

export function dataverseInstitutionSourceLabel(source) {
  if (source === 'staff_confirmed') return 'staff confirmed';
  if (source === 'primary_affiliation') return 'primary affiliation';
  if (source === 'organization') return 'organization';
  return null;
}

export function emailOwnershipLabel(evidence) {
  const labels = {
    full_name: 'full-name mailbox match',
    initials_surname: 'initials + surname mailbox match',
    surname_initials: 'surname + initials mailbox match',
    exact_surname: 'exact-surname mailbox match',
    url_slug: 'mailbox matches the profile URL',
    name_adjacent: 'name and address listed together',
  };
  return labels[evidence?.matchClass] || null;
}

export function emailSourceDisplayLabel(source) {
  const labels = {
    staff_verified: 'staff verification',
    manual: 'staff entry',
    institution_page: 'institutional page',
    orcid: 'ORCID',
    pubmed: 'PubMed',
    scholarly_multi: 'multiple recent papers',
    scholarly_single: 'one recent paper',
    affiliation: 'publication affiliation',
    search_contested: 'contested web-search results',
  };
  return labels[source] || leadSourceLabel(source);
}
