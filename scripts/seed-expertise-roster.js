/**
 * Seed Script: Expertise Roster
 *
 * Populates the expertise_roster table from the CSV file at
 * modules/expertise_matching/data/consultant_expertise.csv
 *
 * Idempotent: skips rows where the name already exists.
 *
 * Usage:
 *   node scripts/seed-expertise-roster.js
 */

const fs = require('fs');
const path = require('path');

// Load environment variables from .env.local
const envPath = path.join(__dirname, '..', '.env.local');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf8');
  envContent.split('\n').forEach(line => {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#')) {
      const [key, ...valueParts] = trimmed.split('=');
      if (key && valueParts.length > 0) {
        let value = valueParts.join('=');
        if ((value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))) {
          value = value.slice(1, -1);
        }
        process.env[key] = value;
      }
    }
  });
  console.log('Loaded environment variables from .env.local');
} else {
  console.error('No .env.local file found. Run: vercel env pull .env.local');
  process.exit(1);
}

const { sql } = require('@vercel/postgres');

const CSV_PATH = path.join(__dirname, '..', 'modules', 'expertise_matching', 'data', 'consultant_expertise.csv');

function parseCSVLine(line) {
  // Fields use semicolons internally, commas only as delimiters.
  // Handle quoted fields (some Expertise paragraphs may contain quotes).
  const fields = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      fields.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  fields.push(current.trim());
  return fields;
}

async function seedRoster() {
  // Refuse once the Production roster has moved to Dataverse (cutover marker).
  await require('../lib/services/expertise-finder/roster-cutover-marker.cjs')
    .assertLegacyRosterWritable((text, params) => sql.query(text, params));
  const raw = fs.readFileSync(CSV_PATH, 'utf-8');
  const lines = raw.split('\n').filter(l => l.trim());

  // Skip header
  const header = lines[0];
  console.log(`CSV header: ${header}`);
  console.log(`Data rows: ${lines.length - 1}`);

  let inserted = 0;
  let skipped = 0;

  for (let i = 1; i < lines.length; i++) {
    const fields = parseCSVLine(lines[i]);
    if (fields.length < 13) {
      console.warn(`Row ${i}: only ${fields.length} fields, skipping`);
      continue;
    }

    const [name, roleType, role, affiliation, orcid, primaryFields, keywords,
           subfieldsSpecialties, methodsTechniques, distinctions, expertise,
           keckAffiliation, keckAffiliationDetails] = fields;

    // Check if already exists
    const existing = await sql`
      SELECT id FROM expertise_roster WHERE name = ${name}
    `;

    if (existing.rows.length > 0) {
      console.log(`  ○ Skipping "${name}" (already exists)`);
      skipped++;
      continue;
    }

    await sql`
      INSERT INTO expertise_roster (
        name, role_type, role, affiliation, orcid,
        primary_fields, keywords, subfields_specialties,
        methods_techniques, distinctions, expertise,
        keck_affiliation, keck_affiliation_details
      ) VALUES (
        ${name}, ${roleType}, ${role}, ${affiliation}, ${orcid || 'N/A'},
        ${primaryFields}, ${keywords}, ${subfieldsSpecialties},
        ${methodsTechniques}, ${distinctions}, ${expertise},
        ${keckAffiliation || null}, ${keckAffiliationDetails || null}
      )
    `;
    console.log(`  ✓ Inserted "${name}" (${roleType})`);
    inserted++;
  }

  console.log(`\nDone: ${inserted} inserted, ${skipped} skipped`);
}

seedRoster()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('Seed failed:', err);
    process.exit(1);
  });
