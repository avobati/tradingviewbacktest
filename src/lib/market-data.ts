const YAHOO_BASE_URL = "https://query1.finance.yahoo.com/v8/finance/chart";

const INTERVAL_TO_MS: Record<string, number> = {
  "1h": 3_600_000,
  "4h": 14_400_000,
  "1d": 86_400_000,
  "1W": 604_800_000,
  "1M": 2_592_000_000,
};

const YAHOO_INTERVAL_MAP: Record<string, string> = {
  "1h": "1h",
  "4h": "1h",
  "1d": "1d",
  "1W": "1wk",
  "1M": "1mo",
};

export type SupportedInterval = keyof typeof INTERVAL_TO_MS;

export type Candle = {
  openTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  closeTime: number;
};

type YahooChartResponse = {
  chart?: {
    error?: { code?: string; description?: string } | null;
    result?: Array<{
      timestamp?: number[];
      indicators?: {
        quote?: Array<{
          open?: Array<number | null>;
          high?: Array<number | null>;
          low?: Array<number | null>;
          close?: Array<number | null>;
          volume?: Array<number | null>;
        }>;
      };
    }>;
  };
};

export function intervalToMs(interval: SupportedInterval): number {
  return INTERVAL_TO_MS[interval];
}

export function isSupportedInterval(value: string): value is SupportedInterval {
  return Object.prototype.hasOwnProperty.call(INTERVAL_TO_MS, value);
}

function normalizeSymbol(input: string): string {
  const value = input.trim().toUpperCase().replace("/", "");
  if (value.endsWith("USDT") || value.endsWith("USDC") || value.endsWith("BUSD")) {
    const base = value.slice(0, -4);
    return `${base}-USD`;
  }
  if (value.endsWith("USD") && !value.includes("-")) {
    const base = value.slice(0, -3);
    if (base.length >= 2 && base.length <= 6) {
      return `${base}-USD`;
    }
  }
  return value;
}

function aggregateCandles(candles: Candle[], groupSize: number): Candle[] {
  if (groupSize <= 1) {
    return candles;
  }

  const output: Candle[] = [];
  for (let i = 0; i < candles.length; i += groupSize) {
    const group = candles.slice(i, i + groupSize);
    if (group.length < groupSize) {
      break;
    }
    const first = group[0];
    const last = group[group.length - 1];
    const high = Math.max(...group.map((candle) => candle.high));
    const low = Math.min(...group.map((candle) => candle.low));
    const volume = group.reduce((sum, candle) => sum + candle.volume, 0);

    output.push({
      openTime: first.openTime,
      open: first.open,
      high,
      low,
      close: last.close,
      volume,
      closeTime: last.closeTime,
    });
  }
  return output;
}

export async function fetchCandles(params: {
  symbol: string;
  interval: SupportedInterval;
  startTime: number;
  endTime: number;
}): Promise<Candle[]> {
  const { symbol, interval, startTime, endTime } = params;
  const yahooSymbol = normalizeSymbol(symbol);
  const yahooInterval = YAHOO_INTERVAL_MAP[interval];
  const period1 = Math.floor(startTime / 1000);
  const period2 = Math.floor(endTime / 1000);

  const url = new URL(`${YAHOO_BASE_URL}/${yahooSymbol}`);
  url.searchParams.set("interval", yahooInterval);
  url.searchParams.set("period1", String(period1));
  url.searchParams.set("period2", String(period2));
  url.searchParams.set("events", "history");
  url.searchParams.set("includePrePost", "false");

  const response = await fetch(url, {
    cache: "no-store",
    headers: {
      Accept: "application/json",
      "User-Agent": "tradingviewbacktest/1.0",
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Market data request failed (${response.status}): ${text || response.statusText}`);
  }

  const payload = (await response.json()) as YahooChartResponse;
  const chartError = payload.chart?.error;
  if (chartError) {
    throw new Error(chartError.description || chartError.code || "Market data error");
  }

  const result = payload.chart?.result?.[0];
  const timestamps = result?.timestamp ?? [];
  const quote = result?.indicators?.quote?.[0];
  const opens = quote?.open ?? [];
  const highs = quote?.high ?? [];
  const lows = quote?.low ?? [];
  const closes = quote?.close ?? [];
  const volumes = quote?.volume ?? [];

  const candles: Candle[] = [];
  for (let i = 0; i < timestamps.length; i += 1) {
    const ts = timestamps[i];
    const open = opens[i];
    const high = highs[i];
    const low = lows[i];
    const close = closes[i];
    const volume = volumes[i] ?? 0;

    if (
      ts === undefined ||
      open === null ||
      high === null ||
      low === null ||
      close === null ||
      open === undefined ||
      high === undefined ||
      low === undefined ||
      close === undefined
    ) {
      continue;
    }

    candles.push({
      openTime: ts * 1000,
      open,
      high,
      low,
      close,
      volume: volume ?? 0,
      closeTime: ts * 1000 + intervalToMs(interval),
    });
  }

  const sorted = candles.sort((a, b) => a.openTime - b.openTime);
  if (interval === "4h") {
    return aggregateCandles(sorted, 4);
  }
  return sorted;
}
