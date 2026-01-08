import crypto from 'crypto';
import fs from 'fs/promises';
import { logger } from './logger';

/**
 * Generate SHA-256 hash of a file
 */
export async function hashFile(filePath: string): Promise<string> {
  try {
    const fileBuffer = await fs.readFile(filePath);
    const hashSum = crypto.createHash('sha256');
    hashSum.update(fileBuffer);
    return hashSum.digest('hex');
  } catch (error) {
    logger.error(`Error hashing file ${filePath}:`, error);
    throw error;
  }
}

/**
 * Generate hash from buffer
 */
export function hashBuffer(buffer: Buffer): string {
  const hashSum = crypto.createHash('sha256');
  hashSum.update(buffer);
  return hashSum.digest('hex');
}

/**
 * Generate hash from string
 */
export function hashString(str: string): string {
  const hashSum = crypto.createHash('sha256');
  hashSum.update(str);
  return hashSum.digest('hex');
}
