/**
 * Canonical Dataverse entity-set names + per-entity default SELECT constants.
 *
 * Motivating incident: the S328 entity-name-guessing 404s (`wmkf_prompts`,
 * `wmkf_aiprompts` — neither exists; the real set is `wmkf_ai_prompts`). This
 * registry makes a guessed set name a THROW, not a runtime 404: `entitySet()`
 * only returns names that appear in the Stage-0 access census.
 *
 * The KNOWN set is seeded from the Stage-0 census
 * (`node scripts/check-dataverse-access-layer.js --report`, Appendix A of
 * docs/DATA_ACCESS_LAYER_MIGRATION_PLAN.md) — every real entity bucket it found.
 * The pseudo-buckets it emits for unattributable calls (`non-entity-transport`,
 * `unresolved`, `changeset-unresolved`) are NOT entity sets and are excluded.
 *
 * SELECT constants: the canonical primary $select each existing adapter shares
 * across its read methods, moved here (with their in-place documentation) so
 * per-route SELECT drift has one home. Specialized projections (merge predicate
 * selects, the researcher bibliometric select) stay local to their adapters —
 * they are deliberately narrower/wider than the primary select.
 */

// Canonical entity-set names in live use (Stage-0 census buckets). A name absent
// here is either a typo or a not-yet-migrated entity: add it deliberately after
// confirming the real set name in Dataverse metadata — never guess.
const KNOWN_ENTITY_SETS = new Set([
  'akoya_requests',
  'wmkf_appreviewersuggestions',
  'wmkf_ai_prompts',
  'contacts',
  'wmkf_appreviewanswers',
  'systemusers',
  'wmkf_potentialreviewerses',
  'wmkf_policies',
  'sharepointdocumentlocations',
  'wmkf_policyversions',
  'wmkf_apprequestpersons',
  'wmkf_granteedeliverables',
  'wmkf_requestdocuments',
  'accounts',
  'wmkf_ai_runs',
  'wmkf_appuserpreferences',
  'wmkf_appgrantcycles',
  'wmkf_portalmemberships',
  'wmkf_proposalbudgetlines',
  'wmkf_reviewquestions',
]);

/**
 * Validate and return a canonical entity-set name. Throws on any name not in the
 * census — the anti-guessing guarantee. Returns the same string on success so it
 * reads naturally at the top of an adapter: `const ENTITY_SET = entitySet('contacts')`.
 */
export function entitySet(name) {
  if (!KNOWN_ENTITY_SETS.has(name)) {
    throw new Error(
      `entity-registry: unknown entity set "${name}" — not in the Dataverse access census. ` +
        'Add it deliberately after confirming the real set name in metadata; never guess.',
    );
  }
  return name;
}

/** True iff `name` is a registered canonical entity-set name. */
export function isKnownEntitySet(name) {
  return KNOWN_ENTITY_SETS.has(name);
}

// ───────── Per-entity primary SELECT constants ─────────
// Copied verbatim from the adapters (field order + membership preserved). The
// adapters import these as their `FIELD_SELECT`, so every downstream `.join(',')`,
// spread, and derived select is byte-identical to before.

const SELECT = {
  contacts: [
    'contactid',
    'firstname',
    'lastname',
    'fullname',
    'emailaddress1',
    'wmkf_orcid',
    'statecode',
  ],
  wmkf_potentialreviewerses: [
    'wmkf_potentialreviewersid',
    'wmkf_name',
    'wmkf_firstname',
    'wmkf_lastname',
    'wmkf_emailaddress',
    'wmkf_emailsource',
    // S391 exact-address staff attestation / contradiction current-state bundle.
    // Null, malformed, unknown-version, or wrong-email state grants no authority.
    'wmkf_addresstruststatejson',
    'wmkf_orcid',
    'wmkf_organizationname',
    'wmkf_primaryaffiliation',
    'wmkf_areaofexpertise',
    'wmkf_whyreviewerwaschosen',
    // S308 board-writeup identity (reviewer/staff-CONFIRMED; distinct from the
    // enrichment-sourced wmkf_primaryaffiliation / wmkf_department).
    'wmkf_academicrank',
    'wmkf_primarydepartment',
    'wmkf_maininstitution',
    '_wmkf_contact_value',
    'statecode',
  ],
  wmkf_appreviewersuggestions: [
    'wmkf_appreviewersuggestionid',
    'wmkf_suggestionlabel',
    'wmkf_grantcyclecode',
    'wmkf_programarea',
    'wmkf_relevancescore',
    'wmkf_matchreason',
    'wmkf_sources',
    'wmkf_selected',
    'wmkf_invited',
    'wmkf_accepted',
    'wmkf_declined',
    'wmkf_emailsentat',
    'wmkf_responsereceivedat',
    'wmkf_materialssentat',
    'wmkf_remindersentat',
    'wmkf_remindercount',
    // Reviewer-engagement Phase 3: fire-once marker for the respond-by reminder,
    // SEPARATE from wmkf_remindersentat (the review-due/follow-up marker). Cleared on
    // Re-invite so a fresh offer window can remind again.
    'wmkf_respondremindersentat',
    'wmkf_reviewreceivedat',
    'wmkf_thankyousentat',
    'wmkf_reviewfilename',
    'wmkf_notes',
    'wmkf_reviewstatus',
    'wmkf_responsetype',
    // Historical held timestamp; retained so removal/reset paths can clear old rows.
    'wmkf_heldat',
    // External-reviewer intake (Phase 1+ schema additions). Surfaced so the
    // Review Manager UI can show token state and link to the magic-link
    // lifecycle actions without a second round trip.
    'wmkf_externaltokenhash',
    'wmkf_externaltokenissued',
    'wmkf_externaltokenexpires',
    'wmkf_externaltokenrevoked',
    'wmkf_proposalfirstaccessed',
    'wmkf_reviewsharepointfolder',
    'wmkf_reviewuploadedbystaff',
    'wmkf_revieweraffiliation',
    // Phase D: the 3 rating columns (wmkf_reviewerimpact/risk/overallrating) are no
    // longer SELECTed here — the reviewers DTO now sources ratings from the
    // wmkf_appreviewanswer snapshot. Affiliation stays (parent identity column).
    // Stage 2a slice 1 additions (S143).
    'wmkf_reviewerfirstname',
    'wmkf_reviewerlastname',
    'wmkf_reviewernickname',
    'wmkf_reviewertitle',
    'wmkf_revieweremail',
    'wmkf_reviewerorcid',
    'wmkf_declinereason',
    'wmkf_declinereasonpicklist',
    'wmkf_declinereferral',
    'wmkf_honorariumoptout',
    // W5 step 3: per-candidate proposal summary blob URL. Migrated from
    // Postgres `reviewer_suggestions.summary_blob_url` 2026-05-12; read by
    // generate-emails.js for multi-proposal email batches.
    'wmkf_summarybloburl',
    'wmkf_withdrawnsufficientat',
    'wmkf_coiackedat',
    'wmkf_aiuseackedat',
    '_wmkf_coipolicyversion_value',
    '_wmkf_aiusepolicyversion_value',
    '_wmkf_potentialreviewer_value',
    '_wmkf_request_value',
    // BILL chunk-1 lookup (Connor, deployed 2026-05-28): the honorarium
    // akoya_request this engagement's payout maps to. Set by the portal accept
    // path (chunk 4) after creating the honorarium row. Provenance to the grant
    // request is one hop away via _wmkf_request_value.
    '_wmkf_honorariumrequest_value',
    // Request Workbench (S208). `wmkf_completedat` paired with reviewstatus=
    // complete (deployed wave5, S196). `wmkf_applicantdisposition` (deployed
    // wave6, S208) tags applicant-sourced rows: null = staff/Claude-discovered
    // (normal case), recommended / excluded otherwise. See APPLICANT_DISPOSITION_MAP.
    'wmkf_completedat',
    'wmkf_applicantdisposition',
  ],
};

/**
 * Return a fresh copy of the canonical primary SELECT field list for an entity
 * set. Copy (not the shared array) so a caller that mutates its `FIELD_SELECT`
 * cannot corrupt another adapter's. Throws if no primary select is registered
 * (specialized selects live in their adapters).
 */
export function selectFields(name) {
  const fields = SELECT[name];
  if (!fields) {
    throw new Error(`entity-registry: no primary SELECT registered for entity set "${name}"`);
  }
  return fields.slice();
}
