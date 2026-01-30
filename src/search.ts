/**
 * Website search journey runner - Browserbase + Playwright automation
 */

import { Browser, Page, BrowserContext, chromium } from 'playwright';
import Browserbase from '@browserbasehq/sdk';
import { SearchResult } from './types';
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
  navigation: 30000,
  fallbackNav: 20000,
  element: 5000,
  elementShort: 2000,
  popupDismiss: 1500,
};

/**
 * Try to select UK/US in country/region selector popups
 */
async function selectEnglishRegion(page: Page): Promise<boolean> {
  console.log('  Checking for country/region selector...');
  
  const countryDropdownSelectors = [
    'select[name*="country" i]',
    'select[id*="country" i]',
    'select[class*="country" i]',
    '[data-testid*="country"] select',
    '[class*="locale"] select',
    '[class*="region"] select',
  ];
  
  for (const selector of countryDropdownSelectors) {
    try {
      const dropdown = page.locator(selector).first();
      if (await dropdown.isVisible({ timeout: TIMEOUTS.popupDismiss })) {
        try {
          await dropdown.selectOption({ label: 'United Kingdom' });
          console.log('    ✓ Selected United Kingdom from dropdown');
          await sleep(500);
          return true;
        } catch {
          try {
            await dropdown.selectOption({ value: 'GB' });
            console.log('    ✓ Selected GB from dropdown');
            await sleep(500);
            return true;
          } catch {
            try {
              await dropdown.selectOption({ label: 'United States' });
              console.log('    ✓ Selected United States from dropdown');
              await sleep(500);
              return true;
            } catch {
              // Continue
            }
          }
        }
      }
    } catch (e) {
      // Continue
    }
  }
  
  const countryLinkSelectors = [
    'a:has-text("United Kingdom")',
    'a:has-text("UK")',
    'button:has-text("United Kingdom")',
    'button:has-text("UK")',
    '[data-country="GB"]',
    '[data-country="UK"]',
    '[data-locale="en-GB"]',
    '[data-locale="en_GB"]',
    'a[href*="/en-gb"]',
    'a[href*="/en_gb"]',
    'a[href*="country=GB"]',
    'a[href*="country=UK"]',
    'a:has-text("United States")',
    'button:has-text("United States")',
    '[data-country="US"]',
    '[data-locale="en-US"]',
    'a[href*="/en-us"]',
    'a[href*="country=US"]',
  ];
  
  for (const selector of countryLinkSelectors) {
    try {
      const link = page.locator(selector).first();
      if (await link.isVisible({ timeout: TIMEOUTS.popupDismiss })) {
        await link.click({ timeout: TIMEOUTS.popupDismiss });
        console.log(`    ✓ Clicked country link: "${selector.substring(0, 40)}..."`);
        await sleep(1000);
        return true;
      }
    } catch (e) {
      // Continue
    }
  }
  
  return false;
}

/**
 * Dismiss common popups: cookie consent, geo selectors, newsletters, modals
 */
async function dismissPopups(page: Page): Promise<void> {
  console.log('  Checking for popups to dismiss...');
  
  const regionSelected = await selectEnglishRegion(page);
  
  const dismissSelectors = [
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
    'button:has-text("Shop Now")',
    'button:has-text("Stay")',
    'button:has-text("Confirm")',
    'button:has-text("Go to")',
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
    '[class*="close"]:not([class*="closed"]) svg',
    '[class*="dismiss"] svg',
    'button:has(svg[class*="close"])',
    '[role="dialog"] button:has-text("×")',
    '[role="dialog"] button:has-text("✕")',
    '[role="dialog"] button:has-text("X")',
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
        await sleep(500);
      }
    } catch (e) {
      // Continue
    }
  }
  
  try {
    await page.keyboard.press('Escape');
    await sleep(300);
  } catch (e) {
    // Ignore
  }
  
  try {
    const backdrop = page.locator('[class*="backdrop"], [class*="overlay"]:not([class*="video"])').first();
    if (await backdrop.isVisible({ timeout: 500 })) {
      await page.mouse.click(10, 10);
      await sleep(300);
    }
  } catch (e) {
    // Ignore
  }
  
  if (dismissed > 0 || regionSelected) {
    console.log(`    ✓ Handled ${dismissed} popup(s)${regionSelected ? ' + selected UK/US region' : ''}`);
  } else {
    console.log('    No popups detected');
  }
}

/**
 * Create a Browserbase session and connect Playwright
 */
async function createBrowserbaseSession(): Promise<{ browser: Browser; sessionId: string }> {
  const client = getBrowserbaseClient();
  const projectId = process.env.BROWSERBASE_PROJECT_ID;
  
  if (!projectId) {
    throw new Error('BROWSERBASE_PROJECT_ID environment variable is not set');
  }
  
  console.log('  Creating Browserbase session...');
  
  // Create a new session
  const session = await client.sessions.create({
    projectId,
    browserSettings: {
      // Browserbase handles stealth automatically
    },
  });
  
  console.log(`  ✓ Session created: ${session.id}`);
  
  // Connect Playwright to the session
  const browser = await chromium.connectOverCDP(session.connectUrl);
  
  return { browser, sessionId: session.id };
}

/**
 * Close browser (no-op for Browserbase, session auto-closes)
 */
export async function closeBrowser(): Promise<void> {
  // Browserbase sessions auto-close when disconnected
  // No global browser to manage anymore
}

/**
 * Try to force English/UK version of URL
 */
function getEnglishUrl(url: string): string[] {
  const urls = [url];
  
  try {
    const urlObj = new URL(url);
    const hostname = urlObj.hostname;
    const pathname = urlObj.pathname;
    
    const separator = url.includes('?') ? '&' : '?';
    urls.push(`${url}${separator}country=GB`);
    urls.push(`${url}${separator}country=UK`);
    urls.push(`${url}${separator}locale=en-GB`);
    
    if (!pathname.includes('/en-gb') && !pathname.includes('/en-us') && !pathname.includes('/en/')) {
      urls.push(`${urlObj.origin}/en-gb${pathname}`);
      urls.push(`${urlObj.origin}/en${pathname}`);
    }
    
    if (hostname.match(/^(be|nl|de|fr|es|it)\./)) {
      const mainDomain = hostname.replace(/^(be|nl|de|fr|es|it)\./, '');
      urls.push(`https://${mainDomain}${pathname}`);
      urls.push(`https://uk.${mainDomain}${pathname}`);
    }
    
  } catch (e) {
    // Return original
  }
  
  return urls;
}

/**
 * Safe page navigation with fallback strategies
 */
async function safeGoto(page: Page, url: string): Promise<boolean> {
  const urlsToTry = getEnglishUrl(url);
  
  for (const tryUrl of urlsToTry) {
    try {
      console.log(`  Trying: ${tryUrl}`);
      await page.goto(tryUrl, { waitUntil: 'networkidle', timeout: TIMEOUTS.navigation });
      await sleep(2000);
      
      const pageUrl = page.url();
      const pageContent = await page.content();
      const isEnglish = pageUrl.includes('/en') || 
                        pageUrl.includes('country=GB') || 
                        pageUrl.includes('country=UK') ||
                        pageUrl.includes('country=US') ||
                        pageContent.includes('lang="en"') ||
                        pageContent.includes("lang='en'");
      
      if (isEnglish || tryUrl === url) {
        return true;
      }
      console.log(`  Page not in English, trying next variant...`);
    } catch (error) {
      // Try next
    }
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
    'button[aria-label*="search" i]',
    'button[aria-label*="Search" i]',
    'a[aria-label*="search" i]',
    '[data-testid*="search" i]',
    '.search-icon',
    '.search-button',
    '[class*="search"][class*="icon"]',
    '[class*="search"][class*="button"]',
    'input[type="search"]',
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
        await sleep(1000);
        console.log(`  ✓ Found search icon with selector: "${selector}"`);
        return true;
      }
    } catch (e) {
      // Continue
    }
  }

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
      // Continue
    }
  }

  return false;
}

/**
 * Open and screenshot navigation menu to show catalog categories
 * This helps the AI understand what products SHOULD exist for recall analysis
 */
async function captureNavigationMenu(page: Page): Promise<boolean> {
  console.log('  Attempting to capture navigation/catalog menu...');
  
  // Try to find and open a navigation menu
  const navTriggerSelectors = [
    // Hamburger menus
    'button[aria-label*="menu" i]',
    'button[aria-label*="Menu" i]',
    '[class*="hamburger"]',
    '[class*="menu-toggle"]',
    '[class*="nav-toggle"]',
    'button:has([class*="hamburger"])',
    // Main nav items that might expand
    'nav a:has-text("Shop")',
    'nav a:has-text("Products")',
    'nav a:has-text("Collections")',
    'nav a:has-text("Categories")',
    'nav button:has-text("Shop")',
    'header a:has-text("Shop")',
    'header a:has-text("Men")',
    'header a:has-text("Women")',
    // Generic nav elements
    'nav > ul > li:first-child > a',
    'header nav a:first-of-type',
  ];
  
  for (const selector of navTriggerSelectors) {
    try {
      const element = page.locator(selector).first();
      const isVisible = await element.isVisible({ timeout: TIMEOUTS.elementShort });
      
      if (isVisible) {
        // Hover first (for dropdowns)
        await element.hover({ timeout: TIMEOUTS.elementShort });
        await sleep(800);
        
        // Check if a dropdown appeared
        const dropdownSelectors = [
          '[class*="dropdown"]',
          '[class*="megamenu"]',
          '[class*="submenu"]',
          '[class*="nav-panel"]',
          'nav ul ul',
          '[role="menu"]',
        ];
        
        for (const dropdownSel of dropdownSelectors) {
          try {
            const dropdown = page.locator(dropdownSel).first();
            if (await dropdown.isVisible({ timeout: 500 })) {
              console.log(`    ✓ Nav dropdown appeared via hover: "${selector.substring(0, 40)}..."`);
              return true;
            }
          } catch (e) {
            // Continue
          }
        }
        
        // Try clicking if hover didn't work
        await element.click({ timeout: TIMEOUTS.elementShort });
        await sleep(800);
        
        for (const dropdownSel of dropdownSelectors) {
          try {
            const dropdown = page.locator(dropdownSel).first();
            if (await dropdown.isVisible({ timeout: 500 })) {
              console.log(`    ✓ Nav menu opened via click: "${selector.substring(0, 40)}..."`);
              return true;
            }
          } catch (e) {
            // Continue
          }
        }
      }
    } catch (e) {
      // Continue to next selector
    }
  }
  
  console.log('    ⚠ Could not open navigation menu, using homepage as catalog reference');
  return false;
}

/**
 * Scroll down to load lazy-loaded content
 */
async function scrollToLoadContent(page: Page, scrollCount: number = 3): Promise<void> {
  for (let i = 0; i < scrollCount; i++) {
    await page.evaluate(() => {
      window.scrollBy(0, window.innerHeight * 0.8);
    });
    await sleep(800);
  }
  await page.evaluate(() => window.scrollTo(0, 0));
  await sleep(300);
}

/**
 * Submit search (try Enter key, then button click, then URL-based)
 */
async function submitSearch(page: Page, query: string, domain: string): Promise<boolean> {
  try {
    const urlBefore = page.url();
    await page.keyboard.press('Enter');
    await sleep(3000);
    const urlAfter = page.url();
    if (urlAfter !== urlBefore) {
      console.log('  ✓ Search submitted via Enter key');
      return true;
    }
  } catch (e) {
    // Continue
  }

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
      // Continue
    }
  }

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
    await sleep(500);
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
    
    // Screenshot navigation/catalog (whether menu opened or not - shows nav bar at minimum)
    const navigationPath = getArtifactPath(jobId, domainName, 'navigation');
    await page.setViewportSize({ width: 1280, height: 1200 }); // Taller to capture dropdown
    await sleep(300);
    await page.screenshot({ path: navigationPath, quality: 80, fullPage: false });
    await page.setViewportSize({ width: 1280, height: 1024 }); // Reset
    
    const navigationScreenshot: SearchResult['screenshots'][0] = {
      stage: 'navigation',
      url: page.url(),
      screenshotUrl: getArtifactUrl(jobId, domainName, 'navigation'),
    };
    addScreenshotToJob(jobId, navigationScreenshot);
    screenshots.push(navigationScreenshot);
    console.log(`  ✓ Navigation screenshot captured (menu opened: ${navOpened})`);
    
    // Close any open menu by pressing Escape or clicking elsewhere
    try {
      await page.keyboard.press('Escape');
      await sleep(300);
    } catch (e) {
      // Ignore
    }

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

    // Type query
    await page.keyboard.type(query, { delay: 100 });
    
    console.log(`  Waiting for search suggestions to load...`);
    await sleep(2500);
    
    try {
      await page.waitForSelector('[class*="suggest"], [class*="autocomplete"], [class*="dropdown"], [class*="results"], [class*="product"]', { 
        timeout: 3000,
        state: 'visible' 
      });
      console.log(`  ✓ Search suggestions appeared`);
      await sleep(500);
    } catch (e) {
      console.log(`  ⚠ No autocomplete detected, continuing...`);
    }

    // Screenshot search modal
    const searchModalPath = getArtifactPath(jobId, domainName, 'search_modal');
    await page.setViewportSize({ width: 1280, height: 1200 });
    await sleep(300);
    await page.screenshot({ path: searchModalPath, quality: 80, fullPage: false });
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

    await sleep(2000);
    await dismissPopups(page);

    // Scroll to load more results
    console.log(`  Scrolling to load more results...`);
    await scrollToLoadContent(page, 3);
    await sleep(1000);

    // Screenshot search results
    const searchResultsPath = getArtifactPath(jobId, domainName, 'search_results');
    const pageHeight = await page.evaluate(() => Math.min(document.body.scrollHeight, 3000));
    await page.setViewportSize({ width: 1280, height: pageHeight });
    await page.evaluate(() => window.scrollTo(0, 0));
    await sleep(500);
    await page.screenshot({ path: searchResultsPath, quality: 80, fullPage: false });
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
