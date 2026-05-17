import { Redis } from '@upstash/redis';

const url = process.env.UPSTASH_REDIS_REST_URL || process.env.STORAGE_REST_URL || process.env.KV_REST_API_URL || process.env.KV_URL;
const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.STORAGE_REST_TOKEN || process.env.KV_REST_API_TOKEN;

const redisInstance = new Redis({
  url: url || "",
  token: token || "",
});

const PREFIX = process.env.REDIS_PREFIX || 'aidajigi:';

export const redis = {
    get: async <T>(key: string) => redisInstance.get<T>(PREFIX + key),
    set: async (key: string, value: any) => redisInstance.set(PREFIX + key, value),
    del: async (key: string) => redisInstance.del(PREFIX + key),
    // 필요한 다른 메서드들도 동일하게 래핑 가능
};

export function isAuthenticated(req: any): boolean {
  const adminPassword = process.env.ADMIN_PASSWORD;
  if (!adminPassword) return false;
  const authHeader = req.headers.authorization;
  if (!authHeader) return false;
  const tokenProvided = authHeader.replace("Bearer ", "").trim();
  return tokenProvided === adminPassword;
}
