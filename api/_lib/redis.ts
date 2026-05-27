import { Redis } from '@upstash/redis';

// Use UPSTASH_REDIS_REST_URL if available, STORAGE_REST_URL if Custom prefix is used, or fallback to KV_REST_API_URL
const url = process.env.UPSTASH_REDIS_REST_URL || process.env.STORAGE_REST_URL || process.env.KV_REST_API_URL || process.env.KV_URL;
const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.STORAGE_REST_TOKEN || process.env.KV_REST_API_TOKEN;

const redisInstance = new Redis({
  url: url || "",
  token: token || "",
});

const PREFIX = process.env.REDIS_PREFIX || '';

export const redis = {
    get: async <T>(key: string) => redisInstance.get<T>(PREFIX + key),
    set: async (key: string, value: any) => redisInstance.set(PREFIX + key, value),
    del: async (key: string) => redisInstance.del(PREFIX + key),
};

// 간단한 비밀번호 기반 인증 헬퍼
export function isAuthenticated(req: any): boolean {
  const adminPassword = process.env.ADMIN_PASSWORD;
  if (!adminPassword) {
      console.error("ADMIN_PASSWORD is not set in environment variables.");
      return false;
  }

  const authHeader = req.headers.authorization;
  if (!authHeader) return false;
  
  // 프론트엔드에서 Authorization: Bearer <password> 포맷으로 보냄
  const tokenProvided = authHeader.replace("Bearer ", "").trim();
  
  return tokenProvided === adminPassword;
}
