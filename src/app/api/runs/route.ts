import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";

export async function GET() {
  if (!process.env.DATABASE_URL) {
    return NextResponse.json({
      runs: [],
      message: "No DATABASE_URL configured. Add a Neon connection string to persist runs.",
    });
  }

  try {
    const runs = await prisma.backtestRun.findMany({
      take: 12,
      orderBy: { createdAt: "desc" },
      include: {
        results: {
          orderBy: { rank: "asc" },
          take: 1,
        },
      },
    });

    const items = runs.map((run) => ({
      id: run.id,
      symbol: run.symbol,
      timeframe: run.timeframe,
      startDate: run.startDate.toISOString(),
      endDate: run.endDate.toISOString(),
      candleCount: run.candleCount,
      initialCapital: run.initialCapital,
      topStrategy: run.topStrategy,
      topScore: run.topScore,
      createdAt: run.createdAt.toISOString(),
      topResult: run.results[0]
        ? {
            totalReturnPct: run.results[0].totalReturnPct,
            sharpe: run.results[0].sharpe,
            maxDrawdownPct: run.results[0].maxDrawdownPct,
            trades: run.results[0].trades,
          }
        : null,
    }));

    return NextResponse.json({ runs: items });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load runs";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
