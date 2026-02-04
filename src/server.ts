/**
 * Express server with REST API for website search tool
 */

import express, { Request, Response } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';

import {
  createJob,
  getJob,
  cleanupOldJobs,
} from './jobs';
import { 
  SmartAnalysisResult, 
  SiteProfile, 
  TestQueries, 
  ComparisonAnalysis
} from './types';
import { isOpenAIConfigured } from './analyze';
import { aiFullAnalysis } from './aiAgent';
import { getDb } from './db';
import { 
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
 * GET /api/job/:jobId - Get job status
 * Returns: { jobId, status, progressPct, error? }
 */
app.get('/api/job/:jobId', (req: Request, res: Response) => {
  try {
    const { jobId } = req.params;
    const job = getJob(jobId);
    
    if (!job) {
      return res.status(404).json({ error: 'Job not found' });
    }
    
    res.json(job.result);
  } catch (error: any) {
    console.error('Error getting job:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

/**
 * GET /api/config - Check server configuration
 */
app.get('/api/config', (req: Request, res: Response) => {
  res.json({
    openai_configured: isOpenAIConfigured(),
    version: '2.0.0',
    features: {
      smart_analysis: isOpenAIConfigured(),
      adversarial_testing: isOpenAIConfigured(),
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
      results: `${baseUrl}${getArtifactUrl(jobId, domainName, 'results')}`
    };
    
    // Add individual query result screenshots if available
    if (aiResult.adversarial?.queriesTested) {
      aiResult.adversarial.queriesTested.forEach((q, i) => {
        screenshotUrls[`results_${i + 1}`] = `${baseUrl}${getArtifactUrl(jobId, domainName, `results_${i + 1}`)}`;
      });
    }
    
    // Convert AI Agent result to SmartAnalysisResult format
    const searchTypeMap: Record<string, 'modal' | 'page' | 'instant' | 'unknown'> = {
      'visible_input': 'instant',
      'icon_triggered': 'modal',
      'hamburger_menu': 'modal',
      'none': 'unknown'
    };
    
    const siteProfile: SiteProfile = {
      company: aiResult.siteProfile.companyName,
      industry: aiResult.siteProfile.industry,
      visibleProducts: [],
      visibleCategories: aiResult.siteProfile.visibleCategories,
      estimatedCatalogSize: 'medium',
      hasSearch: aiResult.siteProfile.hasSearch,
      searchType: searchTypeMap[aiResult.siteProfile.searchType] || 'unknown'
    };
    
    // Simplified comparison - no keyword search
    const comparison: ComparisonAnalysis = {
      nlResultCount: aiResult.searchResults.naturalLanguage.resultCount,
      nlRelevance: aiResult.comparison.nlRelevance,
      nlProductsShown: aiResult.searchResults.naturalLanguage.productsFound,
      kwResultCount: null,  // No keyword search
      kwRelevance: 'none',
      kwProductsShown: [],
      missedProducts: [],
      verdict: aiResult.comparison.verdict,
      verdictReason: aiResult.comparison.reason
    };
    
    // Include adversarial testing info in queries
    const queries: TestQueries = {
      naturalLanguageQuery: aiResult.nlQuery,
      keywordQuery: '',  // No keyword search
      queryBasis: 'inferred',
      expectedBehavior: aiResult.adversarial?.proofQuery 
        ? `Search failed on "${aiResult.adversarial.proofQuery}"` 
        : `Tested ${aiResult.adversarial?.queriesTested.length || 1} queries`
    };
    
    const confidence = {
      level: aiResult.adversarial?.proofQuery 
        ? 'high' as const  // High confidence when we found a failure
        : 'medium' as const,
      reasons: aiResult.adversarial?.queriesTested.map(q => 
        `Query ${q.attempt}: "${q.query}" → ${q.passed ? 'PASSED' : 'FAILED'}`
      ) || [`Tested: ${aiResult.nlQuery}`]
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
    
    const result: SmartAnalysisResult & { adversarial?: any } = {
      jobId,
      domain,
      siteProfile,
      queriesTested: queries,
      comparison,
      confidence,
      emailHook: aiResult.adversarial?.proofQuery 
        ? `I searched for "${aiResult.adversarial.proofQuery}" on your site and got ${
            aiResult.searchResults.naturalLanguage.resultCount === 0 ? 'zero results' : 'irrelevant results'
          }. This is exactly the kind of query your customers are typing.`
        : null,
      screenshotUrls,
      durationMs: Date.now() - startTime,
      // Include full adversarial data for frontend
      adversarial: aiResult.adversarial
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
 * Cleanup old jobs periodically
 */
setInterval(() => {
  cleanupOldJobs();
}, 60 * 60 * 1000); // Every hour

/**
 * Graceful shutdown
 */
process.on('SIGINT', () => {
  console.log('\nShutting down gracefully...');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\nShutting down gracefully...');
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

