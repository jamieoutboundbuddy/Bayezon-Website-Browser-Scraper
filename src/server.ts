/**
 * Express server with REST API for website search tool
 */

import express, { Request, Response } from 'express';
import cors from 'cors';
import path from 'path';
import dotenv from 'dotenv';

import {
  createJob,
  getJob,
  cleanupOldJobs,
} from './jobs';
import { runSearchJourney, closeBrowser } from './search';

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
 * GET /api/search/:jobId - Get search status & results
 * Returns: { jobId, status, progressPct, screenshots, error? }
 */
app.get('/api/search/:jobId', (req: Request, res: Response) => {
  try {
    const { jobId } = req.params;
    const job = getJob(jobId);
    
    if (!job) {
      return res.status(404).json({ error: 'Job not found' });
    }
    
    res.json(job.result);
  } catch (error: any) {
    console.error('Error getting search job:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
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

