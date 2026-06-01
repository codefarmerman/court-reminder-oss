import { timingSafeEqual } from "crypto";

// In-memory rate limiter (works for single-instance serverless)
interface Bucket {
  count: number;
  resetAt: number;
}
const buckets = new Map<string, Bucket>();

const RATE_LIMIT_WINDOW_MS = 60_000; // 1 minute
const RATE_LIMIT_MAX = 20; // 20 requests per minute per IP

/** Timing-safe PIN comparison */
export function verifyPin(pin: string | null): boolean {
  const expected = process.env.ACCESS_PIN;
  if (!expected || !pin) return false;
  const a = Buffer.from(pin);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** Returns true if rate limit exceeded */
export function isRateLimited(key: string): boolean {
  const now = Date.now();
  const bucket = buckets.get(key);

  if (!bucket || bucket.resetAt < now) {
    buckets.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return false;
  }

  if (bucket.count >= RATE_LIMIT_MAX) {
    return true;
  }
  bucket.count++;
  return false;
}

/** Extract client IP from request headers */
export function getClientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  const real = req.headers.get("x-real-ip");
  if (real) return real;
  return "unknown";
}

/** Combined auth check: rate limit + PIN verify */
export function authenticate(req: Request): { ok: boolean; error?: string; status?: number } {
  const ip = getClientIp(req);
  if (isRateLimited(`auth:${ip}`)) {
    return { ok: false, error: "请求过于频繁，请稍后再试", status: 429 };
  }
  const pin = req.headers.get("x-access-pin");
  if (!verifyPin(pin)) {
    return { ok: false, error: "访问密码错误", status: 401 };
  }
  return { ok: true };
}
