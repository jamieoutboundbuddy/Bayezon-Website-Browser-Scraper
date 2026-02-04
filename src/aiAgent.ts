/**
 * AI-Powered Adversarial Search Testing
 * 
 * This module implements iterative adversarial testing:
 * 1. Generate progressively harder queries
 * 2. Stop on SIGNIFICANT failure (0 results or completely irrelevant)
 * 3. Report the failing query as proof of search weakness
 */

import { Stagehand } from '@browserbasehq/stagehand';
import * as fs from 'fs';
import * as path from 'path';
import OpenAI from 'openai';
import { getDb } from './db';

// ============================================================================
// Types
// ============================================================================

export interface QueryTestResult {
  query: string;
  attempt: number;
  passed: boolean;
  resultCount: number | null;
  productsFound: string[];
  reasoning: string;
  screenshotPath?: string;
}

export interface AdversarialResult {
  domain: string;
  brandSummary: string;
  verdict: 'OUTREACH' | 'SKIP' | 'REVIEW';
  proofQuery: string | null;
  failedOnAttempt: number | null;
  queriesTested: QueryTestResult[];
  screenshots: {
    homepage: string;
    failure: string | null;
  };
  reasoning: string;
  durationMs: number;
}

export interface AISiteProfile {
  companyName: string;
  industry: string;
  hasSearch: boolean;
  searchType: 'visible_input' | 'icon_triggered' | 'hamburger_menu' | 'none';
  visibleCategories: string[];
  aiObservations: string;
}

// Legacy compatibility types
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

// ============================================================================
// OpenAI Client
// ============================================================================

let openaiClient: OpenAI | null = null;

function getOpenAIClient(): OpenAI {
  if (!openaiClient) {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error('OPENAI_API_KEY environment variable is not set');
    }
    openaiClient = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });
  }
  return openaiClient;
}

// ============================================================================
// Artifact Paths
// ============================================================================

const ARTIFACTS_DIR = './artifacts';

function ensureArtifactsDir(jobId: string, domain: string): string {
  const safeDomain = domain.replace(/[^a-zA-Z0-9.-]/g, '_');
  const dir = path.join(ARTIFACTS_DIR, jobId, safeDomain, 'screens');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

function getArtifactPath(jobId: string, domain: string, stage: string, ext: 'png' | 'jpg' = 'png'): string {
  const dir = ensureArtifactsDir(jobId, domain);
  return path.join(dir, `${stage}.${ext}`);
}

// ============================================================================
// Browser Session Management
// ============================================================================

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

// ============================================================================
// Simplified Popup Dismissal - Let Stagehand AI handle it
// ============================================================================

async function dismissPopups(stagehand: Stagehand, page: any): Promise<void> {
  console.log('  [AI] Checking for popups...');
  
  // Wait for popups to appear
  await new Promise(r => setTimeout(r, 1500));
  
  try {
    // Single AI instruction handles all popup types
    await stagehand.act(
      "If there is any popup, modal, or overlay visible (like cookie consent, email signup, newsletter, or discount offer), close it by clicking the X button, 'No thanks', 'Close', 'Dismiss', or similar close button. Do NOT click subscribe, sign up, or any colored action buttons. If no popup is visible, do nothing."
    );
    console.log('  [AI] ✓ Popup check complete');
  } catch (e: any) {
    // Expected errors:
    // - "No object generated: response did not match schema" = no popup found (LLM returns {})
    // - Other schema validation errors when there's nothing to do
    // These are all fine - just means no popup was visible
    if (e.message?.includes('schema') || e.message?.includes('No object generated')) {
      // This is expected when no popup exists
    } else {
      console.log(`  [AI] Popup check: ${e.message?.substring(0, 50) || 'no action needed'}`);
    }
  }
  
  await new Promise(r => setTimeout(r, 500));
}

// ============================================================================
// Adaptive Query Generation
// ============================================================================

interface QueryGenerationContext {
  domain: string;
  brandSummary: string;
  attempt: number;
  previousQueries: QueryTestResult[];
}

async function generateNextQuery(
  openai: OpenAI,
  context: QueryGenerationContext
): Promise<string> {
  const { domain, brandSummary, attempt, previousQueries } = context;
  
  // Build context from previous attempts
  const previousContext = previousQueries.length > 0
    ? `\nPREVIOUS QUERIES (all passed - need HARDER query):\n${previousQueries.map(q => 
        `- "${q.query}" → ${q.resultCount || '?'} results, ${q.passed ? 'PASSED' : 'FAILED'}`
      ).join('\n')}`
    : '';
  
  const difficultyGuidance = {
    1: 'EASY: Product + simple use case',
    2: 'MEDIUM: Product + specific situation/condition',
    3: 'HARDER: Abstract need or lifestyle intent',
    4: 'HARD: Unusual constraint or edge case',
    5: 'HARDEST: Very specific multi-constraint need',
  }[attempt] || 'Generate a challenging query';
  
  const prompt = `Generate query #${attempt} to test ${domain}'s search.

BRAND SELLS: ${brandSummary}
DIFFICULTY: ${attempt}/5 - ${difficultyGuidance}
${previousContext}

CRITICAL: Generate queries RELEVANT to what this brand actually sells!
- If they sell casual sneakers, don't search for "formal shoes" or "dress shoes"
- If they sell underwear, don't search for "shoes" or "jackets"
- The query should be something a REAL customer of THIS brand would search

${attempt === 1 ? `
For attempt 1, test a simple natural language search that matches their products:
- Allbirds (casual shoes) → "running shoes for travel"
- PSD (underwear) → "boxers for working out"
- Fashion brand → "dress for beach wedding"
` : ''}

${attempt > 1 ? `
Previous queries passed. Try HARDER natural language that keyword search might miss:
- Weather/condition: "shoes for rainy days", "jacket for cold mornings"
- Feeling/outcome: "underwear that doesn't ride up", "shoes for standing all day"
- Lifestyle: "outfit for first date", "gift for runner"
` : ''}

RULES:
- MAX 5 words
- Must be RELEVANT to ${brandSummary}
- NO filler words: comfortable, trendy, stylish, quality, perfect, best
- Test NATURAL LANGUAGE understanding, not random products they don't sell

Return ONLY JSON:
{"query": "your search query here"}`;

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 100,
      temperature: 0.8  // Higher temp for variety
    });
    
    const content = response.choices[0]?.message?.content || '';
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const data = JSON.parse(jsonMatch[0]);
      return data.query || 'comfortable everyday products';
    }
  } catch (e: any) {
    console.error(`  [AI] Query generation failed: ${e.message}`);
  }
  
  // Fallback queries based on brand category
  const brandLower = brandSummary.toLowerCase();
  let fallbacks: string[];
  
  if (brandLower.includes('shoe') || brandLower.includes('footwear') || brandLower.includes('sneaker')) {
    fallbacks = ['shoes for travel', 'sneakers for rainy days', 'shoes for standing all day', 'running shoes that breathe', 'slip-on for errands'];
  } else if (brandLower.includes('underwear') || brandLower.includes('boxer') || brandLower.includes('brief')) {
    fallbacks = ['boxers for gym', 'underwear for hot weather', 'briefs that stay put', 'themed boxer briefs', 'superhero underwear'];
  } else if (brandLower.includes('cloth') || brandLower.includes('apparel') || brandLower.includes('fashion')) {
    fallbacks = ['outfit for interview', 'dress for beach', 'jacket for travel', 'casual friday look', 'date night outfit'];
  } else if (brandLower.includes('swim') || brandLower.includes('beach')) {
    fallbacks = ['swimsuit for surfing', 'beach cover up', 'swimwear for laps', 'bikini for vacation', 'board shorts for water park'];
  } else {
    fallbacks = ['gift for friend', 'something for travel', 'item for everyday use', 'product for summer', 'option for gifting'];
  }
  
  return fallbacks[attempt - 1] || fallbacks[0];
}

// ============================================================================
// Search Evaluation (GPT-4.1-mini for cost efficiency)
// ============================================================================

interface EvaluationResult {
  isSignificantFailure: boolean;
  resultCount: number | null;
  productsFound: string[];
  reasoning: string;
}

async function evaluateSearchResults(
  openai: OpenAI,
  query: string,
  screenshotBase64: string
): Promise<EvaluationResult> {
  
  const prompt = `Evaluate if this e-commerce search returned RELEVANT products for the query.

QUERY: "${query}"

BE STRICT about relevance. The search should understand INTENT, not just keywords.

EVALUATE:
1. Are there 0 results shown? → SIGNIFICANT FAILURE
2. Are results BLOG POSTS/GUIDES/ARTICLES instead of products? → SIGNIFICANT FAILURE
3. Are results products but WRONG for the query intent? → SIGNIFICANT FAILURE

RELEVANCE EXAMPLES:
- Query "festival outfit" → Generic midi dresses = FAIL (not festival style)
- Query "festival outfit" → Crop tops, shorts, boho styles = PASS
- Query "hiking shoes" → Dress shoes = FAIL
- Query "hiking shoes" → Trail runners, boots = PASS
- Query "beach wedding dress" → Casual sundresses = FAIL
- Query "beach wedding dress" → Flowy white/ivory dresses = PASS

SIGNIFICANT FAILURE if:
- Zero results
- Results are content/articles (not products)
- Results are products but DON'T MATCH THE INTENT of the query
- Results are generic/basic products when query asked for something specific

PASSED only if:
- Results show actual purchasable products (with prices)
- Products GENUINELY fit what someone searching that query would want

Return JSON:
{
  "significant_failure": true/false,
  "result_count": number or null,
  "result_type": "products" | "articles" | "mixed" | "none",
  "products_shown": ["product 1", "product 2", ...],
  "reasoning": "Why products do/don't match the search intent"
}`;

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4.1-mini',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            { 
              type: 'image_url',
              image_url: {
                url: `data:image/png;base64,${screenshotBase64}`,
                detail: 'low'
              }
            }
          ]
        }
      ],
      max_tokens: 300,
      temperature: 0
    });
    
    const content = response.choices[0]?.message?.content || '';
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    
    if (jsonMatch) {
      const data = JSON.parse(jsonMatch[0]);
      return {
        isSignificantFailure: data.significant_failure === true,
        resultCount: data.result_count,
        productsFound: data.products_shown || [],
        reasoning: data.reasoning || 'No reasoning provided'
      };
    }
  } catch (e: any) {
    console.error(`  [AI] Evaluation failed: ${e.message}`);
    // If we can't evaluate, try with gpt-4o as fallback
    try {
      const fallbackResponse = await openai.chat.completions.create({
        model: 'gpt-4o',
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: prompt },
              { 
                type: 'image_url',
                image_url: { 
                  url: `data:image/png;base64,${screenshotBase64}`,
                  detail: 'low'
                }
              }
            ]
          }
        ],
        max_tokens: 300,
        temperature: 0
      });
      
      const content = fallbackResponse.choices[0]?.message?.content || '';
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      
      if (jsonMatch) {
        const data = JSON.parse(jsonMatch[0]);
        return {
          isSignificantFailure: data.significant_failure === true,
          resultCount: data.result_count,
          productsFound: data.products_shown || [],
          reasoning: data.reasoning || 'No reasoning provided'
        };
      }
    } catch {
      // Final fallback
    }
  }
  
  // Default to not a significant failure if we can't evaluate
  return {
    isSignificantFailure: false,
    resultCount: null,
    productsFound: [],
    reasoning: 'Could not evaluate results'
  };
}

// ============================================================================
// Main Adversarial Analysis Pipeline
// ============================================================================

const MAX_ATTEMPTS = 5;

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
  // Adversarial data
  adversarial?: {
    queriesTested: QueryTestResult[];
    failedOnAttempt: number | null;
    proofQuery: string | null;
  };
  // Clean summary for UI
  summary?: {
    narrative: string;
    queriesThatWork: string[];
    journeySteps: string[];
    queryInsight: string; // LLM-generated explanation of what the results mean
  };
}> {
  const startTime = Date.now();
  
  console.log(`\n[ADVERSARIAL] ========================================`);
  console.log(`[ADVERSARIAL] Starting adversarial analysis for: ${domain}`);
  console.log(`[ADVERSARIAL] Max ${MAX_ATTEMPTS} queries, stop on significant failure`);
  console.log(`[ADVERSARIAL] ========================================\n`);
  
  const openai = getOpenAIClient();
  const stagehand = await createStagehandSession();
  const db = getDb();
  
  const queriesTested: QueryTestResult[] = [];
  let proofQuery: string | null = null;
  let failedOnAttempt: number | null = null;
  let failureScreenshotPath: string | null = null;
  let failureReasoning = '';
  
  try {
    const url = domain.startsWith('http') ? domain : `https://${domain}`;
    const page = stagehand.context.pages()[0];
    const brandName = domain.replace(/^www\./, '').replace(/\.(com|co\.uk|net|org).*$/, '');
    
    // Setup browser
    console.log(`[ADVERSARIAL] Setting up browser...`);
    await (page as any).setViewportSize(1920, 1080);
    
    // Navigate to homepage
    console.log(`[ADVERSARIAL] Navigating to ${url}...`);
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await new Promise(r => setTimeout(r, 3000));
    
    // Dismiss popups
    await dismissPopups(stagehand, page);
    
    // Screenshot homepage - wait for images to load first
    console.log(`[ADVERSARIAL] Capturing homepage...`);
    await page.evaluate(() => window.scrollTo(0, 0));
    await new Promise(r => setTimeout(r, 1000));
    
    // Wait for images to load
    try {
      await page.evaluate(async () => {
        const images = Array.from(document.querySelectorAll('img'));
        await Promise.race([
          Promise.all(images.slice(0, 20).map(img => {
            if (img.complete) return Promise.resolve();
            return new Promise(resolve => {
              img.onload = resolve;
              img.onerror = resolve;
            });
          })),
          new Promise(resolve => setTimeout(resolve, 5000)) // Max 5s wait
        ]);
      });
    } catch {
      // Ignore image loading errors
    }
    await new Promise(r => setTimeout(r, 500));
    
    const homepageScreenshotPath = getArtifactPath(jobId, domain, 'homepage', 'png');
    await page.screenshot({ 
      path: homepageScreenshotPath, 
      fullPage: true, 
      type: 'png'
    });
    console.log(`  [AI] ✓ Homepage saved: ${homepageScreenshotPath}`);
    
    // Get brand understanding from homepage screenshot (NOT just domain name)
    let brandSummary = 'E-commerce retailer';
    try {
      const homepageBase64 = fs.readFileSync(homepageScreenshotPath).toString('base64');
      const brandResponse = await openai.chat.completions.create({
        model: 'gpt-4o',
        messages: [{ 
          role: 'user', 
          content: [
            { 
              type: 'text', 
              text: `Look at this e-commerce homepage screenshot. What is the PRIMARY PRODUCT CATEGORY this store sells?

IMPORTANT: Focus on the actual product type being sold, NOT the designs/graphics on products.
- If you see underwear with cartoon prints, they sell "underwear" not "cartoons"
- If you see t-shirts with food logos, they sell "apparel" not "food"

Answer in 2-4 words only. Examples:
- "Underwear and loungewear"
- "Athletic footwear"
- "Outdoor clothing"
- "Home furniture"` 
            },
            {
              type: 'image_url',
              image_url: {
                url: `data:image/png;base64,${homepageBase64}`,
                detail: 'low'
              }
            }
          ]
        }],
        max_tokens: 30,
        temperature: 0
      });
      brandSummary = brandResponse.choices[0]?.message?.content?.trim() || brandSummary;
    } catch (e: any) {
      console.log(`  [AI] Brand detection failed: ${e.message}, using default`);
    }
    console.log(`  [AI] Brand: ${brandSummary}`);
    
    // Build site profile
    const siteProfile: AISiteProfile = {
      companyName: brandName,
      industry: 'e-commerce',
      hasSearch: true,
      searchType: 'icon_triggered',
      visibleCategories: [],
      aiObservations: brandSummary
    };
    
    // ========================================================================
    // ADVERSARIAL TESTING LOOP
    // ========================================================================
    
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      console.log(`\n[ADVERSARIAL] ----------------------------------------`);
      console.log(`[ADVERSARIAL] Query ${attempt}/${MAX_ATTEMPTS}`);
      console.log(`[ADVERSARIAL] ----------------------------------------`);
      
      // Generate next query (adaptive based on previous results)
      const query = await generateNextQuery(openai, {
        domain,
        brandSummary,
        attempt,
        previousQueries: queriesTested
      });
      console.log(`  [AI] Testing: "${query}"`);
      
      // Navigate back to homepage for fresh search
      if (attempt > 1) {
        console.log(`  [AI] Returning to homepage...`);
        await page.goto(url, { waitUntil: 'domcontentloaded' });
        await new Promise(r => setTimeout(r, 2000));
        await dismissPopups(stagehand, page);
      }
      
      // ============================================================
      // SEARCH - Three steps: OPEN, TYPE, SUBMIT with verification
      // ============================================================
      console.log(`  [AI] Executing search for: "${query}"`);
      
      // Dismiss popups first
      await dismissPopups(stagehand, page);
      
      // Store URL before search to verify navigation
      const urlBeforeSearch = page.url();
      let searchSucceeded = false;
      
      try {
        // Step 1: Click to open search (icon, button, or input)
        console.log(`  [AI] Step 1: Opening search...`);
        await stagehand.act(
          `Click the search icon or search button in the header to open the search interface`
        );
        
        // Wait for search interface to fully appear
        await new Promise(r => setTimeout(r, 2000));
        
        // Step 2: Type into the NOW VISIBLE search input
        console.log(`  [AI] Step 2: Typing query into search input...`);
        await stagehand.act(
          `Type "${query}" into the search input field that is currently visible on the page`
        );
        
        await new Promise(r => setTimeout(r, 500));
        
        // Step 3: Submit the search by pressing Enter
        console.log(`  [AI] Step 3: Submitting search...`);
        try {
          await stagehand.act(
            `Press the Enter key on the keyboard to submit the search and navigate to results`
          );
        } catch (submitError: any) {
          // "Cannot find context" error means the page navigated - this is SUCCESS!
          if (submitError.message?.includes('Cannot find context') || 
              submitError.message?.includes('context with specified id')) {
            console.log(`  [AI] ✓ Page navigated (context destroyed) - search likely succeeded`);
          } else {
            console.log(`  [AI] Submit error (will verify URL): ${submitError.message?.substring(0, 60)}`);
          }
        }
        
        // Wait for results page to load (important after navigation)
        await new Promise(r => setTimeout(r, 4000));
        
        // Get fresh page reference after potential navigation
        const pages = stagehand.context.pages();
        const currentPage = pages[pages.length - 1] || page;
        
        // Verify URL has changed (indicates navigation to results page)
        const urlAfterSearch = currentPage.url();
        console.log(`  [AI] URL before: ${urlBeforeSearch}`);
        console.log(`  [AI] URL after: ${urlAfterSearch}`);
        
        if (urlAfterSearch !== urlBeforeSearch) {
          console.log(`  [AI] ✓ URL changed - search navigated to results`);
          searchSucceeded = true;
        } else {
          console.log(`  [AI] ⚠ URL unchanged - trying click submit button...`);
          
          // Try clicking a submit button instead
          try {
            await stagehand.act(
              `Click the search submit button or magnifying glass icon to submit the search`
            );
            await new Promise(r => setTimeout(r, 3000));
            
            const urlAfterRetry = currentPage.url();
            if (urlAfterRetry !== urlBeforeSearch) {
              console.log(`  [AI] ✓ Click submit worked - navigated to results`);
              searchSucceeded = true;
            }
          } catch {
            // Continue to fallback
          }
        }
        
        // Fallback: Direct URL navigation if still on homepage
        if (!searchSucceeded) {
          console.log(`  [AI] ⚠ Trying direct URL navigation as fallback...`);
          const encodedQuery = encodeURIComponent(query);
          // FIX: Ensure proper slash between domain and "search"
          const baseUrl = url.endsWith('/') ? url : url + '/';
          const searchUrl = `${baseUrl}search?q=${encodedQuery}`;
          console.log(`  [AI] Fallback URL: ${searchUrl}`);
          try {
            await currentPage.goto(searchUrl, { waitUntil: 'domcontentloaded' });
            await new Promise(r => setTimeout(r, 3000));
            
            const urlAfterFallback = currentPage.url();
            if (urlAfterFallback.includes('search')) {
              console.log(`  [AI] ✓ Direct URL fallback succeeded`);
              searchSucceeded = true;
            }
          } catch {
            console.log(`  [AI] ⚠ Direct URL fallback failed`);
          }
        }
        
        // Final verification - check for results on page
        const hasResults = await currentPage.evaluate(() => {
          const text = document.body.innerText.toLowerCase();
          return text.includes('result') || text.includes('product') || 
                 text.includes('showing') || text.includes('found') ||
                 document.querySelectorAll('[class*="product"], .product-card, .product-grid').length > 0;
        });
        
        const verifiedUrl = currentPage.url();
        console.log(`  [AI] Final URL: ${verifiedUrl}`);
        console.log(`  [AI] Has results indicators: ${hasResults}`);
        console.log(`  [AI] Search succeeded: ${searchSucceeded}`);
        
      } catch (e: any) {
        console.log(`  [AI] Search failed: ${e.message?.substring(0, 80)}`);
      }
      
      // Get the current page after potential navigation (page context may have changed)
      const pagesAfterSearch = stagehand.context.pages();
      const activePage = pagesAfterSearch[pagesAfterSearch.length - 1] || page;
      
      // Dismiss post-search popups
      await dismissPopups(stagehand, activePage);
      
      // Check if we're still on homepage (search navigation failed)
      const finalUrl = activePage.url();
      const stillOnHomepage = finalUrl === urlBeforeSearch || 
                              finalUrl === url || 
                              (finalUrl.replace(/\/$/, '') === url.replace(/\/$/, ''));
      
      if (stillOnHomepage) {
        console.log(`  [AI] ⚠ STILL ON HOMEPAGE - Search navigation completely failed`);
      } else {
        console.log(`  [AI] ✓ On results page: ${finalUrl}`);
      }
      
      // Wait for images to load before screenshot
      console.log(`  [AI] Waiting for images to load...`);
      await activePage.evaluate(() => window.scrollTo(0, 0));
      await new Promise(r => setTimeout(r, 1000));
      
      // Wait for images to actually load
      try {
        await activePage.evaluate(async () => {
          const images = Array.from(document.querySelectorAll('img'));
          await Promise.race([
            Promise.all(images.slice(0, 20).map(img => {
              if (img.complete) return Promise.resolve();
              return new Promise(resolve => {
                img.onload = resolve;
                img.onerror = resolve;
              });
            })),
            new Promise(resolve => setTimeout(resolve, 5000)) // Max 5s wait
          ]);
        });
      } catch {
        // Ignore image loading errors
      }
      await new Promise(r => setTimeout(r, 1000)); // Extra buffer
      
      // Check for error page BEFORE screenshot
      const pageContent = await activePage.evaluate(() => document.body?.innerText || '');
      const isErrorPage = pageContent.includes("This site can't be reached") ||
                          pageContent.includes("ERR_") ||
                          pageContent.includes("404") ||
                          pageContent.includes("Page not found") ||
                          pageContent.includes("cannot be displayed") ||
                          pageContent.includes("Connection failed");
      
      if (isErrorPage) {
        console.log(`  [AI] ⚠ ERROR PAGE DETECTED - Navigation failed completely`);
        console.log(`  [AI] Attempting to return to homepage and retry...`);
        
        // Try to recover - go back to homepage
        try {
          await activePage.goto(url, { waitUntil: 'domcontentloaded' });
          await new Promise(r => setTimeout(r, 2000));
        } catch {
          // Ignore recovery errors
        }
      }
      
      const resultsScreenshotPath = getArtifactPath(jobId, domain, `results_${attempt}`, 'png');
      await activePage.screenshot({ 
        path: resultsScreenshotPath, 
        fullPage: true, 
        type: 'png'
      });
      console.log(`  [AI] ✓ Results screenshot: ${resultsScreenshotPath}`);
      
      // Evaluate results - handle different failure cases
      let evaluation;
      if (isErrorPage) {
        console.log(`  [AI] Marking as SYSTEM ERROR - page couldn't load (not a search failure)`);
        evaluation = {
          isSignificantFailure: false, // Don't count as search failure - it's a system error
          resultCount: null,
          productsFound: [],
          reasoning: 'SYSTEM ERROR: Page failed to load (ERR_TUNNEL_CONNECTION_FAILED or similar). This is not a search quality issue.'
        };
        // Skip this query and continue to next - don't count it
        continue;
      } else if (stillOnHomepage) {
        console.log(`  [AI] Marking as failure - screenshot is homepage, not search results`);
        evaluation = {
          isSignificantFailure: true,
          resultCount: 0,
          productsFound: [],
          reasoning: 'Search execution failed - never navigated to search results page (still on homepage)'
        };
      } else {
        const resultsBase64 = fs.readFileSync(resultsScreenshotPath).toString('base64');
        evaluation = await evaluateSearchResults(openai, query, resultsBase64);
      }
      
      console.log(`  [AI] Result count: ${evaluation.resultCount ?? 'unknown'}`);
      console.log(`  [AI] Significant failure: ${evaluation.isSignificantFailure}`);
      console.log(`  [AI] Reasoning: ${evaluation.reasoning}`);
      
      // Record result
      const testResult: QueryTestResult = {
        query,
        attempt,
        passed: !evaluation.isSignificantFailure,
        resultCount: evaluation.resultCount,
        productsFound: evaluation.productsFound,
        reasoning: evaluation.reasoning,
        screenshotPath: resultsScreenshotPath
      };
      queriesTested.push(testResult);
      
      // Log to database
      if (db) {
        try {
          await db.llmLog.create({
            data: {
              jobId,
              domain,
              phase: `adversarial_query_${attempt}`,
              prompt: query,
              response: JSON.stringify(evaluation),
              model: 'gpt-4.1-mini',
              tokensUsed: null,
              durationMs: 0
            }
          });
        } catch {
          // Ignore DB errors
        }
      }
      
      // Check for significant failure - STOP if found
      if (evaluation.isSignificantFailure) {
        console.log(`\n  [AI] ✗ SIGNIFICANT FAILURE FOUND!`);
        console.log(`  [AI] Proof query: "${query}"`);
        proofQuery = query;
        failedOnAttempt = attempt;
        failureScreenshotPath = resultsScreenshotPath;
        failureReasoning = evaluation.reasoning;
        break;
      }
      
      console.log(`  [AI] ✓ Query passed, trying harder...`);
    }
    
    await stagehand.close();
    
    // ========================================================================
    // BUILD RESULT
    // ========================================================================
    
    const durationMs = Date.now() - startTime;
    
    // Determine verdict
    let verdict: 'OUTREACH' | 'SKIP' | 'REVIEW';
    let reason: string;
    
    if (proofQuery) {
      verdict = 'OUTREACH';
      reason = `Search failed on query "${proofQuery}": ${failureReasoning}`;
    } else if (queriesTested.length === MAX_ATTEMPTS) {
      verdict = 'SKIP';
      reason = `Search handled all ${MAX_ATTEMPTS} test queries successfully`;
    } else {
      verdict = 'REVIEW';
      reason = 'Analysis incomplete';
    }
    
    // ========================================================================
    // GENERATE NARRATIVE SUMMARY WITH LLM INSIGHT
    // ========================================================================
    
    // Build the journey narrative
    const journeySteps = queriesTested.map((q, i) => {
      const status = q.passed ? '✅' : '❌';
      const resultText = q.resultCount !== null ? `${q.resultCount} results` : 'unknown results';
      return `${i + 1}. "${q.query}" → ${status} ${resultText}${q.passed ? '' : ' - FAILED'}`;
    });
    
    let narrativeSummary = '';
    if (proofQuery) {
      const passedCount = queriesTested.filter(q => q.passed).length;
      narrativeSummary = `We tested ${domain}'s search with ${queriesTested.length} progressively harder queries.\n\n` +
        journeySteps.join('\n') + '\n\n' +
        `CONCLUSION: Search worked for ${passedCount} simple queries but failed on "${proofQuery}". ` +
        `This indicates the search cannot handle ${failedOnAttempt && failedOnAttempt > 2 ? 'abstract/themed' : 'natural language'} queries that real shoppers commonly use.`;
    } else {
      narrativeSummary = `We tested ${domain}'s search with ${queriesTested.length} queries of increasing difficulty.\n\n` +
        journeySteps.join('\n') + '\n\n' +
        `CONCLUSION: Search handled all test queries well. This site has robust search capabilities.`;
    }
    
    // Generate LLM insight - a richer explanation of what this means
    let queryInsight = '';
    try {
      const insightPrompt = proofQuery 
        ? `You are a search optimization expert analyzing an e-commerce site (${domain}, selling ${brandSummary}).

We tested their search with ${queriesTested.length} queries. It handled ${queriesTested.filter(q => q.passed).length} queries but FAILED on: "${proofQuery}"
Failure reason: ${failureReasoning}

Write a 2-3 sentence insight explaining:
1. Why this failure matters (lost sales opportunity)
2. The type of customer behavior this represents (people search like this!)
3. The business impact (concrete, e.g., "shoppers leave empty-handed")

Be direct, conversational, and compelling. No jargon. This is for a sales pitch showing why they need better search.`
        : `You are a search optimization expert. ${domain} (selling ${brandSummary}) passed all ${queriesTested.length} test queries.

Write a 1-2 sentence summary acknowledging their search handles natural language well, but note there may still be edge cases worth exploring.`;

      const insightResponse = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: insightPrompt }],
        max_tokens: 200,
        temperature: 0.7
      });
      
      queryInsight = insightResponse.choices[0]?.message?.content?.trim() || '';
    } catch (e: any) {
      console.log(`  [AI] Insight generation failed: ${e.message}`);
      // Fallback insight
      queryInsight = proofQuery 
        ? `When a customer searches "${proofQuery}" and gets zero results, they don't try again—they leave. This represents real revenue walking out the door.`
        : 'This site handles natural language search well across our test queries.';
    }
    
    // Generate "queries that would work" (simple keyword-based)
    const queriesThatWork = [
      `${brandSummary.split(' ')[0].toLowerCase()}`, // First word of brand summary
      `new arrivals`,
      `sale items`,
      `best sellers`,
      `${brandSummary.toLowerCase()} for men`,
      `${brandSummary.toLowerCase()} for women`
    ].filter(q => q.length > 2);
    
    console.log(`\n[ADVERSARIAL] ========================================`);
    console.log(`[ADVERSARIAL] VERDICT: ${verdict}`);
    console.log(`[ADVERSARIAL] Queries tested: ${queriesTested.length}`);
    console.log(`[ADVERSARIAL] Failed on: ${failedOnAttempt || 'none'}`);
    console.log(`[ADVERSARIAL] Duration: ${durationMs}ms`);
    console.log(`[ADVERSARIAL] ========================================\n`);
    
    // Copy the failure screenshot to 'results.png' for frontend compatibility
    const finalResultsPath = getArtifactPath(jobId, domain, 'results', 'png');
    if (failureScreenshotPath && fs.existsSync(failureScreenshotPath)) {
      fs.copyFileSync(failureScreenshotPath, finalResultsPath);
    } else if (queriesTested.length > 0 && queriesTested[queriesTested.length - 1].screenshotPath) {
      // Use last tested query's screenshot
      fs.copyFileSync(queriesTested[queriesTested.length - 1].screenshotPath!, finalResultsPath);
    }
    
    // Return in legacy format for compatibility
    const lastTest = queriesTested[queriesTested.length - 1];
    
    return {
      siteProfile,
      nlQuery: proofQuery || lastTest?.query || '',
      kwQuery: '', // No keyword search
      searchResults: {
        naturalLanguage: {
          query: proofQuery || lastTest?.query || '',
          screenshotPath: finalResultsPath,
          resultCount: lastTest?.resultCount ?? null,
          productsFound: lastTest?.productsFound || [],
          searchSuccess: !proofQuery,
          aiObservations: reason
        },
        keyword: {
          query: '',
          screenshotPath: '',
          resultCount: null,
          productsFound: [],
          searchSuccess: false,
          aiObservations: 'Keyword search removed - using adversarial testing'
        },
        homepageScreenshotPath
      },
      comparison: {
        nlRelevance: proofQuery ? 'none' : 'high',
        kwRelevance: 'none',
        verdict,
        reason
      },
      adversarial: {
        queriesTested,
        failedOnAttempt,
        proofQuery
      },
      // NEW: Clean summary data
      summary: {
        narrative: narrativeSummary,
        queriesThatWork,
        journeySteps,
        queryInsight
      }
    };
    
  } catch (error) {
    await stagehand.close();
    throw error;
  }
}
