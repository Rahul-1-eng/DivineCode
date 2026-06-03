import IORedis from 'ioredis';

let sharedConnection: IORedis | null = null;

export function redisUrl() {
  return process.env.REDIS_URL || 'redis://localhost:6379';
}

export function createRedisConnection() {
  const url = redisUrl();
  const isUpstash = url.includes('upstash');
  const isRediss = url.startsWith('rediss://');

  return new IORedis(url, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    family: 0, // Solves Render/AWS IPv4 vs IPv6 resolution issues
    keepAlive: 10000, // Sends TCP keep-alive to prevent Upstash from dropping idle workers
    tls: isUpstash || isRediss ? { rejectUnauthorized: false } : undefined,
  });
}

export function getSharedRedisConnection() {
  if (!sharedConnection) {
    sharedConnection = createRedisConnection();
    
    // Auto-reconnect logger
    sharedConnection.on('error', (err) => {
      console.error('[Redis] Worker Connection Error:', err.message);
    });
  }
  return sharedConnection;
}