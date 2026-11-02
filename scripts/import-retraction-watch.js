/**
 * Legacy, unmanaged Retraction Watch import.
 * Managed datasets must use the reviewed refresh service; this tool refuses
 * once the metadata schema exists, and is never an automatic-refresh fallback.
 * Initial cutover must also confirm no earlier legacy import is still running.
 *
 * Usage:
 *   node scripts/import-retraction-watch.js --file /path/to/local.csv
 *   node scripts/import-retraction-watch.js --file /path/to/local.csv --clear
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { Pool } = require('pg');

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

// Create database pool
const pool = new Pool({
  connectionString: process.env.POSTGRES_URL,
  ssl: { rejectUnauthorized: false }
});

// Parse command line arguments
const args = process.argv.slice(2);
const clearFirst = args.includes('--clear');
const fileIndex = args.indexOf('--file');
const customFilePath = fileIndex !== -1 ? args[fileIndex + 1] : null;

/**
 * Normalize author name for search matching
 */
function normalizeAuthorName(name) {
  if (!name) return '';
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/,/g, ' ')
    .replace(/[^a-z\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Parse author string into array of normalized names
 */
function parseAuthors(authorString) {
  if (!authorString) return [];
  const authors = authorString
    .split(/;/)
    .map(a => a.trim())
    .filter(a => a.length > 0);
  return authors.map(normalizeAuthorName).filter(a => a.length > 0);
}

/**
 * Parse reasons string into array
 */
function parseReasons(reasonString) {
  if (!reasonString) return [];
  return reasonString
    .split(/;/)
    .map(r => r.trim())
    .filter(r => r.length > 0);
}

/**
 * Parse date string into Date object
 */
function parseDate(dateString) {
  if (!dateString || dateString === 'unavailable') return null;

  // Handle MM/DD/YYYY format (common in the CSV)
  const parts = dateString.split(' ')[0].split('/');
  if (parts.length === 3) {
    const [month, day, year] = parts;
    const d = new Date(year, month - 1, day);
    if (!isNaN(d.getTime())) {
      return d.toISOString().split('T')[0];
    }
  }

  // Try ISO format
  const isoDate = new Date(dateString);
  if (!isNaN(isoDate.getTime())) {
    return isoDate.toISOString().split('T')[0];
  }

  return null;
}

/**
 * Parse CSV line handling quoted fields
 */
function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current);

  return result;
}

/**
 * Clear existing retraction data
 */
async function clearRetractions() {
  console.log('Clearing existing retraction data...');
  await pool.query('DELETE FROM retractions');
  console.log('  Retraction data cleared.');
}

/**
 * Get database statistics
 */
async function getStats() {
  const result = await pool.query('SELECT COUNT(*) as count FROM retractions');
  return {
    total: parseInt(result.rows[0].count),
  };
}

async function main() {
  console.log('=== Retraction Watch Database Import ===\n');

  if (!customFilePath) {
    console.log('Usage: node scripts/import-retraction-watch.js --file /path/to/file.csv');
    process.exit(1);
  }

  if (!fs.existsSync(customFilePath)) {
    console.error(`File not found: ${customFilePath}`);
    process.exit(1);
  }

  // Prevent an unmanaged rewrite from bypassing publication generations.
  const managed = await pool.query("SELECT to_regclass('retraction_dataset')::text AS relation");
  if (managed.rows[0]?.relation) {
    throw new Error('Managed Retraction Watch schema exists; use the controlled refresh workflow instead of the legacy importer.');
  }

  // Clear if requested
  if (clearFirst) {
    await clearRetractions();
  }

  console.log(`Reading CSV file: ${customFilePath}`);

  const fileStream = fs.createReadStream(customFilePath);
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity
  });

  let headers = null;
  let lineNum = 0;
  let inserted = 0;
  let updated = 0;
  let errors = 0;
  let batch = [];
  const batchSize = 50;

  const insertQuery = `
    INSERT INTO retractions (
      record_id, title, authors, authors_normalized,
      journal, publisher, subject, institution, country,
      retraction_date, original_paper_doi, retraction_nature,
      retraction_reasons, urls, last_updated
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, CURRENT_TIMESTAMP)
    ON CONFLICT (record_id) DO UPDATE SET
      title = EXCLUDED.title,
      authors = EXCLUDED.authors,
      authors_normalized = EXCLUDED.authors_normalized,
      journal = EXCLUDED.journal,
      publisher = EXCLUDED.publisher,
      subject = EXCLUDED.subject,
      institution = EXCLUDED.institution,
      country = EXCLUDED.country,
      retraction_date = EXCLUDED.retraction_date,
      original_paper_doi = EXCLUDED.original_paper_doi,
      retraction_nature = EXCLUDED.retraction_nature,
      retraction_reasons = EXCLUDED.retraction_reasons,
      urls = EXCLUDED.urls,
      last_updated = CURRENT_TIMESTAMP
    RETURNING (xmax = 0) AS inserted
  `;

  async function processBatch(records) {
    for (const record of records) {
      try {
        if (record.record_id) {
          const result = await pool.query(insertQuery, [
            record.record_id,
            record.title,
            record.authors,
            record.authors_normalized,
            record.journal,
            record.publisher,
            record.subject,
            record.institution,
            record.country,
            record.retraction_date,
            record.original_paper_doi,
            record.retraction_nature,
            record.retraction_reasons,
            record.urls
          ]);
          if (result.rows[0]?.inserted) {
            inserted++;
          } else {
            updated++;
          }
        }
      } catch (error) {
        errors++;
        if (errors <= 5) {
          console.error(`\nError inserting record ${record.record_id}: ${error.message}`);
        }
      }
    }
  }

  for await (const line of rl) {
    lineNum++;

    if (lineNum === 1) {
      headers = parseCSVLine(line);
      console.log(`Found ${headers.length} columns`);
      continue;
    }

    const values = parseCSVLine(line);
    if (values.length < headers.length) continue;

    const row = {};
    headers.forEach((h, i) => {
      row[h] = values[i] || '';
    });

    const record = {
      record_id: row['Record ID'] || null,
      title: row['Title'] || '',
      authors: row['Author'] || '',
      journal: row['Journal'] || null,
      publisher: row['Publisher'] || null,
      subject: row['Subject'] || null,
      institution: row['Institution'] || null,
      country: row['Country'] || null,
      retraction_date: parseDate(row['RetractionDate']),
      original_paper_doi: row['OriginalPaperDOI'] || null,
      retraction_nature: row['RetractionNature'] || null,
      retraction_reasons: parseReasons(row['Reason']),
      urls: row['URLS'] || null,
    };

    record.authors_normalized = parseAuthors(record.authors);

    if (record.title && record.record_id) {
      batch.push(record);
    }

    if (batch.length >= batchSize) {
      await processBatch(batch);
      batch = [];
      process.stdout.write(`\r  Processed: ${lineNum - 1} lines, Inserted: ${inserted}, Updated: ${updated}, Errors: ${errors}`);
    }
  }

  // Process remaining batch
  if (batch.length > 0) {
    await processBatch(batch);
  }

  console.log(`\n\n=== Import Summary ===`);
  console.log(`  Lines processed: ${lineNum - 1}`);
  console.log(`  New records inserted: ${inserted}`);
  console.log(`  Existing records updated: ${updated}`);
  console.log(`  Errors: ${errors}`);

  const stats = await getStats();
  console.log(`\n=== Database Statistics ===`);
  console.log(`  Total records: ${stats.total}`);

  await pool.end();
  console.log('\n✓ Import completed successfully!');
}

main().catch(async error => {
  console.error('Import failed:', error);
  await pool.end();
  process.exit(1);
});
