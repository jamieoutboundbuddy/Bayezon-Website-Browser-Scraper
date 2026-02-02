/**
 * OpenAI Vision analysis for search quality assessment
 */

import OpenAI from 'openai';
import fs from 'fs';
import path from 'path';
import { TestQueries, SiteProfile, ComparisonAnalysis } from './types';
import { getDb } from './db';

// Lazy-loaded OpenAI client (only initialized when needed)
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

/**
 * Clean JSON response from LLM (remove markdown wrapping)
 */
function cleanJsonResponse(content: string): string {
  let jsonStr = content.trim();
  if (jsonStr.startsWith('```json')) {
    jsonStr = jsonStr.slice(7);
  }
  if (jsonStr.startsWith('```')) {
    jsonStr = jsonStr.slice(3);
  }
  if (jsonStr.endsWith('```')) {
    jsonStr = jsonStr.slice(0, -3);
  }
  return jsonStr.trim();
}

export interface SearchIssue {
  issue: string;
  severity: 'high' | 'medium' | 'low';
  detail: string;
}

export interface ProductShown {
  name: string;
  price: string;
  position: number;
}

export interface EmailSnippetData {
  opener: string;
  result: string;
  observation: string;
  pain: string;
  pitch_hook: string;
}

export interface PersonalizationHooks {
  specific_query: string;
  products_returned: string;
  missing_context: string;
  customer_friction: string;
  lost_sale_risk: string;
}

export interface ComprehensiveAnalysis {
  input: {
    domain: string;
    query: string;
    query_type: string;
    query_intent: string;
  };
  
  website: {
    name: string;
    url: string;
    industry: string;
    has_search: boolean;
    search_type: string;
    has_autocomplete: boolean;
    has_filters: boolean;
  };
  
  search_journey: {
    homepage_loaded: boolean;
    search_icon_found: boolean;
    search_input_found: boolean;
    query_submitted: boolean;
    results_page_loaded: boolean;
    stages_completed: number;
    stages_total: number;
  };
  
  search_results: {
    returned_results: boolean;
    result_count: number;
    result_count_text: string;
    results_relevant: boolean;
    zero_results: boolean;
    products_shown: ProductShown[];
    products_shown_summary: string;
    products_shown_count: number;
  };
  
  analysis: {
    overall_score: number;
    search_quality: 'excellent' | 'good' | 'fair' | 'poor' | 'very_poor';
    handles_natural_language: boolean;
    matches_query_intent: boolean;
    issues_found: SearchIssue[];
    what_should_have_shown: string[];
    missed_opportunity: string;
  };
  
  catalogue_analysis: {
    likely_has_relevant_products: boolean;
    relevant_products_exist: string[];
    products_that_should_match: string;
  };
  
  recall_analysis: {
    visible_categories: string[];
    related_categories_count: number;
    expected_product_count: string;
    actual_result_count: number;
    recall_score: number;
    recall_verdict: 'excellent' | 'good' | 'fair' | 'poor' | 'very_poor';
    missed_categories: string[];
    recall_explanation: string;
  };
  
  email_context: {
    search_query_used: string;
    what_search_returned: string;
    what_was_missing: string;
    relevant_products_on_site: string;
    pain_point_summary: string;
    personalization_hooks: PersonalizationHooks;
    suggested_talking_points: string[];
    email_snippet_data: EmailSnippetData;
  };
  
  outreach_qualification: {
    is_good_prospect: boolean;
    prospect_score: number;
    reasons: string[];
    disqualifiers: string[];
    recommended_action: 'outreach' | 'skip' | 'review';
  };
}

/**
 * Convert local screenshot path to base64
 */
function getScreenshotBase64(screenshotUrl: string): string | null {
  try {
    const filePath = path.join(process.cwd(), screenshotUrl);
    if (fs.existsSync(filePath)) {
      const imageBuffer = fs.readFileSync(filePath);
      return imageBuffer.toString('base64');
    }
  } catch (e) {
    console.error('Error reading screenshot:', e);
  }
  return null;
}

/**
 * Analyze screenshots using OpenAI Vision
 */
export async function analyzeSearchQuality(
  domain: string,
  query: string,
  screenshots: Array<{ stage: string; url: string; screenshotUrl: string }>,
  searchJourney: {
    homepageLoaded: boolean;
    searchIconFound: boolean;
    searchInputFound: boolean;
    searchSubmitted: boolean;
    resultsLoaded: boolean;
  }
): Promise<ComprehensiveAnalysis> {
  
  // Prepare images for OpenAI
  const imageContents: OpenAI.Chat.Completions.ChatCompletionContentPart[] = [];
  
  for (const screenshot of screenshots) {
    const base64 = getScreenshotBase64(screenshot.screenshotUrl);
    if (base64) {
      imageContents.push({
        type: 'image_url',
        image_url: {
          url: `data:image/jpeg;base64,${base64}`,
          detail: 'high',
        },
      });
    }
  }
  
  if (imageContents.length === 0) {
    throw new Error('No screenshots available for analysis');
  }

  const systemPrompt = `You are an expert e-commerce search quality analyst. You analyze website search functionality to identify companies that would benefit from AI-powered natural language search.

Your task is to analyze screenshots of a search journey and provide comprehensive data for sales outreach.

CRITICAL ANALYSIS POINTS:
1. PRECISION: Are the results shown relevant to the query?
2. RECALL: Did the search find ALL relevant products, or miss many? This is KEY.

Look at the navigation/menu screenshot to see what product categories exist. Then compare to search results.
For example: If navigation shows "Marvel | DC | Star Wars" but "super hero" search only returns 3 Black Panther items, that's TERRIBLE RECALL - the search missed 95%+ of relevant products.

A site with POOR RECALL is a GREAT prospect - even if precision looks okay (3 relevant results), missing 50+ other relevant products is a huge problem.

Respond ONLY with valid JSON matching the exact structure provided. No markdown, no explanation, just JSON.`;

  const userPrompt = `Analyze these screenshots from ${domain} where the search query was: "${query}"

Screenshots provided (in order):
1. Homepage
2. Navigation/Menu (showing product categories - USE THIS FOR RECALL ANALYSIS)
3. Search modal/input with query typed
4. Search results page

CRITICAL: Look at the navigation screenshot to see what product categories exist. Compare this to search results to assess RECALL. If navigation shows many related categories but search only returned a few products, that's POOR RECALL.

Analyze the search quality and return this EXACT JSON structure:

{
  "website": {
    "name": "Company name extracted from site",
    "industry": "Best guess at industry/category",
    "has_search": true,
    "search_type": "modal_overlay|search_page|instant_search|other",
    "has_autocomplete": true/false,
    "has_filters": true/false
  },
  "search_results": {
    "returned_results": true/false,
    "result_count": number or 0,
    "result_count_text": "exact text shown like '14 results'",
    "results_relevant": true/false,
    "zero_results": true/false,
    "products_shown": [
      {"name": "Product 1", "price": "$XX", "position": 1},
      {"name": "Product 2", "price": "$XX", "position": 2},
      {"name": "Product 3", "price": "$XX", "position": 3}
    ],
    "products_shown_summary": "Product 1, Product 2, Product 3"
  },
  "analysis": {
    "overall_score": 0-100,
    "search_quality": "excellent|good|fair|poor|very_poor",
    "handles_natural_language": true/false,
    "matches_query_intent": true/false,
    "issues_found": [
      {"issue": "issue_code", "severity": "high|medium|low", "detail": "explanation"}
    ],
    "what_should_have_shown": ["Product type 1", "Product type 2"],
    "missed_opportunity": "Description of what customer experience issue this creates"
  },
  "catalogue_analysis": {
    "likely_has_relevant_products": true/false,
    "relevant_products_exist": ["Evidence from screenshots of relevant products"],
    "products_that_should_match": "Description of products that should have matched"
  },
  "recall_analysis": {
    "visible_categories": ["List ALL product categories visible in navigation that relate to query"],
    "related_categories_count": number,
    "expected_product_count": "Estimate like '50+' or '100+' based on visible categories",
    "actual_result_count": number from search results,
    "recall_score": 0-100 (100=found everything, 0=missed everything),
    "recall_verdict": "excellent|good|fair|poor|very_poor",
    "missed_categories": ["Categories that should have matched but products didn't appear"],
    "recall_explanation": "e.g. 'Navigation shows Marvel, DC, Star Wars collections but search only returned 3 Black Panther items - missed 95%+ of relevant products'"
  },
  "email_context": {
    "what_search_returned": "Brief description of what results appeared",
    "what_was_missing": "What context/filtering was missing",
    "relevant_products_on_site": "What relevant products exist based on screenshots",
    "pain_point_summary": "One sentence describing the customer pain point",
    "personalization_hooks": {
      "products_returned": "List of actual products shown",
      "missing_context": "What the search failed to understand",
      "customer_friction": "What the customer has to do manually",
      "lost_sale_risk": "Risk level and explanation"
    },
    "suggested_talking_points": [
      "Point 1",
      "Point 2",
      "Point 3"
    ],
    "email_snippet_data": {
      "opener": "I searched for '[query]' on your site",
      "result": "but the results showed [what actually showed]",
      "observation": "I noticed you have [relevant products] in your catalogue that would be perfect for this search",
      "pain": "Customers searching with natural language have to [friction point]",
      "pitch_hook": "What if customers could [aspirational outcome]?"
    }
  },
  "outreach_qualification": {
    "is_good_prospect": true/false,
    "prospect_score": 0-100,
    "reasons": ["Reason 1", "Reason 2"],
    "disqualifiers": ["Any reasons NOT to reach out"],
    "recommended_action": "outreach|skip|review"
  }
}

SCORING GUIDANCE:
- POOR RECALL (recall_score < 30) = ALWAYS recommend outreach (prospect_score 80+)
- If navigation shows many related categories but search returned few results = POOR RECALL
- A search that returns 3 relevant items but misses 50+ is WORSE than returning 10 less-relevant items
- "handles_natural_language" should be FALSE if recall is poor, even if precision looks okay

Be specific and use actual product names and details from the screenshots. The search query was: "${query}"`;

  try {
    const openai = getOpenAIClient();
    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: systemPrompt },
        {
          role: 'user',
          content: [
            { type: 'text', text: userPrompt },
            ...imageContents,
          ],
        },
      ],
      max_tokens: 4000,
      temperature: 0.3,
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      throw new Error('No response from OpenAI');
    }

    // Parse JSON response (handle potential markdown wrapping)
    let jsonStr = content.trim();
    if (jsonStr.startsWith('```json')) {
      jsonStr = jsonStr.slice(7);
    }
    if (jsonStr.startsWith('```')) {
      jsonStr = jsonStr.slice(3);
    }
    if (jsonStr.endsWith('```')) {
      jsonStr = jsonStr.slice(0, -3);
    }
    
    const analysisData = JSON.parse(jsonStr.trim());

    // Build complete response
    const stagesCompleted = screenshots.length;
    const normalizedDomain = domain.replace(/^https?:\/\//, '').replace(/\/$/, '');
    
    const analysis: ComprehensiveAnalysis = {
      input: {
        domain: normalizedDomain,
        query: query,
        query_type: 'natural_language',
        query_intent: `Search for: ${query}`,
      },
      
      website: {
        name: analysisData.website?.name || normalizedDomain,
        url: `https://${normalizedDomain}`,
        industry: analysisData.website?.industry || 'Unknown',
        has_search: searchJourney.searchIconFound,
        search_type: analysisData.website?.search_type || 'unknown',
        has_autocomplete: analysisData.website?.has_autocomplete || false,
        has_filters: analysisData.website?.has_filters || false,
      },
      
      search_journey: {
        homepage_loaded: searchJourney.homepageLoaded,
        search_icon_found: searchJourney.searchIconFound,
        search_input_found: searchJourney.searchInputFound,
        query_submitted: searchJourney.searchSubmitted,
        results_page_loaded: searchJourney.resultsLoaded,
        stages_completed: stagesCompleted,
        stages_total: 3,
      },
      
      search_results: {
        returned_results: analysisData.search_results?.returned_results ?? true,
        result_count: analysisData.search_results?.result_count ?? 0,
        result_count_text: analysisData.search_results?.result_count_text || '',
        results_relevant: analysisData.search_results?.results_relevant ?? false,
        zero_results: analysisData.search_results?.zero_results ?? false,
        products_shown: analysisData.search_results?.products_shown || [],
        products_shown_summary: analysisData.search_results?.products_shown_summary || '',
        products_shown_count: analysisData.search_results?.products_shown?.length || 0,
      },
      
      analysis: {
        overall_score: analysisData.analysis?.overall_score ?? 50,
        search_quality: analysisData.analysis?.search_quality || 'fair',
        handles_natural_language: analysisData.analysis?.handles_natural_language ?? false,
        matches_query_intent: analysisData.analysis?.matches_query_intent ?? false,
        issues_found: analysisData.analysis?.issues_found || [],
        what_should_have_shown: analysisData.analysis?.what_should_have_shown || [],
        missed_opportunity: analysisData.analysis?.missed_opportunity || '',
      },
      
      catalogue_analysis: {
        likely_has_relevant_products: analysisData.catalogue_analysis?.likely_has_relevant_products ?? true,
        relevant_products_exist: analysisData.catalogue_analysis?.relevant_products_exist || [],
        products_that_should_match: analysisData.catalogue_analysis?.products_that_should_match || '',
      },
      
      recall_analysis: {
        visible_categories: analysisData.recall_analysis?.visible_categories || [],
        related_categories_count: analysisData.recall_analysis?.related_categories_count || 0,
        expected_product_count: analysisData.recall_analysis?.expected_product_count || 'Unknown',
        actual_result_count: analysisData.recall_analysis?.actual_result_count || analysisData.search_results?.result_count || 0,
        recall_score: analysisData.recall_analysis?.recall_score ?? 50,
        recall_verdict: analysisData.recall_analysis?.recall_verdict || 'fair',
        missed_categories: analysisData.recall_analysis?.missed_categories || [],
        recall_explanation: analysisData.recall_analysis?.recall_explanation || '',
      },
      
      email_context: {
        search_query_used: query,
        what_search_returned: analysisData.email_context?.what_search_returned || '',
        what_was_missing: analysisData.email_context?.what_was_missing || '',
        relevant_products_on_site: analysisData.email_context?.relevant_products_on_site || '',
        pain_point_summary: analysisData.email_context?.pain_point_summary || '',
        personalization_hooks: {
          specific_query: query,
          products_returned: analysisData.email_context?.personalization_hooks?.products_returned || '',
          missing_context: analysisData.email_context?.personalization_hooks?.missing_context || '',
          customer_friction: analysisData.email_context?.personalization_hooks?.customer_friction || '',
          lost_sale_risk: analysisData.email_context?.personalization_hooks?.lost_sale_risk || '',
        },
        suggested_talking_points: analysisData.email_context?.suggested_talking_points || [],
        email_snippet_data: {
          opener: analysisData.email_context?.email_snippet_data?.opener || `I searched for '${query}' on your site`,
          result: analysisData.email_context?.email_snippet_data?.result || '',
          observation: analysisData.email_context?.email_snippet_data?.observation || '',
          pain: analysisData.email_context?.email_snippet_data?.pain || '',
          pitch_hook: analysisData.email_context?.email_snippet_data?.pitch_hook || '',
        },
      },
      
      outreach_qualification: {
        is_good_prospect: analysisData.outreach_qualification?.is_good_prospect ?? false,
        prospect_score: analysisData.outreach_qualification?.prospect_score ?? 50,
        reasons: analysisData.outreach_qualification?.reasons || [],
        disqualifiers: analysisData.outreach_qualification?.disqualifiers || [],
        recommended_action: analysisData.outreach_qualification?.recommended_action || 'review',
      },
    };

    return analysis;
    
  } catch (error: any) {
    console.error('OpenAI analysis error:', error);
    throw new Error(`Analysis failed: ${error.message}`);
  }
}

/**
 * Evaluate search comparison between natural language and keyword search results
 * This is the core evaluation for the Smart SDR Agent
 */
export async function evaluateSearchComparison(
  jobId: string,
  domain: string,
  queries: TestQueries,
  nlScreenshotBase64: string,
  kwScreenshotBase64: string,
  siteProfile: SiteProfile
): Promise<{ comparison: ComparisonAnalysis; emailHook: string | null }> {
  const startTime = Date.now();

  const prompt = `Compare these two search results from ${siteProfile.company}.

SEARCH 1 - Natural Language Query: "${queries.naturalLanguageQuery}"
[Screenshot 1]

SEARCH 2 - Keyword Query: "${queries.keywordQuery}"  
[Screenshot 2]

Site context:
- Industry: ${siteProfile.industry}
- Catalog size: ${siteProfile.estimatedCatalogSize}
- Expected behavior: ${queries.expectedBehavior}

EVALUATE based on these criteria:

1. RELEVANCE (most important):
   - Are NL results relevant to what customer wanted?
   - Fewer but MORE relevant results = GOOD search
   - Many but IRRELEVANT results = BAD search

2. MISSED PRODUCTS:
   - What products appear in KW results but NOT in NL results?
   - These are products the NL search "missed"
   - List specific product names if visible

3. VERDICT:
   - OUTREACH: NL search failed - returned irrelevant results OR missed obvious products
   - SKIP: NL search worked - returned relevant results (even if fewer)
   - REVIEW: Unclear, needs human check
   - INCONCLUSIVE: Both returned 0 or couldn't evaluate

KEY INSIGHT: We're looking for sites where customers have to "point, click, browse, filter" 
instead of just typing what they want. If "red sneakers" doesn't return red sneakers = OUTREACH.

Return JSON only:
{
  "nlResultCount": number or null,
  "nlRelevance": "all_relevant|mostly_relevant|mixed|irrelevant|none",
  "nlProductsShown": ["Product 1", "Product 2"],
  "kwResultCount": number or null,
  "kwRelevance": "all_relevant|mostly_relevant|mixed|irrelevant|none",
  "kwProductsShown": ["Product 1", "Product 2"],
  "missedProducts": ["Products in KW but not NL"],
  "verdict": "OUTREACH|SKIP|REVIEW|INCONCLUSIVE",
  "verdictReason": "One sentence explanation",
  "emailHook": "If OUTREACH: personalized email opener. If not: null"
}`;

  const openai = getOpenAIClient();
  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${nlScreenshotBase64}`, detail: 'high' } },
          { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${kwScreenshotBase64}`, detail: 'high' } }
        ]
      }
    ],
    max_tokens: 1500,
    temperature: 0
  });

  const content = response.choices[0]?.message?.content || '{}';
  const durationMs = Date.now() - startTime;

  // Log to database (optional - don't fail if DB not available)
  try {
    const db = getDb();
    if (db) {
      await db.llmLog.create({
        data: {
          jobId,
          domain,
          phase: 'evaluation',
          prompt,
          response: content,
          model: 'gpt-4o',
          tokensUsed: response.usage?.total_tokens,
          durationMs
        }
      });
    }
  } catch (dbError) {
    console.error('[EVAL] Failed to log to database:', dbError);
    // Continue even if logging fails
  }

  const parsed = JSON.parse(cleanJsonResponse(content));
  
  // Build the comparison analysis object
  const comparison: ComparisonAnalysis = {
    nlResultCount: parsed.nlResultCount ?? null,
    nlRelevance: parsed.nlRelevance || 'mixed',
    nlProductsShown: parsed.nlProductsShown || [],
    kwResultCount: parsed.kwResultCount ?? null,
    kwRelevance: parsed.kwRelevance || 'mixed',
    kwProductsShown: parsed.kwProductsShown || [],
    missedProducts: parsed.missedProducts || [],
    verdict: parsed.verdict || 'REVIEW',
    verdictReason: parsed.verdictReason || ''
  };
  
  return {
    comparison,
    emailHook: parsed.emailHook || null
  };
}

/**
 * Check if OpenAI is configured
 */
export function isOpenAIConfigured(): boolean {
  return !!process.env.OPENAI_API_KEY;
}

