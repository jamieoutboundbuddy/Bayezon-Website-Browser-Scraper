/**
 * Site reconnaissance module for Smart SDR Agent
 * Analyzes e-commerce homepage to understand the business
 */

import OpenAI from 'openai';
import { SiteProfile } from './types';
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
 * Analyze an e-commerce site homepage screenshot to extract business information
 * 
 * @param jobId - Unique job identifier for logging
 * @param domain - The domain being analyzed
 * @param homepageBase64 - Base64 encoded homepage screenshot
 * @returns SiteProfile with extracted business information
 */
export async function analyzeSite(
  jobId: string,
  domain: string,
  homepageBase64: string
): Promise<SiteProfile> {
  const startTime = Date.now();
  
  const prompt = `Analyze this e-commerce homepage screenshot.

Extract ONLY what you can actually SEE:

1. Company name (from logo/header)
2. Industry: automotive_parts | beauty | fashion | electronics | pet | home | sports | food | health | other
3. List up to 10 SPECIFIC product names visible on the page
4. List category names visible in navigation (up to 10)
5. Estimate catalog size:
   - small: boutique/specialty (<50 products likely)
   - medium: standard e-commerce (50-500 products)  
   - large: major retailer (500+ products)
6. Is there a visible search icon/bar?
7. Search type if visible: modal | page | instant | unknown

IMPORTANT: Only list products/categories you can actually READ in the screenshot.
Do NOT guess or infer products that might exist.

Return JSON only:
{
  "company": "string",
  "industry": "string",
  "visibleProducts": ["Product 1", "Product 2"],
  "visibleCategories": ["Category 1", "Category 2"],
  "estimatedCatalogSize": "small|medium|large",
  "hasSearch": true/false,
  "searchType": "modal|page|instant|unknown"
}`;

  const openai = getOpenAIClient();
  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
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
    max_tokens: 1000,
    temperature: 0  // Deterministic for consistent analysis
  });

  const content = response.choices[0]?.message?.content || '{}';
  const durationMs = Date.now() - startTime;
  
  // Log to database
  try {
    await getDb().llmLog.create({
      data: {
        jobId,
        domain,
        phase: 'reconnaissance',
        prompt,
        response: content,
        model: 'gpt-4o',
        tokensUsed: response.usage?.total_tokens ?? null,
        durationMs
      }
    });
  } catch (dbError) {
    console.error('[RECON] Failed to log to database:', dbError);
    // Continue even if logging fails
  }

  // Parse and return
  try {
    const parsed = JSON.parse(cleanJsonResponse(content));
    
    // Validate and provide defaults for required fields
    const siteProfile: SiteProfile = {
      company: parsed.company || domain,
      industry: parsed.industry || 'other',
      visibleProducts: Array.isArray(parsed.visibleProducts) ? parsed.visibleProducts : [],
      visibleCategories: Array.isArray(parsed.visibleCategories) ? parsed.visibleCategories : [],
      estimatedCatalogSize: ['small', 'medium', 'large'].includes(parsed.estimatedCatalogSize) 
        ? parsed.estimatedCatalogSize 
        : 'medium',
      hasSearch: typeof parsed.hasSearch === 'boolean' ? parsed.hasSearch : true,
      searchType: ['modal', 'page', 'instant', 'unknown'].includes(parsed.searchType) 
        ? parsed.searchType 
        : 'unknown'
    };
    
    console.log(`[RECON] Analyzed ${domain}: ${siteProfile.company} (${siteProfile.industry}), ` +
      `${siteProfile.visibleProducts.length} products, ${siteProfile.visibleCategories.length} categories, ` +
      `hasSearch: ${siteProfile.hasSearch}`);
    
    return siteProfile;
  } catch (parseError) {
    console.error('[RECON] Failed to parse LLM response:', parseError);
    console.error('[RECON] Raw response:', content);
    
    // Return a default profile on parse failure
    return {
      company: domain,
      industry: 'other',
      visibleProducts: [],
      visibleCategories: [],
      estimatedCatalogSize: 'medium',
      hasSearch: true,
      searchType: 'unknown'
    };
  }
}


