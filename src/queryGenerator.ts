/**
 * Query Generator module for Smart SDR Agent
 * Generates natural language and keyword test queries based on site analysis
 */

import OpenAI from 'openai';
import { SiteProfile, TestQueries } from './types';
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
 * Clean JSON response from LLM (removes markdown code blocks if present)
 */
function cleanJsonResponse(content: string): string {
  let jsonStr = content.trim();
  
  // Remove markdown code block wrapper if present
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

/**
 * Generate test queries based on site profile and homepage screenshot
 * Creates both a natural language query (conversational) and a keyword query (basic)
 * to compare search functionality
 * 
 * @param jobId - Unique job identifier for logging
 * @param domain - The domain being analyzed
 * @param siteProfile - Previously analyzed site profile
 * @param homepageBase64 - Base64 encoded homepage screenshot
 * @returns TestQueries with NL and keyword queries
 */
export async function generateTestQueries(
  jobId: string,
  domain: string,
  siteProfile: SiteProfile,
  homepageBase64: string
): Promise<TestQueries> {
  const startTime = Date.now();

  const prompt = `You are testing an e-commerce site's search functionality.

Site: ${siteProfile.company}
Industry: ${siteProfile.industry}
Visible Products: ${siteProfile.visibleProducts.join(', ') || 'None clearly visible'}
Visible Categories: ${siteProfile.visibleCategories.join(', ') || 'None clearly visible'}
Catalog Size: ${siteProfile.estimatedCatalogSize}

Generate TWO search queries to test if their search understands natural language:

1. NATURAL LANGUAGE QUERY: How a real customer would search using conversational language.
   - Include intent, attributes, or context
   - Examples: "red sneakers for running", "moisturizer for dry sensitive skin", "brake pads for 2019 honda civic"

2. KEYWORD QUERY: Simple keywords that their basic search should definitely match.
   - Just the core product terms
   - Examples: "running shoes", "face moisturizer", "honda brake pads"

RULES:
- Base queries on products/categories you can see in the data above
- The NL query should be something their search might FAIL to understand
- The KW query should be something that WILL return results
- If you can't see specific products, use the visible categories

Return JSON:
{
  "naturalLanguageQuery": "string",
  "keywordQuery": "string",
  "queryBasis": "visible_product" | "visible_category" | "inferred",
  "expectedBehavior": "What good search should do with the NL query"
}`;

  const openai = getOpenAIClient();
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
              url: `data:image/jpeg;base64,${homepageBase64}`,
              detail: 'high'
            } 
          }
        ]
      }
    ],
    max_tokens: 500,
    temperature: 0  // Deterministic for consistent query generation
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
          phase: 'query_generation',
          prompt,
          response: content,
          model: 'gpt-4o-mini',
          tokensUsed: response.usage?.total_tokens ?? null,
          durationMs
        }
      });
    }
  } catch (dbError) {
    console.error('[QUERYGEN] Failed to log to database:', dbError);
    // Continue even if logging fails
  }

  // Parse and return
  try {
    const parsed = JSON.parse(cleanJsonResponse(content));
    
    // Validate and provide defaults for required fields
    const testQueries: TestQueries = {
      naturalLanguageQuery: parsed.naturalLanguageQuery || generateFallbackNLQuery(siteProfile),
      keywordQuery: parsed.keywordQuery || generateFallbackKeywordQuery(siteProfile),
      queryBasis: ['visible_product', 'visible_category', 'inferred'].includes(parsed.queryBasis) 
        ? parsed.queryBasis 
        : 'inferred',
      expectedBehavior: parsed.expectedBehavior || 'Should return relevant products matching the search intent'
    };
    
    console.log(`[QUERYGEN] Generated queries for ${domain}:`);
    console.log(`  NL: "${testQueries.naturalLanguageQuery}"`);
    console.log(`  KW: "${testQueries.keywordQuery}"`);
    console.log(`  Basis: ${testQueries.queryBasis}`);
    
    return testQueries;
  } catch (parseError) {
    console.error('[QUERYGEN] Failed to parse LLM response:', parseError);
    console.error('[QUERYGEN] Raw response:', content);
    
    // Return fallback queries on parse failure
    return {
      naturalLanguageQuery: generateFallbackNLQuery(siteProfile),
      keywordQuery: generateFallbackKeywordQuery(siteProfile),
      queryBasis: 'inferred',
      expectedBehavior: 'Should return relevant products matching the search intent'
    };
  }
}

/**
 * Generate a fallback natural language query based on site profile
 */
function generateFallbackNLQuery(siteProfile: SiteProfile): string {
  // If we have visible products, use the first one with intent
  if (siteProfile.visibleProducts.length > 0) {
    const product = siteProfile.visibleProducts[0];
    return `looking for something like ${product}`;
  }
  
  // If we have categories, ask for recommendations
  if (siteProfile.visibleCategories.length > 0) {
    const category = siteProfile.visibleCategories[0];
    return `best ${category.toLowerCase()} for beginners`;
  }
  
  // Industry-specific fallbacks
  const industryQueries: Record<string, string> = {
    'automotive_parts': 'brake pads for my car',
    'beauty': 'moisturizer for dry skin',
    'fashion': 'comfortable shoes for work',
    'electronics': 'wireless headphones under $100',
    'pet': 'food for senior dogs',
    'home': 'cozy blanket for couch',
    'sports': 'running gear for beginners',
    'food': 'healthy snacks for kids',
    'health': 'vitamins for energy'
  };
  
  return industryQueries[siteProfile.industry] || 'popular items on sale';
}

/**
 * Generate a fallback keyword query based on site profile
 */
function generateFallbackKeywordQuery(siteProfile: SiteProfile): string {
  // If we have visible products, extract key terms
  if (siteProfile.visibleProducts.length > 0) {
    // Take first two words of first product
    const product = siteProfile.visibleProducts[0];
    const words = product.split(' ').slice(0, 2).join(' ');
    return words.toLowerCase();
  }
  
  // If we have categories, use the first one
  if (siteProfile.visibleCategories.length > 0) {
    return siteProfile.visibleCategories[0].toLowerCase();
  }
  
  // Industry-specific fallbacks
  const industryKeywords: Record<string, string> = {
    'automotive_parts': 'brake pads',
    'beauty': 'moisturizer',
    'fashion': 'shoes',
    'electronics': 'headphones',
    'pet': 'dog food',
    'home': 'blanket',
    'sports': 'running shoes',
    'food': 'snacks',
    'health': 'vitamins'
  };
  
  return industryKeywords[siteProfile.industry] || 'products';
}


