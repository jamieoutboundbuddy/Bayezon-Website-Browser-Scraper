/**
 * Website search journey runner - Playwright automation for search flow
 */

import { Browser, Page } from 'playwright';
import { chromium } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { SearchResult } from './types';
import { 
  getArtifactPath, 
  getArtifactUrl, 
  normalizeDomain,
  getDomainName,
  sleep 
} from './utils';
import { updateJobProgress, addScreenshotToJob, completeJob, failJob } from './jobs';

// Use stealth plugin to avoid detection
chromium.use(StealthPlugin());

const TIMEOUTS = {
  navigation: 30000,
  fallbackNav: 20000,
  element: 5000,
  elementShort: 2000,
  popupDismiss: 1500,
};

let globalBrowser: Browser | null = null;

/**
 * Dismiss common popups: cookie consent, geo selectors, newsletters, modals
 */
async function dismissPopups(page: Page): Promise<void> {
  console.log('  Checking for popups to dismiss...');
  
  // Common popup dismiss button selectors
  const dismissSelectors = [
    // Cookie consent - Accept/OK buttons
    'button:has-text("Accept")',
    'button:has-text("Accept All")',
    'button:has-text("Accept Cookies")',
    'button:has-text("Allow")',
    'button:has-text("Allow All")',
    'button:has-text("Got it")',
    'button:has-text("I Agree")',
    'button:has-text("Agree")',
    'button:has-text("OK")',
    'button:has-text("Continue")',
    'button:has-text("Yes")',
    '[id*="cookie"] button:has-text("Accept")',
    '[class*="cookie"] button:has-text("Accept")',
    '[id*="consent"] button:has-text("Accept")',
    '[class*="consent"] button:has-text("Accept")',
    '[data-testid*="cookie-accept"]',
    '[data-testid*="accept-cookies"]',
    '#onetrust-accept-btn-handler',
    '.onetrust-close-btn-handler',
    '#CybotCookiebotDialogBodyButtonAccept',
    '#CybotCookiebotDialogBodyLevelButtonAccept',
    '.cc-accept',
    '.cc-btn.cc-allow',
    '[aria-label="Accept cookies"]',
    '[aria-label="accept cookies"]',
    
    // Geo/Country selector - Close or confirm buttons
    'button:has-text("Shop Now")',
    'button:has-text("Stay")',
    'button:has-text("Confirm")',
    'button:has-text("Go to")',
    '[class*="geo"] button',
    '[class*="country"] button:has-text("Shop")',
    '[class*="country"] button:has-text("Continue")',
    '[class*="location"] button:has-text("Confirm")',
    '[class*="locale"] button',
    '[data-testid*="country"] button',
    '[data-testid*="geo"] button',
    
    // Newsletter/Promo popups - Close buttons
    '[class*="newsletter"] button[aria-label*="close" i]',
    '[class*="popup"] button[aria-label*="close" i]',
    '[class*="modal"] button[aria-label*="close" i]',
    '[class*="overlay"] button[aria-label*="close" i]',
    'button[aria-label="Close"]',
    'button[aria-label="close"]',
    'button[aria-label="Close dialog"]',
    'button[aria-label="Dismiss"]',
    '[data-dismiss="modal"]',
    '.modal-close',
    '.popup-close',
    '.close-button',
    '.btn-close',
    
    // Generic close buttons (X icons)
    '[class*="close"]:not([class*="closed"]) svg',
    '[class*="dismiss"] svg',
    'button:has(svg[class*="close"])',
    '[role="dialog"] button:has-text("×")',
    '[role="dialog"] button:has-text("✕")',
    '[role="dialog"] button:has-text("X")',
    
    // Specific vendor modals
    '.klaviyo-close-form',
    '[data-testid="modal-close"]',
    '[data-testid="close-modal"]',
    '#attentive_overlay button.attentive_close',
  ];
  
  let dismissed = 0;
  
  for (const selector of dismissSelectors) {
    try {
      const element = page.locator(selector).first();
      const isVisible = await element.isVisible({ timeout: TIMEOUTS.popupDismiss });
      
      if (isVisible) {
        await element.click({ timeout: TIMEOUTS.popupDismiss, force: true });
        dismissed++;
        console.log(`    ✓ Dismissed popup with: "${selector.substring(0, 50)}..."`);
        await sleep(500); // Wait for popup animation
      }
    } catch (e) {
      // Continue to next selector - element not found or not clickable
    }
  }
  
  // Also try pressing Escape key to close any remaining modals
  try {
    await page.keyboard.press('Escape');
    await sleep(300);
  } catch (e) {
    // Ignore escape key errors
  }
  
  // Click outside modals (on body/backdrop) to close them
  try {
    const backdrop = page.locator('[class*="backdrop"], [class*="overlay"]:not([class*="video"])').first();
    if (await backdrop.isVisible({ timeout: 500 })) {
      await page.mouse.click(10, 10); // Click top-left corner
      await sleep(300);
    }
  } catch (e) {
    // Ignore backdrop click errors
  }
  
  if (dismissed > 0) {
    console.log(`    ✓ Dismissed ${dismissed} popup(s)`);
  } else {
    console.log('    No popups detected');
  }
}

/**
 * Initialize browser if not already initialized
 */
async function getBrowser(): Promise<Browser> {
  if (!globalBrowser) {
    globalBrowser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
  }
  return globalBrowser;
}

/**
 * Close browser
 */
export async function closeBrowser(): Promise<void> {
  if (globalBrowser) {
    await globalBrowser.close();
    globalBrowser = null;
  }
}

/**
 * Safe page navigation with fallback strategies
 */
async function safeGoto(page: Page, url: string): Promise<boolean> {
  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: TIMEOUTS.navigation });
    await sleep(2000);
    return true;
  } catch (error) {
    console.log(`Network idle failed for ${url}, trying domcontentloaded...`);
  }
  
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: TIMEOUTS.fallbackNav });
    await sleep(2000);
    return true;
  } catch (error) {
    console.log(`DOM content loaded failed for ${url}, trying load...`);
  }
  
  try {
    await page.goto(url, { waitUntil: 'load', timeout: TIMEOUTS.fallbackNav });
    await sleep(1000);
    return true;
  } catch (error) {
    console.log(`All navigation strategies failed for ${url}`);
    return false;
  }
}

/**
 * Find and click search icon/button
 */
async function findAndClickSearchIcon(page: Page): Promise<boolean> {
  const searchSelectors = [
    // Common search icon selectors
    'button[aria-label*="search" i]',
    'button[aria-label*="Search" i]',
    'a[aria-label*="search" i]',
    '[data-testid*="search" i]',
    '.search-icon',
    '.search-button',
    '[class*="search"][class*="icon"]',
    '[class*="search"][class*="button"]',
    'input[type="search"]',
    // Generic patterns
    'button:has-text("Search")',
    'a:has-text("Search")',
    '[role="button"]:has-text("Search")',
  ];

  for (const selector of searchSelectors) {
    try {
      const element = page.locator(selector).first();
      const isVisible = await element.isVisible({ timeout: TIMEOUTS.elementShort });
      
      if (isVisible) {
        await element.click({ timeout: TIMEOUTS.elementShort });
        await sleep(1000); // Wait for modal to open
        console.log(`  ✓ Found search icon with selector: "${selector}"`);
        return true;
      }
    } catch (e) {
      // Continue to next selector
    }
  }

  // Fallback: Try to find any element with "search" in class/id/aria-label
  try {
    const elements = await page.$$eval('button, a, [role="button"], input', (els) => {
      return els
        .map((el, idx) => ({
          index: idx,
          tag: el.tagName,
          class: el.className,
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
      // Continue to next selector
    }
  }

  return false;
}

/**
 * Submit search (try Enter key, then button click, then URL-based)
 */
async function submitSearch(page: Page, query: string, domain: string): Promise<boolean> {
  // Strategy 1: Press Enter key
  try {
    const urlBefore = page.url();
    await page.keyboard.press('Enter');
    await sleep(3000); // Wait for navigation
    const urlAfter = page.url();
    // Check if URL changed (search was submitted)
    if (urlAfter !== urlBefore) {
      console.log('  ✓ Search submitted via Enter key');
      return true;
    }
  } catch (e) {
    // Continue to next strategy
  }

  // Strategy 2: Click submit button
  const submitSelectors = [
    'button[type="submit"]',
    'button[aria-label*="search" i]',
    'button:has-text("Search")',
    'input[type="submit"]',
    '[role="button"]:has-text("Search")',
  ];

  for (const selector of submitSelectors) {
    try {
      const button = page.locator(selector).first();
      const isVisible = await button.isVisible({ timeout: TIMEOUTS.elementShort });
      
      if (isVisible) {
        await button.click({ timeout: TIMEOUTS.elementShort });
        await sleep(2000);
        console.log(`  ✓ Search submitted via button: "${selector}"`);
        return true;
      }
    } catch (e) {
      // Continue to next selector
    }
  }

  // Strategy 3: URL-based navigation
  try {
    const searchUrl = `${domain}/search?q=${encodeURIComponent(query)}`;
    await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: TIMEOUTS.fallbackNav });
    await sleep(2000);
    console.log('  ✓ Search submitted via URL navigation');
    return true;
  } catch (e) {
    console.log('  ⚠ All search submission strategies failed');
    return false;
  }
}

/**
 * Run search journey and capture screenshots
 */
export async function runSearchJourney(
  jobId: string,
  domain: string,
  query: string
): Promise<SearchResult> {
  const browser = await getBrowser();
  const page = await browser.newPage();
  
  // Set viewport
  await page.setViewportSize({ width: 1280, height: 720 });
  
  const domainName = getDomainName(domain);
  const normalizedDomain = normalizeDomain(domain);
  const screenshots: SearchResult['screenshots'] = [];

  try {
    updateJobProgress(jobId, 10, 'running');

    // Step 1: Navigate to homepage
    console.log(`[${jobId}] Navigating to homepage: ${normalizedDomain}`);
    const homepageLoaded = await safeGoto(page, normalizedDomain);
    
    if (!homepageLoaded) {
      throw new Error('Failed to load homepage');
    }

    // Dismiss any popups (cookies, geo selectors, newsletters)
    await dismissPopups(page);
    await sleep(500);
    
    // Try dismissing again after a short wait (some popups load delayed)
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

    updateJobProgress(jobId, 33, 'running');

    // Step 2: Find and click search icon
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

    // Type query
    await page.keyboard.type(query, { delay: 100 });
    await sleep(1000); // Wait for query to appear

    // Screenshot search modal with query
    const searchModalPath = getArtifactPath(jobId, domainName, 'search_modal');
    await page.screenshot({ path: searchModalPath, quality: 70, fullPage: false });
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

    // Wait for results page to load
    await sleep(2000);
    
    // Dismiss any popups on results page
    await dismissPopups(page);

    // Screenshot search results
    const searchResultsPath = getArtifactPath(jobId, domainName, 'search_results');
    await page.screenshot({ path: searchResultsPath, quality: 70, fullPage: false });
    const searchResultsScreenshot: SearchResult['screenshots'][0] = {
      stage: 'search_results',
      url: page.url(),
      screenshotUrl: getArtifactUrl(jobId, domainName, 'search_results'),
    };
    addScreenshotToJob(jobId, searchResultsScreenshot);
    screenshots.push(searchResultsScreenshot);
    console.log(`  ✓ Search results screenshot captured`);

    updateJobProgress(jobId, 100, 'completed');

    // Return success result
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
    await page.close();
  }
}

