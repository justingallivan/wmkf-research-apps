#!/usr/bin/env node
/**
 * Test script for name matching improvements
 * Tests nickname variants, Asian name order swapping, and search term generation
 *
 * Usage: node scripts/test-name-matching.js
 */

const { IntegrityMatchingService } = require('../lib/services/integrity-matching-service');

// ANSI color codes
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const CYAN = '\x1b[36m';
const RESET = '\x1b[0m';

function pass(msg) { console.log(`${GREEN}✓${RESET} ${msg}`); }
function fail(msg) { console.log(`${RED}✗${RESET} ${msg}`); }
function info(msg) { console.log(`${CYAN}ℹ${RESET} ${msg}`); }
function section(title) { console.log(`\n${YELLOW}=== ${title} ===${RESET}\n`); }

let passed = 0;
let failed = 0;

function assert(condition, description) {
  if (condition) {
    pass(description);
    passed++;
  } else {
    fail(description);
    failed++;
  }
}

// ============================================
// TEST: Name Variants
// ============================================
section('Name Variant Mapping');

// Test getNameVariants
const robertVariants = IntegrityMatchingService.getNameVariants('robert');
assert(robertVariants.includes('bob'), 'Robert → includes Bob');
assert(robertVariants.includes('rob'), 'Robert → includes Rob');
assert(robertVariants.includes('bobby'), 'Robert → includes Bobby');
assert(robertVariants.includes('robert'), 'Robert → includes Robert (original)');

const bobVariants = IntegrityMatchingService.getNameVariants('bob');
assert(bobVariants.includes('robert'), 'Bob → includes Robert');
assert(bobVariants.includes('rob'), 'Bob → includes Rob (sibling variant)');

const williamVariants = IntegrityMatchingService.getNameVariants('william');
assert(williamVariants.includes('bill'), 'William → includes Bill');
assert(williamVariants.includes('will'), 'William → includes Will');
assert(williamVariants.includes('liam'), 'William → includes Liam');

const mikeVariants = IntegrityMatchingService.getNameVariants('mike');
assert(mikeVariants.includes('michael'), 'Mike → includes Michael');
assert(mikeVariants.includes('mick'), 'Mike → includes Mick');

// Test areNameVariants
assert(IntegrityMatchingService.areNameVariants('bob', 'robert'), 'Bob and Robert are variants');
assert(IntegrityMatchingService.areNameVariants('Bill', 'William'), 'Bill and William are variants (case insensitive)');
assert(IntegrityMatchingService.areNameVariants('mike', 'michael'), 'Mike and Michael are variants');
assert(!IntegrityMatchingService.areNameVariants('john', 'robert'), 'John and Robert are NOT variants');

// ============================================
// TEST: Name Matching with Variants
// ============================================
section('Name Matching with Variants');

let result = IntegrityMatchingService.calculateNameMatch('Robert Smith', 'Bob Smith');
assert(result.matches && result.matchType === 'name_variant', 'Robert Smith matches Bob Smith (name_variant)');
assert(result.confidence === 90, `Heuristic ordering score is 90 (got ${result.confidence}); identity unverified`);

result = IntegrityMatchingService.calculateNameMatch('William Johnson', 'Bill Johnson');
assert(result.matches && result.matchType === 'name_variant', 'William Johnson matches Bill Johnson');

result = IntegrityMatchingService.calculateNameMatch('Michael Chen', 'Mike Chen');
assert(result.matches && result.matchType === 'name_variant', 'Michael Chen matches Mike Chen');

// ============================================
// TEST: Asian Name Order Swapping
// ============================================
section('Asian Name Order Swapping');

result = IntegrityMatchingService.calculateNameMatch('Wei Zhang', 'Zhang Wei');
assert(result.matches && result.matchType === 'name_order_swap', 'Wei Zhang matches Zhang Wei (name_order_swap)');
assert(result.confidence === 85, `Heuristic ordering score is 85 (got ${result.confidence}); identity unverified`);

result = IntegrityMatchingService.calculateNameMatch('Jing Liu', 'Liu Jing');
assert(result.matches && result.matchType === 'name_order_swap', 'Jing Liu matches Liu Jing');

result = IntegrityMatchingService.calculateNameMatch('Min Park', 'Park Min');
assert(result.matches && result.matchType === 'name_order_swap', 'Min Park matches Park Min');

// ============================================
// TEST: Combined - Variant + Order Swap
// ============================================
section('Combined: Variant + Order Swap');

result = IntegrityMatchingService.calculateNameMatch('Bob Zhang', 'Zhang Robert');
assert(result.matches && result.matchType === 'name_order_swap_variant',
  'Bob Zhang matches Zhang Robert (name_order_swap_variant)');
assert(result.confidence === 75, `Heuristic ordering score is 75 (got ${result.confidence}); identity unverified`);

// ============================================
// TEST: Database Search Terms
// ============================================
section('Database Search Term Generation');

const terms = IntegrityMatchingService.buildDatabaseSearchTerms('Robert Smith');
info(`Terms for "Robert Smith": ${terms.join(', ')}`);
assert(terms.includes('robert smith'), 'Includes "robert smith"');
assert(terms.includes('smith'), 'Includes last name "smith"');
assert(terms.includes('smith robert'), 'Includes reversed "smith robert"');
assert(terms.includes('bob smith'), 'Includes variant "bob smith"');
assert(terms.includes('rob smith'), 'Includes variant "rob smith"');
assert(terms.includes('r smith'), 'Includes initial "r smith"');
assert(terms.includes('b smith'), 'Includes variant initial "b smith"');

const asianTerms = IntegrityMatchingService.buildDatabaseSearchTerms('Wei Zhang');
info(`Terms for "Wei Zhang": ${asianTerms.join(', ')}`);
assert(asianTerms.includes('wei zhang'), 'Includes "wei zhang"');
assert(asianTerms.includes('zhang wei'), 'Includes reversed "zhang wei"');
assert(asianTerms.includes('w zhang'), 'Includes initial "w zhang"');

// ============================================
// TEST: Text Search Patterns
// ============================================
section('Text Search Pattern Generation');

const textPatterns = IntegrityMatchingService.buildTextSearchPatterns('Robert Smith');
info(`Patterns for "Robert Smith": ${textPatterns.join(', ')}`);
assert(textPatterns.some(p => p.includes('robert') && p.includes('smith')),
  'Has pattern with robert and smith');
assert(textPatterns.some(p => p.includes('bob') && p.includes('smith')),
  'Has pattern with bob (variant) and smith');

const asianPatterns = IntegrityMatchingService.buildTextSearchPatterns('Wei Zhang');
info(`Patterns for "Wei Zhang": ${asianPatterns.join(', ')}`);
assert(asianPatterns.some(p => p.includes('zhang') && p.includes('wei')),
  'Has pattern with zhang and wei (any order)');

// ============================================
// TEST: Original Matching (regression)
// ============================================
section('Original Matching (Regression Tests)');

result = IntegrityMatchingService.calculateNameMatch('John Smith', 'John Smith');
assert(result.matches && result.matchType === 'exact' && result.confidence === 100,
  'Exact match still works');

result = IntegrityMatchingService.calculateNameMatch('John Smith', 'J Smith');
assert(result.matches && result.matchType === 'last_first_initial' && result.confidence === 85,
  'Initial match still works');

result = IntegrityMatchingService.calculateNameMatch('John Smith', 'John P Smith');
assert(result.matches && result.matchType === 'first_last_exact' && result.confidence === 95,
  'First+Last candidate tolerates an absent middle name, never an explicit conflict');

// ============================================
// Summary
// ============================================
section('Summary');
console.log(`${GREEN}Passed: ${passed}${RESET}`);
console.log(`${RED}Failed: ${failed}${RESET}`);
console.log();

process.exit(failed > 0 ? 1 : 0);
