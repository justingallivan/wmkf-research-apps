/**
 * ContactLeads — Slice 3 display of the quarantined `contactEnrichment.contactLeads`
 * (docs/REVIEWER_CONTACT_LEADS_SPEC.md §6 Slice 3). READ-ONLY: it shows contacts
 * the enrichment tiers fetched-but-discarded (verified-domain / name / anchor
 * rejects) and pages found without an email, so staff can find a reviewer the
 * safety gates withheld. It NEVER offers these as a one-click sendable contact —
 * the "Use this email" promotion is Slice 4. High/medium leads show prominently;
 * low/rejected leads collapse behind a toggle, each with the reason it was not
 * auto-used (spec §4). Pure presentational; no network, no mutation.
 */

import { useState } from 'react';

const SOURCE_LABELS = {
  claude_search: 'Claude web search',
  serp_search: 'Google search',
  institution_page: 'Institution page',
  orcid: 'ORCID',
  pubmed: 'PubMed',
  manual_probe: 'manual probe',
};

export function leadSourceLabel(source) {
  return SOURCE_LABELS[source] || 'web search';
}

const REJECT_REASON_TEXT = {
  verified_domain_contradiction:
    'Found, but the email’s domain didn’t match this person’s verified institution — likely a different person. Verify before use.',
  name_mismatch:
    'Found, but the address doesn’t match this name — possible wrong person. Verify before use.',
  identity_anchor_contradiction:
    'Found, but it contradicts the confirmed identity — likely a same-named different person.',
};

export function leadWarningText(lead) {
  if (!lead) return '';
  if (lead.confidence === 'rejected') {
    return REJECT_REASON_TEXT[lead.rejectedReason] || 'Found but not auto-usable — verify before use.';
  }
  return 'Unverified lead — open the source and verify before use.';
}

const TYPE_ICON = { email: '📧', website: '🔗', faculty_page: '🏛', profile: '👤' };
const PAGE_LABEL = { faculty_page: 'Faculty page', profile: 'Profile', website: 'Website' };
const CONFIDENCE_RANK = { high: 0, medium: 1, low: 2, rejected: 3 };

/**
 * Leads worth showing: de-duplicate by (type, value), and drop a lead only when
 * its value is ALREADY displayed as the card's primary contact of the same kind:
 *   - an EMAIL lead equal to the shown email chip (e.g. the one just promoted via
 *     "Use this email" — it's now the contact above, regardless of its stored
 *     confidence), or
 *   - a NON-rejected website/page lead equal to the shown website chip.
 * A `rejected` website/page lead that merely shares a URL with the chip still
 * surfaces — its rejection context isn't conveyed by the chip (Codex Slice-3 MED).
 * Everything else (other-value leads, the website/page leads that remain after an
 * email is promoted) stays visible so staff can keep fixing the other fields.
 */
export function visibleLeads(leads, hideValues = []) {
  const hidden = new Set((Array.isArray(hideValues) ? hideValues : []).filter(Boolean));
  const seen = new Set();
  const out = [];
  for (const l of Array.isArray(leads) ? leads : []) {
    if (!l || !l.value) continue;
    const isPage = l.type === 'website' || l.type === 'faculty_page' || l.type === 'profile';
    const redundantWithChip = hidden.has(l.value)
      && (l.type === 'email' || (isPage && l.confidence !== 'rejected'));
    if (redundantWithChip) continue;
    const key = `${l.type}:${l.value}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(l);
  }
  return out;
}

/** Split into prominent (high/medium) vs collapsed (low/rejected), best first. */
export function partitionLeads(leads) {
  const sorted = [...(Array.isArray(leads) ? leads : [])].sort(
    (a, b) => (CONFIDENCE_RANK[a.confidence] ?? 9) - (CONFIDENCE_RANK[b.confidence] ?? 9),
  );
  return {
    primary: sorted.filter((l) => l.confidence === 'high' || l.confidence === 'medium'),
    weak: sorted.filter((l) => l.confidence === 'low' || l.confidence === 'rejected'),
  };
}

function LeadRow({ lead, onUse }) {
  const isEmail = lead.type === 'email';
  const rejected = lead.confidence === 'rejected';
  return (
    <li className={`text-xs ${rejected ? 'text-gray-500' : 'text-gray-700'}`}>
      <span className="mr-1" aria-hidden="true">{TYPE_ICON[lead.type] || '🔗'}</span>
      {isEmail ? (
        <span className="font-mono break-all">{lead.value}</span>
      ) : (
        <a href={lead.value} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:text-blue-800 underline break-all">
          {PAGE_LABEL[lead.type] || 'Link'}
        </a>
      )}
      <span className="ml-1 text-gray-400">· {leadSourceLabel(lead.source)}</span>
      {lead.sourceUrl && lead.sourceUrl !== lead.value && (
        <a href={lead.sourceUrl} target="_blank" rel="noopener noreferrer" className="ml-1 text-blue-600 hover:text-blue-800 underline">
          Open source →
        </a>
      )}
      {/* Slice 4: manage-only promotion. Sets the value as a MANUAL contact —
          stamped manual provenance, so the invite flow still treats it as
          low-confidence and requires explicit confirm-before-send. */}
      {onUse && (
        <button
          type="button"
          onClick={() => onUse(lead)}
          className="ml-2 text-blue-700 hover:text-blue-900 underline"
          title="Set this as the reviewer's contact (manual — you'll confirm before any invite is sent)"
        >
          {isEmail ? 'Use this email' : 'Use this page'}
        </button>
      )}
      <span className="block text-[11px] text-amber-700 mt-0.5">{leadWarningText(lead)}</span>
    </li>
  );
}

export default function ContactLeads({ leads, hideValues = [], onUse }) {
  const [showWeak, setShowWeak] = useState(false);
  const visible = visibleLeads(leads, hideValues);
  if (!visible.length) return null;
  const { primary, weak } = partitionLeads(visible);

  return (
    <div className="mt-2 p-2 bg-gray-50 border border-gray-200 rounded">
      <p className="text-xs font-medium text-gray-700">Possible contact leads — not verified, review before use</p>
      {primary.length > 0 && (
        <ul className="mt-1 space-y-1">
          {primary.map((l) => <LeadRow key={`${l.type}:${l.value}`} lead={l} onUse={onUse} />)}
        </ul>
      )}
      {weak.length > 0 && (
        <>
          <button
            type="button"
            onClick={() => setShowWeak((v) => !v)}
            className="mt-1 text-xs text-blue-600 hover:text-blue-800"
            aria-expanded={showWeak}
          >
            {showWeak ? 'Hide weak / rejected leads' : `Show ${weak.length} weak / rejected lead${weak.length === 1 ? '' : 's'}`}
          </button>
          {showWeak && (
            <ul className="mt-1 space-y-1">
              {weak.map((l) => <LeadRow key={`${l.type}:${l.value}`} lead={l} onUse={onUse} />)}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
