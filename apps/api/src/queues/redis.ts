import IORedis from 'ioredis';

let sharedConnection: IORedis | null = null;

export function redisUrl() {
  // If running natively, default to localhost
  return process.env.REDIS_URL || 'redis://localhost:6379';
}

export function createRedisConnection() {
  const url = redisUrl();
  const isUpstash = url.includes('upstash');
  const isRediss = url.startsWith('rediss://');

  return new IORedis(url, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    family: 0, 
    keepAlive: 10000, 
    tls: isUpstash || isRediss ? { rejectUnauthorized: false } : undefined,
  });
}

export function getSharedRedisConnection() {
  if (!sharedConnection) {
    sharedConnection = createRedisConnection();
    
    sharedConnection.on('error', (err) => {
      console.error('[Redis] Worker Connection Error:', err.message);
    });
  }
  return sharedConnection;
}