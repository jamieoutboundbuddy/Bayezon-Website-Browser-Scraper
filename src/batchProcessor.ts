/**
 * Batch Processor Module
 * 
 * Background processor that picks up queued batch items from the database
 * and runs aiFullAnalysis on each domain with concurrency control.
 */

import { getDb } from './db';
import { aiFullAnalysis } from './aiAgent';
import { v4 as uuidv4 } from 'uuid';

// Configuration
const CONCURRENCY_LIMIT = process.env.BATCH_CONCURRENCY ? parseInt(process.env.BATCH_CONCURRENCY) : 5; // Increased default concurrency
const POLL_INTERVAL_MS = 10000; // Check for new work every 10 seconds
const BATCH_SIZE = 10; // Items to fetch per poll

let isProcessing = false;
let processorInterval: NodeJS.Timeout | null = null;

/**
 * Start the background batch processor
 */
export function startBatchProcessor(): void {
  if (processorInterval) {
    console.log('[BATCH] Processor already running');
    return;
  }

  console.log('[BATCH] Starting batch processor...');
  console.log(`[BATCH] Concurrency limit: ${CONCURRENCY_LIMIT}`);
  console.log(`[BATCH] Poll interval: ${POLL_INTERVAL_MS}ms`);

  // Run immediately on start
  processNextBatch();

  // Then run on interval
  processorInterval = setInterval(() => {
    processNextBatch();
  }, POLL_INTERVAL_MS);
}

/**
 * Recover items that were stuck in 'running' state from a previous crash
 */
export async function recoverStuckItems(): Promise<void> {
  const db = getDb();
  if (!db) return;

  try {
    const result = await db.batchJobItem.updateMany({
      where: { status: 'running' },
      data: { status: 'queued' }
    });

    if (result.count > 0) {
      console.log(`[BATCH] Recovered ${result.count} stuck items (reset to queued)`);
    }
  } catch (error) {
    console.error('[BATCH] Failed to recover stuck items:', error);
  }
}

/**
 * Stop the batch processor
 */
export function stopBatchProcessor(): void {
  if (processorInterval) {
    clearInterval(processorInterval);
    processorInterval = null;
    console.log('[BATCH] Processor stopped');
  }
}

// Track if we've already warned about missing tables
let tablesMissingWarned = false;

/**
 * Process the next batch of queued items
 */
async function processNextBatch(): Promise<void> {
  // Prevent overlapping processing
  if (isProcessing) {
    return;
  }

  isProcessing = true;

  try {
    const db = getDb();
    if (!db) {
      if (!tablesMissingWarned) {
        console.log('[BATCH] Database not available, skipping cycles silently');
        tablesMissingWarned = true;
      }
      return;
    }

    // Find batches that need processing (pending or running)
    const activeBatch = await db.batchJob.findFirst({
      where: {
        status: {
          in: ['pending', 'running']
        }
      },
      orderBy: {
        createdAt: 'asc'
      }
    });

    if (!activeBatch) {
      // No work to do
      return;
    }

    // Update batch status to running if it's pending
    if (activeBatch.status === 'pending') {
      await db.batchJob.update({
        where: { id: activeBatch.id },
        data: { status: 'running' }
      });
      console.log(`[BATCH] Started processing batch ${activeBatch.batchId}`);
    }

    // Get queued items for this batch
    const queuedItems = await db.batchJobItem.findMany({
      where: {
        batchId: activeBatch.batchId,
        status: 'queued'
      },
      take: BATCH_SIZE,
      orderBy: {
        createdAt: 'asc'
      }
    });

    if (queuedItems.length === 0) {
      // Check if batch is complete
      const remainingItems = await db.batchJobItem.count({
        where: {
          batchId: activeBatch.batchId,
          status: {
            in: ['queued', 'running']
          }
        }
      });

      if (remainingItems === 0) {
        // Batch is complete
        await db.batchJob.update({
          where: { id: activeBatch.id },
          data: {
            status: 'completed',
            completedAt: new Date()
          }
        });
        console.log(`[BATCH] ✓ Batch ${activeBatch.batchId} completed!`);
      }
      return;
    }

    console.log(`[BATCH] Processing ${queuedItems.length} items from batch ${activeBatch.batchId}`);

    // Process items with concurrency limit
    await processItemsWithConcurrency(queuedItems, activeBatch.batchId, db);

  } catch (error: any) {
    // Silently ignore "table does not exist" errors - expected until prisma db push is run
    if (error.message?.includes('does not exist in the current database')) {
      if (!tablesMissingWarned) {
        console.warn('[BATCH] Database tables not yet created. Run "npx prisma db push" to create them.');
        tablesMissingWarned = true;
      }
      return;
    }
    console.error('[BATCH] Error in processing cycle:', error.message);
  } finally {
    isProcessing = false;
  }
}

/**
 * Process items with concurrency control
 */
async function processItemsWithConcurrency(
  items: any[],
  batchId: string,
  db: any
): Promise<void> {
  // Process in chunks based on concurrency limit
  const chunks = [];
  for (let i = 0; i < items.length; i += CONCURRENCY_LIMIT) {
    chunks.push(items.slice(i, i + CONCURRENCY_LIMIT));
  }

  for (const chunk of chunks) {
    // Mark items as running
    await Promise.all(
      chunk.map((item: any) =>
        db.batchJobItem.update({
          where: { id: item.id },
          data: { status: 'running' }
        })
      )
    );

    // Process items in parallel
    const results = await Promise.allSettled(
      chunk.map((item: any) => processSingleItem(item, batchId, db))
    );

    // Log results
    const succeeded = results.filter(r => r.status === 'fulfilled').length;
    const failed = results.filter(r => r.status === 'rejected').length;
    console.log(`[BATCH] Chunk complete: ${succeeded} succeeded, ${failed} failed`);

    // Update batch counters
    const completedCount = await db.batchJobItem.count({
      where: { batchId, status: 'completed' }
    });
    const failedCount = await db.batchJobItem.count({
      where: { batchId, status: 'failed' }
    });

    await db.batchJob.update({
      where: { batchId },
      data: { completedCount, failedCount }
    });
  }
}

/**
 * Process a single batch item
 */
async function processSingleItem(
  item: any,
  batchId: string,
  db: any
): Promise<void> {
  const jobId = uuidv4();
  const startTime = Date.now();

  console.log(`[BATCH] Processing: ${item.domain}`);

  try {
    // Run the full analysis with timeout
    const TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes timeout

    const analysisPromise = aiFullAnalysis(jobId, item.domain);
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Analysis timed out')), TIMEOUT_MS)
    );

    const result = await Promise.race([analysisPromise, timeoutPromise]);

    // Save successful result
    await db.batchJobItem.update({
      where: { id: item.id },
      data: {
        status: 'completed',
        result: {
          jobId,
          domain: item.domain,
          verdict: result.comparison?.verdict || 'INCONCLUSIVE',
          confidence: result.comparison?.nlRelevance || 'unknown',
          reason: result.comparison?.reason || '',
          siteProfile: result.siteProfile,
          queriesTested: result.adversarial?.queriesTested || [],
          proofQuery: result.adversarial?.proofQuery || null,
          durationMs: Date.now() - startTime
        }
      }
    });

    console.log(`[BATCH] ✓ ${item.domain} - ${result.comparison?.verdict || 'DONE'} (${Date.now() - startTime}ms)`);

  } catch (error: any) {
    console.error(`[BATCH] ✗ ${item.domain} failed:`, error.message);

    // Save error
    await db.batchJobItem.update({
      where: { id: item.id },
      data: {
        status: 'failed',
        error: error.message || 'Unknown error'
      }
    });
  }
}

/**
 * Manually trigger processing for a specific batch
 */
export async function triggerBatchProcessing(batchId: string): Promise<boolean> {
  const db = getDb();
  if (!db) {
    return false;
  }

  const batch = await db.batchJob.findUnique({
    where: { batchId }
  });

  if (!batch) {
    return false;
  }

  // Reset batch to pending if it was completed/failed
  if (batch.status === 'completed' || batch.status === 'failed') {
    await db.batchJob.update({
      where: { batchId },
      data: { status: 'pending' }
    });
  }

  // Reset all failed items to queued for retry
  await db.batchJobItem.updateMany({
    where: {
      batchId,
      status: 'failed'
    },
    data: {
      status: 'queued',
      error: null
    }
  });

  console.log(`[BATCH] Manually triggered processing for batch ${batchId}`);

  // Trigger immediate processing
  processNextBatch();

  return true;
}

/**
 * Get current processor status
 */
export function getProcessorStatus(): {
  running: boolean;
  processing: boolean;
} {
  return {
    running: processorInterval !== null,
    processing: isProcessing
  };
}

