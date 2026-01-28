/**
 * OpenAI Vision analysis for search quality assessment
 */

import OpenAI from 'openai';
import fs from 'fs';
import path from 'path';

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

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

IMPORTANT: We are looking for companies with POOR search that doesn't handle natural language well. These are good prospects for our AI search solution.

Respond ONLY with valid JSON matching the exact structure provided. No markdown, no explanation, just JSON.`;

  const userPrompt = `Analyze these screenshots from ${domain} where the search query was: "${query}"

Screenshots provided (in order):
1. Homepage
2. Search modal/input with query typed
3. Search results page

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

Be specific and use actual product names and details from the screenshots. The search query was: "${query}"`;

  try {
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
 * Check if OpenAI is configured
 */
export function isOpenAIConfigured(): boolean {
  return !!process.env.OPENAI_API_KEY;
}

