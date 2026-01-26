/**
 * In-memory job management for website search
 * MVP: Simple Map storage (can upgrade to Redis/DB later)
 */

import { v4 as uuidv4 } from 'uuid';
import { Job, SearchResult } from './types';

const jobsMap = new Map<string, Job>();

/**
 * Create a new search job
 */
export function createJob(domain: string, query: string): string {
  const jobId = uuidv4();
  const now = new Date().toISOString();
  
  jobsMap.set(jobId, {
    jobId,
    domain,
    query,
    status: 'queued',
    progressPct: 0,
    result: {
      jobId,
      status: 'queued',
      progressPct: 0,
      screenshots: [],
    },
    createdAt: now,
  });
  
  return jobId;
}

/**
 * Get a job by ID
 */
export function getJob(jobId: string): Job | undefined {
  return jobsMap.get(jobId);
}

/**
 * Update job status and progress
 */
export function updateJobProgress(
  jobId: string,
  progressPct: number,
  status?: Job['status']
): void {
  const job = jobsMap.get(jobId);
  if (!job) return;
  
  job.progressPct = progressPct;
  if (status) job.status = status;
}

/**
 * Update job with completed result
 */
export function completeJob(jobId: string, result: SearchResult): void {
  const job = jobsMap.get(jobId);
  if (!job) return;
  
  job.result = result;
  job.status = 'completed';
  job.progressPct = 100;
}

/**
 * Mark job as failed
 */
export function failJob(jobId: string, error: string): void {
  const job = jobsMap.get(jobId);
  if (!job) return;
  
  job.status = 'failed';
  job.result.status = 'failed';
  job.result.error = error;
}

/**
 * Add a screenshot to job result
 */
export function addScreenshotToJob(jobId: string, screenshot: SearchResult['screenshots'][0]): void {
  const job = jobsMap.get(jobId);
  if (!job) return;
  
  job.result.screenshots.push(screenshot);
  
  // Update progress based on screenshots (3 total: homepage, search_modal, search_results)
  const progressMap: { [key: string]: number } = {
    'homepage': 33,
    'search_modal': 66,
    'search_results': 100,
  };
  
  const progress = progressMap[screenshot.stage] || 0;
  job.progressPct = progress;
}

/**
 * Get all jobs (for debugging)
 */
export function getAllJobs(): Job[] {
  return Array.from(jobsMap.values());
}

/**
 * Clean up old jobs (older than 1 hour)
 */
export function cleanupOldJobs(): void {
  const oneHourAgo = Date.now() - (60 * 60 * 1000);
  
  for (const [jobId, job] of jobsMap.entries()) {
    const createdTime = new Date(job.createdAt).getTime();
    if (createdTime < oneHourAgo && (job.status === 'completed' || job.status === 'failed')) {
      jobsMap.delete(jobId);
    }
  }
}

