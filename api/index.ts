/**
 * Vercel serverless function wrapper for Express app
 * Note: Playwright may have limitations on Vercel due to serverless constraints
 * For production, Railway is recommended for better Playwright support
 */

import app from '../src/server';

// Export the Express app for Vercel
export default app;

