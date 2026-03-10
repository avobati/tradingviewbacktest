import {
  ATR,
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
import { STRATEGY_CATALOG } from "@/lib/strategy-catalog";

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
  id: string;
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

function emaSeries(values: number[], period: number): number[] {
  if (values.length === 0) {
    return [];
  }
  const k = 2 / (period + 1);
  const output = new Array<number>(values.length);
  let ema = values[0];
  output[0] = ema;
  for (let i = 1; i < values.length; i += 1) {
    ema = values[i] * k + ema * (1 - k);
    output[i] = ema;
  }
  return output;
}

function smaSeries(values: number[], period: number): Array<number | undefined> {
  const output = new Array<number | undefined>(values.length).fill(undefined);
  if (period <= 0 || values.length < period) {
    return output;
  }

  let rollingSum = 0;
  for (let i = 0; i < values.length; i += 1) {
    rollingSum += values[i];
    if (i >= period) {
      rollingSum -= values[i - period];
    }
    if (i >= period - 1) {
      output[i] = rollingSum / period;
    }
  }
  return output;
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
  const hlc3 = candles.map((candle) => (candle.high + candle.low + candle.close) / 3);

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

  const atr10 = alignSeries(
    ATR.calculate({
      high: highs,
      low: lows,
      close: closes,
      period: 10,
    }),
    candles.length,
  );
  const utTrailingStop = new Array<number | undefined>(candles.length).fill(undefined);
  const utAtrFactor = 1;
  for (let i = 0; i < candles.length; i += 1) {
    const atr = atr10[i];
    const close = closes[i];
    if (atr === undefined || close === undefined) {
      continue;
    }
    const nLoss = utAtrFactor * atr;
    if (i === 0 || utTrailingStop[i - 1] === undefined) {
      utTrailingStop[i] = close - nLoss;
      continue;
    }

    const prevStop = utTrailingStop[i - 1] as number;
    const prevClose = closes[i - 1];
    if (prevClose === undefined) {
      utTrailingStop[i] = close - nLoss;
      continue;
    }

    if (close > prevStop && prevClose > prevStop) {
      utTrailingStop[i] = Math.max(prevStop, close - nLoss);
    } else if (close < prevStop && prevClose < prevStop) {
      utTrailingStop[i] = Math.min(prevStop, close + nLoss);
    } else {
      utTrailingStop[i] = close > prevStop ? close - nLoss : close + nLoss;
    }
  }

  const wtEsa = emaSeries(hlc3, 10);
  const wtDelta = hlc3.map((value, index) => Math.abs(value - wtEsa[index]));
  const wtD = emaSeries(wtDelta, 10);
  const wtCi = hlc3.map((value, index) => {
    const denom = 0.015 * wtD[index];
    if (!Number.isFinite(denom) || denom === 0) {
      return 0;
    }
    return (value - wtEsa[index]) / denom;
  });
  const wt1 = emaSeries(wtCi, 21);
  const wt2 = smaSeries(wt1, 4);

  const strategies: Strategy[] = [
    {
      id: "sma_20_50_cross",
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
      id: "ema_12_26_cross",
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
      id: "ema_200_cross",
      name: "EMA 200 Cross",
      signalAt: (i): Signal => {
        const prevClose = closes[i - 1];
        const close = closes[i];
        const prevEma = ema200[i - 1];
        const ema = ema200[i];
        if (
          prevClose === undefined ||
          close === undefined ||
          prevEma === undefined ||
          ema === undefined
        ) {
          return 0;
        }
        if (prevClose <= prevEma && close > ema) {
          return 1;
        }
        if (prevClose >= prevEma && close < ema) {
          return -1;
        }
        return 0;
      },
    },
    {
      id: "rsi_14_reversion",
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
      id: "macd_signal_cross",
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
      id: "bollinger_reentry",
      name: "Bollinger Re-Entry (20,2)",
      signalAt: (i): Signal => {
        const prev = bb20[i - 1];
        const curr = bb20[i];
        if (!prev || !curr) {
          return 0;
        }
        const prevClose = closes[i - 1];
        const close = closes[i];
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
      id: "stochastic_14_3",
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
      id: "williams_r_14",
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
      id: "cci_20_threshold",
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
      id: "ema_200_rsi_regime",
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
    {
      id: "ut_buy_alert",
      name: "UT Buy Alert",
      signalAt: (i): Signal => {
        const prevClose = closes[i - 1];
        const close = closes[i];
        const prevStop = utTrailingStop[i - 1];
        const stop = utTrailingStop[i];
        if (
          prevClose === undefined ||
          close === undefined ||
          prevStop === undefined ||
          stop === undefined
        ) {
          return 0;
        }

        if (prevClose <= prevStop && close > stop) {
          return 1;
        }
        if (prevClose >= prevStop && close < stop) {
          return -1;
        }
        return 0;
      },
    },
    {
      id: "wavetrend_cross",
      name: "WaveTrend Cross",
      signalAt: (i): Signal => {
        const prevWt1 = wt1[i - 1];
        const currWt1 = wt1[i];
        const prevWt2 = wt2[i - 1];
        const currWt2 = wt2[i];
        if (
          prevWt1 === undefined ||
          currWt1 === undefined ||
          prevWt2 === undefined ||
          currWt2 === undefined
        ) {
          return 0;
        }

        if (crossUp(prevWt1, currWt1, prevWt2, currWt2) && currWt1 < -40) {
          return 1;
        }
        if (crossDown(prevWt1, currWt1, prevWt2, currWt2) && currWt1 > 40) {
          return -1;
        }
        return 0;
      },
    },
  ];

  const orderedMap = new Map(strategies.map((strategy) => [strategy.id, strategy]));
  return STRATEGY_CATALOG.map((item) => orderedMap.get(item.id)).filter(
    (strategy): strategy is Strategy => Boolean(strategy),
  );
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
  strategyIds?: string[];
}): StrategyResult[] {
  const {
    candles,
    interval,
    initialCapital,
    feeBps = 10,
    slippageBps = 5,
    strategyIds,
  } = params;
  const availableStrategies = buildStrategies(candles);

  const selectedStrategies =
    strategyIds && strategyIds.length > 0
      ? availableStrategies.filter((strategy) => strategyIds.includes(strategy.id))
      : availableStrategies;

  const results = selectedStrategies
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
