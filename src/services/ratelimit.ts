/**
 * Rate limiter cho các thao tác Zalo - tránh bị block tài khoản
 * Giới hạn mặc định:
 *   - bulk send: 80 tin/ngày
 *   - add friend: 40 lời mời/ngày
 *   - stranger: 25 tin/ngày
 */

interface DailyCounter {
  date: string; // YYYY-MM-DD
  count: number;
}

const counters: Record<string, DailyCounter> = {};

const LIMITS: Record<string, number> = {
  bulk: 80,
  addfriend: 40,
  stranger: 25,
};

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function getCounter(type: string): DailyCounter {
  const d = today();
  if (!counters[type] || counters[type].date !== d) {
    counters[type] = { date: d, count: 0 };
  }
  return counters[type];
}

export function canSend(type: string): boolean {
  const c = getCounter(type);
  return c.count < (LIMITS[type] || 100);
}

export function increment(type: string): void {
  const c = getCounter(type);
  c.count++;
}

export function getRemaining(type: string): number {
  const c = getCounter(type);
  return Math.max(0, (LIMITS[type] || 100) - c.count);
}

export function getUsage(type: string): { used: number; limit: number; remaining: number } {
  const c = getCounter(type);
  const limit = LIMITS[type] || 100;
  return { used: c.count, limit, remaining: Math.max(0, limit - c.count) };
}
