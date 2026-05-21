import '../config/env';
import { startQueueWorkers } from './runWorkers';

// ✅ Export a wrapper function that your main server can invoke with 'io'
export function initializeWorkers(io: any) {
  const workers = startQueueWorkers(io);

  if (!workers) {
    console.log('[Workers] Set ENABLE_API_WORKERS=true to start queue workers.');
  }
  return workers;
}