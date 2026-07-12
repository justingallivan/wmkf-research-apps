-- ============================================
-- Expert Reviewers Pro - Database Schema
-- ============================================
-- This schema supports multi-source reviewer search with caching
-- Tables: search_cache, external_rate_limit
-- (researchers, publications, researcher_keywords, reviewer_suggestions, proposal_searches
-- dropped 2026-06-04 by migration 018_drop_reviewer_finder_postgres_tables.sql)

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
-- INDEXES FOR PERFORMANCE
-- ============================================
CREATE INDEX IF NOT EXISTS idx_search_cache_lookup
  ON search_cache(source, query_hash);

CREATE INDEX IF NOT EXISTS idx_search_cache_expires
  ON search_cache(expires_at);

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
