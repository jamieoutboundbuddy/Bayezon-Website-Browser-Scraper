/**
 * AI-Powered Browser Agent using Stagehand v3
 * 
 * This module replaces rigid CSS selectors with AI-driven browser control.
 * The agent uses vision + language models to understand pages and interact
 * with them naturally, like a human would.
 */

import { Stagehand } from '@browserbasehq/stagehand';
import { z } from 'zod';
import * as fs from 'fs';
import * as path from 'path';

// Types
export interface AISearchResult {
  query: string;
  screenshotPath: string;
  resultCount: number | null;
  productsFound: string[];
  searchSuccess: boolean;
  aiObservations: string;
}

export interface AIDualSearchResult {
  naturalLanguage: AISearchResult;
  keyword: AISearchResult;
  homepageScreenshotPath: string;
}

export interface AISiteProfile {
  companyName: string;
  industry: string;
  hasSearch: boolean;
  searchType: 'visible_input' | 'icon_triggered' | 'hamburger_menu' | 'none';
  visibleCategories: string[];
  aiObservations: string;
}

// Artifact paths
const ARTIFACTS_DIR = './artifacts';

function ensureArtifactsDir(): void {
  if (!fs.existsSync(ARTIFACTS_DIR)) {
    fs.mkdirSync(ARTIFACTS_DIR, { recursive: true });
  }
}

function getArtifactPath(jobId: string, domain: string, stage: string): string {
  ensureArtifactsDir();
  const safeDomain = domain.replace(/[^a-zA-Z0-9]/g, '_');
  return path.join(ARTIFACTS_DIR, `${jobId}_${safeDomain}_${stage}.jpg`);
}

/**
 * Create a Stagehand instance connected to Browserbase
 */
async function createStagehandSession(): Promise<Stagehand> {
  const apiKey = process.env.BROWSERBASE_API_KEY;
  const projectId = process.env.BROWSERBASE_PROJECT_ID;
  
  if (!apiKey || !projectId) {
    throw new Error('BROWSERBASE_API_KEY and BROWSERBASE_PROJECT_ID must be set');
  }

  console.log('  [AI] Creating Stagehand session...');
  
  // Stagehand v3 constructor
  const stagehand = new Stagehand({
    env: 'BROWSERBASE',
    apiKey,
    projectId,
  });

  await stagehand.init();
  console.log('  [AI] ✓ Stagehand session ready');
  
  return stagehand;
}

/**
 * AI-powered site reconnaissance
 * The AI looks at the page and tells us what it sees
 */
export async function aiAnalyzeSite(
  jobId: string,
  domain: string
): Promise<{ profile: AISiteProfile; homepageScreenshotPath: string }> {
  const stagehand = await createStagehandSession();
  
  try {
    const url = domain.startsWith('http') ? domain : `https://${domain}`;
    console.log(`  [AI] Navigating to: ${url}`);
    
    // Get the page from context and navigate
    const page = stagehand.context.pages()[0];
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    // Dismiss any popups the AI way
    try {
      await stagehand.act(
        "If there's a cookie consent popup or newsletter modal, close it by clicking the X or 'Accept' button. If no popup is visible, do nothing."
      );
    } catch (e) {
      // No popup to close
    }
    
    // Screenshot homepage
    const homepageScreenshotPath = getArtifactPath(jobId, domain, 'homepage');
    await page.screenshot({ path: homepageScreenshotPath, quality: 80, type: 'jpeg' });
    console.log(`  [AI] ✓ Homepage screenshot saved`);
    
    // Use AI to analyze the site with structured extraction
    console.log(`  [AI] Analyzing site structure...`);
    
    const analysisSchema = z.object({
      companyName: z.string().describe('The company or brand name'),
      industry: z.string().describe('The industry category like fashion, electronics, etc.'),
      hasSearch: z.boolean().describe('Whether a search function is visible'),
      searchType: z.enum(['visible_input', 'icon_triggered', 'hamburger_menu', 'none']),
      visibleCategories: z.array(z.string()).describe('Main product categories visible'),
      aiObservations: z.string().describe('Any other relevant observations'),
    });
    
    // Use the string-based extract with schema in options
    const instruction = `Analyze this e-commerce website homepage and extract:
      1. The company/brand name
      2. What industry/category (fashion, electronics, home goods, etc.)
      3. Whether there's a search function visible (look for search icons, search bars, or "Search" text)
      4. What type of search it is: 
         - 'visible_input' if there's a text input already visible
         - 'icon_triggered' if there's a magnifying glass icon that needs to be clicked
         - 'hamburger_menu' if search is likely in a hamburger/menu
         - 'none' if no search is visible
      5. List the main product categories visible in the navigation
      6. Any other relevant observations about the site`;
    
    const result = await stagehand.extract(instruction, { schema: analysisSchema });
    
    // Handle both possible return formats
    const data = 'extraction' in result ? JSON.parse(result.extraction) : result;
    
    const siteProfile: AISiteProfile = {
      companyName: data.companyName || 'Unknown',
      industry: data.industry || 'Unknown',
      hasSearch: data.hasSearch ?? false,
      searchType: data.searchType || 'none',
      visibleCategories: data.visibleCategories || [],
      aiObservations: data.aiObservations || '',
    };
    
    console.log(`  [AI] ✓ Site analyzed: ${siteProfile.companyName} (${siteProfile.industry})`);
    console.log(`  [AI]   Search: ${siteProfile.hasSearch ? siteProfile.searchType : 'none'}`);
    console.log(`  [AI]   Categories: ${siteProfile.visibleCategories.join(', ')}`);
    
    await stagehand.close();
    
    return {
      profile: siteProfile,
      homepageScreenshotPath,
    };
    
  } catch (error) {
    await stagehand.close();
    throw error;
  }
}

/**
 * AI-powered search execution
 * The AI figures out how to search on ANY site
 */
export async function aiExecuteSearch(
  jobId: string,
  domain: string,
  query: string,
  label: string
): Promise<AISearchResult> {
  const stagehand = await createStagehandSession();
  
  try {
    const url = domain.startsWith('http') ? domain : `https://${domain}`;
    console.log(`  [AI] [${label.toUpperCase()}] Navigating to: ${url}`);
    
    const page = stagehand.context.pages()[0];
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Dismiss popups
    try {
      await stagehand.act("Close any cookie consent popup or newsletter modal if present");
    } catch (e) {
      // No popup
    }
    
    // Use AI to find and interact with search
    console.log(`  [AI] [${label.toUpperCase()}] Finding search...`);
    
    try {
      // Step 1: Find and activate search
      await stagehand.act(
        "Find the search functionality on this page. If there's a search input visible, click on it. If there's a search icon (magnifying glass), click it to open the search. Focus on the search input field."
      );
      
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Step 2: Type the query
      console.log(`  [AI] [${label.toUpperCase()}] Typing query: "${query}"`);
      await stagehand.act(`Type the following search query into the search input: "${query}"`);
      
      await new Promise(resolve => setTimeout(resolve, 1500));
      
      // Step 3: Submit the search
      console.log(`  [AI] [${label.toUpperCase()}] Submitting search...`);
      await stagehand.act("Submit the search by pressing Enter or clicking the search button");
      
      // Wait for results to load
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      // Step 4: Screenshot results
      const screenshotPath = getArtifactPath(jobId, domain, `results_${label}`);
      
      // Scroll to show products
      await page.evaluate(() => window.scrollTo(0, 200));
      await new Promise(resolve => setTimeout(resolve, 500));
      
      await page.screenshot({ path: screenshotPath, quality: 80, type: 'jpeg' });
      console.log(`  [AI] [${label.toUpperCase()}] ✓ Results screenshot saved`);
      
      // Step 5: Extract what we see on the results page
      const resultsSchema = z.object({
        resultCount: z.number().nullable().describe('Approximate number of products visible, null if unclear'),
        productsFound: z.array(z.string()).describe('Names of products visible'),
        searchSuccess: z.boolean().describe('Whether this looks like successful search results'),
        aiObservations: z.string().describe('Observations about the results'),
      });
      
      const resultsInstruction = `Analyze the search results on this page:
        1. How many products are visible?
        2. List the names of the first 5-10 products you can see
        3. Does this look like a successful search results page or an error/empty page?
        4. Any observations about result quality`;
        
      const resultsResult = await stagehand.extract(resultsInstruction, { schema: resultsSchema });
      
      // Handle both possible return formats
      const resultsData = 'extraction' in resultsResult ? JSON.parse(resultsResult.extraction) : resultsResult;
      
      await stagehand.close();
      
      return {
        query,
        screenshotPath,
        resultCount: resultsData.resultCount,
        productsFound: resultsData.productsFound || [],
        searchSuccess: resultsData.searchSuccess ?? false,
        aiObservations: resultsData.aiObservations || '',
      };
      
    } catch (searchError: any) {
      console.log(`  [AI] [${label.toUpperCase()}] Search failed: ${searchError.message}`);
      
      // Take a screenshot of whatever state we're in
      const screenshotPath = getArtifactPath(jobId, domain, `results_${label}`);
      await page.screenshot({ path: screenshotPath, quality: 80, type: 'jpeg' });
      
      await stagehand.close();
      
      return {
        query,
        screenshotPath,
        resultCount: null,
        productsFound: [],
        searchSuccess: false,
        aiObservations: `Search failed: ${searchError.message}`,
      };
    }
    
  } catch (error) {
    await stagehand.close();
    throw error;
  }
}

/**
 * AI-powered dual search (NL vs Keyword)
 * Runs both searches and returns comparison data
 */
export async function aiRunDualSearch(
  jobId: string,
  domain: string,
  nlQuery: string,
  kwQuery: string
): Promise<AIDualSearchResult> {
  console.log(`[AI-DUAL] Starting AI-powered dual search for: ${domain}`);
  console.log(`[AI-DUAL] NL Query: "${nlQuery}"`);
  console.log(`[AI-DUAL] KW Query: "${kwQuery}"`);
  
  // First, capture homepage
  const stagehand = await createStagehandSession();
  const url = domain.startsWith('http') ? domain : `https://${domain}`;
  
  const page = stagehand.context.pages()[0];
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await new Promise(resolve => setTimeout(resolve, 2000));
  
  const homepageScreenshotPath = getArtifactPath(jobId, domain, 'homepage');
  await page.screenshot({ path: homepageScreenshotPath, quality: 80, type: 'jpeg' });
  console.log(`[AI-DUAL] ✓ Homepage captured`);
  
  await stagehand.close();
  
  // Wait a bit between sessions (rate limit)
  console.log(`[AI-DUAL] Waiting for session cooldown...`);
  await new Promise(resolve => setTimeout(resolve, 5000));
  
  // Run NL search
  console.log(`[AI-DUAL] Phase 1: Natural Language Search`);
  const nlResult = await aiExecuteSearch(jobId, domain, nlQuery, 'nl');
  
  // Wait between sessions
  console.log(`[AI-DUAL] Waiting for session cooldown...`);
  await new Promise(resolve => setTimeout(resolve, 5000));
  
  // Run Keyword search
  console.log(`[AI-DUAL] Phase 2: Keyword Search`);
  const kwResult = await aiExecuteSearch(jobId, domain, kwQuery, 'kw');
  
  console.log(`[AI-DUAL] ✓ Dual search completed`);
  
  return {
    naturalLanguage: nlResult,
    keyword: kwResult,
    homepageScreenshotPath,
  };
}

/**
 * Full AI-powered analysis pipeline
 * Does everything: recon, query gen, search, evaluation
 */
export async function aiFullAnalysis(
  jobId: string,
  domain: string
): Promise<{
  siteProfile: AISiteProfile;
  nlQuery: string;
  kwQuery: string;
  searchResults: AIDualSearchResult;
  comparison: {
    nlRelevance: 'high' | 'medium' | 'low' | 'none';
    kwRelevance: 'high' | 'medium' | 'low' | 'none';
    verdict: 'OUTREACH' | 'SKIP' | 'REVIEW' | 'INCONCLUSIVE';
    reason: string;
  };
}> {
  console.log(`\n[AI-FULL] ========================================`);
  console.log(`[AI-FULL] Starting AI-powered analysis for: ${domain}`);
  console.log(`[AI-FULL] ========================================\n`);
  
  // Phase 1: Reconnaissance
  console.log(`[AI-FULL] Phase 1: Site Reconnaissance`);
  const { profile: siteProfile, homepageScreenshotPath } = await aiAnalyzeSite(jobId, domain);
  
  if (!siteProfile.hasSearch) {
    return {
      siteProfile,
      nlQuery: '',
      kwQuery: '',
      searchResults: {
        naturalLanguage: { query: '', screenshotPath: '', resultCount: null, productsFound: [], searchSuccess: false, aiObservations: 'No search on site' },
        keyword: { query: '', screenshotPath: '', resultCount: null, productsFound: [], searchSuccess: false, aiObservations: 'No search on site' },
        homepageScreenshotPath,
      },
      comparison: {
        nlRelevance: 'none',
        kwRelevance: 'none',
        verdict: 'INCONCLUSIVE',
        reason: 'No search functionality detected on site',
      },
    };
  }
  
  // Phase 2: Generate queries based on what we see
  console.log(`\n[AI-FULL] Phase 2: Query Generation`);
  const nlQuery = generateNLQuery(siteProfile);
  const kwQuery = generateKWQuery(siteProfile);
  console.log(`  [AI] NL Query: "${nlQuery}"`);
  console.log(`  [AI] KW Query: "${kwQuery}"`);
  
  // Wait for rate limit
  console.log(`\n[AI-FULL] Waiting for session cooldown...`);
  await new Promise(resolve => setTimeout(resolve, 5000));
  
  // Phase 3: Dual Search
  console.log(`\n[AI-FULL] Phase 3: Dual Search Execution`);
  const searchResults = await aiRunDualSearch(jobId, domain, nlQuery, kwQuery);
  
  // Phase 4: Compare and Evaluate
  console.log(`\n[AI-FULL] Phase 4: Evaluation`);
  const comparison = evaluateSearchResults(searchResults);
  
  console.log(`\n[AI-FULL] ========================================`);
  console.log(`[AI-FULL] VERDICT: ${comparison.verdict}`);
  console.log(`[AI-FULL] Reason: ${comparison.reason}`);
  console.log(`[AI-FULL] ========================================\n`);
  
  return {
    siteProfile,
    nlQuery,
    kwQuery,
    searchResults,
    comparison,
  };
}

/**
 * Generate a natural language query based on site profile
 */
function generateNLQuery(profile: AISiteProfile): string {
  const category = profile.visibleCategories[0] || profile.industry;
  
  const templates = [
    `I'm looking for a gift for my friend who loves ${category}`,
    `What do you recommend for someone interested in ${category}?`,
    `I need something special for ${category}, any suggestions?`,
    `Looking for the best ${category} items you have`,
    `Help me find something nice in ${category}`,
  ];
  
  return templates[Math.floor(Math.random() * templates.length)];
}

/**
 * Generate a keyword query based on site profile
 */
function generateKWQuery(profile: AISiteProfile): string {
  const category = profile.visibleCategories[0] || profile.industry;
  return category.toLowerCase().replace(/[^a-z0-9\s]/g, '');
}

/**
 * Evaluate search results and determine verdict
 */
function evaluateSearchResults(results: AIDualSearchResult): {
  nlRelevance: 'high' | 'medium' | 'low' | 'none';
  kwRelevance: 'high' | 'medium' | 'low' | 'none';
  verdict: 'OUTREACH' | 'SKIP' | 'REVIEW' | 'INCONCLUSIVE';
  reason: string;
} {
  const nl = results.naturalLanguage;
  const kw = results.keyword;
  
  // Determine relevance based on what the AI observed
  const nlRelevance = determineRelevance(nl);
  const kwRelevance = determineRelevance(kw);
  
  // Determine verdict
  let verdict: 'OUTREACH' | 'SKIP' | 'REVIEW' | 'INCONCLUSIVE';
  let reason: string;
  
  if (!nl.searchSuccess && !kw.searchSuccess) {
    verdict = 'INCONCLUSIVE';
    reason = 'Could not complete searches on this site';
  } else if (nlRelevance === 'none' && kwRelevance !== 'none') {
    verdict = 'OUTREACH';
    reason = 'Natural language search failed but keyword search works - opportunity for AI search improvement';
  } else if (nlRelevance === 'low' && (kwRelevance === 'medium' || kwRelevance === 'high')) {
    verdict = 'OUTREACH';
    reason = 'Keyword search outperforms NL search significantly - good candidate for AI search';
  } else if (nlRelevance === kwRelevance) {
    verdict = 'SKIP';
    reason = 'Search performs similarly for both query types - may already have good search';
  } else if (nlRelevance === 'high') {
    verdict = 'SKIP';
    reason = 'Natural language search already works well - may already have AI search';
  } else {
    verdict = 'REVIEW';
    reason = `NL: ${nlRelevance}, KW: ${kwRelevance} - needs manual review`;
  }
  
  return { nlRelevance, kwRelevance, verdict, reason };
}

function determineRelevance(result: AISearchResult): 'high' | 'medium' | 'low' | 'none' {
  if (!result.searchSuccess) return 'none';
  if (result.resultCount === null || result.resultCount === 0) return 'none';
  if (result.productsFound.length >= 5) return 'high';
  if (result.productsFound.length >= 2) return 'medium';
  return 'low';
}
