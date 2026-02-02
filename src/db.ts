import { PrismaClient } from '@prisma/client';

let prisma: PrismaClient | null = null;
let dbInitFailed = false;

/**
 * Get the database client.
 * Returns null if database is not configured or failed to initialize.
 * This allows the app to run without a database (logging is optional).
 */
export function getDb(): PrismaClient | null {
  // If we already know DB init failed, don't try again
  if (dbInitFailed) {
    return null;
  }
  
  // Check if DATABASE_URL is configured
  if (!process.env.DATABASE_URL) {
    console.log('[DB] DATABASE_URL not set - running without database logging');
    dbInitFailed = true;
    return null;
  }
  
  if (!prisma) {
    try {
      prisma = new PrismaClient();
    } catch (error) {
      console.error('[DB] Failed to initialize Prisma client:', error);
      dbInitFailed = true;
      return null;
    }
  }
  return prisma;
}

// Graceful shutdown handler
export async function disconnectDb(): Promise<void> {
  if (prisma) {
    await prisma.$disconnect();
    prisma = null;
  }
}

