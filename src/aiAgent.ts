/**
 * AI-Powered Browser Agent using Stagehand v3
 * 
 * This module replaces rigid CSS selectors with AI-driven browser control.
 * The agent uses vision + language models to understand pages and interact
 * with them naturally, like a human would.
 */

import { Stagehand } from '@browserbasehq/stagehand';
import * as fs from 'fs';
import * as path from 'path';
import OpenAI from 'openai';
import { getDb } from './db';

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


// Lazy-loaded OpenAI client
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

function getArtifactPath(jobId: string, domain: string, stage: string, ext: 'png' | 'jpg' = 'png'): string {
  const dir = ensureArtifactsDir(jobId, domain);
  return path.join(dir, `${stage}.${ext}`);
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
 * Aggressively tries multiple strategies to ensure all popups are closed
 */
async function dismissPopups(stagehand: Stagehand, page: any): Promise<void> {
  console.log('  [AI] Aggressively dismissing popups...');
  
  // Wait longer for popups to appear (some load after page load)
  await new Promise(resolve => setTimeout(resolve, 2000));
  
  // Try up to 5 times (increased from 3)
  for (let i = 0; i < 5; i++) {
    try {
      // Strategy 1: Try Escape key first (fastest)
      await page.keyboard.press('Escape');
      await new Promise(resolve => setTimeout(resolve, 800));
      
      // Strategy 2: Ask AI to close visible popups
      const result = await stagehand.act(
        "Look at the page carefully. If you see ANY popup, modal, cookie banner, newsletter signup, overlay, or dialog box that is blocking or covering the main content, close it immediately. Look for: X buttons, Close buttons, Accept/Agree buttons, 'Got it' buttons, 'No thanks' buttons, or click outside the popup. If NO popup is visible, do nothing."
      );
      
      // Wait for popup to close
      await new Promise(resolve => setTimeout(resolve, 1500));
      
      // Strategy 3: Verify popup is gone by checking if main content is visible
      const verifyResult = await stagehand.act(
        "Check if the main page content (navigation menu, product grid, or main hero section) is clearly visible and not blocked by any popup or overlay. If content is blocked, try closing it again. If content is visible, confirm 'content visible'."
      );
      
      // Check if verification was successful (no popup blocking content)
      if (verifyResult.success) {
        console.log(`  [AI] ✓ Popups dismissed (attempt ${i + 1})`);
        break;
      }
      
      console.log(`  [AI] Popup check ${i + 1}: still present, retrying...`);
      
    } catch (e: any) {
      console.log(`  [AI] Popup check ${i + 1}: ${e.message || 'no action needed'}`);
      // Continue trying
    }
  }
  
  // Final wait to ensure everything is settled
  await new Promise(resolve => setTimeout(resolve, 1000));
}


/**
 * Simplified AI analysis result
 */
export interface SimpleAnalysisResult {
  domain: string;
  brandSummary: string;
  searchQuery: string;
  screenshots: {
    homepage: string;
    results: string;
  };
  verdict: 'FAILED' | 'PARTIAL' | 'PASSED';
  reasoning: string;
  productsShown: string[];
  resultCount: number | null;
}

/**
 * Full AI-powered analysis pipeline - SIMPLIFIED
 * Single browser session, 2 API calls, focused on proving NL search failure
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
  console.log(`[AI-FULL] Starting SIMPLIFIED analysis for: ${domain}`);
  console.log(`[AI-FULL] Single session, 2 API calls`);
  console.log(`[AI-FULL] ========================================\n`);
  
  const openai = getOpenAIClient();
  const stagehand = await createStagehandSession();
  
  try {
    const url = domain.startsWith('http') ? domain : `https://${domain}`;
    const page = stagehand.context.pages()[0];
    
    // Step 1: Set viewport for quality screenshots
    console.log(`[AI-FULL] Step 1: Setting up browser...`);
    await page.setViewportSize(1920, 1080);
    
    // Step 2: Navigate to homepage
    console.log(`[AI-FULL] Step 2: Navigating to ${url}...`);
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await new Promise(r => setTimeout(r, 3000)); // Let page stabilize
    
    // Step 3: Dismiss popups aggressively
    console.log(`[AI-FULL] Step 3: Dismissing popups...`);
    await dismissPopups(stagehand, page);
    
    // Step 4: Screenshot homepage (PNG, full page)
    console.log(`[AI-FULL] Step 4: Capturing homepage screenshot...`);
    await page.evaluate(() => window.scrollTo(0, 0));
    await new Promise(r => setTimeout(r, 500));
    
    const homepageScreenshotPath = getArtifactPath(jobId, domain, 'homepage', 'png');
    await page.screenshot({ 
      path: homepageScreenshotPath, 
      fullPage: true, 
      type: 'png'
    });
    console.log(`  [AI] ✓ Homepage screenshot saved: ${homepageScreenshotPath}`);
    
    // Step 5: Generate search query using domain knowledge (NO screenshot needed)
    // gpt-5-mini knows what allbirds.com, nike.com etc. sell from training data
    console.log(`[AI-FULL] Step 5: Generating search query (gpt-5-mini, text-only)...`);
    
    const queryPrompt = `You are researching ${domain} to generate a search query that tests their search functionality.

First, recall what you know about ${domain}:
- What do they sell?
- What makes them unique?
- Who is their target customer?

Then generate ONE natural language search query a real customer would type.

RULES:
- Combine 2-3 constraints (use case + environment + preference)
- Write as a statement/phrase, NOT a question
- DO NOT use standalone category names (MEN, WOMEN, shoes, clothing)
- Product type + real constraints is good

GOOD EXAMPLES:
- "lightweight sneakers for summer travel"
- "comfortable walking shoes for hot weather"
- "warm jacket for commuting not hiking"
- "breathable shoes for standing all day"

BAD EXAMPLES:
- "men's shoes" (just category browsing)
- "What do you recommend?" (question format - FORBIDDEN)
- "I need something for MEN" (question format - FORBIDDEN)
- "running shoes" (only one constraint)

Return JSON only:
{
  "brand_summary": "What they sell in 1 sentence",
  "search_query": "your query here"
}`;

    const researchStartTime = Date.now();
    const researchResponse = await openai.chat.completions.create({
      model: 'gpt-5-mini',
      messages: [{ role: 'user', content: queryPrompt }],
      max_completion_tokens: 200
    });
    
    const researchContent = researchResponse.choices[0].message.content || '{}';
    let researchData: { brand_summary: string; search_query: string };
    
    try {
      const jsonMatch = researchContent.match(/\{[\s\S]*\}/);
      researchData = JSON.parse(jsonMatch ? jsonMatch[0] : '{}');
    } catch (e) {
      console.error('[AI-FULL] Failed to parse research response, using defaults');
      researchData = {
        brand_summary: 'E-commerce retailer',
        search_query: 'comfortable everyday products'
      };
    }
    
    // Log to database
    const db = getDb();
    if (db) {
      try {
        await db.llmLog.create({
          data: {
            jobId,
            domain,
            phase: 'query_generation',
            prompt: queryPrompt,
            response: researchContent,
            model: 'gpt-5-mini',
            tokensUsed: researchResponse.usage?.total_tokens ?? null,
            durationMs: Date.now() - researchStartTime
          }
        });
      } catch (dbError) {
        console.error('[AI-FULL] Failed to log:', dbError);
      }
    }
    
    const brandSummary = researchData.brand_summary || 'E-commerce retailer';
    const searchQuery = researchData.search_query || 'comfortable everyday products';
    
    console.log(`  [AI] ✓ Brand: ${brandSummary}`);
    console.log(`  [AI] ✓ Query: "${searchQuery}"`);
    
    // Build site profile for compatibility (assume search exists, we'll find out when we try)
    const siteProfile: AISiteProfile = {
      companyName: brandSummary.split(' ')[0] || 'Unknown',
      industry: 'e-commerce',
      hasSearch: true,  // Assume true, handle failure gracefully
      searchType: 'icon_triggered',
      visibleCategories: [],
      aiObservations: brandSummary
    };
    
    // Step 6: Execute search (in same session!)
    console.log(`[AI-FULL] Step 6: Executing search...`);
    
    try {
      // Find and activate search
      console.log(`  [AI] Finding search...`);
      await stagehand.act("Find and click the search icon or search input field");
      await new Promise(r => setTimeout(r, 1000));
      
      // Type the query
      console.log(`  [AI] Typing query: "${searchQuery}"`);
      await stagehand.act(`Type: ${searchQuery}`);
      await new Promise(r => setTimeout(r, 500));
      
      // Submit search
      console.log(`  [AI] Submitting search...`);
      await stagehand.act("Press Enter or click the search button to submit");
      await new Promise(r => setTimeout(r, 4000)); // Wait for results
      
    } catch (searchError: any) {
      console.log(`  [AI] Search interaction issue: ${searchError.message}`);
      // Continue anyway - we'll screenshot whatever state we're in
    }
    
    // Step 7: Dismiss popups AGAIN after search
    console.log(`[AI-FULL] Step 7: Dismissing post-search popups...`);
    await dismissPopups(stagehand, page);
    
    // Step 8: Screenshot results (PNG, full page)
    console.log(`[AI-FULL] Step 8: Capturing results screenshot...`);
    await page.evaluate(() => window.scrollTo(0, 0));
    await new Promise(r => setTimeout(r, 500));
    
    const resultsScreenshotPath = getArtifactPath(jobId, domain, 'results', 'png');
    await page.screenshot({ 
      path: resultsScreenshotPath, 
      fullPage: true, 
      type: 'png'
    });
    console.log(`  [AI] ✓ Results screenshot saved: ${resultsScreenshotPath}`);
    
    // Step 9: Evaluate results (ONE API call)
    console.log(`[AI-FULL] Step 9: Evaluating search results...`);
    const resultsBase64 = fs.readFileSync(resultsScreenshotPath).toString('base64');
    
    const evalPrompt = `You are evaluating if an e-commerce search handled this natural language query well.

QUERY: "${searchQuery}"

Look at the search results screenshot and answer:

1. Did the site understand the INTENT behind the query?
2. Are the results RELEVANT to all constraints in the query?
3. Or did it just do basic keyword matching / show generic results?

VERDICT OPTIONS:
- "FAILED" - Results don't match intent, generic/irrelevant products, or no results
- "PARTIAL" - Some relevant results but missed key constraints  
- "PASSED" - Results clearly address the multi-constraint query

Return JSON:
{
  "verdict": "FAILED" or "PARTIAL" or "PASSED",
  "result_count": number or null,
  "products_shown": ["product 1", "product 2", ...],
  "reasoning": "Brief explanation of why the search failed/passed"
}`;

    const evalStartTime = Date.now();
    const evalResponse = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: evalPrompt },
            { 
              type: 'image_url', 
              image_url: { 
                url: `data:image/png;base64,${resultsBase64}`,
                detail: 'low'
              } 
            }
          ]
        }
      ],
      max_tokens: 500,
      temperature: 0
    });
    
    const evalContent = evalResponse.choices[0].message.content || '{}';
    let evalData: { verdict: string; result_count: number | null; products_shown: string[]; reasoning: string };
    
    try {
      const jsonMatch = evalContent.match(/\{[\s\S]*\}/);
      evalData = JSON.parse(jsonMatch ? jsonMatch[0] : '{}');
    } catch (e) {
      console.error('[AI-FULL] Failed to parse eval response, using defaults');
      evalData = {
        verdict: 'FAILED',
        result_count: null,
        products_shown: [],
        reasoning: 'Could not evaluate search results'
      };
    }
    
    // Log to database
    if (db) {
      try {
        await db.llmLog.create({
          data: {
            jobId,
            domain,
            phase: 'search_evaluation',
            prompt: evalPrompt,
            response: evalContent,
            model: 'gpt-4o',
            tokensUsed: evalResponse.usage?.total_tokens ?? null,
            durationMs: Date.now() - evalStartTime
          }
        });
      } catch (dbError) {
        console.error('[AI-FULL] Failed to log:', dbError);
      }
    }
    
    const verdict = (evalData.verdict || 'FAILED').toUpperCase() as 'FAILED' | 'PARTIAL' | 'PASSED';
    const resultCount = evalData.result_count;
    const productsShown = evalData.products_shown || [];
    const reasoning = evalData.reasoning || 'No reasoning provided';
    
    console.log(`  [AI] ✓ Verdict: ${verdict}`);
    console.log(`  [AI] ✓ Reasoning: ${reasoning}`);
    
    await stagehand.close();
    
    // Map to legacy format for compatibility
    console.log(`\n[AI-FULL] ========================================`);
    console.log(`[AI-FULL] VERDICT: ${verdict === 'FAILED' ? 'OUTREACH' : verdict === 'PARTIAL' ? 'REVIEW' : 'SKIP'}`);
    console.log(`[AI-FULL] Reason: ${reasoning}`);
    console.log(`[AI-FULL] ========================================\n`);
    
    return {
      siteProfile,
      nlQuery: searchQuery,
      kwQuery: '', // No KW search in simplified flow
      searchResults: {
        naturalLanguage: {
          query: searchQuery,
          screenshotPath: resultsScreenshotPath,
          resultCount,
          productsFound: productsShown,
          searchSuccess: verdict !== 'FAILED',
          aiObservations: reasoning
        },
        keyword: {
          query: '',
          screenshotPath: '',
          resultCount: null,
          productsFound: [],
          searchSuccess: false,
          aiObservations: 'Keyword search removed in simplified flow'
        },
        homepageScreenshotPath
      },
      comparison: {
        nlRelevance: verdict === 'PASSED' ? 'high' : verdict === 'PARTIAL' ? 'medium' : 'low',
        kwRelevance: 'none',
        verdict: verdict === 'FAILED' ? 'OUTREACH' : verdict === 'PARTIAL' ? 'REVIEW' : 'SKIP',
        reason: reasoning
      }
    };
    
  } catch (error) {
    await stagehand.close();
    throw error;
  }
}

/**
 * Build result for sites with no search functionality
 */
function buildNoSearchResult(siteProfile: AISiteProfile, homepageScreenshotPath: string) {
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
      nlRelevance: 'none' as const,
      kwRelevance: 'none' as const,
      verdict: 'INCONCLUSIVE' as const,
      reason: 'No search functionality detected on site',
    },
  };
}


