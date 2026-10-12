#!/usr/bin/env python3
# Read-only probe (docs/CLAUDE_REMEDIATION_PLAN.md "Commit probe scripts"). Produced the move
# ledger for docs/plans/FLAT_SERVICES_RELOCATION_PLAN_2026-10-11.md at origin/main b3135037c.
# Reads the repo only; writes to LEDGER_OUT (default docs/plans/data). Run from the repo root:
#   LEDGER_OUT=docs/plans/data python3 scripts/probe-flat-services-ledger.py && \
#   LEDGER_OUT=docs/plans/data python3 scripts/probe-flat-services-ledger-render.py
import os
import json, re, os, sys
from collections import Counter, defaultdict

OUT = os.environ.get('LEDGER_OUT', os.path.join(os.environ.get('REPO_ROOT', os.getcwd()), 'docs/plans/data'))
d = json.load(open(os.path.join(OUT, 'analysis.json')))
rows = {r['name']: r for r in d['rows']}
subdirs = d['subdirs']
subdir_files = d['subdir_files']

# name -> (target, confidence, note)
M = {}
def m(target, conf, names, note=''):
    for n in names.split():
        assert n in rows, n
        assert n not in M, ('dup', n)
        M[n] = (target, conf, note)

# --- NEW:platform: cross-domain infrastructure ---
m('NEW:platform', 'med', 'dynamics-service', 'rule: infra, 11 domains -> platform. Alt: `dynamics` (it imports dynamics/ 10x; dynamics/ is its own split-out internals). tsconfig.check.json include.')
m('NEW:platform', 'med', 'dynamics-context', 'rule: infra, 153 importers (142 scripts). Alt: `dynamics`.')
m('NEW:platform', 'med', 'graph-service', 'rule: infra, 25 domains. Alt: `graph` (it imports graph/ 10x and is the facade over it).')
m('NEW:platform', 'high', 'service-http-error settings-service notification-service alert-service operational-event-service database-service dataverse-identity-map app-access-service request-document-actor-service email-defaults email-signature')
m('NEW:platform', 'med', 'alert-recipients', 'imported by notification-service (platform), site-visit-materials, pages/api/admin')
m('NEW:platform', 'med', 'dataverse-app-access-service dataverse-prefs-service dataverse-settings-service', 'scripts-only importers; Dataverse-backed siblings of app-access/settings services')
m('NEW:platform', 'med', 'external-token', 'token infra for lib/external (7) + 4 service subdirs. Alt: `external-review`.')
m('NEW:platform', 'med', 'program-director-resolver', 'small resolver used by reviewer-finder, workbench, review-manager and 4 flat notification senders')
m('NEW:platform', 'med', 'proposal-participants', '39-line helper imported by review-manager, workbench, external-review, pre-site-visit')
m('NEW:platform', 'med', 'dynamics-identity-service', 'admin/auth/cron/scripts importers; systemuser reconciliation')
m('NEW:platform', 'med', 'vercel-log-drain-ingest', 'operational_events ingestion; single importer pages/api/webhooks')

# --- NEW:executor: LLM / prompt / model infrastructure ---
m('NEW:executor', 'high', 'execute-prompt llm-client prompt-store model-resolver model-capabilities model-override-loader executor-budget-service', 'Alt for the whole cluster: NEW:platform (task lists these as platform examples)')
m('NEW:executor', 'med', 'openai-client multi-llm-service prompt-resolver prompt-seed model-review-validation anthropic-admin', 'openai-client imported only by llm-client; multi-llm-service only by review-panel-generation; prompt-resolver/prompt-seed scripts-only; model-review-validation alt `admin`; anthropic-admin = Anthropic Admin API client (cron)')

# --- NEW:uploads ---
m('NEW:uploads', 'high', 'portal-upload-staging cloudmersive-scan large-upload-admission portal-upload-client-failure')
m('NEW:uploads', 'med', 'sharepoint-cleanup', 'rollback helper shared by grantee-upload/review-upload/portal-upload-staging. Alt: `graph`.')

# --- NEW:cycle-dossier / NEW:review-panel ---
m('NEW:cycle-dossier', 'high', 'cycle-dossier-documents cycle-dossier-generation cycle-dossier-rollout cycle-dossier-service cycle-dossier-sharepoint cycle-dossier-storage cycle-dossier-store cycle-dossier-worker', 'no existing subdir imports any of these; importers are pages/api/cycle-dossier, pages/api/cron, scripts')
m('NEW:review-panel', 'high', 'review-panel-documents review-panel-generation review-panel-input review-panel-questions review-panel-rollout review-panel-service review-panel-storage review-panel-store review-panel-worker', 'no existing subdir imports any of these; importers are pages/api/review-panel, pages/api/cron, pages/api/admin')

# --- NEW:reviewer-identity ---
m('NEW:reviewer-identity', 'high', 'reviewer-identity-resolver reviewer-identity-evidence reviewer-identity-lookup reviewer-identity-runtime reviewer-identity-shadow-log reviewer-identity-binding-contract reviewer-identity-binding-writer reviewer-works-first reviewer-works-first-authoritative reviewer-work-author-resolver independent-reviewer-identity reviewer-independent-identity-runtime capture-self-reported-orcid capture-self-reported-reviewer-identity backprop-reviewer-orcid proposal-pi-identity', 'cluster imports each other; heaviest existing importer is contact-enrichment (resolver 5, work-author-resolver 3). Alt for cluster: `contact-enrichment`.')
m('NEW:reviewer-identity', 'med', 'auto-link-reviewer-contact-account sync-reviewer-name-title-to-contact reviewer-contact-reconciliation reviewer-contact-audit reviewer-candidate-attestation reviewer-promotion-repair-classifier deduplication-service', 'contact/identity binding helpers; deduplication-service imports institution-identity-resolver and is imported by workbench(2)/discovery/reviewer-finder/scripts(4)')

# --- NEW:institution-identity ---
m('NEW:institution-identity', 'high', 'ror-affiliation-assertion-resolver ror-institution-candidate-adapter ror-institution-candidate-contract ror-institution-decision ror-institution-evidence ror-institution-identity-resolver institution-affiliation-assessment institution-affiliation-consistency institution-affiliation-stage2 institution-identity-resolver', 'ROR/affiliation cluster imports only itself + openalex/dedup; importers workbench, reviewer-finder, scripts')
m('NEW:institution-identity', 'med', 'institution-coi-context institution-structural-sameness reviewer-institution-auto-resolution-policy reviewer-institution-coi-screen reviewer-institution-evidence-attestation reviewer-institution-measurement', 'first three have 0 runtime importers (test-only); measurement/evidence-attestation imported by workbench(3)+reviewer-finder')

# --- NEW:intake ---
m('NEW:intake', 'high', 'intake-audit-service intake-draft-service contact-bridge-service membership-service', 'all imported by pages/api/intake (4 each); no lib/services intake dir exists')

# --- NEW:integrity-screener ---
m('NEW:integrity-screener', 'med', 'integrity-service integrity-matching-service', 'integrity-service.js COLLIDES with lib/services/workbench/integrity-service.js so `workbench` is not available; importers pages/api/integrity-screener(3), workbench(1), scripts')

# --- existing dirs ---
m('workbench', 'high', 'grantee-deliverable-record grantee-upload grantee-document-html grantee-abstract-service workbench-proposal-documents reviewer-rollup reviewer-candidate-export', 'grantee-deliverable-record imported by workbench/ 6x; reviewer-rollup is in tsconfig.check.json include')
m('workbench', 'med', 'grantee-document-assembly grantee-submit-notification reviewer-exclusion-parser reviewer-roster-store reviewer-address-trust-service', 'grantee-document-assembly also imported by pre-site-visit(2); roster-store imported by workbench(3)/reviewer-finder/scripts(3); address-trust imports roster-store')
m('workbench', 'med', 'consultant-feedback-service consultant-feedback-attachment-service', 'importers pages/api/workbench (3 and 2) + deliberation-briefing(1); attachment-service imports site-visit-materials/(1)')
m('reviewer-finder', 'high', 'claude-reviewer-service reviewer-prompt-composer reviewer-prompt-resolver reviewer-request-context', 'reviewer suggestion LLM pipeline; importers pages/api/reviewer-finder, scripts, workbench')
m('reviewer-finder', 'med', 'reviewer-merge reviewer-time-budget', 'reviewer-merge imports test-requests/(2); time-budget importers pages/api/reviewer-finder(3)')
m('review-manager', 'high', 'reviewer-request-authorization review-receipt-guard review-synthesis-content review-synthesis-job-service review-synthesis-readiness reviewer-reminder-eligibility')
m('review-manager', 'med', 'review-synthesis-drain reviewer-reminder-candidate reviewer-reminder-liveness-audit reviewer-reminder-personalization reviewer-reminder-sweep reviewer-manual-reminder reviewer-thankyou-sweep reviewer-due-extension reviewer-campaign-timeline reviewer-release-config review-draft-service review-upload reviewer-subfolder honorarium-config grant-cycles-dataverse', 'reminder/sweep cluster imports each other + review-manager; review-upload importers pages/api/external+review-manager+scripts; reviewer-subfolder is a pure extract of review-upload (imported by test-requests 2); grant-cycles-dataverse alt `reviewer-finder`')
m('reviewer-engagement', 'med', 'reviewer-acceptance-drain reviewer-acceptance-email reviewer-acceptance-job-service alert-reviewer-affiliation-mismatch alert-reviewer-email-mismatch reviewer-email-reconciler reviewer-withdrawal reviewer-quota reviewer-suggestion-sweep', 'invitation/acceptance lifecycle; acceptance-job-service imported by external-review+reviewer-engagement; alert-reviewer-* imported only by acceptance-drain; withdrawal alt `external-review`')
m('review-documents', 'med', 'review-answers', '21 lines; imported by review-documents(2), deliberation-briefing, review-manager, lib/dataverse')
m('discovery', 'high', 'discovery-service arxiv-service biorxiv-service chemrxiv-service pubmed-service', 'discovery-service imports discovery/ 13x; preprint/pubmed sources imported by discovery/')
m('discovery', 'med', 'openalex-service', 'imported by 9 flat files, contact-enrichment(2), discovery(1), workbench(1). Alt: `contact-enrichment`.')
m('contact-enrichment', 'high', 'contact-enrichment-service serp-contact-service', 'contact-enrichment-service imports contact-enrichment/ 11x')
m('contact-enrichment', 'med', 'orcid-service', 'importers scripts(5), contact-enrichment(2), 3 flat identity files. Alt: NEW:reviewer-identity.')
m('dynamics-explorer', 'high', 'dynamics-explorer-request-telemetry dynamics-explorer-taxonomy dynamics-odata-validator')
m('dynamics-explorer', 'med', 'feedback-service', 'imports dynamics-explorer-request-telemetry; importers pages/api/cron + pages/api/dynamics-explorer')
m('cron', 'high', 'grantee-title-service', 'single importer cron/generate-grantee-titles-service.js')
m('cron', 'med', 'maintenance-service scheduled-email-service scheduled-email-store email-automation-preferences', 'maintenance-service: 22 pages/api/cron importers. scheduled-email-*: alt NEW:scheduled-emails (importers pages/api/scheduled-emails, cron/, review-manager/)')
m('graph', 'high', 'sharepoint-target-registry', 'imported by graph/(3) and test-requests/(3)')
m('field-primer', 'high', 'field-primer-service', 'single service importer field-primer/generate-service.js')
m('meeting-tracker', 'med', 'deliberation-stage-labels', 'Staff Deliberations rail labels (PC Meeting Tracker D6); importers pre-site-visit(1), pages/api/workbench(1)')
m('KEEP-FLAT:standalone IRS reference-data domain with no lib/services sibling (importers pages/api/irs, pages/api/cron, scripts)', 'low', 'irs-bmf-service')

missing = sorted(set(rows) - set(M))
assert not missing, missing
assert len(M) == 176

# --- domain collapse for cross-domain-hub ---
def feature(dom):
    if dom == 'scripts': return 'scripts'
    if dom == 'lib/services(flat)': return None
    parts = dom.split('/')
    if parts[0] == 'pages':
        return parts[2] if len(parts) > 2 else (parts[1] if len(parts) > 1 else 'pages')
    if parts[0] == 'lib':
        if len(parts) > 2 and parts[1] == 'services': return parts[2]
        return parts[1] if len(parts) > 1 else 'lib'
    if parts[0] == 'shared':
        return parts[2] if len(parts) > 2 else parts[1] if len(parts) > 1 else 'shared'
    return dom

def feature_domains(r):
    s = set()
    for dom, _ in r['importer_dirs']:
        f = feature(dom)
        if f: s.add(f)
    return s

TS_INCLUDE = {'dynamics-service', 'reviewer-rollup'}
JEST_SETUP = {'app-access-service': 'jest.setup.js:53: jest.mock(\'./lib/services/app-access-service\', ...)  (global mock, outside the task gate list)'}

def hazards(r):
    hz = []
    if r['name'] in TS_INCLUDE: hz.append('tsconfig-include')
    if r['gate_hits'] or r['name'] in JEST_SETUP: hz.append('gate-literal')
    if r['test_file_refs'] >= 30: hz.append('jest-mock-heavy')
    if r['cycle_subdirs']: hz.append('cycle-risk')
    if len(feature_domains(r)) >= 4: hz.append('cross-domain-hub')
    return hz


PURPOSE_OVERRIDE = {
 'openalex-service': 'OpenAlex API client: authors, works, topics, institutions',
 'dynamics-explorer-taxonomy': 'Cached live Dataverse taxonomy resolver for Dynamics Explorer',
 'dynamics-odata-validator': 'OData expression validation and lookup-alias catalog for Explorer',
 'review-synthesis-drain': 'Cron drain for queued review-synthesis jobs',
 'review-synthesis-job-service': 'Postgres queue for automatic/manual review-synthesis jobs',
 'reviewer-acceptance-drain': 'Processes reviewer-acceptance jobs: contact, honorarium, identity follow-ups',
 'reviewer-acceptance-email': 'Renders reviewer acceptance confirmation email from settings keys',
 'reviewer-acceptance-job-service': 'Postgres queue for reviewer_acceptance_jobs (enqueue, claim, lease)',
 'reviewer-withdrawal': 'Late-honorarium cancellation and PD notification on reviewer withdrawal',
 'cycle-dossier-documents': 'Server-side Cycle Dossier document renderers (PDF/DOCX)',
 'cycle-dossier-service': 'Cycle Dossier application service: roster, preview, pinning, launch/retry',
 'cycle-dossier-sharepoint': 'Resolve one authoritative request SharePoint destination for dossier writes',
 'cycle-dossier-storage': 'Private immutable dossier bytes (Blob) with persisted references',
 'cycle-dossier-store': 'Cycle Dossier operational persistence: leases, budgets, run JSON',
 'cycle-dossier-worker': 'Cycle Dossier durable cron worker with global run lease',
 'institution-coi-context': 'Institution COI context contract/version constants and hashing',
 'reviewer-institution-auto-resolution-policy': 'Dormant Phase 1 composition contract for institution auto-resolution (no runtime caller)',
 'email-defaults': 'Read required email default settings; alert on misconfiguration',
 'email-signature': 'Resolve and append sender signature block for request emails',
 'review-panel-storage': 'Private immutable review-panel bytes (dedicated Blob store, SHA-256 verified)',
 'review-panel-store': 'Virtual Review Panel Phase A persistence (clone of cycle-dossier-store shape)',
 'reviewer-identity-binding-contract': 'Identity binding sources, field sources, lineage schema constants and normalizers',
 'reviewer-identity-evidence': 'Builds reviewer identity evidence/notes from OpenAlex, ORCID, resolver',
 'reviewer-work-author-resolver': 'Resolves a work\'s author to a reviewer identity via OpenAlex',
 'reviewer-email-reconciler': 'Backstop recovering enrichment-found reviewer emails that never reached Dataverse',
 'proposal-pi-identity': 'Resolve proposal PI from structured Dataverse data, not LLM text',
 'grant-cycles-dataverse': 'Dataverse-backed grant-cycle accessors for reviewer-finder and review-manager routes',
 'reviewer-subfolder': 'Pure per-reviewer SharePoint subfolder naming extracted from review-upload',
 'reviewer-reminder-candidate': 'Side-effect-free OData predicate shared by review-due reminder sweep',
 'consultant-feedback-attachment-service': 'Consultant Feedback slice 2 attachment lifecycle',
 'reviewer-exclusion-parser': 'Parse applicant-supplied excluded-reviewers free text into clean names',
 'reviewer-rollup': 'Lightweight per-request reviewer suggestion count rollup',
 'reviewer-roster-store': 'Postgres CRUD for reviewer_find_roster durable candidate roster',
 'grantee-document-assembly': 'Canonical assembly model for grantee deliverable document outputs',
 'grantee-document-html': 'Presentation (HTML) layer for grantee document assembly model',
 'reviewer-identity-lookup': 'Cross-store reviewer identity lookup behind workbench reviewer-lookup',
 'reviewer-merge': 'Collapse a duplicate wmkf_potentialreviewers row into its survivor',
 'alert-reviewer-affiliation-mismatch': 'Staff alert when accepted reviewer self-reported affiliation differs',
 'alert-reviewer-email-mismatch': 'Staff alert when accepted reviewer self-reported email differs',
 'capture-self-reported-reviewer-identity': 'Capture reviewer self-reported board-writeup identity fields',
 'reviewer-promotion-repair-classifier': 'Read-only classifier for historical promotions pointing at email-empty persons',
 'reviewer-identity-shadow-log': 'Durable best-effort persistence for reviewer-identity shadow comparisons',
 'review-panel-documents': 'Review Panel Phase A DOCX/PDF renderers, private-Blob editions',
 'prompt-resolver': 'Fetches Claude prompt templates with per-app dynamic fallback module',
 'alert-recipients': 'Resolves an alert category to admin email recipients',
 'service-http-error': 'Typed HTTP error for Route-to-Service consolidation',
 'reviewer-release-config': 'Reviewer release-materials attachment setting (single Dataverse boolean)',
}

def purpose(r):
    if r['name'] in PURPOSE_OVERRIDE: return PURPOSE_OVERRIDE[r['name']]
    t = r['purpose_raw']
    t = re.sub(r'\s+', ' ', t).strip()
    t = re.sub(r'^(lib/services/)?' + re.escape(r['name']) + r'(\.js)?\s*[-—:]*\s*', '', t, flags=re.I)
    # first sentence
    mm = re.match(r'(.+?[.!?])(\s|$)', t)
    if mm and len(mm.group(1).split()) >= 3:
        t = mm.group(1)
    words = t.split()
    if len(words) > 12:
        t = ' '.join(words[:12]).rstrip(',;:—-') + '…'
    if not t:
        t = '(no header comment)'
    return t.replace('\t', ' ')

def wave(r, hz):
    if 'tsconfig-include' in hz or 'gate-literal' in hz: return 4
    if 'jest-mock-heavy' in hz: return 3
    if 6 <= r['test_file_refs'] <= 29: return 2
    if r['test_file_refs'] <= 5 and hz: return 2
    return 1

out = []
for name, (target, conf, note) in M.items():
    r = rows[name]
    hz = hazards(r)
    prec = ['tsconfig-include', 'gate-literal', 'jest-mock-heavy', 'cycle-risk', 'cross-domain-hub']
    primary = next((h for h in prec if h in hz), 'none')
    dirs = '; '.join(f'{k}:{v}' for k, v in r['importer_dirs'][:3])
    out.append({
        'file': f'lib/services/{name}.js', 'name': name, 'lines': r['lines'], 'purpose': purpose(r),
        'importer_files_total': r['importer_files_total'], 'importer_dirs': dirs,
        'test_file_refs': r['test_file_refs'], 'script_refs': r['script_refs'], 'doc_memory_refs': r['doc_memory_refs'],
        'proposed_target': target, 'confidence': conf, 'hazard': primary, 'all_hazards': hz, 'note': note,
        'wave': wave(r, hz), 'feature_domains': sorted(feature_domains(r)),
    })

def sort_key(o):
    t = o['proposed_target']
    grp = 0 if not t.startswith(('NEW:', 'KEEP-FLAT')) else (1 if t.startswith('NEW:') else 2)
    return (grp, t, o['name'])
out.sort(key=sort_key)

cols = ['file', 'lines', 'purpose', 'importer_files_total', 'importer_dirs', 'test_file_refs', 'script_refs', 'doc_memory_refs', 'proposed_target', 'confidence', 'hazard']
with open(os.path.join(OUT, 'flat-services-map.tsv'), 'w') as fh:
    fh.write('\t'.join(cols) + '\n')
    for o in out:
        fh.write('\t'.join(str(o[c]) for c in cols) + '\n')

# collisions
collisions = []
for o in out:
    t = o['proposed_target']
    if t in subdir_files and f"{o['name']}.js" in subdir_files[t]:
        collisions.append((o['name'], t))
# NEW dirs must not equal existing
for o in out:
    t = o['proposed_target']
    if t.startswith('NEW:'):
        assert t[4:] not in subdirs, t
        assert t[4:] not in rows, ('NEW name collides with flat basename', t)
    elif not t.startswith('KEEP-FLAT'):
        assert t in subdirs, t

waves = Counter(o['wave'] for o in out)
assert sum(waves.values()) == 176
json.dump(out, open(os.path.join(OUT, 'rows.json'), 'w'), indent=1)
print('targets:', Counter(o['proposed_target'].split(':')[0] if o['proposed_target'].startswith('KEEP') else o['proposed_target'] for o in out).most_common())
print('waves:', sorted(waves.items()))
print('hazards:', Counter(o['hazard'] for o in out))
print('collisions in target:', collisions)
print('rows with all_hazards>1:', [(o['name'], o['all_hazards']) for o in out if len(o['all_hazards']) > 1][:40])

# ---------------- notes ----------------
L = []
w = L.append
w('# Flat lib/services/*.js move table — companion notes')
w('')
w('Worktree: ' + ROOT + '  @ b3135037c (origin/main). Read-only analysis; generated by scripts/probe-flat-services-ledger.py + scripts/probe-flat-services-ledger-render.py (python3, stdlib only).')
w('')
w('## Counting method (reproducible)')
w('')
w('- Flat set: `find lib/services -maxdepth 1 -name "*.js" -type f` = 176 files. Subdirs: `ls -d lib/services/*/` = 34.')
w('- `lines`: newline count of the file (`wc -l` equivalent).')
w('- `importer_files_total`: number of files under `lib/`, `pages/`, `shared/`, `scripts/` (extensions .js .jsx .mjs .cjs .ts .tsx; skipping node_modules, .next, vendor) containing at least one import/require/`import()`/`require.resolve`/`jest.mock` string specifier that RESOLVES to the flat file. Resolution: relative specifiers are normalized against the importing file\'s directory; `@/` maps to repo root (jest moduleNameMapper); bare `lib/services/...` strings map to root. Extensions stripped before comparison. Each importer file counted once (deduped). This is a superset of the task\'s literal patterns (`lib/services/<name>`, `./<name>` from lib/services, `../<name>` from lib/services/<subdir>) and also catches `../../services/<name>` from lib/<other>/ and `../../lib/services/<name>` from pages/. Spot-check: dynamics-context resolver=153 vs `rg -l "dynamics-context(\\.js)?[\'\\"]" lib pages shared scripts`=155; the 2 extra literal hits are string literals in scripts/check-dynamics-context-boundary*.js, not imports.')
w('- `importer_dirs`: importer files grouped by directory token: `pages/api/<x>`, `pages/<x>`, `lib/services/<subdir>`, `lib/services(flat)` (another flat file), `lib/<x>`, `shared/<kind>/<x>`, `scripts`. Top 3 by count, `dir:count; ...`.')
w('- `test_file_refs`: files under `tests/` whose text matches regex `lib/services/<name>(?![\\w\\-/])` (so `lib/services/dynamics-service` does not match `lib/services/dynamics-service-x` or `lib/services/dynamics/...`).')
w('- `script_refs`: same regex, files under `scripts/`.')
w('- `doc_memory_refs`: files under `docs/` and `.claude-memory/` matching `lib/services/<name>\\.js(?![\\w\\-])` (the `.js` form, as specified).')
w('- `hazard` column is single-valued; precedence when several apply: tsconfig-include > gate-literal > jest-mock-heavy > cycle-risk > cross-domain-hub > none. All hazards per file are listed in the per-file section below. Only 2 files carry tsconfig-include; both also match gate-literal.')
w('  - gate-literal: regex hit in any `scripts/check-*.js` (68 files), `tests/unit/*recorded-set*.test.js` (2 files), `tsconfig.check.json`, `jest.config.js`, `next.config.js`, `.github/workflows/*` (7 files). PLUS one deviation: `jest.setup.js:53` globally `jest.mock(\'./lib/services/app-access-service\', ...)`; a move breaks every Jest run, so app-access-service is marked gate-literal and the source is named here.')
w('  - jest-mock-heavy: test_file_refs >= 30.')
w('  - cross-domain-hub: importer dirs collapsed to feature tokens (`pages/api/X`->X, `lib/services/X/`->X, `lib/X`->X, `shared/*/X`->X, `scripts` counts as one token, `lib/services(flat)` EXCLUDED because those importers are themselves moving) span >= 4 distinct tokens.')
w('  - cycle-risk: the flat file imports from a subdir S AND some file in S imports the flat file (direct edges only). Result: 0 of 176 flagged. Checked by intersecting each file\'s imported-subdir set with its importing-subdir set; e.g. dynamics-service imports dynamics/ 10x and the only `dynamics-service` strings inside lib/services/dynamics/ are "Moved verbatim from lib/services/dynamics-service.js" comments (read-ops.js:5, http.js:4, ...), not imports.')
w('- `purpose`: first sentence of the file header comment, trimmed to <=12 words; for files whose header is below the imports or absent, a <=12-word summary from the first JSDoc block / first exports (hand-written, see PURPOSE_OVERRIDE in generate.py).')
w('- Wave assignment precedence (single wave per file; counts sum to 176): any gate-literal/tsconfig-include -> wave 4; else jest-mock-heavy -> wave 3; else test_file_refs 6..29 -> wave 2; else test_file_refs <= 5 with cross-domain-hub/cycle-risk -> wave 2; else -> wave 1.')
w('- TSV sort: existing-subdir targets (alphabetical) first, then NEW:* targets, then KEEP-FLAT; files alphabetical within target.')
w('')
w('## (a) Existing 34 subdirs of lib/services with .js file counts')
w('')
for k in sorted(subdirs):
    w(f'- {k}: {subdirs[k]}')
w('')
w('## Proposed NEW directories (9) and why no existing dir fits')
w('')
newdirs = defaultdict(list)
for o in out:
    if o['proposed_target'].startswith('NEW:'):
        newdirs[o['proposed_target']].append(o['name'])
for k in sorted(newdirs):
    w(f'- {k} ({len(newdirs[k])} files): ' + ', '.join(newdirs[k]))
w('')
w('Facts behind the NEW set: cycle-dossier-* and review-panel-* have zero importers inside any existing lib/services subdir (importers are pages/api/cycle-dossier|review-panel, pages/api/cron, pages/api/admin, scripts). intake-* / contact-bridge-service / membership-service are imported only by pages/api/intake (+cron, scripts); no `lib/services/intake` exists. integrity-service cannot go to `workbench` (filename collision, see (b)). The platform/executor/uploads/reviewer-identity/institution-identity groups are cross-subdir clusters whose members import each other; the strongest single existing-dir pull for each is recorded in the per-file notes as an "Alt".')
w('')
w('## (b) Filename collisions')
w('')
w('- Flat file vs existing subdir FILE with same basename anywhere in lib/services/*/: `integrity-service.js` exists in `workbench/` (lib/services/workbench/integrity-service.js, "Workbench request integrity screening"). Proposed target for the flat file is NEW:integrity-screener, so no collision in the proposed target.')
w('- Flat file vs existing subdir NAME (would block `lib/services/<name>/` creation): none of the 176 basenames equals one of the 34 dir names.')
w('- Proposed NEW dir name vs flat basename (a flat `<name>.js` would block `mkdir lib/services/<name>/`): none of the 9 NEW names equals a flat basename (asserted by generate.py).')
w(f'- Collisions inside PROPOSED targets after assignment: {collisions if collisions else "none"} (asserted by generate.py: for every row whose target is an existing dir, `<name>.js` is not already present there).')
w('')
w('## (c) Move order (waves)')
w('')
for wv in (1, 2, 3, 4):
    files = [o['name'] for o in out if o['wave'] == wv]
    label = {1: 'test_file_refs <= 5 and no hazard', 2: 'test_file_refs 6..29, or <=5 refs with cross-domain-hub', 3: 'jest-mock-heavy (>=30 test refs), no gate literal', 4: 'gate-literal / tsconfig-include'}[wv]
    w(f'### Wave {wv} — {label} — {len(files)} files')
    w('')
    w(', '.join(files))
    w('')
w(f'Wave totals: ' + ', '.join(f'wave {k}={v}' for k, v in sorted(waves.items())) + f' (sum {sum(waves.values())}).')
w('')
w('## (d) Path mappings / includes in config files (exact file:line)')
w('')
w('- jest.config.js:43-47 `moduleNameMapper`: `^@/(.*)$` -> `<rootDir>/$1` (line 45); `^@shared/(.*)$` -> `<rootDir>/shared/$1` (46); `^@pages/(.*)$` -> `<rootDir>/pages/$1` (47). No lib/services literal; `@/lib/services/...` is used by 2 test files: tests/unit/presentation-video-cut-script.test.js:13 (subdir path meeting-tracker-recordings/, unaffected by flat moves) and tests/unit/graph-service-boundary.test.js:345 (a synthetic string inside a fixture, `@/lib/services/also-missing`).')
w('- jest.config.js:24-28 `modulePathIgnorePatterns`: node_modules.nosync, .next.nosync, .claude/worktrees — no lib/services pattern.')
w('- jest.config.js:12-19 `testPathIgnorePatterns`; :48-52 `testMatch` (tests/**, shared/**/__tests__, pages/**/__tests__) — no lib/services pattern.')
w('- jest.setup.js:53 `jest.mock(\'./lib/services/app-access-service\', ...)` — global mock of a FLAT path (root-relative). jest.setup.js:41 comment references lib/services/dynamics-context.js#isDalEnforcementOn.')
w('- next.config.js:87 `outputFileTracingIncludes` with entries at :95, :111, :129 = `./lib/services/transcription-pilot/audio-inspector-worker.js` (subdir file; not a flat file; unaffected). next.config.js:74 `experimental.esmExternals` — not a path mapping. No webpack alias block.')
w('- tsconfig.check.json:32-61 `include`: lib/services/dynamics/read-ops.js (:36, subdir), **lib/services/dynamics-service.js (:42, FLAT)**, lib/services/workbench/triage-service.js (:46, subdir), **lib/services/reviewer-rollup.js (:47, FLAT)**. No `paths`/`baseUrl` in compilerOptions (:9-26).')
w('- jsconfig.json: does not exist at repo root. package.json: no `"imports"` subpath map.')
w('- .github/workflows/*.yml (7 files): zero `lib/services` literals.')
w('- Dynamic import with a computed specifier: lib/services/prompt-resolver.js:126 `await import(fallbackModule)`; the only configured value is `../../shared/config/prompts/phase-i-dynamics.js` (prompt-resolver.js:50) — relative to lib/services/, so moving prompt-resolver.js one level deeper changes the resolution of that string.')
w('')
w('## Gate-literal hits (exact file:line, only for flagged files)')
w('')
for o in out:
    r = rows[o['name']]
    if r['gate_hits'] or o['name'] in JEST_SETUP:
        w(f'### {o["file"]}')
        for h in r['gate_hits']:
            w(f'- {h}')
        if o['name'] in JEST_SETUP:
            w(f'- {JEST_SETUP[o["name"]]}')
        w('')
w('## Per-file notes (all hazards, feature-domain count, alternative targets)')
w('')
for o in out:
    r = rows[o['name']]
    extra = []
    if o['all_hazards']: extra.append('hazards=' + '+'.join(o['all_hazards']))
    extra.append(f'feature_domains={len(o["feature_domains"])}')
    if r['imported_subdirs']: extra.append('imports-from-subdirs=' + ','.join(f'{k}:{v}' for k, v in r['imported_subdirs']))
    if r['importing_subdirs']: extra.append('imported-by-subdirs=' + ','.join(f'{k}:{v}' for k, v in r['importing_subdirs']))
    if r['importer_files_total'] == 0: extra.append('0 runtime importers (test-only)')
    if o['note']: extra.append(o['note'])
    w(f'- {o["name"]} -> {o["proposed_target"]} [{o["confidence"]}] wave {o["wave"]}: ' + ' | '.join(extra))
w('')
w('## Other facts')
w('')
w('- Zero-importer flat files (only tests reference them): institution-coi-context, institution-structural-sameness, reviewer-institution-auto-resolution-policy.')
w('- Second-order dependency direction: execute-prompt.js and workbench-proposal-documents.js and consultant-feedback-attachment-service.js each import from lib/services/site-visit-materials/ (1 import each); cycle-dossier-rollout/-service and review-panel-rollout/-service import from workbench/ and test-requests/; several reviewer-* flat files import from test-requests/ (sandbox fences). No direct cycle exists today (see cycle-risk), but a NEW:platform dir would depend on the feature dir site-visit-materials via execute-prompt.')
w('- Flat files importing other flat files: the TSV `importer_dirs` token `lib/services(flat)` counts these; after a move those relative `./x` specifiers must be rewritten in both directions.')
w('- test_file_refs counts literal path mentions (jest.mock strings, imports, comments) and is therefore an upper bound on test files that need edits.')
with open(os.path.join(OUT, 'flat-services-notes.md'), 'w') as fh:
    fh.write('\n'.join(L) + '\n')
print('notes lines', len(L))
