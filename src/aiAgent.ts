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
  console.log('  [AI] Dismissing popups...');
  
  // Wait for popups to appear (some load after page load)
  await new Promise(resolve => setTimeout(resolve, 1500));
  
  // Try up to 3 times
  for (let i = 0; i < 3; i++) {
    try {
      // Strategy 1: Try Escape key (if keyboard available)
      try {
        if (page.keyboard) {
          await page.keyboard.press('Escape');
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      } catch {
        // Keyboard not available, skip
      }
      
      // Strategy 2: Ask AI to close visible popups
      await stagehand.act(
        "If there is any popup, modal, cookie banner, newsletter signup, or overlay visible, close it by clicking the X, Close, Accept, or 'No thanks' button. If no popup is visible, do nothing."
      );
      
      await new Promise(resolve => setTimeout(resolve, 1000));
      console.log(`  [AI] ✓ Popup check ${i + 1} complete`);
      
    } catch (e: any) {
      console.log(`  [AI] Popup check ${i + 1}: ${e.message || 'done'}`);
    }
  }
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
    console.log(`[AI-FULL] Step 5: Generating search query (gpt-5-mini, text-only)...`);
    
    // Extract domain name for brand lookup
    const brandName = domain.replace(/^www\./, '').replace(/\.(com|co\.uk|net|org).*$/, '');
    
    const queryPrompt = `Generate a search query to test if ${domain} can handle natural language search.

BRAND CONTEXT (use your knowledge):
${brandName} - recall what they sell, their unique value, target customer.

YOUR TASK:
Create ONE search query that combines 2-3 constraints (use case + environment/season + preference).
The query should test if their search understands INTENT, not just keywords.

EXAMPLES BY BRAND:
- allbirds.com → "comfy trainers for city walking in summer"
- nike.com → "all day walking shoes for hot weather"  
- patagonia.com → "everyday jacket for cold weather but not hiking"
- lululemon.com → "comfortable trousers for travel days"
- everlane.com → "simple everyday shoes that go with everything"
- ikea.com → "small sofa comfortable for everyday use"
- uniqlo.com → "warm clothes for winter layering"
- away.com → "carry-on suitcase for short trips"

RULES:
- Sound like natural human speech (NOT a question, NOT a command)
- Must include 2-3 real constraints
- NEVER use standalone categories (men, women, shoes, pants)
- Product type + context/use-case + preference = good

Return ONLY this JSON (no other text):
{"brand_summary": "one sentence about what they sell", "search_query": "your multi-constraint query"}`;

    const researchStartTime = Date.now();
    let researchContent = '';
    let researchData: { brand_summary: string; search_query: string };
    
    try {
      const researchResponse = await openai.chat.completions.create({
        model: 'gpt-5-mini',
        messages: [{ role: 'user', content: queryPrompt }],
        max_completion_tokens: 200
      });
      
      researchContent = researchResponse.choices[0].message.content || '';
      console.log(`  [AI] Raw LLM response: ${researchContent.substring(0, 200)}`);
      
      const jsonMatch = researchContent.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('No JSON found in response');
      }
      researchData = JSON.parse(jsonMatch[0]);
      
      // Validate the query isn't garbage
      if (!researchData.search_query || researchData.search_query.length < 10) {
        throw new Error('Query too short or missing');
      }
      
    } catch (e: any) {
      console.error(`[AI-FULL] Query generation failed: ${e.message}`);
      console.error(`[AI-FULL] Raw response was: ${researchContent}`);
      
      // Brand-specific fallbacks instead of generic garbage
      const fallbacks: Record<string, { brand: string; query: string }> = {
        'allbirds': { brand: 'Sustainable comfort footwear', query: 'comfy trainers for city walking in summer' },
        'nike': { brand: 'Athletic footwear and apparel', query: 'all day walking shoes for hot weather' },
        'patagonia': { brand: 'Outdoor clothing and gear', query: 'everyday jacket for cold weather but not hiking' },
        'lululemon': { brand: 'Athletic apparel', query: 'comfortable trousers for travel days' },
        'everlane': { brand: 'Modern essentials clothing', query: 'simple everyday shoes that go with everything' },
        'ikea': { brand: 'Home furnishings', query: 'small sofa comfortable for everyday use' },
        'uniqlo': { brand: 'Casual everyday clothing', query: 'warm clothes for winter layering' },
        'away': { brand: 'Travel luggage', query: 'carry-on suitcase for short trips' },
      };
      
      const fallback = fallbacks[brandName.toLowerCase()] || { 
        brand: 'E-commerce retailer', 
        query: 'lightweight comfortable option for everyday use' 
      };
      
      researchData = {
        brand_summary: fallback.brand,
        search_query: fallback.query
      };
      console.log(`  [AI] Using fallback query: "${fallback.query}"`);
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


