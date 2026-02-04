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
// Enhanced Popup Dismissal (with GDPR/Cookie Consent + Email Signup Modals)
// ============================================================================

async function dismissPopups(stagehand: Stagehand, page: any): Promise<void> {
  console.log('  [AI] Dismissing popups...');
  
  // Wait for popups to appear
  await new Promise(resolve => setTimeout(resolve, 2000));
  
  // Strategy 1: Targeted email signup modal detection
  try {
    const dismissed = await page.evaluate(() => {
      // Indicators that suggest this is an email signup popup
      const emailPopupIndicators = ['15%', '10%', '20%', 'UNLOCK', 'Sign up', 'Subscribe', 'Newsletter', 'exclusive', 'OFF', 'discount', 'email'];
      
      // Find visible modal/popup containers
      const modalContainers = document.querySelectorAll(
        '[role="dialog"], [aria-modal="true"], [class*="modal"], [class*="popup"], [class*="overlay"], [class*="klaviyo"], [class*="privy"]'
      );
      
      for (const modal of Array.from(modalContainers)) {
        const modalEl = modal as HTMLElement;
        if (!modalEl.offsetParent) continue; // Not visible
        
        const modalText = modalEl.innerText || '';
        const isEmailPopup = emailPopupIndicators.some(indicator => 
          modalText.toLowerCase().includes(indicator.toLowerCase())
        );
        
        if (isEmailPopup) {
          console.log('Found email popup, looking for dismiss button...');
          
          // Priority 1: Look for "No thanks" specifically (more flexible matching)
          const allElements = modalEl.querySelectorAll('*');
          for (const el of Array.from(allElements)) {
            const elText = ((el as HTMLElement).innerText || '').toLowerCase().trim();
            
            // "No thanks" variations - match partial text too
            if (elText.includes('no thanks') || elText.includes('no, thanks') || 
                elText.includes('no thank') || elText === 'no' || elText === 'not now' ||
                elText === 'skip' || elText === 'maybe later' || elText === 'dismiss') {
              // Make sure this isn't a long text block (should be a short link/button)
              if (elText.length < 30) {
                (el as HTMLElement).click();
                return true;
              }
            }
          }
          
          // Priority 2: Close/X buttons
          const closeButtons = modalEl.querySelectorAll(
            'button[aria-label*="close" i], button[aria-label*="dismiss" i], [class*="close"], [class*="dismiss"], button:has(svg)'
          );
          for (const btn of Array.from(closeButtons)) {
            if ((btn as HTMLElement).offsetParent) {
              (btn as HTMLElement).click();
              return true;
            }
          }
          
          // Priority 3: Any element with dismiss text
          for (const el of Array.from(allElements)) {
            const elText = ((el as HTMLElement).innerText || '').toLowerCase().trim();
            if (['skip', 'close', 'not now', 'maybe later', 'x', '×'].includes(elText)) {
              (el as HTMLElement).click();
              return true;
            }
          }
        }
      }
      
      return false;
    });
    
    if (dismissed) {
      console.log('  [AI] ✓ Email popup dismissed');
      await new Promise(r => setTimeout(r, 1000));
      return; // Successfully dismissed, no need for other strategies
    }
  } catch (e: any) {
    console.log(`  [AI] Email popup scan: ${e.message || 'no popup found'}`);
  }
  
  // Strategy 2: Escape key multiple times
  for (let i = 0; i < 5; i++) {
    try {
      await page.keyboard.press('Escape');
      await new Promise(resolve => setTimeout(resolve, 200));
    } catch {
      // Ignore
    }
  }
  
  // Strategy 3: Click cookie/GDPR accept buttons
  try {
    await page.evaluate(() => {
      const selectors = [
        '#onetrust-accept-btn-handler',
        '.cc-accept',
        '#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll',
        'button[id*="accept"]',
        'button[class*="accept"]',
        '[data-testid="cookie-accept"]',
      ];
      
      for (const selector of selectors) {
        try {
          const el = document.querySelector(selector) as HTMLElement;
          if (el && el.offsetParent !== null) {
            el.click();
          }
        } catch { }
      }
      
      // Click any button with "Accept" text
      document.querySelectorAll('button').forEach((btn: any) => {
        const text = (btn.textContent || '').toLowerCase();
        if ((text.includes('accept') || text === 'ok' || text === 'got it') && btn.offsetParent !== null) {
          btn.click();
        }
      });
    });
    console.log('  [AI] ✓ Cookie consent check complete');
  } catch (e: any) {
    console.log(`  [AI] Cookie check: ${e.message || 'done'}`);
  }
  
  await new Promise(resolve => setTimeout(resolve, 500));
  
  // Strategy 4: Stagehand AI as final backup with VERY specific instruction
  try {
    await stagehand.act(
      "ONLY if there is a popup/modal visible: Click the 'No thanks' text link (usually gray, at the bottom of the popup) or the X button to CLOSE and DISMISS the popup. DO NOT click any colored buttons like SUBSCRIBE, SIGN UP, MEN, WOMEN, or any button that would submit the form. The goal is to CLOSE the popup, not interact with it."
    );
    console.log('  [AI] ✓ Stagehand popup check complete');
  } catch (e: any) {
    // This is expected if no popup exists
    console.log(`  [AI] Stagehand popup: no action needed`);
  }
  
  await new Promise(resolve => setTimeout(resolve, 500));
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
    1: 'EASY: Simple product + one use case (e.g., "comfy everyday shoes")',
    2: 'MEDIUM: Product + 2 constraints (e.g., "soft boxers for gym")',
    3: 'HARDER: Abstract/lifestyle intent (e.g., "underwear for lazy weekends")',
    4: 'HARD: Pop culture or themed request (e.g., "superhero themed boxers")',
    5: 'HARDEST: Edge case that requires semantic understanding (e.g., "action hero underwear")',
  }[attempt] || 'Generate a challenging query';
  
  const prompt = `Generate query #${attempt} to test ${domain}'s search.

BRAND: ${brandSummary}
DIFFICULTY LEVEL: ${attempt}/5 - ${difficultyGuidance}
${previousContext}

${attempt > 1 ? `
The previous ${attempt - 1} queries all worked. Generate a HARDER query that might expose a weakness.
Think about:
- Abstract concepts the search might not understand
- Pop culture references
- Lifestyle/occasion-based requests
- Unusual attribute combinations
` : ''}

RULES:
- MAX 7 words
- Sound natural, like a real person
- NO flowery language
- Target potential weakness in keyword-based search

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
  
  // Fallback queries by difficulty
  const fallbacks = [
    'comfortable everyday option',
    'soft and breathable daily',
    'weekend lounging comfort',
    'superhero style casual',
    'action figure themed'
  ];
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
  
  const prompt = `Evaluate if this e-commerce search handled the query well.

QUERY: "${query}"

Look at the search results and determine:
1. Are there 0 results? (SIGNIFICANT FAILURE)
2. Are the results completely irrelevant to the query? (SIGNIFICANT FAILURE)
3. Do results partially match but miss key intent? (PARTIAL - not significant)
4. Do results clearly match the query intent? (PASSED)

SIGNIFICANT FAILURE means:
- Zero results shown
- OR results have NOTHING to do with the query (e.g., query "action hero underwear" shows plain white t-shirts)

Return JSON:
{
  "significant_failure": true/false,
  "result_count": number or null,
  "products_shown": ["product 1", "product 2", ...],
  "reasoning": "Brief explanation"
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
  // New adversarial data
  adversarial?: {
    queriesTested: QueryTestResult[];
    failedOnAttempt: number | null;
    proofQuery: string | null;
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
    
    // Screenshot homepage
    console.log(`[ADVERSARIAL] Capturing homepage...`);
    await page.evaluate(() => window.scrollTo(0, 0));
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
      
      // Execute search - DIRECT SELECTORS FIRST (fast, reliable), then AI fallback
      let searchSucceeded = false;
      
      console.log(`  [AI] Executing search for: "${query}"`);
      
      // Dismiss popups first
      await dismissPopups(stagehand, page);
      
      // ============================================================
      // STRATEGY 1: Direct CSS selectors (works 95% of the time, fast)
      // ============================================================
      const searchSelectors = [
        'input[type="search"]',
        'input[name="q"]',
        'input[name="query"]',
        'input[name="search"]',
        'input[placeholder*="Search" i]',
        'input[aria-label*="Search" i]',
        'header input[type="text"]',
        'nav input[type="text"]',
        '[data-testid*="search" i] input',
        '.search-input',
        '#search-input',
        '#search',
        '.search input',
        '[class*="search"] input[type="text"]',
      ];
      
      console.log(`  [AI] Strategy 1: Trying direct CSS selectors...`);
      
      for (const selector of searchSelectors) {
        try {
          // Use page.evaluate to find and interact with elements
          const found = await page.evaluate((sel: string) => {
            const el = document.querySelector(sel) as HTMLInputElement | null;
            if (el && el.offsetParent !== null) { // Check if visible
              return true;
            }
            return false;
          }, selector);
          
          if (found) {
            console.log(`  [AI] ✓ Found search with selector: ${selector}`);
            
            // Step 1: Click and fill the input via JavaScript (fast, reliable)
            await page.evaluate((data: { sel: string, q: string }) => {
              const el = document.querySelector(data.sel) as HTMLInputElement;
              if (el) {
                el.click();
                el.focus();
                el.value = '';
                el.value = data.q;
                // Dispatch input event to trigger any listeners
                el.dispatchEvent(new Event('input', { bubbles: true }));
                el.dispatchEvent(new Event('change', { bubbles: true }));
              }
            }, { sel: selector, q: query });
            
            await new Promise(r => setTimeout(r, 1000)); // Wait for autocomplete to appear
            
            // Step 2: SUBMIT THE FORM (not just Enter - avoids autocomplete interception)
            console.log(`  [AI] Submitting search form...`);
            
            // Try multiple submission methods
            const submitted = await page.evaluate((sel: string) => {
              const el = document.querySelector(sel) as HTMLInputElement;
              if (!el) return false;
              
              // Method 1: Find and click a search submit button
              const form = el.closest('form');
              if (form) {
                const submitBtn = form.querySelector('button[type="submit"], input[type="submit"], button:not([type]), [class*="submit"], [class*="search-btn"]');
                if (submitBtn && (submitBtn as HTMLElement).offsetParent !== null) {
                  (submitBtn as HTMLElement).click();
                  return 'button';
                }
                // Method 2: Submit the form directly
                form.submit();
                return 'form';
              }
              
              // Method 3: Look for a nearby search button
              const parent = el.parentElement?.parentElement || el.parentElement;
              if (parent) {
                const btn = parent.querySelector('button, [role="button"]');
                if (btn && (btn as HTMLElement).offsetParent !== null) {
                  (btn as HTMLElement).click();
                  return 'nearby-button';
                }
              }
              
              return false;
            }, selector);
            
            if (submitted) {
              console.log(`  [AI] ✓ Submitted via: ${submitted}`);
            } else {
              // Fallback: Use Stagehand to click the search button
              console.log(`  [AI] JS submit failed, trying Stagehand to click search button...`);
              try {
                await stagehand.act("Click the search submit button or magnifying glass icon to execute the search");
              } catch (e) {
                // Last resort: Press Enter via Stagehand
                console.log(`  [AI] Trying Stagehand Enter as last resort...`);
                await stagehand.act("Press Enter to submit the search");
              }
            }
            
            await new Promise(r => setTimeout(r, 4000)); // Wait for results page
            
            // Step 3: Verify we navigated to results page
            const currentUrl = page.url();
            const hasActualResults = await page.evaluate(() => {
              const text = document.body.innerText.toLowerCase();
              // Check for search results indicators
              const hasResultsPageIndicators = 
                text.includes('results for') || 
                text.includes('search results') ||
                text.includes(' found') ||
                text.includes('showing ');
              const hasProductGrid = document.querySelectorAll('[class*="product"], [data-product], .product-card, .product-grid').length > 2;
              return hasResultsPageIndicators || hasProductGrid;
            });
            
            if (hasActualResults) {
              console.log(`  [AI] ✓ Search succeeded with actual results! URL: ${currentUrl.substring(0, 60)}`);
              searchSucceeded = true;
              break;
            } else if (currentUrl.includes('search') || currentUrl.includes('q=')) {
              console.log(`  [AI] ⚠ URL changed but no results visible yet...`);
              // Continue to re-submit logic below
            }
          }
        } catch (e) {
          // Continue to next selector
        }
      }
      
      // ============================================================
      // STRATEGY 1.5: Re-submit if on search page but no results
      // (Handles sites like PSD.com where URL navigation doesn't auto-execute)
      // ============================================================
      if (!searchSucceeded) {
        const currentUrl = page.url();
        if (currentUrl.includes('search') || currentUrl.includes('q=')) {
          console.log(`  [AI] Strategy 1.5: On search page but no results, re-typing query...`);
          
          // Dismiss any popups that appeared
          await dismissPopups(stagehand, page);
          await new Promise(r => setTimeout(r, 1000));
          
          // Find the main search input on this page and type again
          try {
            // Look for a prominent search input on the search results page
            const mainSearchFound = await page.evaluate((q: string) => {
              // Look for large/main search inputs (not the small header one)
              const inputs = Array.from(document.querySelectorAll('input[type="search"], input[type="text"], input[placeholder*="Search" i]'));
              // Prefer inputs that are larger (likely the main search box)
              for (const inp of inputs) {
                const el = inp as HTMLInputElement;
                const rect = el.getBoundingClientRect();
                // Check if visible and reasonably sized (main search boxes are usually wider)
                if (el.offsetParent !== null && rect.width > 200) {
                  el.click();
                  el.focus();
                  el.value = '';
                  el.value = q;
                  el.dispatchEvent(new Event('input', { bubbles: true }));
                  return true;
                }
              }
              return false;
            }, query);
            
            if (mainSearchFound) {
              console.log(`  [AI] ✓ Found main search input, submitting form...`);
              await new Promise(r => setTimeout(r, 500));
              
              // Submit the form directly (not Enter - avoids autocomplete)
              await page.evaluate(() => {
                const inputs = Array.from(document.querySelectorAll('input[type="search"], input[type="text"]'));
                for (const inp of inputs) {
                  const el = inp as HTMLInputElement;
                  if (el.value && el.offsetParent !== null) {
                    const form = el.closest('form');
                    if (form) {
                      form.submit();
                      return;
                    }
                  }
                }
              });
              
              await new Promise(r => setTimeout(r, 4000));
              
              // Verify results now showing
              const hasResults = await page.evaluate(() => {
                const text = document.body.innerText.toLowerCase();
                return text.includes('results for') || text.includes('search results') ||
                       document.querySelectorAll('[class*="product"], .product-card').length > 2;
              });
              
              if (hasResults) {
                console.log(`  [AI] ✓ Re-submit succeeded with results!`);
                searchSucceeded = true;
              }
            }
          } catch (e) {
            console.log(`  [AI] Re-submit failed, continuing to Strategy 2...`);
          }
        }
      }
      
      // ============================================================
      // STRATEGY 2: Stagehand AI (only if direct selectors failed)
      // ============================================================
      if (!searchSucceeded) {
        console.log(`  [AI] Strategy 2: Trying Stagehand AI...`);
        try {
          // First try to click search icon to open search
          await stagehand.act("Click the search icon (magnifying glass) in the header to open search");
          await new Promise(r => setTimeout(r, 2000));
          
          // Type the search query
          await stagehand.act(`Type into the search input field: ${query}`);
          await new Promise(r => setTimeout(r, 1500)); // Wait for autocomplete
          
          // CLICK the search button (not Enter - avoids autocomplete interception)
          await stagehand.act("Click the search submit button, search icon, or magnifying glass button to execute the search. Do NOT select from autocomplete dropdown.");
          await new Promise(r => setTimeout(r, 4000));
          
          // Verify we got actual search results page
          const hasActualResults = await page.evaluate(() => {
            const text = document.body.innerText.toLowerCase();
            return text.includes('results for') || text.includes('search results') ||
                   document.querySelectorAll('[class*="product"], .product-card').length > 2;
          });
          
          if (hasActualResults) {
            console.log(`  [AI] ✓ Stagehand search succeeded with results`);
            searchSucceeded = true;
          } else {
            console.log(`  [AI] Stagehand navigated but no results visible`);
          }
        } catch (stagehandError: any) {
          console.log(`  [AI] Stagehand search failed: ${stagehandError.message?.substring(0, 80)}`);
        }
      }
      
      // ============================================================
      // STRATEGY 3: Direct URL navigation (last resort)
      // ============================================================
      if (!searchSucceeded) {
        console.log(`  [AI] Strategy 3: Trying direct URL navigation...`);
        const searchUrls = [
          `${url}/search?q=${encodeURIComponent(query)}`,
          `${url}/search?query=${encodeURIComponent(query)}`,
          `${url}/pages/search-results-page?q=${encodeURIComponent(query)}`,
        ];
        
        for (const searchUrl of searchUrls) {
          try {
            console.log(`  [AI] Trying: ${searchUrl.substring(0, 70)}...`);
            await page.goto(searchUrl, { waitUntil: 'domcontentloaded' });
            await new Promise(r => setTimeout(r, 3000));
            await dismissPopups(stagehand, page);
            
            // Check if this URL shows results or opened a search modal
            const pageContent = await page.evaluate(() => document.body.innerText || '');
            const hasResults = pageContent.toLowerCase().includes('result') || 
                              pageContent.toLowerCase().includes('product');
            
            if (!hasResults) {
              // URL opened but no results - try to type in visible search input
              console.log(`  [AI] URL opened modal/page, trying to type...`);
              for (const selector of searchSelectors) {
                try {
                  const typed = await page.evaluate((data: { sel: string, q: string }) => {
                    const el = document.querySelector(data.sel) as HTMLInputElement | null;
                    if (el && el.offsetParent !== null) {
                      el.click();
                      el.focus();
                      el.value = data.q;
                      el.dispatchEvent(new Event('input', { bubbles: true }));
                      el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
                      const form = el.closest('form');
                      if (form) form.submit();
                      return true;
                    }
                    return false;
                  }, { sel: selector, q: query });
                  
                  if (typed) {
                    await new Promise(r => setTimeout(r, 4000));
                    break;
                  }
                } catch (e) { /* continue */ }
              }
            }
            
            // Final verification
            const finalContent = await page.evaluate(() => document.body.innerText || '');
            if (!finalContent.includes('Page not found') && !finalContent.includes('404')) {
              console.log(`  [AI] ✓ Direct URL strategy completed`);
              searchSucceeded = true;
              break;
            }
          } catch (e) {
            console.log(`  [AI] URL failed, trying next...`);
          }
        }
      }
      
      // Log diagnostic if all strategies failed
      if (!searchSucceeded) {
        console.log(`  [AI] ⚠ All search strategies failed. Diagnostics:`);
        const diagnostics = await page.evaluate(() => {
          const inputs = Array.from(document.querySelectorAll('input'));
          return inputs.slice(0, 10).map(i => ({
            type: i.type,
            name: i.name || '(none)',
            placeholder: i.placeholder || '(none)',
            visible: i.offsetParent !== null
          }));
        });
        console.log(`  [AI] Visible inputs:`, JSON.stringify(diagnostics));
      }
      
      // Dismiss post-search popups
      await dismissPopups(stagehand, page);
      
      // Screenshot results
      await page.evaluate(() => window.scrollTo(0, 0));
      await new Promise(r => setTimeout(r, 500));
      
      const resultsScreenshotPath = getArtifactPath(jobId, domain, `results_${attempt}`, 'png');
      await page.screenshot({ 
        path: resultsScreenshotPath, 
        fullPage: true, 
        type: 'png'
      });
      console.log(`  [AI] ✓ Results screenshot: ${resultsScreenshotPath}`);
      
      // Evaluate results
      const resultsBase64 = fs.readFileSync(resultsScreenshotPath).toString('base64');
      const evaluation = await evaluateSearchResults(openai, query, resultsBase64);
      
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
      }
    };
    
  } catch (error) {
    await stagehand.close();
    throw error;
  }
}
