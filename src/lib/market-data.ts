const BINANCE_BASE_URL = "https://api.binance.com";
const MAX_BATCH = 1000;
const MAX_CANDLES = 6000;

const INTERVAL_TO_MS: Record<string, number> = {
  "1m": 60_000,
  "3m": 180_000,
  "5m": 300_000,
  "15m": 900_000,
  "30m": 1_800_000,
  "1h": 3_600_000,
  "2h": 7_200_000,
  "4h": 14_400_000,
  "6h": 21_600_000,
  "8h": 28_800_000,
  "12h": 43_200_000,
  "1d": 86_400_000,
};

export type BinanceInterval = keyof typeof INTERVAL_TO_MS;

export type Candle = {
  openTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  closeTime: number;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function intervalToMs(interval: BinanceInterval): number {
  return INTERVAL_TO_MS[interval];
}

export function isSupportedInterval(value: string): value is BinanceInterval {
  return Object.prototype.hasOwnProperty.call(INTERVAL_TO_MS, value);
}

export async function fetchCandlesFromBinance(params: {
  symbol: string;
  interval: BinanceInterval;
  startTime: number;
  endTime: number;
}): Promise<Candle[]> {
  const { symbol, interval, startTime, endTime } = params;
  const candles: Candle[] = [];
  const intervalMs = intervalToMs(interval);
  let cursor = startTime;
  let safetyLoops = 0;

  while (cursor < endTime && candles.length < MAX_CANDLES) {
    const url = new URL("/api/v3/klines", BINANCE_BASE_URL);
    url.searchParams.set("symbol", symbol);
    url.searchParams.set("interval", interval);
    url.searchParams.set("startTime", String(cursor));
    url.searchParams.set("endTime", String(endTime));
    url.searchParams.set("limit", String(MAX_BATCH));

    const response = await fetch(url, {
      headers: { Accept: "application/json" },
      cache: "no-store",
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(
        `Binance request failed (${response.status}): ${body || response.statusText}`,
      );
    }

    const batch = (await response.json()) as unknown[];
    if (!Array.isArray(batch) || batch.length === 0) {
      break;
    }

    for (const row of batch) {
      if (!Array.isArray(row) || row.length < 7) {
        continue;
      }

      const openTimeValue = Number(row[0]);
      if (!Number.isFinite(openTimeValue)) {
        continue;
      }

      candles.push({
        openTime: openTimeValue,
        open: Number(row[1]),
        high: Number(row[2]),
        low: Number(row[3]),
        close: Number(row[4]),
        volume: Number(row[5]),
        closeTime: Number(row[6]),
      });
    }

    const last = batch[batch.length - 1] as unknown[];
    const lastOpenTime = Number(last[0]);
    if (!Number.isFinite(lastOpenTime)) {
      break;
    }

    cursor = lastOpenTime + intervalMs;
    safetyLoops += 1;
    if (safetyLoops > 32) {
      break;
    }

    if (batch.length < MAX_BATCH) {
      break;
    }

    await sleep(110);
  }

  const deduped = new Map<number, Candle>();
  for (const candle of candles) {
    deduped.set(candle.openTime, candle);
  }

  return [...deduped.values()]
    .filter((candle) => candle.openTime >= startTime && candle.openTime <= endTime)
    .sort((a, b) => a.openTime - b.openTime)
    .slice(0, MAX_CANDLES);
}
