import {
  BollingerBands,
  CCI,
  EMA,
  MACD,
  RSI,
  SMA,
  Stochastic,
  WilliamsR,
} from "technicalindicators";

import type { Candle, SupportedInterval } from "@/lib/market-data";
import { intervalToMs } from "@/lib/market-data";

type Signal = -1 | 0 | 1;

type EquityPoint = {
  time: number;
  equity: number;
};

type Trade = {
  entryTime: number;
  exitTime: number;
  entryPrice: number;
  exitPrice: number;
  pnl: number;
  returnPct: number;
};

export type StrategyResult = {
  strategy: string;
  rank: number;
  score: number;
  totalReturnPct: number;
  cagrPct: number;
  maxDrawdownPct: number;
  sharpe: number;
  winRatePct: number;
  profitFactor: number;
  trades: number;
  equityCurve: EquityPoint[];
};

type Strategy = {
  name: string;
  signalAt: (index: number) => Signal;
};

const BPS_DIVISOR = 10_000;

function alignSeries<T>(input: T[], length: number): Array<T | undefined> {
  const result = new Array<T | undefined>(length).fill(undefined);
  const offset = length - input.length;
  for (let i = 0; i < input.length; i += 1) {
    result[i + offset] = input[i];
  }
  return result;
}

function crossUp(
  prevFast?: number,
  fast?: number,
  prevSlow?: number,
  slow?: number,
): boolean {
  if (
    prevFast === undefined ||
    fast === undefined ||
    prevSlow === undefined ||
    slow === undefined
  ) {
    return false;
  }
  return prevFast <= prevSlow && fast > slow;
}

function crossDown(
  prevFast?: number,
  fast?: number,
  prevSlow?: number,
  slow?: number,
): boolean {
  if (
    prevFast === undefined ||
    fast === undefined ||
    prevSlow === undefined ||
    slow === undefined
  ) {
    return false;
  }
  return prevFast >= prevSlow && fast < slow;
}

function clampNumber(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return value;
}

function downsampleEquity(input: EquityPoint[], target = 320): EquityPoint[] {
  if (input.length <= target) {
    return input;
  }

  const stride = Math.ceil(input.length / target);
  const output: EquityPoint[] = [];
  for (let i = 0; i < input.length; i += stride) {
    output.push(input[i]);
  }

  const tail = input[input.length - 1];
  if (output[output.length - 1]?.time !== tail.time) {
    output.push(tail);
  }

  return output;
}

function standardDeviation(values: number[]): number {
  if (values.length < 2) {
    return 0;
  }
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance =
    values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

function maxDrawdownPct(equityCurve: EquityPoint[]): number {
  let peak = Number.NEGATIVE_INFINITY;
  let maxDrawdown = 0;

  for (const point of equityCurve) {
    if (point.equity > peak) {
      peak = point.equity;
    }
    if (peak <= 0) {
      continue;
    }
    const drawdown = (peak - point.equity) / peak;
    if (drawdown > maxDrawdown) {
      maxDrawdown = drawdown;
    }
  }

  return maxDrawdown * 100;
}

function buildStrategies(candles: Candle[]): Strategy[] {
  const closes = candles.map((candle) => candle.close);
  const highs = candles.map((candle) => candle.high);
  const lows = candles.map((candle) => candle.low);

  const sma20 = alignSeries(SMA.calculate({ period: 20, values: closes }), candles.length);
  const sma50 = alignSeries(SMA.calculate({ period: 50, values: closes }), candles.length);
  const ema12 = alignSeries(EMA.calculate({ period: 12, values: closes }), candles.length);
  const ema26 = alignSeries(EMA.calculate({ period: 26, values: closes }), candles.length);
  const ema200 = alignSeries(EMA.calculate({ period: 200, values: closes }), candles.length);
  const rsi14 = alignSeries(RSI.calculate({ period: 14, values: closes }), candles.length);
  const macd = alignSeries(
    MACD.calculate({
      values: closes,
      fastPeriod: 12,
      slowPeriod: 26,
      signalPeriod: 9,
      SimpleMAOscillator: false,
      SimpleMASignal: false,
    }),
    candles.length,
  );
  const bb20 = alignSeries(
    BollingerBands.calculate({
      period: 20,
      stdDev: 2,
      values: closes,
    }),
    candles.length,
  );
  const stoch = alignSeries(
    Stochastic.calculate({
      high: highs,
      low: lows,
      close: closes,
      period: 14,
      signalPeriod: 3,
    }),
    candles.length,
  );
  const wr14 = alignSeries(
    WilliamsR.calculate({
      high: highs,
      low: lows,
      close: closes,
      period: 14,
    }),
    candles.length,
  );
  const cci20 = alignSeries(
    CCI.calculate({
      high: highs,
      low: lows,
      close: closes,
      period: 20,
    }),
    candles.length,
  );

  return [
    {
      name: "SMA 20/50 Crossover",
      signalAt: (i): Signal => {
        if (crossUp(sma20[i - 1], sma20[i], sma50[i - 1], sma50[i])) {
          return 1;
        }
        if (crossDown(sma20[i - 1], sma20[i], sma50[i - 1], sma50[i])) {
          return -1;
        }
        return 0;
      },
    },
    {
      name: "EMA 12/26 Crossover",
      signalAt: (i): Signal => {
        if (crossUp(ema12[i - 1], ema12[i], ema26[i - 1], ema26[i])) {
          return 1;
        }
        if (crossDown(ema12[i - 1], ema12[i], ema26[i - 1], ema26[i])) {
          return -1;
        }
        return 0;
      },
    },
    {
      name: "RSI 14 Reversion",
      signalAt: (i): Signal => {
        const prev = rsi14[i - 1];
        const curr = rsi14[i];
        if (prev === undefined || curr === undefined) {
          return 0;
        }
        if (prev <= 30 && curr > 30) {
          return 1;
        }
        if (prev >= 70 && curr < 70) {
          return -1;
        }
        return 0;
      },
    },
    {
      name: "MACD Signal Cross",
      signalAt: (i): Signal => {
        const prev = macd[i - 1];
        const curr = macd[i];
        if (!prev || !curr) {
          return 0;
        }
        if (crossUp(prev.MACD, curr.MACD, prev.signal, curr.signal)) {
          return 1;
        }
        if (crossDown(prev.MACD, curr.MACD, prev.signal, curr.signal)) {
          return -1;
        }
        return 0;
      },
    },
    {
      name: "Bollinger Re-Entry (20,2)",
      signalAt: (i): Signal => {
        const prev = bb20[i - 1];
        const curr = bb20[i];
        if (!prev || !curr) {
          return 0;
        }
        const prevClose = candles[i - 1]?.close;
        const close = candles[i]?.close;
        if (prevClose === undefined || close === undefined) {
          return 0;
        }

        if (prevClose < prev.lower && close > curr.lower) {
          return 1;
        }
        if (close >= curr.middle) {
          return -1;
        }
        return 0;
      },
    },
    {
      name: "Stochastic 14/3",
      signalAt: (i): Signal => {
        const prev = stoch[i - 1];
        const curr = stoch[i];
        if (!prev || !curr) {
          return 0;
        }
        if (crossUp(prev.k, curr.k, prev.d, curr.d) && curr.k < 25) {
          return 1;
        }
        if (crossDown(prev.k, curr.k, prev.d, curr.d) && curr.k > 75) {
          return -1;
        }
        return 0;
      },
    },
    {
      name: "Williams %R 14",
      signalAt: (i): Signal => {
        const prev = wr14[i - 1];
        const curr = wr14[i];
        if (prev === undefined || curr === undefined) {
          return 0;
        }
        if (prev <= -80 && curr > -80) {
          return 1;
        }
        if (prev >= -20 && curr < -20) {
          return -1;
        }
        return 0;
      },
    },
    {
      name: "CCI 20 Threshold",
      signalAt: (i): Signal => {
        const prev = cci20[i - 1];
        const curr = cci20[i];
        if (prev === undefined || curr === undefined) {
          return 0;
        }
        if (prev <= -100 && curr > -100) {
          return 1;
        }
        if (prev >= 100 && curr < 100) {
          return -1;
        }
        return 0;
      },
    },
    {
      name: "EMA 200 + RSI Regime",
      signalAt: (i): Signal => {
        const ema = ema200[i];
        const rsi = rsi14[i];
        const close = closes[i];
        if (ema === undefined || rsi === undefined || close === undefined) {
          return 0;
        }

        if (close > ema && rsi > 55) {
          return 1;
        }
        if (close < ema || rsi < 45) {
          return -1;
        }
        return 0;
      },
    },
  ];
}

function runSingleStrategy(params: {
  candles: Candle[];
  strategy: Strategy;
  initialCapital: number;
  interval: SupportedInterval;
  feeBps: number;
  slippageBps: number;
}): Omit<StrategyResult, "rank"> {
  const { candles, strategy, initialCapital, interval, feeBps, slippageBps } = params;
  const fee = feeBps / BPS_DIVISOR;
  const slippage = slippageBps / BPS_DIVISOR;
  const barsPerYear = (365 * 24 * 60 * 60 * 1000) / intervalToMs(interval);

  let cash = initialCapital;
  let units = 0;
  let entryValue = 0;
  let entryPrice = 0;
  let entryTime = 0;
  let inPosition = false;
  const trades: Trade[] = [];
  const equityCurve: EquityPoint[] = [];

  for (let i = 1; i < candles.length; i += 1) {
    const candle = candles[i];
    const signal = strategy.signalAt(i);

    if (!inPosition && signal === 1) {
      const buyPrice = candle.close * (1 + slippage);
      if (buyPrice > 0) {
        units = (cash * (1 - fee)) / buyPrice;
        entryValue = cash;
        entryPrice = buyPrice;
        entryTime = candle.openTime;
        cash = 0;
        inPosition = true;
      }
    } else if (inPosition && signal === -1) {
      const sellPrice = candle.close * (1 - slippage);
      const proceeds = units * sellPrice * (1 - fee);
      const pnl = proceeds - entryValue;
      trades.push({
        entryTime,
        exitTime: candle.openTime,
        entryPrice,
        exitPrice: sellPrice,
        pnl,
        returnPct: entryValue > 0 ? (pnl / entryValue) * 100 : 0,
      });
      cash = proceeds;
      units = 0;
      entryValue = 0;
      entryPrice = 0;
      entryTime = 0;
      inPosition = false;
    }

    const markToMarket = inPosition ? units * candle.close : cash;
    equityCurve.push({
      time: candle.openTime,
      equity: clampNumber(markToMarket),
    });
  }

  const lastCandle = candles[candles.length - 1];
  if (inPosition && lastCandle) {
    const sellPrice = lastCandle.close * (1 - slippage);
    const proceeds = units * sellPrice * (1 - fee);
    const pnl = proceeds - entryValue;
    trades.push({
      entryTime,
      exitTime: lastCandle.openTime,
      entryPrice,
      exitPrice: sellPrice,
      pnl,
      returnPct: entryValue > 0 ? (pnl / entryValue) * 100 : 0,
    });
    cash = proceeds;
  }

  const firstTime = candles[0]?.openTime ?? Date.now();
  const finalTime = candles[candles.length - 1]?.openTime ?? firstTime;
  const years = Math.max((finalTime - firstTime) / (365 * 24 * 60 * 60 * 1000), 1 / 365);
  const totalReturnPct = ((cash - initialCapital) / initialCapital) * 100;
  const cagrPct = (Math.pow(cash / initialCapital, 1 / years) - 1) * 100;

  const returns: number[] = [];
  for (let i = 1; i < equityCurve.length; i += 1) {
    const prev = equityCurve[i - 1].equity;
    const curr = equityCurve[i].equity;
    if (prev > 0 && Number.isFinite(curr)) {
      returns.push((curr - prev) / prev);
    }
  }

  const meanReturn = returns.length
    ? returns.reduce((sum, value) => sum + value, 0) / returns.length
    : 0;
  const stdReturn = standardDeviation(returns);
  const sharpe = stdReturn > 0 ? (meanReturn / stdReturn) * Math.sqrt(barsPerYear) : 0;

  const wins = trades.filter((trade) => trade.pnl > 0);
  const grossProfit = wins.reduce((sum, trade) => sum + trade.pnl, 0);
  const grossLoss = Math.abs(
    trades.filter((trade) => trade.pnl < 0).reduce((sum, trade) => sum + trade.pnl, 0),
  );
  const winRatePct = trades.length > 0 ? (wins.length / trades.length) * 100 : 0;
  const profitFactor =
    grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Number.POSITIVE_INFINITY : 0;
  const drawdownPct = maxDrawdownPct(equityCurve);

  let score =
    totalReturnPct * 0.45 +
    cagrPct * 0.35 +
    sharpe * 8 -
    drawdownPct * 0.4 +
    winRatePct * 0.15;
  if (trades.length < 3) {
    score -= 12;
  }
  if (!Number.isFinite(score)) {
    score = -9999;
  }

  return {
    strategy: strategy.name,
    score: clampNumber(score),
    totalReturnPct: clampNumber(totalReturnPct),
    cagrPct: clampNumber(cagrPct),
    maxDrawdownPct: clampNumber(drawdownPct),
    sharpe: clampNumber(sharpe),
    winRatePct: clampNumber(winRatePct),
    profitFactor: Number.isFinite(profitFactor) ? profitFactor : 999,
    trades: trades.length,
    equityCurve: downsampleEquity(equityCurve),
  };
}

export function runBacktests(params: {
  candles: Candle[];
  interval: SupportedInterval;
  initialCapital: number;
  feeBps?: number;
  slippageBps?: number;
}): StrategyResult[] {
  const { candles, interval, initialCapital, feeBps = 10, slippageBps = 5 } = params;
  const strategies = buildStrategies(candles);

  const results = strategies
    .map((strategy) =>
      runSingleStrategy({
        candles,
        strategy,
        interval,
        initialCapital,
        feeBps,
        slippageBps,
      }),
    )
    .sort((a, b) => b.score - a.score)
    .map((result, index) => ({
      ...result,
      rank: index + 1,
    }));

  return results;
}
