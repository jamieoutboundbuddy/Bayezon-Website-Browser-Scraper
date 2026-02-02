/**
 * TypeScript interfaces for website search tool
 */

export interface SearchScreenshot {
  stage: 'homepage' | 'navigation' | 'search_modal' | 'search_results';
  url: string;
  screenshotUrl: string;
}

export interface SearchResult {
  jobId: string;
  status: 'queued' | 'running' | 'completed' | 'failed';
  progressPct: number;
  screenshots: SearchScreenshot[];
  error?: string;
}

export interface Job {
  jobId: string;
  domain: string;
  query: string;
  status: 'queued' | 'running' | 'completed' | 'failed';
  progressPct: number;
  result: SearchResult;
  createdAt: string;
}

// ============================================
// Smart SDR Agent Types
// ============================================

// Site reconnaissance output
export interface SiteProfile {
  company: string;
  industry: string;
  visibleProducts: string[];      // Actual product names seen
  visibleCategories: string[];    // Category names from nav
  estimatedCatalogSize: 'small' | 'medium' | 'large';
  hasSearch: boolean;
  searchType: 'modal' | 'page' | 'instant' | 'unknown';
}

// Query generation output
export interface TestQueries {
  naturalLanguageQuery: string;   // "red sneakers for running"
  keywordQuery: string;           // "running shoes"
  queryBasis: 'visible_product' | 'visible_category' | 'inferred';
  expectedBehavior: string;
}

// Search result for one query
export interface SingleSearchResult {
  query: string;
  resultCount: number | null;     // null if couldn't determine
  firstTenProducts: string[];     // Product names visible
  screenshotPath: string;
  relevanceToQuery: 'all_relevant' | 'mostly_relevant' | 'mixed' | 'irrelevant' | 'none';
}

// Dual search comparison
export interface DualSearchResult {
  homepage: { screenshotPath: string; url: string };
  naturalLanguage: SingleSearchResult;
  keyword: SingleSearchResult;
}

// Final comparison analysis
export interface ComparisonAnalysis {
  nlResultCount: number | null;
  nlRelevance: string;
  nlProductsShown: string[];
  kwResultCount: number | null;
  kwRelevance: string;
  kwProductsShown: string[];
  missedProducts: string[];       // Products KW found that NL missed
  verdict: 'OUTREACH' | 'SKIP' | 'REVIEW' | 'INCONCLUSIVE';
  verdictReason: string;
}

// Confidence assessment
export interface Confidence {
  level: 'high' | 'medium' | 'low';
  reasons: string[];
}

// Complete smart analysis result
export interface SmartAnalysisResult {
  jobId: string;
  domain: string;
  siteProfile: SiteProfile;
  queriesTested: TestQueries;
  comparison: ComparisonAnalysis;
  confidence: Confidence;
  emailHook: string | null;
  screenshotUrls: Record<string, string>;
  durationMs: number;
}
