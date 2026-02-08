/**
 * Express server with REST API for website search tool
 */

console.log('[SERVER] Starting module imports...');

const uploadRateLimit = new Map<string, number>();

import express, { Request, Response } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import multer from 'multer';
import { parse } from 'csv-parse/sync';
import { v4 as uuidv4 } from 'uuid';

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
import {
  startBatchProcessor,
  triggerBatchProcessing,
  getProcessorStatus
} from './batchProcessor';

console.log('[SERVER] All imports complete, loading config...');
dotenv.config();
console.log('[SERVER] Config loaded, PORT=' + (process.env.PORT || '3000'));

const app = express();
const PORT = parseInt(process.env.PORT || '3000', 10);

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));
app.use('/artifacts', express.static('artifacts'));

// Multer configuration for CSV uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 } // 50MB max
});

// Password verification middleware for CSV operations
const verifyCsvPassword = (req: any, res: any, next: any) => {
  const password = req.headers['x-csv-password'] || req.body.password;
  const csvPassword = process.env.CSV_UPLOAD_PASSWORD;

  if (!csvPassword) {
    console.warn('[CSV] CSV_UPLOAD_PASSWORD not set in environment');
    return res.status(500).json({ error: 'CSV upload not configured' });
  }

  if (!password || password !== csvPassword) {
    return res.status(401).json({ error: 'Invalid CSV upload password' });
  }

  next();
};

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

    const result: SmartAnalysisResult & { adversarial?: any; summary?: any } = {
      jobId,
      domain,
      siteProfile,
      queriesTested: queries,
      comparison,
      confidence,
      emailHook: aiResult.adversarial?.proofQuery
        ? `I searched for "${aiResult.adversarial.proofQuery}" on your site and got ${aiResult.searchResults.naturalLanguage.resultCount === 0 ? 'zero results' : 'irrelevant results'
        }. This is exactly the kind of query your customers are typing.`
        : null,
      screenshotUrls,
      durationMs: Date.now() - startTime,
      // Include full adversarial data and summary for frontend
      adversarial: aiResult.adversarial,
      summary: aiResult.summary
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
 * POST /api/batch/upload - Upload CSV file for batch processing
 * Requires: x-csv-password header or password in body
 * CSV must have 'domain' column
 */
app.post('/api/batch/upload', verifyCsvPassword, upload.single('file'), async (req: any, res: any) => {
  try {
    // Rate limiting
    const now = Date.now();
    const ip = req.ip || 'unknown';
    const lastUpload = uploadRateLimit.get(ip);
    if (lastUpload && now - lastUpload < 60000) {
      return res.status(429).json({ error: 'Too many uploads. Please wait 1 minute.' });
    }
    uploadRateLimit.set(ip, now);

    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const batchId = uuidv4();
    const csvContent = req.file.buffer.toString('utf-8');

    // Parse CSV
    let records: any[];
    try {
      records = parse(csvContent, {
        columns: true,
        skip_empty_lines: true,
        trim: true
      });
    } catch (e: any) {
      return res.status(400).json({ error: `Invalid CSV format: ${e.message}` });
    }

    if (!records.length) {
      return res.status(400).json({ error: 'CSV is empty' });
    }

    // Validate CSV has 'domain' column
    if (!records[0].domain) {
      return res.status(400).json({
        error: 'CSV must have a "domain" column. Headers found: ' + Object.keys(records[0]).join(', ')
      });
    }

    // Deduplicate domains
    const uniqueDomains = new Set<string>();
    const uniqueRecords = records.filter((record: any) => {
      const domain = record.domain?.trim().toLowerCase();
      if (!domain || uniqueDomains.has(domain)) {
        return false;
      }
      uniqueDomains.add(domain);
      return true;
    });

    records = uniqueRecords;

    if (records.length === 0) {
      return res.status(400).json({ error: 'No valid unique domains found in CSV' });
    }

    const db = getDb();
    if (!db) {
      return res.status(500).json({ error: 'Database unavailable' });
    }

    console.log(`[CSV] Processing batch with ${records.length} domains`);

    // Create batch job
    const batchJob = await db.batchJob.create({
      data: {
        batchId,
        fileName: req.file.originalname,
        totalCount: records.length,
        status: 'pending'
      }
    });

    // Create batch job items
    const batchItems = records.map((record: any) => ({
      batchId,
      domain: record.domain.trim().toLowerCase(),
      status: 'queued' as const
    }));

    await db.batchJobItem.createMany({
      data: batchItems
    });

    console.log(`[CSV] Batch ${batchId} created with ${records.length} items`);

    res.json({
      success: true,
      batchId,
      fileName: req.file.originalname,
      totalDomains: records.length,
      status: 'pending',
      message: 'CSV uploaded successfully. Processing will start shortly.'
    });
  } catch (error: any) {
    console.error('[CSV] Upload error:', error);
    res.status(500).json({ error: error.message || 'Upload failed' });
  }
});

/**
 * GET /api/batch/processor/status - Get batch processor status
 * Moved before /:batchId to avoid route conflict
 */
app.get('/api/batch/processor/status', verifyCsvPassword, (req: any, res: any) => {
  const status = getProcessorStatus();
  res.json({
    ...status,
    message: status.running ? 'Batch processor is active' : 'Batch processor is stopped'
  });
});

/**
 * GET /api/batch/:batchId - Get batch job status and progress
 */
app.get('/api/batch/:batchId', verifyCsvPassword, async (req: any, res: any) => {
  try {
    const db = getDb();
    if (!db) {
      return res.status(500).json({ error: 'Database unavailable' });
    }

    const batch = await db.batchJob.findUnique({
      where: { batchId: req.params.batchId }
    });

    if (!batch) {
      return res.status(404).json({ error: 'Batch not found' });
    }

    const items = await db.batchJobItem.findMany({
      where: { batchId: req.params.batchId },
      orderBy: { createdAt: 'desc' }
    });

    const statusCounts = {
      queued: items.filter((i: any) => i.status === 'queued').length,
      running: items.filter((i: any) => i.status === 'running').length,
      completed: items.filter((i: any) => i.status === 'completed').length,
      failed: items.filter((i: any) => i.status === 'failed').length
    };

    res.json({
      batchId: batch.batchId,
      fileName: batch.fileName,
      status: batch.status,
      totalDomains: batch.totalCount,
      progress: {
        completed: batch.completedCount,
        failed: batch.failedCount,
        remaining: batch.totalCount - batch.completedCount - batch.failedCount,
        statusBreakdown: statusCounts
      },
      createdAt: batch.createdAt,
      startedAt: batch.startedAt,
      completedAt: batch.completedAt,
      recentItems: items.slice(0, 20).map((item: any) => ({
        domain: item.domain,
        status: item.status,
        error: item.error,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt
      }))
    });
  } catch (error: any) {
    console.error('[CSV] Batch status error:', error);
    res.status(500).json({ error: error.message || 'Failed to get batch status' });
  }
});

/**
 * GET /api/batch/:batchId/results - Get batch results with pagination
 */
app.get('/api/batch/:batchId/results', verifyCsvPassword, async (req: any, res: any) => {
  try {
    const { limit = 50, offset = 0 } = req.query;
    const db = getDb();
    if (!db) {
      return res.status(500).json({ error: 'Database unavailable' });
    }

    const batch = await db.batchJob.findUnique({
      where: { batchId: req.params.batchId }
    });

    if (!batch) {
      return res.status(404).json({ error: 'Batch not found' });
    }

    const items = await db.batchJobItem.findMany({
      where: {
        batchId: req.params.batchId,
        status: 'completed'
      },
      take: parseInt(limit),
      skip: parseInt(offset),
      orderBy: { updatedAt: 'desc' }
    });

    res.json({
      batchId: batch.batchId,
      totalCompleted: batch.completedCount,
      limit: parseInt(limit),
      offset: parseInt(offset),
      results: items.map((item: any) => ({
        domain: item.domain,
        result: item.result,
        completedAt: item.updatedAt
      }))
    });
  } catch (error: any) {
    console.error('[CSV] Results error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/batch/:batchId/failed - Get failed items for retry
 */
app.get('/api/batch/:batchId/failed', verifyCsvPassword, async (req: any, res: any) => {
  try {
    const db = getDb();
    if (!db) {
      return res.status(500).json({ error: 'Database unavailable' });
    }

    const batch = await db.batchJob.findUnique({
      where: { batchId: req.params.batchId }
    });

    if (!batch) {
      return res.status(404).json({ error: 'Batch not found' });
    }

    const failedItems = await db.batchJobItem.findMany({
      where: {
        batchId: req.params.batchId,
        status: 'failed'
      },
      orderBy: { updatedAt: 'desc' }
    });

    res.json({
      batchId: batch.batchId,
      totalFailed: batch.failedCount,
      failed: failedItems.map((item: any) => ({
        domain: item.domain,
        error: item.error,
        failedAt: item.updatedAt
      }))
    });
  } catch (error: any) {
    console.error('[CSV] Failed items error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/batch/:batchId/start - Manually trigger batch processing
 * Also retries failed items
 */
app.post('/api/batch/:batchId/start', verifyCsvPassword, async (req: any, res: any) => {
  try {
    const success = await triggerBatchProcessing(req.params.batchId);

    if (!success) {
      return res.status(404).json({ error: 'Batch not found' });
    }

    res.json({
      success: true,
      message: 'Batch processing triggered. Failed items will be retried.',
      batchId: req.params.batchId
    });
  } catch (error: any) {
    console.error('[CSV] Start batch error:', error);
    res.status(500).json({ error: error.message });
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
 * Verify database tables exist on startup
 */
async function verifyDatabaseTables() {
  try {
    const db = getDb();
    if (!db) {
      console.error('[DB] Database connection not available');
      return;
    }

    console.log('[DB] Checking database tables...');
    const tables = await db.$queryRaw<{ table_name: string }[]>`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public'
    `;

    const tableNames = tables.map(t => t.table_name);
    console.log('[DB] Found tables:', tableNames.join(', '));

    // Check for required batch tables
    const requiredTables = ['batch_jobs', 'batch_job_items'];
    const missingTables = requiredTables.filter(t => !tableNames.includes(t));

    if (missingTables.length > 0) {
      console.error('[DB] Missing required tables:', missingTables.join(', '));
      console.error('[DB] Run "npx prisma db push" to create missing tables');
    } else {
      console.log('[DB] All required batch tables present ✓');
    }
  } catch (error: any) {
    console.error('[DB] Error checking tables:', error.message);
  }
}

/**
 * Start server (only if not in Vercel/serverless environment)
 */
if (process.env.VERCEL !== '1') {
  app.listen(PORT, '0.0.0.0', async () => {
    console.log(`🚀 Website Search Tool server running on http://localhost:${PORT}`);
    console.log(`📸 Screenshots will be saved to ./artifacts/`);

    // Verify database tables
    await verifyDatabaseTables();

    // Recover stuck items
    await import('./batchProcessor').then(m => m.recoverStuckItems());

    // Start the batch processor
    startBatchProcessor();
  });
}

// Export app for Vercel/serverless
export default app;

