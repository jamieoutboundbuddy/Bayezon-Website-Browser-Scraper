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
  console.log('  [AI] Quick popup check...');
  
  // FAST: Try JavaScript-based dismissal first (instant, no API call)
  try {
    const dismissed = await page.evaluate(() => {
      let found = false;
      
      // ============================================================
      // STEP 1: Find dismiss buttons by TEXT content
      // This catches Steve Madden "NO, THANKS", Allbirds "DECLINE OFFER", etc.
      // ============================================================
      const dismissTexts = [
        'no, thanks', 'no thanks', 'no, thank you', 'no thank you',
        'decline', 'decline offer', 'not now', 'maybe later',
        'close', 'dismiss', 'skip', 'cancel', 'not interested',
        'continue without', 'no discount', 'i\'ll pass'
      ];
      
      const allButtons = Array.from(document.querySelectorAll('button, [role="button"], a[href="#"]'));
      for (const btn of allButtons) {
        const el = btn as HTMLElement;
        const text = el.innerText?.toLowerCase().trim();
        if (text && el.offsetParent !== null) { // Is visible
          for (const dismissText of dismissTexts) {
            if (text === dismissText || text.includes(dismissText)) {
              console.log('[POPUP] Clicking dismiss button:', text);
              el.click();
              found = true;
              break;
            }
          }
          if (found) break;
        }
      }
      
      // Brief pause after clicking
      if (found) return found;
      
      // ============================================================
      // STEP 2: Cookie consent banners (click OK/Accept)
      // ============================================================
      const cookieSelectors = [
        '#onetrust-accept-btn-handler',
        '[id*="cookie"] button[id*="accept"]',
        '[id*="cookie"] button[id*="ok"]',
        '[class*="cookie"] button',
        '[class*="consent"] button[class*="accept"]',
        '[class*="gdpr"] button',
        'button[data-cookie-accept]',
      ];
      
      for (const selector of cookieSelectors) {
        try {
          const el = document.querySelector(selector) as HTMLElement;
          if (el && el.offsetParent !== null) {
            console.log('[POPUP] Clicking cookie consent:', selector);
            el.click();
            found = true;
          }
        } catch { /* ignore */ }
      }
      
      // ============================================================
      // STEP 3: Modal X/Close buttons by aria-label or class
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
      ];
      
      for (const selector of closeSelectors) {
        try {
          const el = document.querySelector(selector) as HTMLElement;
          if (el && el.offsetParent !== null) {
            console.log('[POPUP] Clicking close button:', selector);
            el.click();
            found = true;
          }
        } catch { /* ignore */ }
      }
      
      // ============================================================
      // STEP 4: Find X icons (SVG) inside modal overlays
      // ============================================================
      const modalContainers = Array.from(document.querySelectorAll(
        '[class*="modal"], [class*="Modal"], [class*="popup"], [class*="Popup"], ' +
        '[class*="overlay"], [class*="Overlay"], [role="dialog"], [aria-modal="true"]'
      ));
      
      for (const modal of modalContainers) {
        // Look for buttons containing SVG (likely X icons)
        const buttons = Array.from(modal.querySelectorAll('button'));
        for (const btn of buttons) {
          const el = btn as HTMLElement;
          // Check if button contains an SVG and is in top area of modal (close buttons usually are)
          if (el.querySelector('svg') && el.offsetParent !== null) {
            const rect = el.getBoundingClientRect();
            const modalRect = (modal as HTMLElement).getBoundingClientRect();
            // If button is in top 100px of modal, likely a close button
            if (rect.top - modalRect.top < 100) {
              console.log('[POPUP] Clicking SVG close button in modal');
              el.click();
              found = true;
              break;
            }
          }
        }
        if (found) break;
      }
      
      return found;
    });
    
    if (dismissed) {
      console.log('  [AI] ✓ Popup dismissed via JS');
      await new Promise(r => setTimeout(r, 500)); // Let popup animation complete
      
      // Check for additional popups (sometimes there are multiple)
      await page.evaluate(() => {
        const dismissTexts = ['no, thanks', 'no thanks', 'decline', 'close', 'ok', 'accept'];
        const buttons = Array.from(document.querySelectorAll('button, [role="button"]'));
        for (const btn of buttons) {
          const el = btn as HTMLElement;
          const text = el.innerText?.toLowerCase().trim();
          if (text && el.offsetParent !== null && dismissTexts.some(t => text.includes(t))) {
            el.click();
            break;
          }
        }
      });
      await new Promise(r => setTimeout(r, 300));
      return;
    }
  } catch (e: any) {
    console.log('  [AI] JS popup check error:', e.message?.substring(0, 50));
  }
  
  // Brief wait for any popups to appear
  await new Promise(r => setTimeout(r, 500));
  
  // SLOW FALLBACK: Use Stagehand with better instruction
  try {
    const popupPromise = stagehand.act(
      "If there is a popup, modal, or overlay blocking the page, close it by clicking 'No Thanks', 'No, Thanks', 'Decline', 'Close', 'X', or similar dismiss button. Do NOT click 'Yes', 'Subscribe', 'Sign Up', or accept buttons. If nothing is blocking, do nothing."
    );
    
    // 5 second timeout for popup handling
    await Promise.race([
      popupPromise,
      new Promise((_, reject) => setTimeout(() => reject(new Error('popup timeout')), 5000))
    ]);
    console.log('  [AI] ✓ Popup check complete');
  } catch (e: any) {
    // Expected - either no popup, timeout, or schema error
    if (e.message?.includes('timeout')) {
      console.log('  [AI] Popup check timed out, continuing...');
    }
  }
  
  await new Promise(r => setTimeout(r, 200));
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
  
  // Real-World Commerce Search Query Generator (Progression-Based)
  // Strategy: Start simple, progressively add qualifiers/friction
  const getProgressionPrompt = (attempt: number, brandSummary: string) => {
    let searchStrategy = '';
    
    if (attempt === 1) {
      searchStrategy = `ATTEMPT 1 (Simple): Generate a basic, single-concept search term that a real customer would type. This should be a straightforward product search - just the main thing they're looking for, nothing fancy.
Examples: "running shoes", "moisturiser for sensitive skin", "coffee table", "blue dress"`;
    } else if (attempt === 2) {
      searchStrategy = `ATTEMPT 2 (One Qualifier): Add one realistic qualifier that a customer might naturally include. This should feel like a normal follow-up search they'd try if the first one didn't quite work.
Examples: "running shoes for flat feet", "moisturiser without fragrance", "coffee table wood", "blue wedding dress"`;
    } else if (attempt === 3) {
      searchStrategy = `ATTEMPT 3 (Problem-Focused): Frame it around a real problem or situation the customer is solving. What's the actual friction they're experiencing?
Examples: "shoes that won't hurt my feet", "skincare for acne breakouts", "furniture for small spaces", "dress that won't wrinkle"`;
    } else if (attempt === 4) {
      searchStrategy = `ATTEMPT 4 (Specific Scenario): Include context about when/where/why they need this. Think about the actual use case.
Examples: "comfortable shoes for work all day", "moisturiser for dry skin in winter", "lightweight coffee table for moving", "dress for a long flight"`;
    } else {
      searchStrategy = `ATTEMPT 5 (Challenging): Combine multiple realistic factors - what would a demanding customer search for after other attempts failed?
Examples: "comfortable shoes that look professional but won't hurt my feet", "lightweight moisturiser for sensitive skin that doesn't feel greasy"`;
    }

    return `You are a real customer shopping at: ${brandSummary}

Your task: Generate ONE realistic search query that a normal human would type into this site's search bar.

${searchStrategy}

Guidelines:
- Sound natural and conversational - like you're typing in a search bar, not writing an ad
- Stay within the realm of what this brand actually sells
- Use everyday language, not marketing jargon
- If you wouldn't actually type it yourself, don't suggest it
- Keep it under 10 words ideally
- Don't stack too many qualifiers together

Output: Just the search query itself. One line. No explanation, no quotes, no alternatives.`;
  };

  const prompt = getProgressionPrompt(attempt, brandSummary);

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4.1-mini',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 150,
      temperature: 0.85  // Higher temp for variety and more natural queries
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
  
  // Fallback queries based on brand category with multi-constraint approach
  const brandLower = brandSummary.toLowerCase();
  let fallbacks: string[];
  
  if (brandLower.includes('shoe') || brandLower.includes('footwear') || brandLower.includes('sneaker')) {
    fallbacks = [
      'shoes that don\'t irritate for everyday wear',
      'sneakers I can wear all day without pain',
      'shoes for travel that pack light',
      'running shoes for someone with flat feet',
      'slip-ons that work for both casual and work'
    ];
  } else if (brandLower.includes('underwear') || brandLower.includes('boxer') || brandLower.includes('brief')) {
    fallbacks = [
      'boxers that stay put during workouts',
      'underwear for hot weather without riding up',
      'briefs that are comfortable for all-day wear',
      'boxer briefs that don\'t show through',
      'underwear for sensitive skin without irritation'
    ];
  } else if (brandLower.includes('cloth') || brandLower.includes('apparel') || brandLower.includes('fashion')) {
    fallbacks = [
      'outfit I can wear to work and dinner',
      'dress that\'s both comfortable and professional',
      'jacket that works in multiple seasons',
      'casual clothes for someone who hates tight fits',
      'clothes that are stylish but not high maintenance'
    ];
  } else if (brandLower.includes('swim') || brandLower.includes('beach')) {
    fallbacks = [
      'swimsuit that doesn\'t ride up or slip',
      'beachwear for someone with sensitive skin',
      'cover-up that\'s stylish and actually covers',
      'swim shorts that dry quickly for water sports',
      'swimwear that works for lap swimming'
    ];
  } else {
    fallbacks = [
      'product that works for everyday use and travel',
      'something I can wear that looks good and feels good',
      'items that work for both casual and professional',
      'gift that\'s useful for someone active',
      'product that won\'t irritate sensitive skin'
    ];
  }
  
  const selected = fallbacks[Math.min(attempt - 1, fallbacks.length - 1)];
  console.log(`  [AI] Using fallback query ${attempt}: "${selected}"`);
  return selected;
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
  
  const prompt = `Evaluate if this e-commerce search returned RELEVANT products for the query.

QUERY: "${query}"

CRITICAL CHECKS - These are ALWAYS SIGNIFICANT FAILURES:
1. Page shows a STORE LOCATOR MAP instead of products (e.g., location picker, store finder)
2. Page shows "No Results" / "0 Results" / empty product grid
3. Page shows a different section (checkout, account login, homepage redirect)
4. Results are ONLY BLOG POSTS/GUIDES/ARTICLES (no products at all)
5. Page redirected to error page or wrong category

INTENT MATCHING:
- A query asking for "comfortable shoes" is SATISFIED by shoe products described as comfortable
- A query asking for "hiking boots" is FAILED by generic dress shoes or location maps
- A query asking for "wide fit running shoes" is SATISFIED by any running shoe labeled as wide fit
- A query asking for "moisturiser without fragrance" is SATISFIED by fragrance-free moisturiser products

PASS CONDITIONS (at least ONE of these):
- ANY products genuinely match the query intent (even if only 1 in the results)
- Results exist and are on-topic, even if buried deep (position 10+)
- Mixed results with at least some relevant products

RELEVANCE EXAMPLES:
✅ Query "running shoes for wide feet" → Products labeled as "wide fit" = PASS
✅ Query "waterproof hiking boots" → Mix with 1-2 waterproof boots = PASS
✅ Query "comfortable everyday shoes" → Mix including comfortable labeled shoes = PASS
❌ Query "hiking shoes" → Only dress shoes = FAIL
❌ Query "products" → Store locator map = FAIL
❌ Query "wireless headphones" → 0 results / map = FAIL

Return JSON:
{
  "significant_failure": true/false,
  "result_count": number or null,
  "relevant_result_count": number (how many results actually match intent),
  "first_relevant_position": number or null (1-indexed position of first relevant product),
  "result_type": "products" | "articles" | "map_locator" | "mixed" | "none" | "error",
  "products_shown": ["product 1", "product 2", ...],
  "reasoning": "Clear explanation of why this is pass/fail. If failure, note what was shown instead (map, articles, no results, etc)"
}`;

  try {
    // Use gpt-4o-mini for vision (gpt-4.1-mini doesn't support images)
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
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
      max_tokens: 400,
      temperature: 0
    });
    
    const content = response.choices[0]?.message?.content || '';
    console.log(`  [AI] Evaluation raw response (first 200 chars): ${content.substring(0, 200)}`);
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    
    if (jsonMatch) {
      try {
        const data = JSON.parse(jsonMatch[0]);
        console.log(`  [AI] Evaluation parsed successfully`);
        return {
          isSignificantFailure: data.significant_failure === true,
          resultCount: data.result_count ?? null,
          relevantResultCount: data.relevant_result_count ?? 0,
          firstRelevantPosition: data.first_relevant_position ?? null,
          productsFound: data.products_shown ?? [],
          reasoning: data.reasoning ?? 'No reasoning provided'
        };
      } catch (parseError: any) {
        console.error(`  [AI] JSON parse error: ${parseError.message}`);
        console.error(`  [AI] Raw JSON attempted: ${jsonMatch[0].substring(0, 200)}`);
      }
    } else {
      console.error(`  [AI] No JSON found in response`);
    }
  } catch (e: any) {
    console.error(`  [AI] Evaluation failed with gpt-4.1-mini: ${e.message}`);
    console.error(`  [AI] Full error:`, e);
    // If we can't evaluate, try with gpt-4o as fallback
    console.log(`  [AI] Trying fallback with gpt-4o...`);
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
        max_tokens: 400,
        temperature: 0
      });
      
      const content = fallbackResponse.choices[0]?.message?.content || '';
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
    } catch {
      // Final fallback
    }
  }
  
  // Default to not a significant failure if we can't evaluate
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
