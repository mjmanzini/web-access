import { createPostgresStorage } from './postgres.js';
import { createFirebaseStorage } from './firebase.js';

export function createStorage({ backend = process.env.STORAGE_BACKEND || 'postgres' } = {}) {
  if (backend === 'postgres') return createPostgresStorage();
  if (backend === 'firebase') return createFirebaseStorage();
  throw new Error(`Unsupported storage backend: ${backend}`);
}