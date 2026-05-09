import { createPostgresStorage } from './postgres.js';

export function createStorage({ backend = process.env.STORAGE_BACKEND || 'postgres' } = {}) {
  if (backend === 'postgres') return createPostgresStorage();
  throw new Error(`Unsupported storage backend: ${backend}`);
}