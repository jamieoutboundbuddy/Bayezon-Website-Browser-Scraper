/**
 * Website search journey runner - Browserbase + Playwright automation
 */

import { Browser, Page, BrowserContext, chromium } from 'playwright';
import Browserbase from '@browserbasehq/sdk';
import { SearchResult, TestQueries, SingleSearchResult, DualSearchResult } from './types';
import { 
  getArtifactPath, 
  getArtifactUrl, 
  normalizeDomain,
  getDomainName,
  sleep 
} from './utils';
import { updateJobProgress, addScreenshotToJob, completeJob, failJob } from './jobs';

// Initialize Browserbase client (lazy)
let browserbaseClient: Browserbase | null = null;

function getBrowserbaseClient(): Browserbase {
  if (!browserbaseClient) {
    const apiKey = process.env.BROWSERBASE_API_KEY;
    if (!apiKey) {
      throw new Error('BROWSERBASE_API_KEY environment variable is not set');
    }
    browserbaseClient = new Browserbase({ apiKey });
  }
  return browserbaseClient;
}

const TIMEOUTS = {
  navigation: 15000,   // Reduced from 30s
  fallbackNav: 10000,  // Reduced from 20s
  element: 3000,       // Reduced from 5s
  elementShort: 1500,  // Reduced from 2s
  popupDismiss: 1000,  // Reduced from 1.5s
};

/**
 * Fast popup dismissal - just the most common ones
 */
async function dismissPopups(page: Page): Promise<void> {
  // Only the most common/effective selectors - speed over completeness
  const dismissSelectors = [
    'button:has-text("Accept")',
    'button:has-text("Accept All")',
    '#onetrust-accept-btn-handler',
    '#CybotCookiebotDialogBodyButtonAccept',
    '.cc-accept',
    'button[aria-label="Close"]',
    'button[aria-label="close"]',
    '[data-dismiss="modal"]',
    '.modal-close',
  ];
  
  let dismissed = 0;
  
  // Try each selector but don't wait long - max 500ms per
  for (const selector of dismissSelectors) {
    if (dismissed >= 2) break; // Stop after 2 dismissals - enough
    try {
      const element = page.locator(selector).first();
      const isVisible = await element.isVisible({ timeout: 500 });
      
      if (isVisible) {
        await element.click({ timeout: 500, force: true });
        dismissed++;
        await sleep(200);
      }
    } catch (e) {
      // Continue
    }
  }
  
  // Quick Escape press to close any remaining modals
  try {
    await page.keyboard.press('Escape');
  } catch (e) {
    // Ignore
  }
  
  if (dismissed > 0) {
    console.log(`    ✓ Dismissed ${dismissed} popup(s)`);
  }
}

/**
 * Create a Browserbase session and connect Playwright
 * Includes automatic retry with backoff for rate limit errors
 */
async function createBrowserbaseSession(maxRetries: number = 3): Promise<{ browser: Browser; sessionId: string }> {
  const client = getBrowserbaseClient();
  const projectId = process.env.BROWSERBASE_PROJECT_ID;
  
  if (!projectId) {
    throw new Error('BROWSERBASE_PROJECT_ID environment variable is not set');
  }
  
  let lastError: Error | null = null;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`  Creating Browserbase session... (attempt ${attempt}/${maxRetries})`);
      
      // Create a new session with longer timeout (5 minutes)
      const session = await client.sessions.create({
        projectId,
        browserSettings: {
          // Browserbase handles stealth automatically
        },
        timeout: 300, // 5 minutes
        keepAlive: false, // Don't keep alive - let it close when done
      });
      
      console.log(`  ✓ Session created: ${session.id}`);
      
      // Connect Playwright to the session
      const browser = await chromium.connectOverCDP(session.connectUrl);
      
      return { browser, sessionId: session.id };
    } catch (error: any) {
      lastError = error;
      
      // Check if it's a rate limit error (429)
      if (error?.status === 429 || error?.message?.includes('429') || error?.message?.includes('concurrent sessions')) {
        // Extract reset time from error if available, default to 30 seconds
        let waitTime = 30;
        
        // Try to extract ratelimit-reset from error
        const resetMatch = error?.message?.match(/ratelimit-reset.*?(\d+)/i) || 
                          error?.headers?.['ratelimit-reset'];
        if (resetMatch) {
          const resetValue = typeof resetMatch === 'string' ? parseInt(resetMatch) : parseInt(resetMatch[1]);
          if (!isNaN(resetValue) && resetValue > 0) {
            waitTime = Math.min(resetValue + 5, 120); // Add 5s buffer, max 2 minutes
          }
        }
        
        console.log(`  ⚠ Rate limited (concurrent session limit). Waiting ${waitTime}s before retry...`);
        
        if (attempt < maxRetries) {
          await sleep(waitTime * 1000);
          continue;
        }
      }
      
      // For other errors or final attempt, throw
      throw error;
    }
  }
  
  throw lastError || new Error('Failed to create Browserbase session after retries');
}

/**
 * Close browser (no-op for Browserbase, session auto-closes)
 */
export async function closeBrowser(): Promise<void> {
  // Browserbase sessions auto-close when disconnected
  // No global browser to manage anymore
}

/**
 * Fast page navigation - just go to the URL directly
 * No more trying multiple language variants (wastes 3+ minutes)
 */
async function safeGoto(page: Page, url: string): Promise<boolean> {
  try {
    // Use domcontentloaded for speed - don't wait for all resources
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: TIMEOUTS.navigation });
    // Short wait for JS to initialize
    await sleep(1000);
    return true;
  } catch (error) {
    console.log(`  Navigation failed for ${url}, retrying with load...`);
  }
  
  try {
    await page.goto(url, { waitUntil: 'load', timeout: TIMEOUTS.fallbackNav });
    await sleep(500);
    return true;
  } catch (error) {
    console.log(`  All navigation failed for ${url}`);
    return false;
  }
}

/**
 * Check if search input is already visible (no click needed)
 * Many sites have search inputs directly visible in the header
 */
async function isSearchInputAlreadyVisible(page: Page): Promise<boolean> {
  const inputSelectors = [
    'input[type="search"]',
    'input[name*="q" i]',
    'input[name*="search" i]',
    'input[placeholder*="search" i]',
    'input[placeholder*="Search" i]',
    'input[aria-label*="search" i]',
    'header input[class*="search"]',
    'nav input[class*="search"]',
    'input[id*="search"]',
    // Common e-commerce search patterns
    'input.search-input',
    'input.search__input',
    'input.header-search',
    '[class*="header"] input[type="text"]',
  ];

  for (const selector of inputSelectors) {
    try {
      const input = page.locator(selector).first();
      const isVisible = await input.isVisible({ timeout: 500 });
      
      if (isVisible) {
        console.log(`  ✓ Search input already visible: "${selector}"`);
        return true;
      }
    } catch (e) {
      // Continue
    }
  }
  return false;
}

/**
 * Find and click search icon/button
 */
async function findAndClickSearchIcon(page: Page): Promise<boolean> {
  // FIRST: Check if search input is already visible (no click needed)
  if (await isSearchInputAlreadyVisible(page)) {
    return true; // Input is ready, no need to click anything
  }

  const searchSelectors = [
    'button[aria-label*="search" i]',
    'button[aria-label*="Search" i]',
    'a[aria-label*="search" i]',
    '[data-testid*="search" i]',
    '.search-icon',
    '.search-button',
    '[class*="search"][class*="icon"]',
    '[class*="search"][class*="button"]',
    'button:has-text("Search")',
    'a:has-text("Search")',
    '[role="button"]:has-text("Search")',
    // SVG icons for search (magnifying glass)
    'svg[class*="search"]',
    '[class*="search"] svg',
    'button svg',
    // More generic patterns
    'header button:not([class*="cart"]):not([class*="menu"])',
  ];

  for (const selector of searchSelectors) {
    try {
      const element = page.locator(selector).first();
      const isVisible = await element.isVisible({ timeout: TIMEOUTS.elementShort });
      
      if (isVisible) {
        await element.click({ timeout: TIMEOUTS.elementShort });
        await sleep(1000);
        console.log(`  ✓ Clicked search element: "${selector}"`);
        return true;
      }
    } catch (e) {
      // Continue
    }
  }

  // Fallback: look for any element with 'search' in its attributes
  try {
    const elements = await page.$$eval('button, a, [role="button"], input, svg', (els) => {
      return els
        .map((el, idx) => ({
          index: idx,
          tag: el.tagName,
          class: el.className || '',
          id: el.id,
          ariaLabel: el.getAttribute('aria-label') || '',
          text: el.textContent?.trim() || '',
          visible: (el as HTMLElement).offsetParent !== null,
        }))
        .filter(el => {
          const searchText = `${el.class} ${el.id} ${el.ariaLabel} ${el.text}`.toLowerCase();
          return searchText.includes('search') && el.visible;
        })
        .slice(0, 5);
    });

    if (elements.length > 0) {
      const element = page.locator('button, a, [role="button"], input').nth(elements[0].index);
      await element.click({ timeout: TIMEOUTS.elementShort });
      await sleep(1000);
      console.log(`  ✓ Found search icon via fallback`);
      return true;
    }
  } catch (e) {
    console.log('  ⚠ Fallback search icon detection failed');
  }

  return false;
}

/**
 * Find search input in modal/page
 */
async function findSearchInput(page: Page): Promise<boolean> {
  const inputSelectors = [
    'input[type="search"]',
    'input[name*="q" i]',
    'input[name*="search" i]',
    'input[placeholder*="search" i]',
    'input[placeholder*="Search" i]',
    'input[aria-label*="search" i]',
    'input[class*="search"]',
    'input[id*="search"]',
  ];

  for (const selector of inputSelectors) {
    try {
      const input = page.locator(selector).first();
      const isVisible = await input.isVisible({ timeout: TIMEOUTS.elementShort });
      
      if (isVisible) {
        await input.focus();
        await sleep(500);
        console.log(`  ✓ Found search input with selector: "${selector}"`);
        return true;
      }
    } catch (e) {
      // Continue
    }
  }

  return false;
}

/**
 * Quick hover on main nav to show categories (for recall analysis)
 */
async function captureNavigationMenu(page: Page): Promise<boolean> {
  // Quick nav hover - just try main menu items
  const navSelectors = [
    'nav a:has-text("Shop")',
    'header a:has-text("Shop")', 
    'nav > ul > li:first-child > a',
    'button[aria-label*="menu" i]',
  ];
  
  for (const selector of navSelectors) {
    try {
      const element = page.locator(selector).first();
      if (await element.isVisible({ timeout: 500 })) {
        await element.hover({ timeout: 500 });
        await sleep(400);
        // Check if dropdown appeared
        const dropdown = page.locator('[class*="dropdown"], [class*="megamenu"], [role="menu"]').first();
        if (await dropdown.isVisible({ timeout: 300 })) {
          console.log('    ✓ Nav dropdown captured');
          return true;
        }
      }
    } catch (e) {
      // Continue
    }
  }
  return false;
}

/**
 * Fast scroll to load lazy content - 2 quick scrolls
 */
async function scrollToLoadContent(page: Page): Promise<void> {
  for (let i = 0; i < 2; i++) {
    await page.evaluate(() => window.scrollBy(0, window.innerHeight));
    await sleep(400);
  }
  await page.evaluate(() => window.scrollTo(0, 0));
}

/**
 * Submit search - try Enter, then button, then direct URL
 */
async function submitSearch(page: Page, query: string, domain: string): Promise<boolean> {
  try {
    const urlBefore = page.url();
    await page.keyboard.press('Enter');
    await sleep(1500); // Reduced from 3s
    const urlAfter = page.url();
    if (urlAfter !== urlBefore) {
      console.log('  ✓ Search submitted via Enter key');
      return true;
    }
  } catch (e) {
    // Continue
  }

  // Try submit button
  try {
    const button = page.locator('button[type="submit"], button:has-text("Search")').first();
    if (await button.isVisible({ timeout: 1000 })) {
      await button.click({ timeout: 1000 });
      await sleep(1000);
      console.log('  ✓ Search submitted via button');
      return true;
    }
  } catch (e) {
    // Continue
  }

  // Fallback: direct URL navigation
  try {
    const searchUrl = `${domain}/search?q=${encodeURIComponent(query)}`;
    await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: TIMEOUTS.fallbackNav });
    console.log('  ✓ Search submitted via URL');
    return true;
  } catch (e) {
    console.log('  ⚠ Search submission failed');
    return false;
  }
}

/**
 * Run search journey and capture screenshots using Browserbase
 */
export async function runSearchJourney(
  jobId: string,
  domain: string,
  query: string
): Promise<SearchResult> {
  let browser: Browser | null = null;
  let context: BrowserContext | null = null;
  let sessionId: string | null = null;
  
  const domainName = getDomainName(domain);
  const normalizedDomain = normalizeDomain(domain);
  const screenshots: SearchResult['screenshots'] = [];

  try {
    updateJobProgress(jobId, 5, 'running');
    
    // Create Browserbase session
    const session = await createBrowserbaseSession();
    browser = session.browser;
    sessionId = session.sessionId;
    
    updateJobProgress(jobId, 10, 'running');
    
    // Get the default context (Browserbase provides one)
    const contexts = browser.contexts();
    context = contexts[0] || await browser.newContext({
      locale: 'en-US',
      timezoneId: 'America/New_York',
      geolocation: { longitude: -73.935242, latitude: 40.730610 },
      permissions: ['geolocation'],
      extraHTTPHeaders: {
        'Accept-Language': 'en-US,en;q=0.9',
      },
    });
    
    const page = context.pages()[0] || await context.newPage();
    
    // Set larger viewport
    await page.setViewportSize({ width: 1280, height: 1024 });

    // Step 1: Navigate to homepage
    console.log(`[${jobId}] Navigating to homepage: ${normalizedDomain}`);
    const homepageLoaded = await safeGoto(page, normalizedDomain);
    
    if (!homepageLoaded) {
      throw new Error('Failed to load homepage');
    }

    await dismissPopups(page);

    // Screenshot homepage
    const homepagePath = getArtifactPath(jobId, domainName, 'homepage');
    await page.screenshot({ path: homepagePath, quality: 70, fullPage: false });
    const homepageScreenshot: SearchResult['screenshots'][0] = {
      stage: 'homepage',
      url: page.url(),
      screenshotUrl: getArtifactUrl(jobId, domainName, 'homepage'),
    };
    addScreenshotToJob(jobId, homepageScreenshot);
    screenshots.push(homepageScreenshot);
    console.log(`  ✓ Homepage screenshot captured`);

    updateJobProgress(jobId, 20, 'running');

    // Step 2: Capture navigation menu (for recall/catalog analysis)
    console.log(`[${jobId}] Capturing navigation menu for catalog context...`);
    const navOpened = await captureNavigationMenu(page);
    
    // Screenshot navigation/catalog
    const navigationPath = getArtifactPath(jobId, domainName, 'navigation');
    await page.setViewportSize({ width: 1280, height: 1200 });
    await page.screenshot({ path: navigationPath, quality: 70, fullPage: false });
    await page.setViewportSize({ width: 1280, height: 1024 });
    
    const navigationScreenshot: SearchResult['screenshots'][0] = {
      stage: 'navigation',
      url: page.url(),
      screenshotUrl: getArtifactUrl(jobId, domainName, 'navigation'),
    };
    addScreenshotToJob(jobId, navigationScreenshot);
    screenshots.push(navigationScreenshot);
    console.log(`  ✓ Navigation screenshot captured`);
    
    // Close any open menu
    try { await page.keyboard.press('Escape'); } catch (e) {}

    updateJobProgress(jobId, 33, 'running');

    // Step 3: Find and click search icon
    console.log(`[${jobId}] Looking for search icon...`);
    const searchIconFound = await findAndClickSearchIcon(page);
    
    if (!searchIconFound) {
      console.log('  ⚠ Search icon not found, returning homepage only');
      return {
        jobId,
        status: 'completed',
        progressPct: 33,
        screenshots,
        error: 'Search icon not found',
      };
    }

    // Step 3: Find search input and type query
    console.log(`[${jobId}] Looking for search input...`);
    const inputFound = await findSearchInput(page);
    
    if (!inputFound) {
      console.log('  ⚠ Search input not found, returning homepage only');
      return {
        jobId,
        status: 'completed',
        progressPct: 33,
        screenshots,
        error: 'Search input not found',
      };
    }

    // Type query (faster typing)
    await page.keyboard.type(query, { delay: 50 });
    
    // Wait briefly for autocomplete
    await sleep(1500);
    try {
      await page.waitForSelector('[class*="suggest"], [class*="autocomplete"], [class*="dropdown"]', { 
        timeout: 1500,
        state: 'visible' 
      });
      console.log(`  ✓ Autocomplete appeared`);
    } catch (e) {
      // No autocomplete, continue
    }

    // Screenshot search modal
    const searchModalPath = getArtifactPath(jobId, domainName, 'search_modal');
    await page.setViewportSize({ width: 1280, height: 1200 });
    await page.screenshot({ path: searchModalPath, quality: 70, fullPage: false });
    await page.setViewportSize({ width: 1280, height: 1024 });
    
    const searchModalScreenshot: SearchResult['screenshots'][0] = {
      stage: 'search_modal',
      url: page.url(),
      screenshotUrl: getArtifactUrl(jobId, domainName, 'search_modal'),
    };
    addScreenshotToJob(jobId, searchModalScreenshot);
    screenshots.push(searchModalScreenshot);
    console.log(`  ✓ Search modal screenshot captured`);

    updateJobProgress(jobId, 66, 'running');

    // Step 4: Submit search
    console.log(`[${jobId}] Submitting search for: "${query}"`);
    const searchSubmitted = await submitSearch(page, query, normalizedDomain);
    
    if (!searchSubmitted) {
      console.log('  ⚠ Search submission failed, returning partial results');
      return {
        jobId,
        status: 'completed',
        progressPct: 66,
        screenshots,
        error: 'Search submission failed',
      };
    }

    await sleep(1000);
    await dismissPopups(page);

    // Quick scroll to load results
    await scrollToLoadContent(page);

    // Screenshot search results
    const searchResultsPath = getArtifactPath(jobId, domainName, 'search_results');
    const pageHeight = await page.evaluate(() => Math.min(document.body.scrollHeight, 2500));
    await page.setViewportSize({ width: 1280, height: pageHeight });
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: searchResultsPath, quality: 70, fullPage: false });
    await page.setViewportSize({ width: 1280, height: 1024 });
    
    const searchResultsScreenshot: SearchResult['screenshots'][0] = {
      stage: 'search_results',
      url: page.url(),
      screenshotUrl: getArtifactUrl(jobId, domainName, 'search_results'),
    };
    addScreenshotToJob(jobId, searchResultsScreenshot);
    screenshots.push(searchResultsScreenshot);
    console.log(`  ✓ Search results screenshot captured (height: ${pageHeight}px)`);

    updateJobProgress(jobId, 100, 'completed');

    const result: SearchResult = {
      jobId,
      status: 'completed',
      progressPct: 100,
      screenshots,
    };

    completeJob(jobId, result);
    return result;

  } catch (error: any) {
    console.error(`[${jobId}] Error in search journey:`, error);
    const errorMessage = error?.message || 'Unknown error occurred';
    failJob(jobId, errorMessage);
    
    return {
      jobId,
      status: 'failed',
      progressPct: screenshots.length * 33,
      screenshots,
      error: errorMessage,
    };
  } finally {
    // Close browser connection (session auto-closes on Browserbase)
    if (browser) {
      try {
        await browser.close();
      } catch (e) {
        // Ignore close errors
      }
    }
    if (sessionId) {
      console.log(`  Session ${sessionId} completed`);
    }
  }
}

/**
 * Execute a single search and capture screenshot of results
 */
async function executeSearch(
  page: Page,
  query: string,
  jobId: string,
  domainName: string,
  label: string
): Promise<SingleSearchResult> {
  console.log(`  [${label.toUpperCase()}] Executing search: "${query}"`);
  
  // Find and click search icon
  const searchIconFound = await findAndClickSearchIcon(page);
  if (!searchIconFound) {
    console.log(`  ⚠ [${label.toUpperCase()}] Search icon not found`);
    return {
      query,
      resultCount: null,
      firstTenProducts: [],
      screenshotPath: '',
      relevanceToQuery: 'none'
    };
  }
  
  // Find search input
  const inputFound = await findSearchInput(page);
  if (!inputFound) {
    console.log(`  ⚠ [${label.toUpperCase()}] Search input not found`);
    return {
      query,
      resultCount: null,
      firstTenProducts: [],
      screenshotPath: '',
      relevanceToQuery: 'none'
    };
  }
  
  // Type the query
  await page.keyboard.type(query, { delay: 50 });
  await sleep(1500);
  
  // Submit search via Enter
  await page.keyboard.press('Enter');
  await sleep(2000);
  
  // Wait for results to load (but don't wait forever)
  try {
    await page.waitForSelector('[class*="product"], [class*="item"], [class*="result"], [class*="grid"]', {
      timeout: 3000,
      state: 'visible'
    });
    console.log(`  ✓ [${label.toUpperCase()}] Results loaded`);
  } catch (e) {
    console.log(`  ⚠ [${label.toUpperCase()}] Results selector not found, continuing anyway`);
  }
  
  // Dismiss any popups that appeared
  await dismissPopups(page);
  
  // Quick scroll to ensure content loads
  await scrollToLoadContent(page);
  
  // Screenshot the first results (capture what's visible without infinite scroll)
  const screenshotPath = getArtifactPath(jobId, domainName, `results_${label}`);
  
  // Get page height but cap it to show first ~10 results
  const pageHeight = await page.evaluate(() => Math.min(document.body.scrollHeight, 2000));
  await page.setViewportSize({ width: 1280, height: pageHeight });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: screenshotPath, quality: 70, fullPage: false });
  await page.setViewportSize({ width: 1280, height: 1024 });
  
  console.log(`  ✓ [${label.toUpperCase()}] Screenshot captured: ${screenshotPath}`);
  
  return {
    query,
    resultCount: null,  // LLM will determine from screenshot
    firstTenProducts: [],  // LLM will extract
    screenshotPath,
    relevanceToQuery: 'mixed'  // LLM will evaluate
  };
}

/**
 * Run dual search comparison - NL query vs Keyword query
 * Captures homepage, then runs both searches with state reset between them
 */
export async function runDualSearch(
  jobId: string,
  domain: string,
  queries: TestQueries
): Promise<DualSearchResult> {
  let browser: Browser | null = null;
  let sessionId: string | null = null;
  
  const domainName = getDomainName(domain);
  const normalizedDomain = normalizeDomain(domain);
  
  try {
    console.log(`[DUAL] Starting dual search for: ${domain}`);
    console.log(`[DUAL] NL Query: "${queries.naturalLanguageQuery}"`);
    console.log(`[DUAL] KW Query: "${queries.keywordQuery}"`);
    
    // Create Browserbase session
    const session = await createBrowserbaseSession();
    browser = session.browser;
    sessionId = session.sessionId;
    
    // Get the default context
    const contexts = browser.contexts();
    const context = contexts[0] || await browser.newContext({
      locale: 'en-US',
      timezoneId: 'America/New_York',
      extraHTTPHeaders: {
        'Accept-Language': 'en-US,en;q=0.9',
      },
    });
    
    const page = context.pages()[0] || await context.newPage();
    await page.setViewportSize({ width: 1280, height: 1024 });
    
    // Step 1: Navigate to homepage
    console.log(`[DUAL] Navigating to homepage: ${normalizedDomain}`);
    const homepageLoaded = await safeGoto(page, normalizedDomain);
    
    if (!homepageLoaded) {
      throw new Error('Failed to load homepage');
    }
    
    await dismissPopups(page);
    
    // Screenshot homepage
    const homepagePath = getArtifactPath(jobId, domainName, 'homepage');
    await page.screenshot({ path: homepagePath, quality: 70, fullPage: false });
    const homepageUrl = page.url();
    console.log(`  ✓ Homepage screenshot captured`);
    
    // Step 2: Execute Natural Language search
    console.log(`[DUAL] Phase 1: Natural Language Search`);
    const nlResult = await executeSearch(page, queries.naturalLanguageQuery, jobId, domainName, 'nl');
    
    // Step 3: RESET - Go back to homepage to clear search state
    console.log(`[DUAL] Resetting to homepage...`);
    await page.goto(normalizedDomain, { waitUntil: 'domcontentloaded', timeout: TIMEOUTS.navigation });
    await sleep(500);
    await dismissPopups(page);
    console.log(`  ✓ Reset complete`);
    
    // Step 4: Execute Keyword search
    console.log(`[DUAL] Phase 2: Keyword Search`);
    const kwResult = await executeSearch(page, queries.keywordQuery, jobId, domainName, 'kw');
    
    console.log(`[DUAL] Dual search completed successfully`);
    
    return {
      homepage: { 
        screenshotPath: homepagePath, 
        url: homepageUrl 
      },
      naturalLanguage: nlResult,
      keyword: kwResult
    };
    
  } catch (error: any) {
    console.error(`[DUAL] Error in dual search:`, error);
    throw error;
  } finally {
    // Close browser connection
    if (browser) {
      try {
        await browser.close();
      } catch (e) {
        // Ignore close errors
      }
    }
    if (sessionId) {
      console.log(`  Session ${sessionId} completed`);
    }
  }
}
