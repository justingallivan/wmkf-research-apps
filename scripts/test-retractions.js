/**
 * Test script for Retraction Watch database search
 *
 * Usage: node scripts/test-retractions.js [name]
 * Example: node scripts/test-retractions.js "John Smith"
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
  console.log('Loaded environment variables from .env.local\n');
}

const { sql } = require('@vercel/postgres');

async function main() {
  const testName = process.argv[2] || null;

  try {
    // 1. Check if table exists and has data
    console.log('=== Retraction Watch Database Test ===\n');

    const countResult = await sql`SELECT COUNT(*) as count FROM retractions`;
    console.log(`Total records in database: ${countResult.rows[0].count}`);

    if (countResult.rows[0].count === '0') {
      console.log('\n⚠️  Database is empty! You need to import data first.');
      console.log('   Run: node scripts/import-retraction-watch.js --file /path/to/data.csv');
      process.exit(1);
    }

    // 2. Show a sample record
    console.log('\n--- Sample Record ---');
    const sampleResult = await sql`
      SELECT id, record_id, title, authors, authors_normalized
      FROM retractions
      LIMIT 1
    `;

    if (sampleResult.rows.length > 0) {
      const sample = sampleResult.rows[0];
      console.log(`ID: ${sample.id}`);
      console.log(`Record ID: ${sample.record_id}`);
      console.log(`Title: ${sample.title?.substring(0, 80)}...`);
      console.log(`Authors: ${sample.authors?.substring(0, 80)}...`);
      console.log(`Authors Normalized: ${JSON.stringify(sample.authors_normalized?.slice(0, 3))}${sample.authors_normalized?.length > 3 ? '...' : ''}`);
    }

    // 3. Test search if name provided
    if (testName) {
      console.log(`\n--- Testing Search for: "${testName}" ---`);

      // Import matching service
      const { IntegrityMatchingService } = require('../lib/services/integrity-matching-service');

      // Build search terms
      const searchTerms = IntegrityMatchingService.buildDatabaseSearchTerms(testName);
      console.log(`\nSearch terms generated: ${JSON.stringify(searchTerms)}`);

      // Test each search term
      let totalMatches = 0;
      for (const term of searchTerms) {
        const result = await sql`
          SELECT COUNT(*) as count
          FROM retractions
          WHERE authors_normalized @> ARRAY[${term}]::text[]
        `;
        const count = parseInt(result.rows[0].count);
        if (count > 0) {
          console.log(`  Term "${term}": ${count} matches`);
          totalMatches += count;
        }
      }

      if (totalMatches === 0) {
        console.log('\n  No matches found for any search term.');

        // Try a fuzzy search to see if data exists
        const lastName = testName.split(/\s+/).pop()?.toLowerCase();
        if (lastName) {
          console.log(`\n  Trying partial text search for last name "${lastName}"...`);
          const fuzzyResult = await sql`
            SELECT title, authors
            FROM retractions
            WHERE LOWER(authors) LIKE ${'%' + lastName + '%'}
            LIMIT 5
          `;

          if (fuzzyResult.rows.length > 0) {
            console.log(`  Found ${fuzzyResult.rows.length} potential matches with LIKE search:`);
            fuzzyResult.rows.forEach((r, i) => {
              console.log(`    ${i + 1}. ${r.authors?.substring(0, 60)}...`);
            });
          } else {
            console.log(`  No matches found with LIKE search either.`);
          }
        }
      } else {
        // Show actual matches
        console.log(`\n  Total potential matches: ${totalMatches}`);

        // Import full service and test
        const { IntegrityService } = require('../lib/services/integrity-service');
        const matches = await IntegrityService.searchRetractionWatch(testName, null);

        console.log(`  After name-candidate filtering: ${matches.length} matches`);

        if (matches.length > 0) {
          console.log('\n  Top matches:');
          matches.slice(0, 3).forEach((m, i) => {
            console.log(`    ${i + 1}. ${m.title?.substring(0, 50)}...`);
            console.log(`       Matched: "${m.matchedAuthor}" (${m.matchType}; identity unverified; heuristic score ${m.confidence})`);
          });
        }
      }
    } else {
      console.log('\n--- Search Test ---');
      console.log('To test a name search, run:');
      console.log('  node scripts/test-retractions.js "John Smith"');
    }

    // 4. Show database stats
    console.log('\n--- Database Statistics ---');
    const statsResult = await sql`
      SELECT
        COUNT(*) as total,
        COUNT(DISTINCT journal) as journals,
        MIN(retraction_date) as earliest,
        MAX(retraction_date) as latest,
        AVG(array_length(authors_normalized, 1)) as avg_authors
      FROM retractions
    `;

    const stats = statsResult.rows[0];
    console.log(`Total records: ${stats.total}`);
    console.log(`Unique journals: ${stats.journals}`);
    console.log(`Date range: ${stats.earliest} to ${stats.latest}`);
    console.log(`Avg authors per record: ${parseFloat(stats.avg_authors).toFixed(1)}`);

  } catch (error) {
    console.error('Error:', error.message);
    if (error.message.includes('does not exist')) {
      console.log('\n⚠️  Table does not exist! Run migrations first:');
      console.log('   node scripts/setup-database.js');
    }
  }

  process.exit(0);
}

main();
