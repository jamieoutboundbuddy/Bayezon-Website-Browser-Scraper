/**
 * Utility functions for website search tool
 */

import path from 'path';
import fs from 'fs';

/**
 * Ensure artifact directory exists
 */
export function ensureArtifactDir(jobId: string, domain: string): string {
  const dir = path.join(process.cwd(), 'artifacts', jobId, domain, 'screens');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

/**
 * Get artifact path for a screenshot
 */
export function getArtifactPath(jobId: string, domain: string, stage: string): string {
  const dir = ensureArtifactDir(jobId, domain);
  return path.join(dir, `${stage}.png`);
}

/**
 * Get served URL for artifact
 */
export function getArtifactUrl(jobId: string, domain: string, stage: string): string {
  return `/artifacts/${jobId}/${domain}/screens/${stage}.png`;
}

/**
 * Normalize domain URL
 * - Adds https:// if missing
 * - Adds .com if no TLD is detected
 */
export function normalizeDomain(domain: string): string {
  // Remove any leading/trailing whitespace
  domain = domain.trim();
  
  // Remove protocol if present to normalize
  let cleanDomain = domain.replace(/^https?:\/\//, '');
  
  // Remove trailing slashes and paths for TLD check
  const domainPart = cleanDomain.split('/')[0];
  
  // Check if domain has a TLD (contains a dot in the domain part)
  if (!domainPart.includes('.')) {
    // No TLD found, add .com
    cleanDomain = domainPart + '.com' + cleanDomain.slice(domainPart.length);
  }
  
  // Add https:// prefix
  return 'https://' + cleanDomain;
}

/**
 * Extract domain name from URL
 */
export function getDomainName(url: string): string {
  try {
    const urlObj = new URL(url);
    return urlObj.hostname;
  } catch {
    return url;
  }
}

/**
 * Sleep for N milliseconds
 */
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Sanitize filename
 */
export function sanitizeFilename(filename: string): string {
  return filename.replace(/[^a-z0-9]/gi, '_').toLowerCase();
}


