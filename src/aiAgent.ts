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
  relevantResultCount: number;
  firstRelevantPosition: number | null;
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
    verbose: 0,           // Disable verbose logging for speed
  });

  await stagehand.init();
  console.log('  [AI] ✓ Stagehand session ready');

  return stagehand;
}

// ============================================================================
// Action Timeout Helper - Prevents hanging on slow actions
// ============================================================================

async function actWithTimeout(
  stagehand: Stagehand,
  instruction: string,
  timeoutMs = 10000
): Promise<void> {
  const actionPromise = stagehand.act(instruction);
  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error(`Action timeout after ${timeoutMs}ms: ${instruction.substring(0, 50)}...`)), timeoutMs)
  );
  await Promise.race([actionPromise, timeoutPromise]);
}

// ============================================================================
// Fast Popup Dismissal - JavaScript-first, Stagehand fallback
// ============================================================================

async function dismissPopups(stagehand: Stagehand, page: any): Promise<void> {
  console.log('  [AI] Popup dismissal starting...');

  // CRITICAL: Wait for delayed popups to appear (Steve Madden shows after ~2-3s)
  await new Promise(r => setTimeout(r, 3500));

  // Helper to check if element is truly visible
  const isElementVisible = (el: HTMLElement): boolean => {
    const style = window.getComputedStyle(el);
    return style.display !== 'none' &&
      style.visibility !== 'hidden' &&
      style.opacity !== '0' &&
      el.offsetWidth > 0 &&
      el.offsetHeight > 0;
  };

  // Try up to 3 times (some popups have animations or multiple layers)
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const dismissed = await page.evaluate(() => {
        // Helper function for visibility (defined inside evaluate)
        const checkVisible = (el: HTMLElement): boolean => {
          const style = window.getComputedStyle(el);
          return style.display !== 'none' &&
            style.visibility !== 'hidden' &&
            style.opacity !== '0' &&
            el.offsetWidth > 0 &&
            el.offsetHeight > 0;
        };

        // ============================================================
        // STEP 1: Press Escape key first (universal dismiss)
        // ============================================================
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

        // ============================================================
        // STEP 2: Find dismiss buttons by TEXT content
        // ============================================================
        const dismissTexts = [
          'no, thanks', 'no thanks', 'no, thank you', 'no thank you',
          'decline', 'decline offer', 'not now', 'maybe later',
          'close', 'dismiss', 'skip', 'cancel', 'not interested',
          'continue without', 'no discount', "i'll pass", 'x',
          'continue shopping', 'no thanks, i prefer full price'
        ];

        // Check ALL clickable elements, not just buttons
        const clickables = Array.from(document.querySelectorAll(
          'button, [role="button"], a, span[onclick], div[onclick], [tabindex="0"], [data-dismiss]'
        ));

        for (const el of clickables) {
          const element = el as HTMLElement;
          const text = element.innerText?.toLowerCase().trim().replace(/\s+/g, ' ');

          if (text && checkVisible(element)) {
            for (const dismissText of dismissTexts) {
              if (text === dismissText || text.includes(dismissText)) {
                console.log('[POPUP] Clicking dismiss button:', text);
                element.click();
                return true;
              }
            }
          }
        }

        // ============================================================
        // STEP 3: Cookie consent banners
        // ============================================================
        const cookieSelectors = [
          '#onetrust-accept-btn-handler',
          '[id*="cookie"] button[id*="accept"]',
          '[class*="cookie"] button',
          '[class*="consent"] button[class*="accept"]',
          '[class*="gdpr"] button',
        ];

        for (const selector of cookieSelectors) {
          try {
            const el = document.querySelector(selector) as HTMLElement;
            if (el && checkVisible(el)) {
              console.log('[POPUP] Clicking cookie consent:', selector);
              el.click();
              return true;
            }
          } catch { /* ignore */ }
        }

        // ============================================================
        // STEP 4: Modal X/Close buttons by aria-label or class
        // ============================================================
        const closeSelectors = [
          '[aria-label="Close"]',
          '[aria-label="close"]',
          '[aria-label="Close modal"]',
          '[aria-label="Close dialog"]',
          '[aria-label="Dismiss"]',
          'button[class*="close"]',
          'button[class*="Close"]',
          '[class*="modal-close"]',
          '[class*="popup-close"]',
          '[data-dismiss="modal"]',
          '[data-testid="close-button"]',
          '[data-testid="modal-close"]',
          // Specific X button patterns
          'button[aria-label*="lose"]', // Catches "Close"
          'button[title*="lose"]',
          'button[title*="Close"]',
          'a[aria-label*="lose"]',
          // Site-specific selectors
          '.modal__close',
          '.popup__close',
          '.dialog__close',
          // Steve Madden specific
          '[class*="klaviyo"] button[aria-label]',
          '[class*="klaviyo"] [aria-label*="lose"]',
        ];

        for (const selector of closeSelectors) {
          try {
            const el = document.querySelector(selector) as HTMLElement;
            if (el && checkVisible(el)) {
              console.log('[POPUP] Clicking close button:', selector);
              el.click();
              return true;
            }
          } catch { /* ignore */ }
        }

        // ============================================================
        // STEP 5: Find X icons (SVG) inside modal overlays
        // ============================================================
        const modalContainers = Array.from(document.querySelectorAll(
          '[class*="modal"], [class*="Modal"], [class*="popup"], [class*="Popup"], ' +
          '[class*="overlay"], [class*="Overlay"], [role="dialog"], [aria-modal="true"]'
        ));

        for (const modal of modalContainers) {
          const modalEl = modal as HTMLElement;
          if (!checkVisible(modalEl)) continue;

          // Look for buttons containing SVG (likely X icons)
          const buttons = Array.from(modal.querySelectorAll('button, [role="button"]'));
          for (const btn of buttons) {
            const el = btn as HTMLElement;
            // Check if button contains an SVG or × character
            const hasCloseIcon = el.querySelector('svg') || el.innerText?.includes('×') || el.innerText?.includes('✕');
            if (hasCloseIcon && checkVisible(el)) {
              const rect = el.getBoundingClientRect();
              const modalRect = modalEl.getBoundingClientRect();
              // If button is in top 120px of modal, likely a close button
              if (rect.top - modalRect.top < 120) {
                console.log('[POPUP] Clicking SVG/X close button in modal');
                el.click();
                return true;
              }
            }
          }
        }

        // ============================================================
        // STEP 6: Click overlay backdrop (dismiss by clicking outside)
        // ============================================================
        const overlays = document.querySelectorAll(
          '[class*="overlay"], [class*="backdrop"], [class*="Overlay"], [class*="Backdrop"]'
        );
        for (const overlay of Array.from(overlays)) {
          const style = window.getComputedStyle(overlay as Element);
          if (style.position === 'fixed' && style.display !== 'none') {
            console.log('[POPUP] Clicking overlay backdrop');
            (overlay as HTMLElement).click();
            return true;
          }
        }

        return false;
      });

      if (dismissed) {
        console.log(`  [AI] ✓ Popup dismissed (attempt ${attempt + 1})`);
        await new Promise(r => setTimeout(r, 500)); // Let animation complete
      } else {
        // No popup found, exit loop
        console.log('  [AI] No popup detected');
        break;
      }
    } catch (e: any) {
      console.log('  [AI] JS popup check error:', e.message?.substring(0, 50));
      break;
    }
  }

  // Final Escape key press via Playwright (more reliable)
  try {
    await page.keyboard.press('Escape');
    await new Promise(r => setTimeout(r, 200));
  } catch { /* ignore */ }
}

// ============================================================================
// State Verification - Check if search UI actually opened
// ============================================================================

interface SearchState {
  inputFound: boolean;
  inputVisible: boolean;
  urlChanged: boolean;
  onSearchPage: boolean;
}

async function verifySearchOpened(page: any, originalUrl: string): Promise<SearchState> {
  const currentUrl = page.url();
  const urlChanged = currentUrl !== originalUrl &&
    currentUrl.replace(/\/$/, '') !== originalUrl.replace(/\/$/, '');
  const onSearchPage = currentUrl.includes('/search') ||
    currentUrl.includes('?q=') ||
    currentUrl.includes('?query=') ||
    currentUrl.includes('?s=');

  // Check for visible search input
  const inputCheck = await page.evaluate(() => {
    const selectors = [
      'input[type="search"]',
      'input[name="q"]',
      'input[name="query"]',
      'input[name="search"]',
      'input[name="s"]',
      'input[placeholder*="search" i]',
      'input[aria-label*="search" i]',
      '[role="searchbox"]'
    ];

    for (const selector of selectors) {
      const input = document.querySelector(selector) as HTMLInputElement;
      if (input) {
        const rect = input.getBoundingClientRect();
        const isVisible = rect.width > 0 && rect.height > 0 &&
          input.offsetParent !== null &&
          getComputedStyle(input).visibility !== 'hidden' &&
          getComputedStyle(input).display !== 'none';
        return { found: true, visible: isVisible };
      }
    }
    return { found: false, visible: false };
  });

  return {
    inputFound: inputCheck.found,
    inputVisible: inputCheck.visible,
    urlChanged,
    onSearchPage
  };
}

// ============================================================================
// Site-Specific Selector Map
// ============================================================================

const SITE_SELECTORS: Record<string, { searchButton?: string; searchInput?: string }> = {
  'stevemadden.com': {
    searchButton: 'button.header__icon--search, [data-action="toggle-search"]',
    searchInput: 'input[name="q"]'
  },
  'allbirds.com': {
    searchButton: '[data-testid="search-button"], button[aria-label*="search" i]',
    searchInput: 'input[type="search"]'
  },
  'nordstrom.com': {
    searchButton: '[data-testid="search-button"]',
    searchInput: 'input[name="keyword"]'
  },
  'nike.com': {
    searchButton: 'button[aria-label="Open Search Modal"]',
    searchInput: 'input[aria-label="Search Products"]'
  }
};

function getSiteSelectors(domain: string): { searchButton?: string; searchInput?: string } | null {
  // Check for exact match first
  if (SITE_SELECTORS[domain]) {
    return SITE_SELECTORS[domain];
  }
  // Check for partial match (e.g., "www.stevemadden.com" matches "stevemadden.com")
  for (const [key, value] of Object.entries(SITE_SELECTORS)) {
    if (domain.includes(key) || key.includes(domain.replace('www.', ''))) {
      return value;
    }
  }
  return null;
}

// ============================================================================
// JS-First Search Execution with Layered Fallbacks
// ============================================================================

interface SearchExecutionResult {
  success: boolean;
  method: 'input_focus' | 'keyboard' | 'button_click' | 'site_specific' | 'url_fallback' | 'stagehand_ai' | 'none';
  error?: string;
}

async function executeSearchWithFallbacks(
  page: any,
  stagehand: Stagehand,
  query: string,
  domain: string,
  originalUrl: string
): Promise<SearchExecutionResult> {
  console.log(`  [SEARCH] Starting layered search for: "${query}"`);

  // ========================================================================
  // LAYER 1: Direct Input Focus (Header Scoped)
  // ========================================================================
  console.log(`  [SEARCH] Layer 1: Trying direct input focus...`);
  try {
    const inputFocused = await page.evaluate((q: string) => {
      // First, try to scope to header/nav
      const headerSelectors = ['header', '[role="banner"]', 'nav', '.header', '#header'];
      let scope: Element | Document = document;

      for (const sel of headerSelectors) {
        const header = document.querySelector(sel);
        if (header) {
          scope = header;
          break;
        }
      }

      // Search input selectors in priority order
      const inputSelectors = [
        'input[type="search"]',
        'input[name="q"]',
        'input[name="query"]',
        'input[name="search"]',
        '[role="searchbox"]',
        'input[placeholder*="search" i]',
        'input[aria-label*="search" i]'
      ];

      // Try header-scoped first
      for (const selector of inputSelectors) {
        const input = scope.querySelector(selector) as HTMLInputElement;
        if (input && input.offsetParent !== null) {
          input.focus();
          input.value = q;
          input.dispatchEvent(new Event('input', { bubbles: true }));
          return { found: true, selector };
        }
      }

      // Fall back to page-wide if not in header
      if (scope !== document) {
        for (const selector of inputSelectors) {
          const input = document.querySelector(selector) as HTMLInputElement;
          if (input && input.offsetParent !== null) {
            input.focus();
            input.value = q;
            input.dispatchEvent(new Event('input', { bubbles: true }));
            return { found: true, selector };
          }
        }
      }

      return { found: false, selector: null };
    }, query);

    if (inputFocused.found) {
      console.log(`  [SEARCH] ✓ Layer 1 SUCCESS: Found input via ${inputFocused.selector}`);

      // Submit the search
      await page.keyboard.press('Enter');
      await new Promise(r => setTimeout(r, 2000));

      const state = await verifySearchOpened(page, originalUrl);
      if (state.urlChanged || state.onSearchPage) {
        console.log(`  [SEARCH] ✓ Search submitted successfully`);
        return { success: true, method: 'input_focus' };
      }
    }
  } catch (e: any) {
    console.log(`  [SEARCH] Layer 1 error: ${e.message?.substring(0, 50)}`);
  }

  // ========================================================================
  // LAYER 2: Keyboard Shortcuts
  // ========================================================================
  console.log(`  [SEARCH] Layer 2: Trying keyboard shortcuts...`);
  const shortcuts = [
    { key: '/', name: 'slash' },
    { key: 'Control+k', name: 'Ctrl+K' },
    { key: 'Meta+k', name: 'Cmd+K' }
  ];

  for (const shortcut of shortcuts) {
    try {
      await page.keyboard.press(shortcut.key);
      await new Promise(r => setTimeout(r, 500));

      const state = await verifySearchOpened(page, originalUrl);
      if (state.inputVisible) {
        console.log(`  [SEARCH] ✓ Layer 2 SUCCESS: ${shortcut.name} opened search`);

        // Type and submit
        await page.keyboard.type(query);
        await new Promise(r => setTimeout(r, 300));
        await page.keyboard.press('Enter');
        await new Promise(r => setTimeout(r, 2000));

        const finalState = await verifySearchOpened(page, originalUrl);
        if (finalState.urlChanged || finalState.onSearchPage) {
          return { success: true, method: 'keyboard' };
        }
      }
    } catch (e: any) {
      // Continue to next shortcut
    }
  }

  // ========================================================================
  // LAYER 3: Click Search Button (Header Scoped, Semantic)
  // ========================================================================
  console.log(`  [SEARCH] Layer 3: Trying semantic button click...`);
  try {
    const buttonClicked = await page.evaluate(() => {
      // Scope to header first
      const headerSelectors = ['header', '[role="banner"]', 'nav', '.header', '#header'];
      let scope: Element | Document = document;

      for (const sel of headerSelectors) {
        const header = document.querySelector(sel);
        if (header) {
          scope = header;
          break;
        }
      }

      // Button selectors in priority order
      const buttonSelectors = [
        'button[aria-label*="search" i]',
        'a[aria-label*="search" i]',
        '[role="button"][aria-label*="search" i]',
        'button[title*="search" i]',
        '[data-testid*="search" i]',
        '[data-action*="search" i]',
        '.search-icon',
        '.icon-search',
        '.search-toggle',
        'button.search',
        'a.search'
      ];

      // Try header-scoped first
      for (const selector of buttonSelectors) {
        const btn = scope.querySelector(selector) as HTMLElement;
        if (btn && btn.offsetParent !== null) {
          btn.click();
          return { clicked: true, selector };
        }
      }

      // Fall back to page-wide
      if (scope !== document) {
        for (const selector of buttonSelectors) {
          const btn = document.querySelector(selector) as HTMLElement;
          if (btn && btn.offsetParent !== null) {
            btn.click();
            return { clicked: true, selector };
          }
        }
      }

      return { clicked: false, selector: null };
    });

    if (buttonClicked.clicked) {
      console.log(`  [SEARCH] ✓ Layer 3: Clicked button via ${buttonClicked.selector}`);
      await new Promise(r => setTimeout(r, 800));

      // Verify search UI opened
      const state = await verifySearchOpened(page, originalUrl);
      if (state.inputVisible) {
        console.log(`  [SEARCH] ✓ Search UI opened, typing query...`);

        // Find and fill the now-visible input
        await page.evaluate((q: string) => {
          const input = document.querySelector('input[type="search"], input[name="q"], input[placeholder*="search" i], [role="searchbox"]') as HTMLInputElement;
          if (input) {
            input.focus();
            input.value = q;
            input.dispatchEvent(new Event('input', { bubbles: true }));
          }
        }, query);

        await page.keyboard.press('Enter');
        await new Promise(r => setTimeout(r, 2000));

        const finalState = await verifySearchOpened(page, originalUrl);
        if (finalState.urlChanged || finalState.onSearchPage) {
          return { success: true, method: 'button_click' };
        }
      }
    }
  } catch (e: any) {
    console.log(`  [SEARCH] Layer 3 error: ${e.message?.substring(0, 50)}`);
  }

  // ========================================================================
  // LAYER 4: Site-Specific Selectors
  // ========================================================================
  const siteConfig = getSiteSelectors(domain);
  if (siteConfig) {
    console.log(`  [SEARCH] Layer 4: Trying site-specific selectors for ${domain}...`);
    try {
      if (siteConfig.searchButton) {
        const clicked = await page.evaluate((selector: string) => {
          const btn = document.querySelector(selector) as HTMLElement;
          if (btn && btn.offsetParent !== null) {
            btn.click();
            return true;
          }
          return false;
        }, siteConfig.searchButton);

        if (clicked) {
          console.log(`  [SEARCH] ✓ Clicked site-specific button`);
          await new Promise(r => setTimeout(r, 800));
        }
      }

      // Try site-specific input
      if (siteConfig.searchInput) {
        const filled = await page.evaluate((selector: string, q: string) => {
          const input = document.querySelector(selector) as HTMLInputElement;
          if (input) {
            input.focus();
            input.value = q;
            input.dispatchEvent(new Event('input', { bubbles: true }));
            return true;
          }
          return false;
        }, siteConfig.searchInput, query);

        if (filled) {
          await page.keyboard.press('Enter');
          await new Promise(r => setTimeout(r, 2000));

          const state = await verifySearchOpened(page, originalUrl);
          if (state.urlChanged || state.onSearchPage) {
            console.log(`  [SEARCH] ✓ Layer 4 SUCCESS: Site-specific selector worked`);
            return { success: true, method: 'site_specific' };
          }
        }
      }
    } catch (e: any) {
      console.log(`  [SEARCH] Layer 4 error: ${e.message?.substring(0, 50)}`);
    }
  }

  // ========================================================================
  // LAYER 5: URL Fallback
  // ========================================================================
  console.log(`  [SEARCH] Layer 5: Trying direct URL navigation...`);
  const searchUrlPatterns = [
    `/search?q=${encodeURIComponent(query)}`,
    `/search?query=${encodeURIComponent(query)}`,
    `/search?s=${encodeURIComponent(query)}`,
    `?q=${encodeURIComponent(query)}`,
    `/pages/search-results?q=${encodeURIComponent(query)}`
  ];

  for (const pattern of searchUrlPatterns) {
    try {
      const baseUrl = originalUrl.replace(/\/$/, '');
      const searchUrl = pattern.startsWith('?') ? `${baseUrl}${pattern}` : `${baseUrl}${pattern}`;
      console.log(`  [SEARCH] Trying URL: ${searchUrl}`);

      await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 10000 });
      await new Promise(r => setTimeout(r, 1500));

      // Check if we landed on a valid search page (not error/404)
      const isValidPage = await page.evaluate(() => {
        const text = document.body?.innerText?.toLowerCase() || '';
        const isError = text.includes('page not found') ||
          text.includes('404') ||
          text.includes("this page doesn't exist") ||
          text.includes('error');
        const hasResults = text.includes('result') ||
          text.includes('product') ||
          text.includes('showing') ||
          document.querySelectorAll('[class*="product"]').length > 0;
        return !isError && (hasResults || text.length > 500);
      });

      if (isValidPage) {
        console.log(`  [SEARCH] ✓ Layer 5 SUCCESS: URL fallback worked`);
        return { success: true, method: 'url_fallback' };
      }
    } catch (e: any) {
      // Continue to next URL pattern
    }
  }

  // Return to original page for Layer 6
  try {
    await page.goto(originalUrl, { waitUntil: 'domcontentloaded', timeout: 10000 });
    await new Promise(r => setTimeout(r, 1000));
  } catch {
    // Ignore
  }

  // ========================================================================
  // LAYER 6: Stagehand AI (Last Resort)
  // ========================================================================
  console.log(`  [SEARCH] Layer 6: Using Stagehand AI as last resort...`);
  try {
    // Step 1: Open search
    await actWithTimeout(stagehand,
      `Click the search icon, magnifying glass, or search button. Look in the header, top right corner, or navigation bar.`,
      8000
    );
    await new Promise(r => setTimeout(r, 1000));

    // Verify
    let state = await verifySearchOpened(page, originalUrl);
    if (!state.inputVisible && !state.urlChanged) {
      console.log(`  [SEARCH] AI click didn't open search UI`);
      return { success: false, method: 'none', error: 'Stagehand AI could not find search UI' };
    }

    // Step 2: Type query
    await actWithTimeout(stagehand,
      `Type "${query}" into the search input field that is currently visible on the page`,
      8000
    );
    await new Promise(r => setTimeout(r, 300));

    // Step 3: Submit
    try {
      await actWithTimeout(stagehand,
        `Press the Enter key on the keyboard to submit the search`,
        8000
      );
    } catch (e: any) {
      // Context destroyed means navigation happened - success
      if (e.message?.includes('Cannot find context') || e.message?.includes('context with specified id')) {
        console.log(`  [SEARCH] ✓ Page navigated during submit`);
      }
    }

    await new Promise(r => setTimeout(r, 2000));

    const finalState = await verifySearchOpened(page, originalUrl);
    if (finalState.urlChanged || finalState.onSearchPage) {
      console.log(`  [SEARCH] ✓ Layer 6 SUCCESS: Stagehand AI worked`);
      return { success: true, method: 'stagehand_ai' };
    }

  } catch (e: any) {
    console.log(`  [SEARCH] Layer 6 error: ${e.message?.substring(0, 80)}`);
  }

  // All layers failed
  console.log(`  [SEARCH] ✗ All layers failed - could not execute search`);
  return { success: false, method: 'none', error: 'All search methods failed' };
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

  // PERSONA-BASED Query Generator - emulates real user search behavior
  // Strategy: Solver (problem) → Hunter (specific) → Conversational (natural language)
  const getProgressionPrompt = (attempt: number, brandSummary: string) => {
    let searchStrategy = '';

    if (attempt === 1) {
      // THE SOLVER: Context/Problem/Occasion based
      // GOAL: Find a "Hook" query where basic search might fail but AI search succeeds
      searchStrategy = `ATTEMPT 1 (THE SOLVER - Context/Occasion):
Generate a search query based on a specific CONTEXT, OCCASION, or PROBLEM.
The intent should be clear to a human, but might be tricky for a basic keyword search.

GOOD EXAMPLES (Hyper-Realistic Hooks):
- "outfit for bloating" (Problem solving)
- "swimsuit for hip dips" (Body concern)
- "rug safe for crawling baby" (Safety context)
- "sweat proof gym set" (Performance need)
- "bra that doesnt show through tshirts" (Specific constraint)
- "sheets specifically for hot sleepers" (Benefit)
- "shoes that wont destroy my feet at a wedding" (Real pain point)

BAD EXAMPLES:
- "shoes for plantar fasciitis" (Too medical/niche)
- "comfortable clothes" (Too generic)
- "items for problem" (Robot speak)
- "stylish shoes for summer" (Nobody says 'stylish' — that's marketing speak)
- "elegant evening wear" (Sounds like a catalog, not a real person)

The query should sound like a REAL person typing their specific need/context into the search bar. Think text message, not magazine ad.`;
    } else if (attempt === 2) {
      // THE CONVERSATIONAL: Vibe/Implied Need
      searchStrategy = `ATTEMPT 2 (THE CONVERSATIONAL - Vibe/Implied Need):
Generate a search query that describes a VIBE, MOOD, or IMPLIED NEED.
Short, punchy, and natural.

GOOD EXAMPLES (Hyper-Realistic Hooks):
- "heels i can dance in" (Implies comfort + stability + party style)
- "baddie birthday outfit" (Implies specific trendy style)
- "shoes for disney world" (Implies walking 20k steps/comfort)
- "outfit for first date" (Implies attractive but not trying too hard)
- "gift for someone who has everything" (Implies unique/novelty)

BAD EXAMPLES:
- "comfortable heels" (Too basic)
- "party clothes" (Too generic)
- "stylish shoes" (BANNED — nobody talks like this)
- "chic outfit for brunch" (Too curated — real people say 'cute outfit for brunch')
- "elegant dress for evening" (Catalog language, not human language)

The query should imply a set of product features (e.g. "dance in" = block heel/straps) without listing them. Write like you're texting a friend, not writing ad copy.`;
    } else if (attempt === 3) {
      // THE HUNTER: Specific but Human
      searchStrategy = `ATTEMPT 3 (THE HUNTER - Specific but Human):
Generate a search query for a specific type of item, but phrased naturally.
Avoid keyword stuffing. Use the words real people use.

GOOD EXAMPLES (Hyper-Realistic Hooks):
- "gold hoop earrings heavy duty" (Specific trait)
- "black work pants stretchy" (Category + Benefit)
- "white sneakers easy to clean" (Category + Maintenance)
- "running gear for 40 degree weather" (Contextual specificity)
- "makeup for dry skin" (Skin type constraint)

BAD EXAMPLES:
- "premium genuine leather ankle boots waterproof" (Keyword stuffing)
- "women's footwear black size 9" (Robot speak)
- "stylish sustainable sneakers" (Marketing buzzwords — real people say 'cute sneakers that are eco friendly')
- "trendy summer clothes" (Nobody searches this way)

The query should be specific but sound like a text message, not a catalog entry.`;
    }

    return `You are generating a REALISTIC search query to test an e-commerce site: ${brandSummary}

${searchStrategy}

CRITICAL RULES:
- Sound like a REAL human customer searching (not a product catalog or ad)
- Keep it under 10 words (usually 3-6 words is best)
- Use natural language people actually type into search bars
- NO medical terms unless relevant to brand
- ADAPT TO THE BRAND: If searching a high-fashion site, search for 'club heels' not 'orthopedic shoes'
- BANNED WORDS (never use these — they are marketing speak, not customer speak):
  "stylish", "chic", "elegant", "trendy", "fashionable", "premium", "sophisticated", "stunning", "exquisite", "luxurious"
  Instead use: "cute", "cool", "nice", "good", "comfy", "pretty", or just describe the need directly

Output: Just the search query itself. One line. No explanation.`;
  };

  const prompt = getProgressionPrompt(attempt, brandSummary);

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      max_completion_tokens: 150,
      temperature: 0.7  // Increased to 0.7 for natural variation
    });

    const content = response.choices[0]?.message?.content || '';
    // Now expects plain text, not JSON
    const query = content
      .trim()
      .split('\n')[0]  // Take first line
      .replace(/^["']|["']$/g, '')  // Remove quotes if present
      .substring(0, 120);

    if (query && query.length > 5 && !query.includes('{')) {
      console.log(`  [AI] Generated query ${attempt}: "${query}"`);
      return query;
    }

    // Fallback to parsing JSON if response looks like JSON
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const data = JSON.parse(jsonMatch[0]);
      return data.query || '';
    }
  } catch (e: any) {
    console.error(`  [AI] Query generation failed: ${e.message}`);
  }


  // Simple fallback if AI generation failed
  console.log(`  [AI] Using generic fallback for attempt ${attempt}`);
  return `popular items`;
}

// ============================================================================
// Search Evaluation (GPT-4.1-mini for cost efficiency)
// ============================================================================

interface EvaluationResult {
  isSignificantFailure: boolean;
  resultCount: number | null;
  relevantResultCount: number;
  firstRelevantPosition: number | null;
  productsFound: string[];
  reasoning: string;
}

async function evaluateSearchResults(
  openai: OpenAI,
  query: string,
  screenshotBase64: string
): Promise<EvaluationResult> {

  const prompt = `You are an expert at evaluating search results with STRICT adherence to user intent.

    Query: "${query}"


Your Goal: Determine if the search results TRULY solve the user's specific problem.
  CRITICAL: Many search engines return "keyword matches" that are functionally useless(False Positives).You must catch these.

Rules for Relevance:
    1. STRICT MATCHING: If the user asks for "heels i can dance in", a 5 - inch stiletto is NOT relevant, even if it is a "heel".It must look stable / comfortable.
2. CONTEXT MATTERS: "Rug that hides dirt" means patterned / dark / washable.A plain white rug is a FAILURE, even if it is a "rug".
3. DETECT FAILURE: If the results are just generic matches that ignore the specific constraint(e.g. "dance in", "hides dirt", "birthday outfit"), mark them as IRRELEVANT.

Return a JSON object with:
  - relevant_result_count: (number) Count of results that actually meet the SPECIFIC intent.
- top_match: (string) Title of the best match(or "None").
- significant_failure: (boolean) Set to TRUE if the search engine failed to understand the nuance(returned keyword matches that are wrong).
- result_count: (number) Total results found.
- first_relevant_position: (number or null) Position of first good result.
- products_shown: (string[]) List of product titles.
- reasoning: (string) Explain strictly why it passed or failed.E.g. "Results were just generic heels, not suitable for dancing."`;

  // Helper to parse evaluation response
  const parseEvalResponse = (content: string) => {
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const data = JSON.parse(jsonMatch[0]);
      return {
        isSignificantFailure: data.significant_failure === true,
        resultCount: data.result_count ?? null,
        relevantResultCount: data.relevant_result_count ?? 0,
        firstRelevantPosition: data.first_relevant_position ?? null,
        productsFound: data.products_shown ?? [],
        reasoning: data.reasoning ?? 'No reasoning provided'
      };
    }
    return null;
  };

  const imageMessage = {
    role: 'user' as const,
    content: [
      { type: 'text' as const, text: prompt },
      {
        type: 'image_url' as const,
        image_url: {
          url: `data:image/png;base64,${screenshotBase64}`,
          detail: 'low' as const
        }
      }
    ]
  };

  // Try gpt-4o first (proven reliable with vision)
  try {
    console.log(`  [AI] Evaluating with gpt-4o...`);
    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [imageMessage],
      max_completion_tokens: 400,
      temperature: 0
    });

    const content = response.choices[0]?.message?.content || '';
    console.log(`  [AI] Evaluation raw response (first 200 chars): ${content.substring(0, 200)}`);

    if (content.trim()) {
      const result = parseEvalResponse(content);
      if (result) {
        console.log(`  [AI] Evaluation parsed successfully (gpt-4o)`);
        return result;
      }
      console.error(`  [AI] No JSON found in gpt-4o response`);
    } else {
      console.error(`  [AI] Empty response from gpt-4o`);
    }
  } catch (e: any) {
    console.error(`  [AI] gpt-4o evaluation failed: ${e.message}`);
  }

  // Fallback to gpt-4o-mini
  try {
    console.log(`  [AI] Trying fallback with gpt-4o-mini...`);
    const fallbackResponse = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [imageMessage],
      max_completion_tokens: 400,
      temperature: 0
    });

    const content = fallbackResponse.choices[0]?.message?.content || '';
    console.log(`  [AI] Fallback raw response (first 200 chars): ${content.substring(0, 200)}`);

    if (content.trim()) {
      const result = parseEvalResponse(content);
      if (result) {
        console.log(`  [AI] Evaluation parsed successfully (gpt-4o-mini)`);
        return result;
      }
      console.error(`  [AI] No JSON found in gpt-4o-mini response`);
    } else {
      console.error(`  [AI] Empty response from gpt-4o-mini`);
    }
  } catch (e: any) {
    console.error(`  [AI] gpt-4o-mini fallback also failed: ${e.message}`);
  }

  // Default to not a significant failure if we can't evaluate
  console.error(`  [AI] Both models failed to evaluate - returning default`);
  return {
    isSignificantFailure: false,
    resultCount: null,
    relevantResultCount: 0,
    firstRelevantPosition: null,
    productsFound: [],
    reasoning: 'Could not evaluate results'
  };
}

// ============================================================================
// Main Adversarial Analysis Pipeline
// ============================================================================

const MAX_ATTEMPTS = 3;  // Reduced from 5 - most failures happen early

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
  console.log(`[ADVERSARIAL] Starting adversarial analysis for: ${domain} `);
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
    await new Promise(r => setTimeout(r, 1500));  // Reduced from 3000

    // Dismiss popups
    await dismissPopups(stagehand, page);

    // Screenshot homepage - wait for images to load first
    console.log(`[ADVERSARIAL] Capturing homepage...`);
    await page.evaluate(() => window.scrollTo(0, 0));
    await new Promise(r => setTimeout(r, 500));  // Reduced from 1000

    // Wait for images to load (with shorter timeout)
    try {
      await page.evaluate(async () => {
        const images = Array.from(document.querySelectorAll('img'));
        await Promise.race([
          Promise.all(images.slice(0, 10).map(img => {  // Reduced from 20
            if (img.complete) return Promise.resolve();
            return new Promise(resolve => {
              img.onload = resolve;
              img.onerror = resolve;
            });
          })),
          new Promise(resolve => setTimeout(resolve, 2000)) // Reduced from 5s to 2s
        ]);
      });
    } catch {
      // Ignore image loading errors
    }
    await new Promise(r => setTimeout(r, 200));  // Reduced from 500

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
              text: `Analyze this e-commerce homepage and extract:

1. PRIMARY PRODUCT CATEGORY (2-4 words, e.g. "Athletic footwear", "Outdoor clothing")
   - Focus on actual product type, NOT designs/graphics on products
   
2. TARGET AUDIENCE (one sentence, e.g. "Budget-conscious parents", "High-end athletes")

3. KEY BUYING MOTIVATIONS (comma-separated, e.g. "Gift giving, Performance, Style")

4. THREE BUYER PERSONAS for search testing:
   a) THE SOLVER: Problem/context-based shopper (e.g. someone with plantar fasciitis, needs gear for trip)
   b) THE HUNTER: Multi-attribute specific shopper (e.g. seeking "gore-tex wide fit trail shoes")
   c) THE CONVERSATIONAL: Natural language, vague intent (e.g. "what should I wear for...")

Return JSON:
{
  "category": "...",
  "audience": "...",
  "motivations": "...",
  "personas": {
    "solver": "brief description of their problem/context",
    "hunter": "brief description of what specific attributes they seek",
    "conversational": "brief description of their vague shopping intent"
  }
}`
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
        max_completion_tokens: 300,
        temperature: 0
      });

      const responseContent = brandResponse.choices[0]?.message?.content?.trim() || '';
      console.log(`  [AI] Site profiling response:`, responseContent.substring(0, 200));

      try {
        const jsonMatch = responseContent.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const profileData = JSON.parse(jsonMatch[0]);
          brandSummary = `${profileData.category || 'E-commerce retailer'} | ${profileData.audience || 'General shoppers'}`;
          console.log(`  [AI] Personas extracted:`, profileData.personas);
        } else {
          brandSummary = responseContent.substring(0, 100) || brandSummary;
        }
      } catch (parseError) {
        console.log(`  [AI] JSON parsing failed, using raw response`);
        brandSummary = responseContent.substring(0, 100) || brandSummary;
      }
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
        await new Promise(r => setTimeout(r, 1000));  // Reduced from 2000
        await dismissPopups(stagehand, page);
      }

      // ============================================================
      // SEARCH - Layered JS-first approach with Stagehand fallback
      // ============================================================

      // Store URL before search to verify navigation
      const urlBeforeSearch = page.url();

      // Execute search using layered fallback approach
      const searchResult = await executeSearchWithFallbacks(
        page,
        stagehand,
        query,
        domain,
        url
      );

      console.log(`  [AI] Search result: ${searchResult.success ? '✓ SUCCESS' : '✗ FAILED'} via ${searchResult.method}`);
      if (searchResult.error) {
        console.log(`  [AI] Error: ${searchResult.error}`);
      }

      // Get the current page after potential navigation (page context may have changed)
      const pagesAfterSearch = stagehand.context.pages();
      const activePage = pagesAfterSearch[pagesAfterSearch.length - 1] || page;

      // Check if we're still on homepage (search navigation failed)
      const finalUrl = activePage.url();
      const stillOnHomepage = !searchResult.success && (
        finalUrl === urlBeforeSearch ||
        finalUrl === url ||
        (finalUrl.replace(/\/$/, '') === url.replace(/\/$/, '')));

      if (stillOnHomepage) {
        console.log(`  [AI] ⚠ STILL ON HOMEPAGE - Search navigation completely failed`);
      } else {
        console.log(`  [AI] ✓ On results page: ${finalUrl}`);
      }

      // Wait for images to load before screenshot
      console.log(`  [AI] Capturing results...`);
      await activePage.evaluate(() => window.scrollTo(0, 0));
      await new Promise(r => setTimeout(r, 500));  // Reduced from 1000

      // Wait for images to actually load (shorter timeout)
      try {
        await activePage.evaluate(async () => {
          const images = Array.from(document.querySelectorAll('img'));
          await Promise.race([
            Promise.all(images.slice(0, 10).map(img => {  // Reduced from 20
              if (img.complete) return Promise.resolve();
              return new Promise(resolve => {
                img.onload = resolve;
                img.onerror = resolve;
              });
            })),
            new Promise(resolve => setTimeout(resolve, 2000)) // Reduced from 5s to 2s
          ]);
        });
      } catch {
        // Ignore image loading errors
      }
      await new Promise(r => setTimeout(r, 300)); // Reduced from 1000

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
          await new Promise(r => setTimeout(r, 1000));  // Reduced from 2000
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
        console.log(`  [AI] Marking as SYSTEM ERROR - still on homepage, search couldn't execute`);
        evaluation = {
          isSignificantFailure: true,
          resultCount: null,
          relevantResultCount: 0,
          firstRelevantPosition: null,
          productsFound: [],
          reasoning: 'SYSTEM ERROR: Search could not be executed (popup blocking or search UI not found). Still on homepage.'
        };
      } else {
        const resultsBase64 = fs.readFileSync(resultsScreenshotPath).toString('base64');
        evaluation = await evaluateSearchResults(openai, query, resultsBase64);
      }

      console.log(`  [AI] Result count: ${evaluation.resultCount ?? 'unknown'}`);
      console.log(`  [AI] Relevant results: ${evaluation.relevantResultCount}`);
      if (evaluation.firstRelevantPosition) {
        console.log(`  [AI] First relevant at position: ${evaluation.firstRelevantPosition}`);
      }
      console.log(`  [AI] Significant failure: ${evaluation.isSignificantFailure}`);
      console.log(`  [AI] Reasoning: ${evaluation.reasoning}`);

      // Record result
      const testResult: QueryTestResult = {
        query,
        attempt,
        passed: !evaluation.isSignificantFailure,
        resultCount: evaluation.resultCount ?? null,
        relevantResultCount: evaluation.relevantResultCount ?? 0,
        firstRelevantPosition: evaluation.firstRelevantPosition ?? null,
        productsFound: evaluation.productsFound ?? [],
        reasoning: evaluation.reasoning ?? 'No reasoning provided',
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

      // Check for significant failure - Record it but CONTINUE to test other personas
      if (evaluation.isSignificantFailure) {
        console.log(`\n  [AI] ✗ SIGNIFICANT FAILURE FOUND!`);
        console.log(`  [AI] Proof query candidate: "${query}"`);

        // If this is the first failure, record it as the primary proof
        if (!proofQuery) {
          proofQuery = query;
          failedOnAttempt = attempt;
          failureScreenshotPath = resultsScreenshotPath;
          failureReasoning = evaluation.reasoning;
        }
        // Continue to test other personas to get full picture
      }

      console.log(`  [AI] ✓ Query passed, trying harder...`);
    }

    await stagehand.close();

    // ========================================================================
    // BUILD RESULT
    // ========================================================================

    const durationMs = Date.now() - startTime;

    // Determine verdict - distinguish system errors from actual search failures
    let verdict: 'OUTREACH' | 'SKIP' | 'REVIEW';
    let reason: string;

    // Check if failures are system errors (couldn't execute search) vs actual search quality issues
    const systemErrorQueries = queriesTested.filter(q => q.reasoning?.includes('SYSTEM ERROR'));
    const actualSearchFailures = queriesTested.filter(q => !q.passed && !q.reasoning?.includes('SYSTEM ERROR'));
    const successfulQueries = queriesTested.filter(q => q.passed);

    if (systemErrorQueries.length === queriesTested.length) {
      // ALL queries were system errors - we couldn't test the search at all
      verdict = 'REVIEW';
      reason = `Could not execute search on this site (likely popup blocking or search UI not found). Manual review needed.`;
      // Clear proofQuery since it wasn't a real search failure
      proofQuery = null;
      failedOnAttempt = null;
    } else if (proofQuery && !failureReasoning?.includes('SYSTEM ERROR')) {
      // Real search failure found
      verdict = 'OUTREACH';
      reason = `Search failed on query "${proofQuery}": ${failureReasoning}`;
    } else if (actualSearchFailures.length > 0) {
      // At least one actual search failure
      const firstFailure = actualSearchFailures[0];
      verdict = 'OUTREACH';
      reason = `Search failed on query "${firstFailure.query}": ${firstFailure.reasoning}`;
      proofQuery = firstFailure.query;
    } else if (successfulQueries.length >= MAX_ATTEMPTS || queriesTested.length === MAX_ATTEMPTS) {
      verdict = 'SKIP';
      reason = `Search handled all ${successfulQueries.length} test queries successfully`;
    } else if (systemErrorQueries.length > 0 && successfulQueries.length > 0) {
      // Mixed - some worked, some system errors
      verdict = 'SKIP';
      reason = `Search handled ${successfulQueries.length} queries (${systemErrorQueries.length} had system errors)`;
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
      const positionText = q.firstRelevantPosition
        ? ` (relevant at position ${q.firstRelevantPosition})`
        : '';
      return `${i + 1}. "${q.query}" → ${status} ${resultText}${positionText}${q.passed ? '' : ' - FAILED'}`;
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
        model: 'gpt-4.1-mini',
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
