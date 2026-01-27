/**
 * TypeScript interfaces for website search tool
 */

export interface SearchScreenshot {
  stage: 'homepage' | 'search_modal' | 'search_results';
  url: string;
  screenshotUrl: string;
}

export interface SearchResult {
  jobId: string;
  status: 'queued' | 'running' | 'completed' | 'failed';
  progressPct: number;
  screenshots: SearchScreenshot[];
  error?: string;
}

export interface Job {
  jobId: string;
  domain: string;
  query: string;
  status: 'queued' | 'running' | 'completed' | 'failed';
  progressPct: number;
  result: SearchResult;
  createdAt: string;
}


