/**
 * Express server with REST API for website search tool
 */

import express, { Request, Response } from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';

import {
  createJob,
  getJob,
  cleanupOldJobs,
} from './jobs';
import { runSearchJourney, runDualSearch, closeBrowser } from './search';
import { 
  SearchScreenshot, 
  SmartAnalysisResult, 
  SiteProfile, 
  TestQueries, 
  ComparisonAnalysis, 
  Confidence 
} from './types';
import { analyzeSearchQuality, evaluateSearchComparison, isOpenAIConfigured, ComprehensiveAnalysis } from './analyze';
import { analyzeSite } from './reconnaissance';
import { generateTestQueries } from './queryGenerator';
import { getDb } from './db';
import { aiFullAnalysis } from './aiAgent';
import { 
  getArtifactPath, 
  getArtifactUrl, 
  normalizeDomain, 
  getDomainName 
} from './utils';

dotenv.config();

const app = express();
const PORT = parseInt(process.env.PORT || '3000', 10);

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));
app.use('/artifacts', express.static('artifacts'));

/**
 * Health check endpoint
 */
app.get('/api/health', (req: Request, res: Response) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    version: '1.0.0',
  });
});

/**
 * POST /api/search - Start a new search job
 * Body: { domain: string, query: string }
 * Returns: { jobId: string }
 */
app.post('/api/search', (req: Request, res: Response) => {
  try {
    const { domain, query } = req.body;
    
    if (!domain) {
      return res.status(400).json({ error: 'domain is required' });
    }
    
    if (!query) {
      return res.status(400).json({ error: 'query is required' });
    }
    
    const jobId = createJob(domain, query);
    
    // Start search in background (don't await)
    runSearchAsync(jobId, domain, query).catch(error => {
      console.error(`Error in background search ${jobId}:`, error);
    });
    
    res.json({ jobId });
  } catch (error: any) {
    console.error('Error creating search job:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

/**
 * Convert screenshot URL to base64 data URL for OpenAI
 */
function screenshotToBase64(screenshotUrl: string): string | null {
  try {
    // Convert URL path to file path
    const filePath = path.join(process.cwd(), screenshotUrl);
    if (fs.existsSync(filePath)) {
      const imageBuffer = fs.readFileSync(filePath);
      const base64 = imageBuffer.toString('base64');
      return `data:image/jpeg;base64,${base64}`;
    }
  } catch (e) {
    console.error('Error converting screenshot to base64:', e);
  }
  return null;
}

/**
 * Read a screenshot file and return raw base64 (no data URL prefix)
 */
function readScreenshotAsBase64(screenshotPath: string): string {
  try {
    if (fs.existsSync(screenshotPath)) {
      const imageBuffer = fs.readFileSync(screenshotPath);
      return imageBuffer.toString('base64');
    }
  } catch (e) {
    console.error('Error reading screenshot as base64:', e);
  }
  return '';
}

/**
 * Get the base URL from a request for building full screenshot URLs
 */
function getBaseUrl(req: Request): string {
  const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'http';
  const host = req.headers['x-forwarded-host'] || req.headers.host || 'localhost:3000';
  return `${protocol}://${host}`;
}

/**
 * Calculate confidence level based on query generation and comparison results
 */
function calculateConfidence(
  queries: TestQueries,
  comparison: ComparisonAnalysis,
  siteProfile: SiteProfile
): Confidence {
  const reasons: string[] = [];
  let confidenceScore = 0;
  
  // Higher confidence if queries based on visible products/categories
  if (queries.queryBasis === 'visible_product') {
    confidenceScore += 30;
    reasons.push('Queries based on visible products');
  } else if (queries.queryBasis === 'visible_category') {
    confidenceScore += 20;
    reasons.push('Queries based on visible categories');
  } else {
    confidenceScore += 5;
    reasons.push('Queries inferred from industry');
  }
  
  // Higher confidence if we got clear results from both searches
  if (comparison.nlResultCount !== null && comparison.nlResultCount > 0) {
    confidenceScore += 15;
    reasons.push('NL search returned results');
  }
  if (comparison.kwResultCount !== null && comparison.kwResultCount > 0) {
    confidenceScore += 15;
    reasons.push('Keyword search returned results');
  }
  
  // Higher confidence if verdict is clear (OUTREACH or SKIP vs REVIEW/INCONCLUSIVE)
  if (comparison.verdict === 'OUTREACH' || comparison.verdict === 'SKIP') {
    confidenceScore += 20;
    reasons.push('Clear verdict from comparison');
  }
  
  // Higher confidence if we have a good understanding of the catalog
  if (siteProfile.visibleProducts.length >= 3) {
    confidenceScore += 10;
    reasons.push('Multiple products visible on homepage');
  }
  if (siteProfile.visibleCategories.length >= 3) {
    confidenceScore += 10;
    reasons.push('Multiple categories visible in navigation');
  }
  
  // Determine confidence level
  let level: 'high' | 'medium' | 'low';
  if (confidenceScore >= 70) {
    level = 'high';
  } else if (confidenceScore >= 40) {
    level = 'medium';
  } else {
    level = 'low';
  }
  
  return { level, reasons };
}

/**
 * Format screenshots for OpenAI Vision API
 */
interface OpenAIImageContent {
  type: 'image_url';
  image_url: {
    url: string;
    detail?: 'low' | 'high' | 'auto';
  };
}

interface ScreenshotWithBase64 extends SearchScreenshot {
  base64?: string;
  openai_format?: OpenAIImageContent;
}

function formatScreenshotsForOpenAI(screenshots: SearchScreenshot[], baseUrl?: string): ScreenshotWithBase64[] {
  return screenshots.map(screenshot => {
    const base64 = screenshotToBase64(screenshot.screenshotUrl);
    const result: ScreenshotWithBase64 = {
      ...screenshot,
    };
    
    if (base64) {
      result.base64 = base64;
      result.openai_format = {
        type: 'image_url',
        image_url: {
          url: base64,
          detail: 'high',
        },
      };
    } else if (baseUrl) {
      // Fallback to URL if base64 fails
      result.openai_format = {
        type: 'image_url',
        image_url: {
          url: `${baseUrl}${screenshot.screenshotUrl}`,
          detail: 'high',
        },
      };
    }
    
    return result;
  });
}

/**
 * GET /api/search/:jobId - Get search status & results
 * Query params:
 *   - format=base64: Include base64-encoded images for OpenAI
 *   - base_url=https://...: Base URL for screenshot URLs (for OpenAI URL format)
 * Returns: { jobId, status, progressPct, screenshots, error? }
 */
app.get('/api/search/:jobId', (req: Request, res: Response) => {
  try {
    const { jobId } = req.params;
    const { format, base_url } = req.query;
    const job = getJob(jobId);
    
    if (!job) {
      return res.status(404).json({ error: 'Job not found' });
    }
    
    // If base64 format requested, include base64 encoded images
    if (format === 'base64' || format === 'openai') {
      const result = {
        ...job.result,
        screenshots: formatScreenshotsForOpenAI(job.result.screenshots, base_url as string),
      };
      return res.json(result);
    }
    
    res.json(job.result);
  } catch (error: any) {
    console.error('Error getting search job:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

/**
 * POST /api/search/sync - Synchronous search (waits for completion)
 * Body: { domain: string, query: string, analyze?: boolean }
 * Returns: Complete result with optional AI analysis for email outreach
 */
app.post('/api/search/sync', async (req: Request, res: Response) => {
  try {
    const { domain, query, analyze = false } = req.body;
    
    if (!domain) {
      return res.status(400).json({ error: 'domain is required' });
    }
    
    if (!query) {
      return res.status(400).json({ error: 'query is required' });
    }
    
    // Check if analysis requested but OpenAI not configured
    if (analyze && !isOpenAIConfigured()) {
      return res.status(400).json({ 
        error: 'OpenAI API key not configured. Set OPENAI_API_KEY environment variable.',
        hint: 'Add OPENAI_API_KEY to your Railway environment variables'
      });
    }
    
    console.log(`[SYNC] Starting synchronous search: ${domain} - "${query}" (analyze: ${analyze})`);
    const jobId = createJob(domain, query);
    
    // Run search and wait for completion
    const startTime = Date.now();
    const searchResult = await runSearchJourney(jobId, domain, query);
    const searchDuration = Date.now() - startTime;
    
    const job = getJob(jobId);
    if (!job) {
      return res.status(500).json({ error: 'Job disappeared after completion' });
    }
    
    // Get base URL from request for full URLs
    const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'http';
    const host = req.headers['x-forwarded-host'] || req.headers.host || 'localhost:3000';
    const baseUrl = `${protocol}://${host}`;
    
    // Build screenshot URLs
    const screenshotUrls: Record<string, string> = {};
    for (const screenshot of job.result.screenshots) {
      screenshotUrls[screenshot.stage] = `${baseUrl}${screenshot.screenshotUrl}`;
    }
    
    // If analysis requested, run OpenAI Vision analysis
    if (analyze) {
      console.log(`[SYNC] Running OpenAI analysis...`);
      const analysisStartTime = Date.now();
      
      try {
        const analysis = await analyzeSearchQuality(
          domain,
          query,
          job.result.screenshots,
          {
            homepageLoaded: job.result.screenshots.some(s => s.stage === 'homepage'),
            searchIconFound: job.result.screenshots.some(s => s.stage === 'search_modal'),
            searchInputFound: job.result.screenshots.some(s => s.stage === 'search_modal'),
            searchSubmitted: job.result.screenshots.some(s => s.stage === 'search_results'),
            resultsLoaded: job.result.screenshots.some(s => s.stage === 'search_results'),
          }
        );
        
        const analysisDuration = Date.now() - analysisStartTime;
        const totalDuration = Date.now() - startTime;
        
        console.log(`[SYNC] Analysis completed in ${analysisDuration}ms (total: ${totalDuration}ms)`);
        
        // Return comprehensive analysis response
        const result = {
          jobId,
          timestamp: new Date().toISOString(),
          duration_ms: totalDuration,
          search_duration_ms: searchDuration,
          analysis_duration_ms: analysisDuration,
          status: job.result.status,
          
          // Full analysis data
          ...analysis,
          
          // Screenshot URLs
          screenshot_urls: screenshotUrls,
          screenshots_count: job.result.screenshots.length,
          
          // Raw data if needed
          raw_search_result: {
            progressPct: job.result.progressPct,
            error: job.result.error,
          },
        };
        
        return res.json(result);
        
      } catch (analysisError: any) {
        console.error('[SYNC] Analysis failed:', analysisError);
        
        // Return search results without analysis
        return res.json({
          jobId,
          timestamp: new Date().toISOString(),
          duration_ms: Date.now() - startTime,
          status: job.result.status,
          analysis_error: analysisError.message,
          screenshot_urls: screenshotUrls,
          screenshots_count: job.result.screenshots.length,
          screenshots: formatScreenshotsForOpenAI(job.result.screenshots, baseUrl),
        });
      }
    }
    
    // Return basic result without analysis
    const result = {
      jobId,
      timestamp: new Date().toISOString(),
      duration_ms: searchDuration,
      status: job.result.status,
      progressPct: job.result.progressPct,
      error: job.result.error,
      screenshot_urls: screenshotUrls,
      screenshots_count: job.result.screenshots.length,
      screenshots: formatScreenshotsForOpenAI(job.result.screenshots, baseUrl),
      openai_images: formatScreenshotsForOpenAI(job.result.screenshots, baseUrl)
        .map(s => s.openai_format)
        .filter(Boolean),
    };
    
    console.log(`[SYNC] Completed in ${searchDuration}ms with ${result.screenshots.length} screenshots`);
    res.json(result);
    
  } catch (error: any) {
    console.error('Error in sync search:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

/**
 * GET /api/config - Check server configuration
 */
app.get('/api/config', (req: Request, res: Response) => {
  res.json({
    openai_configured: isOpenAIConfigured(),
    version: '1.1.0',
    features: {
      sync_search: true,
      async_search: true,
      base64_screenshots: true,
      ai_analysis: isOpenAIConfigured(),
      smart_analysis: isOpenAIConfigured(),
    },
  });
});

/**
 * POST /api/analyze - Smart SDR analysis (domain only)
 * Analyzes an e-commerce site's search quality using AI
 * Body: { domain: string }
 * Returns: SmartAnalysisResult
 */
app.post('/api/analyze', async (req: Request, res: Response) => {
  const { domain } = req.body;
  
  if (!domain) {
    return res.status(400).json({ error: 'domain is required' });
  }
  
  // Check if OpenAI is configured (required for smart analysis)
  if (!isOpenAIConfigured()) {
    return res.status(400).json({ 
      error: 'OpenAI API key not configured. Set OPENAI_API_KEY environment variable.',
      hint: 'Smart analysis requires OpenAI for site reconnaissance and evaluation'
    });
  }
  
  const startTime = Date.now();
  const jobId = createJob(domain, 'smart-analysis');
  const normalizedDomain = normalizeDomain(domain);
  const domainName = getDomainName(normalizedDomain);
  
  try {
    console.log(`[SMART] Starting analysis for: ${domain}`);
    
    // Phase 1: Capture homepage and analyze using runDualSearch
    // This creates ONE browser session and does everything in a single pass
    console.log(`[SMART] Phase 1: Reconnaissance (capturing homepage)`);
    
    // First, we need to capture just the homepage to analyze it
    // We'll do a minimal search journey that just gets the homepage
    const tempResult = await runSearchJourney(jobId + '-recon', domain, 'test');
    
    // Find the homepage screenshot
    const homepageScreenshot = tempResult.screenshots.find(s => s.stage === 'homepage');
    if (!homepageScreenshot) {
      return res.status(500).json({ 
        error: 'Failed to capture homepage screenshot',
        jobId 
      });
    }
    
    // Read homepage as base64
    const homepagePath = path.join(process.cwd(), homepageScreenshot.screenshotUrl);
    const homepageBase64 = readScreenshotAsBase64(homepagePath);
    
    if (!homepageBase64) {
      return res.status(500).json({ 
        error: 'Failed to read homepage screenshot',
        jobId 
      });
    }
    
    // Analyze the site
    const siteProfile = await analyzeSite(jobId, domain, homepageBase64);
    
    // Check for login wall / no search
    if (!siteProfile.hasSearch) {
      console.log(`[SMART] No search functionality detected on ${domain}`);
      return res.json({
        jobId,
        domain,
        verdict: 'INCONCLUSIVE',
        reason: 'No search functionality detected',
        siteProfile,
        durationMs: Date.now() - startTime
      });
    }
    
    // Phase 2: Generate queries
    console.log(`[SMART] Phase 2: Query Generation`);
    const queries = await generateTestQueries(jobId, domain, siteProfile, homepageBase64);
    
    // Phase 3: Execute dual search
    // IMPORTANT: Wait a bit for the previous Browserbase session to fully close
    console.log(`[SMART] Phase 3: Dual Search (waiting for previous session to close...)`);
    await new Promise(resolve => setTimeout(resolve, 3000)); // Wait 3 seconds
    
    const searchResults = await runDualSearch(jobId, domain, queries);
    
    // Phase 4: Evaluate
    console.log(`[SMART] Phase 4: Evaluation`);
    const nlBase64 = readScreenshotAsBase64(searchResults.naturalLanguage.screenshotPath);
    const kwBase64 = readScreenshotAsBase64(searchResults.keyword.screenshotPath);
    
    if (!nlBase64 || !kwBase64) {
      return res.status(500).json({ 
        error: 'Failed to read search result screenshots',
        jobId 
      });
    }
    
    const { comparison, emailHook } = await evaluateSearchComparison(
      jobId, domain, queries, nlBase64, kwBase64, siteProfile
    );
    
    // Calculate confidence
    const confidence = calculateConfidence(queries, comparison, siteProfile);
    
    // Build screenshot URLs
    const baseUrl = getBaseUrl(req);
    const screenshotUrls: Record<string, string> = {
      homepage: `${baseUrl}${getArtifactUrl(jobId, domainName, 'homepage')}`,
      results_nl: `${baseUrl}${getArtifactUrl(jobId, domainName, 'results_nl')}`,
      results_kw: `${baseUrl}${getArtifactUrl(jobId, domainName, 'results_kw')}`
    };
    
    // Save to database (optional - don't fail if DB not available)
    try {
      const db = getDb();
      if (db) {
        await db.analysisResult.create({
          data: {
            jobId,
            domain,
            siteProfile: siteProfile as any,
            queriesTested: queries as any,
            comparison: comparison as any,
            verdict: comparison.verdict,
            confidence: confidence.level,
            confidenceReasons: confidence.reasons,
            emailHook,
            screenshotUrls: screenshotUrls as any
          }
        });
        console.log(`[SMART] Results saved to database`);
      }
    } catch (dbError) {
      console.error(`[SMART] Failed to save to database (continuing anyway):`, dbError);
      // Continue anyway - don't fail the request just because DB save failed
    }
    
    const result: SmartAnalysisResult = {
      jobId,
      domain,
      siteProfile,
      queriesTested: queries,
      comparison,
      confidence,
      emailHook,
      screenshotUrls,
      durationMs: Date.now() - startTime
    };
    
    console.log(`[SMART] Completed: ${comparison.verdict} (${confidence.level} confidence) in ${result.durationMs}ms`);
    res.json(result);
    
  } catch (error: any) {
    console.error(`[SMART] Error:`, error);
    res.status(500).json({ 
      error: error.message || 'Smart analysis failed',
      jobId 
    });
  }
});

/**
 * POST /api/ai-analyze - AI-powered autonomous analysis
 * Uses Stagehand for intelligent, adaptive browser control
 * Body: { domain: string }
 * Returns: AI-powered analysis results
 */
app.post('/api/ai-analyze', async (req: Request, res: Response) => {
  const { domain } = req.body;
  
  if (!domain) {
    return res.status(400).json({ error: 'domain is required' });
  }
  
  // Check if OpenAI is configured (required for AI analysis)
  if (!isOpenAIConfigured()) {
    return res.status(400).json({ 
      error: 'OpenAI API key not configured. Set OPENAI_API_KEY environment variable.',
      hint: 'AI analysis requires OpenAI for vision-based browser control'
    });
  }
  
  const startTime = Date.now();
  const jobId = createJob(domain, 'ai-analysis');
  const normalizedDomain = normalizeDomain(domain);
  const domainName = getDomainName(normalizedDomain);
  
  try {
    console.log(`\n[AI-ANALYZE] ========================================`);
    console.log(`[AI-ANALYZE] Starting AI-powered analysis for: ${domain}`);
    console.log(`[AI-ANALYZE] Job ID: ${jobId}`);
    console.log(`[AI-ANALYZE] ========================================\n`);
    
    // Run the full AI-powered analysis
    const result = await aiFullAnalysis(jobId, domain);
    
    // Build screenshot URLs
    const baseUrl = getBaseUrl(req);
    const screenshotUrls: Record<string, string> = {
      homepage: `${baseUrl}${getArtifactUrl(jobId, domainName, 'homepage')}`,
      results_nl: `${baseUrl}${getArtifactUrl(jobId, domainName, 'results_nl')}`,
      results_kw: `${baseUrl}${getArtifactUrl(jobId, domainName, 'results_kw')}`
    };
    
    const response = {
      jobId,
      domain,
      mode: 'ai-autonomous',
      siteProfile: {
        companyName: result.siteProfile.companyName,
        industry: result.siteProfile.industry,
        hasSearch: result.siteProfile.hasSearch,
        searchType: result.siteProfile.searchType,
        visibleCategories: result.siteProfile.visibleCategories,
        aiObservations: result.siteProfile.aiObservations,
      },
      queriesTested: {
        naturalLanguageQuery: result.nlQuery,
        keywordQuery: result.kwQuery,
        queryBasis: 'ai-generated',
        expectedBehavior: 'AI-determined based on site analysis',
      },
      comparison: {
        nlRelevance: result.comparison.nlRelevance,
        kwRelevance: result.comparison.kwRelevance,
        verdict: result.comparison.verdict,
        reason: result.comparison.reason,
        nlProductsFound: result.searchResults.naturalLanguage.productsFound,
        kwProductsFound: result.searchResults.keyword.productsFound,
        nlObservations: result.searchResults.naturalLanguage.aiObservations,
        kwObservations: result.searchResults.keyword.aiObservations,
      },
      confidence: {
        level: result.searchResults.naturalLanguage.searchSuccess && result.searchResults.keyword.searchSuccess 
          ? 'high' : 'medium',
        reasons: [
          `AI successfully navigated ${domain}`,
          `Search type detected: ${result.siteProfile.searchType}`,
          `NL search: ${result.searchResults.naturalLanguage.searchSuccess ? 'success' : 'failed'}`,
          `KW search: ${result.searchResults.keyword.searchSuccess ? 'success' : 'failed'}`,
        ]
      },
      screenshotUrls,
      durationMs: Date.now() - startTime
    };
    
    console.log(`\n[AI-ANALYZE] ========================================`);
    console.log(`[AI-ANALYZE] Completed in ${response.durationMs}ms`);
    console.log(`[AI-ANALYZE] Verdict: ${response.comparison.verdict}`);
    console.log(`[AI-ANALYZE] ========================================\n`);
    
    res.json(response);
    
  } catch (error: any) {
    console.error(`[AI-ANALYZE] Error:`, error);
    res.status(500).json({ 
      error: error.message || 'AI analysis failed',
      jobId,
      hint: 'Check that OPENAI_API_KEY and BROWSERBASE credentials are correct'
    });
  }
});

/**
 * Run search asynchronously
 */
async function runSearchAsync(jobId: string, domain: string, query: string): Promise<void> {
  try {
    await runSearchJourney(jobId, domain, query);
  } catch (error: any) {
    console.error(`[${jobId}] Fatal error in search journey:`, error);
  }
}

/**
 * Cleanup old jobs periodically
 */
setInterval(() => {
  cleanupOldJobs();
}, 60 * 60 * 1000); // Every hour

/**
 * Graceful shutdown
 */
process.on('SIGINT', async () => {
  console.log('\nShutting down gracefully...');
  await closeBrowser();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('\nShutting down gracefully...');
  await closeBrowser();
  process.exit(0);
});

/**
 * Start server (only if not in Vercel/serverless environment)
 */
if (process.env.VERCEL !== '1') {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Website Search Tool server running on http://localhost:${PORT}`);
    console.log(`📸 Screenshots will be saved to ./artifacts/`);
  });
}

// Export app for Vercel/serverless
export default app;

