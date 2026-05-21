import IORedis from 'ioredis';

let sharedConnection: IORedis | null = null;

export function redisUrl() {
  return process.env.REDIS_URL || 'redis://localhost:6379';
}

export function createRedisConnection() {
  return new IORedis(redisUrl(), {
    maxRetriesPerRequest: null,
    enableReadyCheck: false
  });
}

export function getSharedRedisConnection() {
  if (!sharedConnection) {
    sharedConnection = createRedisConnection();
  }
  return sharedConnection;
}
