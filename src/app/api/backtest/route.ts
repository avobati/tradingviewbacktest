import { NextResponse } from "next/server";
import { z } from "zod";

import { runBacktests } from "@/lib/backtest";
import {
  fetchCandlesFromBinance,
  isSupportedInterval,
  type BinanceInterval,
} from "@/lib/market-data";
import { prisma } from "@/lib/prisma";

const requestSchema = z.object({
  symbol: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9]{4,20}$/, "Use a valid Binance pair like BTCUSDT"),
  timeframe: z.string(),
  startDate: z.string(),
  endDate: z.string(),
  initialCapital: z.coerce.number().positive().min(100),
  feeBps: z.coerce.number().min(0).max(200).optional(),
  slippageBps: z.coerce.number().min(0).max(200).optional(),
});

function parseDate(input: string): number {
  const parsed = Date.parse(input);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid date: ${input}`);
  }
  return parsed;
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const parsed = requestSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        {
          error: parsed.error.issues[0]?.message ?? "Invalid request",
        },
        { status: 400 },
      );
    }

    const payload = parsed.data;
    if (!isSupportedInterval(payload.timeframe)) {
      return NextResponse.json(
        {
          error: "Unsupported timeframe. Choose one of: 1m, 5m, 15m, 1h, 4h, 1d",
        },
        { status: 400 },
      );
    }

    const startMs = parseDate(payload.startDate);
    const endMs = parseDate(payload.endDate);
    if (endMs <= startMs) {
      return NextResponse.json(
        { error: "End date must be after start date." },
        { status: 400 },
      );
    }

    const interval = payload.timeframe as BinanceInterval;
    const candles = await fetchCandlesFromBinance({
      symbol: payload.symbol,
      interval,
      startTime: startMs,
      endTime: endMs,
    });

    if (candles.length < 220) {
      return NextResponse.json(
        {
          error:
            "Not enough candles returned. Use a longer date range or a symbol with more history.",
        },
        { status: 400 },
      );
    }

    const results = runBacktests({
      candles,
      interval,
      initialCapital: payload.initialCapital,
      feeBps: payload.feeBps,
      slippageBps: payload.slippageBps,
    });

    const best = results[0];
    let runId: string | null = null;
    let persisted = false;

    if (process.env.DATABASE_URL) {
      const run = await prisma.backtestRun.create({
        data: {
          symbol: payload.symbol,
          timeframe: payload.timeframe,
          startDate: new Date(startMs),
          endDate: new Date(endMs),
          initialCapital: payload.initialCapital,
          candleCount: candles.length,
          topStrategy: best?.strategy,
          topScore: best?.score,
          results: {
            create: results.map((result) => ({
              strategy: result.strategy,
              rank: result.rank,
              totalReturnPct: result.totalReturnPct,
              cagrPct: result.cagrPct,
              maxDrawdownPct: result.maxDrawdownPct,
              sharpe: result.sharpe,
              winRatePct: result.winRatePct,
              profitFactor: result.profitFactor,
              trades: result.trades,
              score: result.score,
              equityPoints: result.equityCurve,
            })),
          },
        },
      });

      runId = run.id;
      persisted = true;
    }

    return NextResponse.json({
      runId,
      persisted,
      symbol: payload.symbol,
      timeframe: payload.timeframe,
      startDate: payload.startDate,
      endDate: payload.endDate,
      initialCapital: payload.initialCapital,
      candleCount: candles.length,
      bestStrategy: best,
      results,
      note:
        "This engine uses Binance OHLCV with TradingView-style indicator logic and long-only execution.",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to run backtest";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
