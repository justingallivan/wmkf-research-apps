-- Complete the source inventory without rewriting migration 106 or operator edits.
SET LOCAL lock_timeout = '5s';
INSERT INTO external_services (id,data) VALUES ('irs-bmf','{"name": "Exempt Organizations Business Master File", "provider": "IRS", "category": "Research & search", "purpose": "EIN verification against IRS exempt organization reference data", "configuration": "Four regional CSVs; quarterly application refresh and lookup through the IRS BMF service.", "updateMode": "Provider-managed", "costTracking": "No paid plan identified", "owner": "Justin", "cadenceDays": 90, "nextReviewOn": "2026-11-20", "actionNeeded": false, "notes": "Source inventory addition from the Opus review. First service review pending; confirm current terms, limits, and availability.", "links": [{"label": "Integration source", "href": "https://github.com/justingallivan/wmkf-research-apps/blob/main/lib/services/irs-bmf-service.js"}]}'::jsonb) ON CONFLICT (id) DO NOTHING;
INSERT INTO external_services (id,data) VALUES ('europe-pmc','{"name": "Scholarly contact evidence", "provider": "Europe PMC", "category": "Research & search", "purpose": "Publication and affiliation evidence for reviewer email discovery", "configuration": "Europe PMC REST search is used by the scholarly-email enrichment tier.", "updateMode": "Provider-managed", "costTracking": "No paid plan identified", "owner": "Justin", "cadenceDays": 90, "nextReviewOn": "2026-11-20", "actionNeeded": false, "notes": "Source inventory addition from the Opus review. First service review pending; confirm current terms, limits, and availability.", "links": [{"label": "Integration source", "href": "https://github.com/justingallivan/wmkf-research-apps/blob/main/lib/services/contact-enrichment/scholarly-email.js"}]}'::jsonb) ON CONFLICT (id) DO NOTHING;

-- Add the missing public benchmark reference while retaining all review edits.
-- Increment the parent version so an open Admin editor cannot erase the change.
WITH changed AS (
  UPDATE external_service_reviews
  SET data = jsonb_set(data, '{links}', (data->'links') || '[{"label": "Vendor benchmark comparison", "href": "https://www.assemblyai.com/benchmarks"}]'::jsonb),
      updated_at = now(), updated_by = NULL
  WHERE id = '438dce63-e462-4e8d-877b-8aefc8f40840' AND service_id = 'assemblyai'
    AND jsonb_typeof(data->'links') = 'array'
    AND jsonb_array_length(data->'links') < 12
    AND NOT (data->'links' @> '[{"href":"https://www.assemblyai.com/benchmarks"}]'::jsonb)
  RETURNING service_id
)
UPDATE external_services SET version = version + 1, updated_at = now(), updated_by = NULL
WHERE id IN (SELECT service_id FROM changed);
