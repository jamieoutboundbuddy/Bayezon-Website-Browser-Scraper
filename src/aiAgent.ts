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

function ensureArtifactsDir(jobId: string, domain: string): string {
  const safeDomain = domain.replace(/[^a-zA-Z0-9.-]/g, '_');
  const dir = path.join(ARTIFACTS_DIR, jobId, safeDomain, 'screens');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

function getArtifactPath(jobId: string, domain: string, stage: string): string {
  const dir = ensureArtifactsDir(jobId, domain);
  return path.join(dir, `${stage}.jpg`);
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
 * Dismiss any popups/modals on the page
 * Tries multiple times to ensure all popups are closed
 */
async function dismissPopups(stagehand: Stagehand, page: any): Promise<void> {
  console.log('  [AI] Checking for popups...');
  
  // Try up to 3 times to dismiss any popups
  for (let i = 0; i < 3; i++) {
    try {
      // Take a quick screenshot to see what's on screen
      await new Promise(resolve => setTimeout(resolve, 500));
      
      // Ask AI to close any visible popup
      const result = await stagehand.act(
        "Look at the page. If you see any popup, modal, cookie banner, newsletter signup, or overlay that is blocking the main content, close it by clicking the X button, 'Close' button, 'Accept' button, 'Got it' button, or clicking outside the popup. If no popup is visible, do nothing."
      );
      
      console.log(`  [AI] Popup check ${i + 1}: ${result.success ? 'action taken' : 'no popup found'}`);
      
      if (!result.success) {
        // No popup found, we're done
        break;
      }
      
      // Wait a bit for the popup to close
      await new Promise(resolve => setTimeout(resolve, 1000));
      
    } catch (e: any) {
      console.log(`  [AI] Popup check ${i + 1}: ${e.message || 'no action needed'}`);
      break;
    }
  }
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
    await page.goto(url, { waitUntil: 'networkidle' });
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Dismiss any popups
    await dismissPopups(stagehand, page);
    
    // Screenshot homepage (after popups dismissed)
    const homepageScreenshotPath = getArtifactPath(jobId, domain, 'homepage');
    await page.screenshot({ path: homepageScreenshotPath, quality: 80, type: 'jpeg', fullPage: false });
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
    
    const instruction = `Analyze this e-commerce website homepage and extract:
      1. The company/brand name
      2. What industry/category (fashion, electronics, home goods, etc.)
      3. Whether there's a search function visible (look for search icons, search bars, magnifying glass icons, or "Search" text)
      4. What type of search it is: 
         - 'visible_input' if there's a search text input already visible on the page
         - 'icon_triggered' if there's a magnifying glass icon or search icon that needs to be clicked
         - 'hamburger_menu' if search is likely hidden in a hamburger/menu
         - 'none' if no search is visible at all
      5. List the main product categories visible in the navigation
      6. Any other relevant observations about the site`;
    
    const result = await stagehand.extract(instruction, analysisSchema as any) as any;
    
    const siteProfile: AISiteProfile = {
      companyName: result.companyName || 'Unknown',
      industry: result.industry || 'Unknown',
      hasSearch: result.hasSearch ?? false,
      searchType: result.searchType || 'none',
      visibleCategories: result.visibleCategories || [],
      aiObservations: result.aiObservations || '',
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
    await page.goto(url, { waitUntil: 'networkidle' });
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Dismiss popups first
    await dismissPopups(stagehand, page);
    
    console.log(`  [AI] [${label.toUpperCase()}] Finding and using search...`);
    
    try {
      // Step 1: Find and click on search (handles both visible inputs and icons)
      console.log(`  [AI] [${label.toUpperCase()}] Step 1: Activating search...`);
      await stagehand.act(
        "Find and click on the search functionality. This could be a search input field, a magnifying glass icon, a search button, or any element that opens the search. Click on it to activate search."
      );
      
      await new Promise(resolve => setTimeout(resolve, 1500));
      
      // Step 2: Type the search query
      console.log(`  [AI] [${label.toUpperCase()}] Step 2: Typing query: "${query}"`);
      await stagehand.act(
        `Type the following text into the search input field: ${query}`
      );
      
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Step 3: Submit the search
      console.log(`  [AI] [${label.toUpperCase()}] Step 3: Submitting search...`);
      await stagehand.act(
        "Submit the search by pressing Enter or clicking the search/submit button"
      );
      
      // Wait for results to load
      console.log(`  [AI] [${label.toUpperCase()}] Waiting for results...`);
      await new Promise(resolve => setTimeout(resolve, 4000));
      
      // Dismiss any new popups that appeared
      await dismissPopups(stagehand, page);
      
      // Step 4: Screenshot results
      const screenshotPath = getArtifactPath(jobId, domain, `results_${label}`);
      
      // Scroll down slightly to show products
      await page.evaluate(() => window.scrollTo(0, 300));
      await new Promise(resolve => setTimeout(resolve, 500));
      
      await page.screenshot({ path: screenshotPath, quality: 80, type: 'jpeg', fullPage: false });
      console.log(`  [AI] [${label.toUpperCase()}] ✓ Results screenshot saved`);
      
      // Step 5: Extract what we see on the results page
      console.log(`  [AI] [${label.toUpperCase()}] Analyzing results...`);
      
      const resultsSchema = z.object({
        resultCount: z.number().nullable().describe('Approximate number of products visible, null if unclear'),
        productsFound: z.array(z.string()).describe('Names of products visible on the page'),
        searchSuccess: z.boolean().describe('Whether this looks like a successful search results page with products'),
        aiObservations: z.string().describe('Observations about the search results'),
      });
      
      const resultsInstruction = `Analyze the current page which should show search results:
        1. How many products are visible? (approximate count)
        2. List the names/titles of products you can see (up to 10)
        3. Does this look like a successful search results page with relevant products? Or is it an error page, empty results, or showing unrelated content?
        4. Any observations about the quality or relevance of results`;
        
      const resultsData = await stagehand.extract(resultsInstruction, resultsSchema as any) as any;
      
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
      console.log(`  [AI] [${label.toUpperCase()}] Search interaction failed: ${searchError.message}`);
      
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
        aiObservations: `Search interaction failed: ${searchError.message}`,
      };
    }
    
  } catch (error) {
    await stagehand.close();
    throw error;
  }
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
    console.log(`[AI-FULL] No search found on site, returning early`);
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
  
  // Wait for rate limit between sessions
  console.log(`\n[AI-FULL] Waiting for session cooldown (5s)...`);
  await new Promise(resolve => setTimeout(resolve, 5000));
  
  // Phase 3: Execute searches
  console.log(`\n[AI-FULL] Phase 3: Natural Language Search`);
  const nlResult = await aiExecuteSearch(jobId, domain, nlQuery, 'nl');
  
  // Wait between sessions
  console.log(`\n[AI-FULL] Waiting for session cooldown (5s)...`);
  await new Promise(resolve => setTimeout(resolve, 5000));
  
  console.log(`\n[AI-FULL] Phase 4: Keyword Search`);
  const kwResult = await aiExecuteSearch(jobId, domain, kwQuery, 'kw');
  
  // Phase 5: Compare and Evaluate
  console.log(`\n[AI-FULL] Phase 5: Evaluation`);
  const comparison = evaluateSearchResults({
    naturalLanguage: nlResult,
    keyword: kwResult,
    homepageScreenshotPath,
  });
  
  console.log(`\n[AI-FULL] ========================================`);
  console.log(`[AI-FULL] VERDICT: ${comparison.verdict}`);
  console.log(`[AI-FULL] Reason: ${comparison.reason}`);
  console.log(`[AI-FULL] ========================================\n`);
  
  return {
    siteProfile,
    nlQuery,
    kwQuery,
    searchResults: {
      naturalLanguage: nlResult,
      keyword: kwResult,
      homepageScreenshotPath,
    },
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
    `I need something special in ${category}, any suggestions?`,
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
  return category.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim();
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
  
  console.log(`  [AI] NL Search: ${nlRelevance} (${nl.productsFound.length} products, success: ${nl.searchSuccess})`);
  console.log(`  [AI] KW Search: ${kwRelevance} (${kw.productsFound.length} products, success: ${kw.searchSuccess})`);
  
  // Determine verdict
  let verdict: 'OUTREACH' | 'SKIP' | 'REVIEW' | 'INCONCLUSIVE';
  let reason: string;
  
  if (!nl.searchSuccess && !kw.searchSuccess) {
    verdict = 'INCONCLUSIVE';
    reason = 'Could not complete searches on this site - both searches failed';
  } else if (nlRelevance === 'none' && kwRelevance !== 'none') {
    verdict = 'OUTREACH';
    reason = `Natural language search failed (${nl.aiObservations}) but keyword search returned ${kw.productsFound.length} products`;
  } else if (nlRelevance === 'low' && (kwRelevance === 'medium' || kwRelevance === 'high')) {
    verdict = 'OUTREACH';
    reason = `Keyword search (${kw.productsFound.length} products) significantly outperforms NL search (${nl.productsFound.length} products)`;
  } else if (nlRelevance === kwRelevance) {
    verdict = 'SKIP';
    reason = `Both search types perform similarly (${nl.productsFound.length} vs ${kw.productsFound.length} products)`;
  } else if (nlRelevance === 'high') {
    verdict = 'SKIP';
    reason = `Natural language search works well - returned ${nl.productsFound.length} relevant products`;
  } else {
    verdict = 'REVIEW';
    reason = `NL: ${nlRelevance} (${nl.productsFound.length}), KW: ${kwRelevance} (${kw.productsFound.length}) - needs manual review`;
  }
  
  return { nlRelevance, kwRelevance, verdict, reason };
}

function determineRelevance(result: AISearchResult): 'high' | 'medium' | 'low' | 'none' {
  if (!result.searchSuccess) return 'none';
  if (result.resultCount === null && result.productsFound.length === 0) return 'none';
  if (result.productsFound.length >= 5) return 'high';
  if (result.productsFound.length >= 2) return 'medium';
  if (result.productsFound.length >= 1) return 'low';
  return 'none';
}
