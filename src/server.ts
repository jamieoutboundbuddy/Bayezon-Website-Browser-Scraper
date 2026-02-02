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
import { closeBrowser } from './search';
import { 
  SmartAnalysisResult, 
  SiteProfile, 
  TestQueries, 
  ComparisonAnalysis, 
  Confidence 
} from './types';
import { isOpenAIConfigured } from './analyze';
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
 * Get the base URL from a request for building full screenshot URLs
 */
function getBaseUrl(req: Request): string {
  const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'http';
  const host = req.headers['x-forwarded-host'] || req.headers.host || 'localhost:3000';
  return `${protocol}://${host}`;
}

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
 * POST /api/analyze - Smart SDR analysis with AI Agent (domain only)
 * Analyzes an e-commerce site's search quality using Stagehand + GPT-5-mini
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
      hint: 'Smart analysis requires OpenAI for AI-powered browser control'
    });
  }
  
  const startTime = Date.now();
  const jobId = createJob(domain, 'smart-analysis');
  const normalizedDomain = normalizeDomain(domain);
  const domainName = getDomainName(normalizedDomain);
  
  try {
    console.log(`\n[ANALYZE] ========================================`);
    console.log(`[ANALYZE] Starting AI-powered Smart analysis for: ${domain}`);
    console.log(`[ANALYZE] Job ID: ${jobId}`);
    console.log(`[ANALYZE] ========================================\n`);
    
    // Use AI Agent (Stagehand) for the entire analysis - this works on ANY website
    const aiResult = await aiFullAnalysis(jobId, domain);
    
    // Build screenshot URLs
    const baseUrl = getBaseUrl(req);
    const screenshotUrls: Record<string, string> = {
      homepage: `${baseUrl}${getArtifactUrl(jobId, domainName, 'homepage')}`,
      results_nl: `${baseUrl}${getArtifactUrl(jobId, domainName, 'results_nl')}`,
      results_kw: `${baseUrl}${getArtifactUrl(jobId, domainName, 'results_kw')}`
    };
    
    // Convert AI Agent result to SmartAnalysisResult format
    const siteProfile: SiteProfile = {
      company: aiResult.siteProfile.companyName,
      industry: aiResult.siteProfile.industry,
      visibleProducts: [],
      visibleCategories: aiResult.siteProfile.visibleCategories,
      estimatedCatalogSize: 'medium',
      hasSearch: aiResult.siteProfile.hasSearch,
      searchType: aiResult.siteProfile.searchType
    };
    
    const comparison: ComparisonAnalysis = {
      nlResultCount: aiResult.searchResults.naturalLanguage.resultCount,
      nlRelevance: aiResult.comparison.nlRelevance,
      nlProductsShown: aiResult.searchResults.naturalLanguage.productsFound,
      kwResultCount: aiResult.searchResults.keyword.resultCount,
      kwRelevance: aiResult.comparison.kwRelevance,
      kwProductsShown: aiResult.searchResults.keyword.productsFound,
      missedProducts: [],
      verdict: aiResult.comparison.verdict,
      verdictReason: aiResult.comparison.reason
    };
    
    const queries: TestQueries = {
      naturalLanguageQuery: aiResult.nlQuery,
      keywordQuery: aiResult.kwQuery,
      queryBasis: 'ai-generated',
      expectedBehavior: 'AI-determined based on site analysis'
    };
    
    const confidence = {
      level: (aiResult.searchResults.naturalLanguage.searchSuccess && aiResult.searchResults.keyword.searchSuccess) 
        ? 'high' as const 
        : 'medium' as const,
      reasons: [
        `AI successfully navigated ${domain}`,
        `Search type detected: ${aiResult.siteProfile.searchType}`,
        `NL search: ${aiResult.searchResults.naturalLanguage.searchSuccess ? 'success' : 'failed'}`,
        `KW search: ${aiResult.searchResults.keyword.searchSuccess ? 'success' : 'failed'}`,
      ]
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
            emailHook: null,
            screenshotUrls: screenshotUrls as any
          }
        });
        console.log(`[ANALYZE] Results saved to database`);
      }
    } catch (dbError) {
      console.error(`[ANALYZE] Failed to save to database (continuing anyway):`, dbError);
      // Continue anyway - don't fail the request just because DB save failed
    }
    
    const result: SmartAnalysisResult = {
      jobId,
      domain,
      siteProfile,
      queriesTested: queries,
      comparison,
      confidence,
      emailHook: null,
      screenshotUrls,
      durationMs: Date.now() - startTime
    };
    
    console.log(`\n[ANALYZE] ========================================`);
    console.log(`[ANALYZE] Completed in ${result.durationMs}ms`);
    console.log(`[ANALYZE] Verdict: ${comparison.verdict}`);
    console.log(`[ANALYZE] ========================================\n`);
    
    res.json(result);
    
  } catch (error: any) {
    console.error(`[ANALYZE] Error:`, error);
    res.status(500).json({ 
      error: error.message || 'Smart analysis failed',
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

