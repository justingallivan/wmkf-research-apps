-- ============================================
-- Expert Reviewers Pro - Database Schema
-- ============================================
-- This schema supports multi-source reviewer search with caching
-- Tables: search_cache, researchers, publications, researcher_keywords, reviewer_suggestions

-- ============================================
-- SEARCH CACHE TABLE
-- Stores results from external API searches
-- ============================================
CREATE TABLE IF NOT EXISTS search_cache (
  id SERIAL PRIMARY KEY,
  source VARCHAR(50) NOT NULL,  -- 'pubmed', 'arxiv', 'biorxiv', 'scholar'
  query_hash VARCHAR(64) NOT NULL,  -- SHA256 hash of search parameters
  query_text TEXT NOT NULL,  -- Human-readable query for debugging
  results JSONB,  -- Full results from API
  result_count INTEGER,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  expires_at TIMESTAMP,
  UNIQUE(source, query_hash)
);

-- ============================================
-- RESEARCHERS TABLE
-- Deduplicated researcher profiles
-- ============================================
CREATE TABLE IF NOT EXISTS researchers (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  normalized_name VARCHAR(255),  -- Lowercase, no punctuation for matching
  primary_affiliation VARCHAR(500),
  department VARCHAR(255),
  email VARCHAR(255),
  website VARCHAR(500),
  orcid VARCHAR(50),
  google_scholar_id VARCHAR(100),
  h_index INTEGER,
  i10_index INTEGER,
  total_citations INTEGER,
  notes TEXT,  -- V12: General notes about the researcher (conflicts, preferences, etc.)
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  last_checked TIMESTAMP  -- Last time we verified/refreshed this profile
);

-- ============================================
-- PUBLICATIONS TABLE
-- Papers linked to researchers
-- ============================================
CREATE TABLE IF NOT EXISTS publications (
  id SERIAL PRIMARY KEY,
  researcher_id INTEGER REFERENCES researchers(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  authors TEXT[],  -- Array of all author names
  author_position INTEGER,  -- Position of this researcher in author list
  publication_date DATE,
  year INTEGER,
  journal VARCHAR(500),
  doi VARCHAR(100),
  pmid VARCHAR(50),  -- PubMed ID
  pmcid VARCHAR(50),  -- PubMed Central ID
  arxiv_id VARCHAR(50),
  citations INTEGER DEFAULT 0,
  abstract TEXT,
  source VARCHAR(50),  -- 'pubmed', 'arxiv', 'biorxiv', 'scholar'
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(doi)  -- Prevent duplicate publications by DOI
);

-- ============================================
-- RESEARCHER KEYWORDS TABLE
-- Research areas/expertise for each researcher
-- ============================================
CREATE TABLE IF NOT EXISTS researcher_keywords (
  id SERIAL PRIMARY KEY,
  researcher_id INTEGER REFERENCES researchers(id) ON DELETE CASCADE,
  keyword VARCHAR(255) NOT NULL,
  relevance_score FLOAT DEFAULT 1.0,  -- 0-1, how strongly associated
  source VARCHAR(50),  -- 'publications', 'profile', 'manual'
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(researcher_id, keyword, source)
);

-- ============================================
-- REVIEWER SUGGESTIONS TABLE
-- Track which researchers were suggested for which proposals
-- ============================================
CREATE TABLE IF NOT EXISTS reviewer_suggestions (
  id SERIAL PRIMARY KEY,
  proposal_id VARCHAR(100) NOT NULL,  -- Your internal proposal identifier
  proposal_title TEXT,
  researcher_id INTEGER REFERENCES researchers(id) ON DELETE CASCADE,
  relevance_score FLOAT,  -- How well they match this proposal
  match_reason TEXT,  -- Why we suggested them
  sources TEXT[],  -- Which databases found them: ['pubmed', 'scholar']
  suggested_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  selected BOOLEAN DEFAULT FALSE,  -- Did you actually use them?
  invited BOOLEAN DEFAULT FALSE,  -- Did you send invitation?
  accepted BOOLEAN,  -- Did they accept?
  notes TEXT,
  -- V4: Email generation fields
  proposal_abstract TEXT,
  proposal_authors TEXT,
  proposal_institution TEXT,
  -- V6: Co-PI information for email templates
  co_investigators TEXT,  -- Comma-separated Co-PI names
  co_investigator_count INTEGER,
  -- V3: Outreach tracking
  email_sent_at TIMESTAMP,
  email_opened_at TIMESTAMP,
  response_received_at TIMESTAMP,
  response_type VARCHAR(50),  -- 'accepted', 'declined', 'no_response'
  UNIQUE(proposal_id, researcher_id)
);

-- ============================================
-- PROPOSAL SEARCHES TABLE
-- Track proposal analysis history and extracted data
-- ============================================
CREATE TABLE IF NOT EXISTS proposal_searches (
  id SERIAL PRIMARY KEY,
  proposal_title TEXT,
  proposal_hash VARCHAR(64),
  author_institution VARCHAR(255),
  claude_suggestions JSONB,
  search_queries JSONB,
  verified_count INTEGER DEFAULT 0,
  discovered_count INTEGER DEFAULT 0,
  selected_candidates INTEGER[],
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  -- V6: Summary attachments and Co-PI tracking
  summary_blob_url VARCHAR(500),  -- Vercel Blob URL for extracted summary page(s)
  summary_filename VARCHAR(255),
  summary_pages VARCHAR(50),  -- e.g., "2" or "1,2"
  full_proposal_blob_url VARCHAR(500),  -- Original uploaded proposal
  co_investigators TEXT,  -- Comma-separated Co-PI names
  co_investigator_count INTEGER
);

-- ============================================
-- INDEXES FOR PERFORMANCE
-- ============================================
CREATE INDEX IF NOT EXISTS idx_search_cache_lookup
  ON search_cache(source, query_hash);

CREATE INDEX IF NOT EXISTS idx_search_cache_expires
  ON search_cache(expires_at);

CREATE INDEX IF NOT EXISTS idx_researchers_normalized
  ON researchers(normalized_name);

CREATE INDEX IF NOT EXISTS idx_researchers_email
  ON researchers(email);

CREATE INDEX IF NOT EXISTS idx_researchers_updated
  ON researchers(last_updated);

CREATE INDEX IF NOT EXISTS idx_publications_researcher
  ON publications(researcher_id);

CREATE INDEX IF NOT EXISTS idx_publications_date
  ON publications(publication_date DESC);

CREATE INDEX IF NOT EXISTS idx_publications_doi
  ON publications(doi);

CREATE INDEX IF NOT EXISTS idx_keywords_researcher
  ON researcher_keywords(researcher_id);

CREATE INDEX IF NOT EXISTS idx_keywords_keyword
  ON researcher_keywords(keyword);

CREATE INDEX IF NOT EXISTS idx_suggestions_proposal
  ON reviewer_suggestions(proposal_id);

CREATE INDEX IF NOT EXISTS idx_suggestions_researcher
  ON reviewer_suggestions(researcher_id);

-- ============================================
-- HELPER FUNCTIONS
-- ============================================

-- Function to clean up expired cache entries
CREATE OR REPLACE FUNCTION cleanup_expired_cache()
RETURNS INTEGER AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM search_cache WHERE expires_at < CURRENT_TIMESTAMP;
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- EXTERNAL-REVIEWER RATE LIMITING (security audit A6)
-- ============================================

-- Fixed-window counters for the public token routes
-- /api/external/review/[token]/* . Bucket scope is encoded in the
-- bucket_key prefix: 'tok:<sha256(jwt)>' (per-token) or 'ip:<addr>' (per-IP).
-- invalid_count tracks per-IP token-verification failures and feeds the
-- invalid-token-spike system_alerts entry. See migration
-- 010_external_rate_limit.sql.
CREATE TABLE IF NOT EXISTS external_rate_limit (
  bucket_key    TEXT NOT NULL,
  window_start  TIMESTAMPTZ NOT NULL,
  hit_count     INTEGER NOT NULL DEFAULT 0,
  invalid_count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (bucket_key, window_start)
);

CREATE INDEX IF NOT EXISTS idx_external_rate_limit_window
  ON external_rate_limit(window_start);
