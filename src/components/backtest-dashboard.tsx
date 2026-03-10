"use client";

import { useEffect, useMemo, useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

type StrategyResult = {
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
  equityCurve: Array<{ time: number; equity: number }>;
};

type BacktestResponse = {
  runId: string | null;
  persisted: boolean;
  symbol: string;
  timeframe: string;
  startDate: string;
  endDate: string;
  initialCapital: number;
  candleCount: number;
  bestStrategy: StrategyResult;
  results: StrategyResult[];
  note: string;
};

type RunHistoryItem = {
  id: string;
  symbol: string;
  timeframe: string;
  createdAt: string;
  startDate: string;
  endDate: string;
  topStrategy: string | null;
  topScore: number | null;
  topResult: {
    totalReturnPct: number;
    sharpe: number;
    maxDrawdownPct: number;
    trades: number;
  } | null;
};

const TIMEFRAME_OPTIONS = ["1m", "5m", "15m", "1h", "4h", "1d"] as const;

const today = new Date();
const ninetyDaysAgo = new Date(today.getTime() - 90 * 24 * 60 * 60 * 1000);

const DEFAULT_FORM = {
  symbol: "BTCUSDT",
  timeframe: "1h",
  startDate: ninetyDaysAgo.toISOString().slice(0, 10),
  endDate: today.toISOString().slice(0, 10),
  initialCapital: 10_000,
  feeBps: 10,
  slippageBps: 5,
};

function asCurrency(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(value);
}

function asPercent(value: number): string {
  return `${value.toFixed(2)}%`;
}

function asNumber(value: number): string {
  return Number.isFinite(value) ? value.toFixed(2) : "0.00";
}

export function BacktestDashboard() {
  const [form, setForm] = useState(DEFAULT_FORM);
  const [result, setResult] = useState<BacktestResponse | null>(null);
  const [history, setHistory] = useState<RunHistoryItem[]>([]);
  const [historyNote, setHistoryNote] = useState<string>("");
  const [error, setError] = useState<string>("");
  const [loading, setLoading] = useState<boolean>(false);

  const selectedCurve = useMemo(() => result?.bestStrategy?.equityCurve ?? [], [result]);

  async function loadHistory() {
    const response = await fetch("/api/runs", { cache: "no-store" });
    const payload = (await response.json()) as { runs?: RunHistoryItem[]; message?: string };
    setHistory(payload.runs ?? []);
    setHistoryNote(payload.message ?? "");
  }

  useEffect(() => {
    void loadHistory();
  }, []);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setLoading(true);

    try {
      const response = await fetch("/api/backtest", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(form),
      });

      const payload = (await response.json()) as BacktestResponse & { error?: string };
      if (!response.ok) {
        throw new Error(payload.error || "Unable to run backtest");
      }

      setResult(payload);
      await loadHistory();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Unable to run backtest");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-7xl flex-col gap-8 px-4 py-8 md:px-8">
      <section className="rounded-3xl border border-cyan-500/30 bg-slate-900/75 p-6 backdrop-blur">
        <div className="mb-4 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.25em] text-cyan-300">Trading Lab</p>
            <h1 className="text-3xl font-semibold text-cyan-50 md:text-4xl">
              tradingviewbacktest
            </h1>
            <p className="mt-1 max-w-2xl text-sm text-slate-300">
              Backtest TradingView-style indicator strategies on Binance OHLCV and auto-rank the
              best performer by risk-adjusted score.
            </p>
          </div>
          <div className="rounded-2xl border border-cyan-500/40 bg-slate-800/70 px-4 py-3 text-sm text-slate-200">
            {result ? (
              <>
                <p>
                  Best: <span className="font-semibold text-cyan-200">{result.bestStrategy.strategy}</span>
                </p>
                <p>Candles: {result.candleCount}</p>
              </>
            ) : (
              <p>Run a backtest to see top strategy selection.</p>
            )}
          </div>
        </div>

        <form onSubmit={onSubmit} className="grid grid-cols-1 gap-4 md:grid-cols-4">
          <label className="flex flex-col gap-2 text-sm text-slate-200">
            Symbol
            <input
              value={form.symbol}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, symbol: event.target.value.toUpperCase() }))
              }
              className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 outline-none ring-cyan-400 transition focus:ring-2"
              placeholder="BTCUSDT"
              required
            />
          </label>

          <label className="flex flex-col gap-2 text-sm text-slate-200">
            Timeframe
            <select
              value={form.timeframe}
              onChange={(event) => setForm((prev) => ({ ...prev, timeframe: event.target.value }))}
              className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 outline-none ring-cyan-400 transition focus:ring-2"
            >
              {TIMEFRAME_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-2 text-sm text-slate-200">
            Start Date
            <input
              type="date"
              value={form.startDate}
              onChange={(event) => setForm((prev) => ({ ...prev, startDate: event.target.value }))}
              className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 outline-none ring-cyan-400 transition focus:ring-2"
              required
            />
          </label>

          <label className="flex flex-col gap-2 text-sm text-slate-200">
            End Date
            <input
              type="date"
              value={form.endDate}
              onChange={(event) => setForm((prev) => ({ ...prev, endDate: event.target.value }))}
              className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 outline-none ring-cyan-400 transition focus:ring-2"
              required
            />
          </label>

          <label className="flex flex-col gap-2 text-sm text-slate-200">
            Initial Capital
            <input
              type="number"
              min={100}
              value={form.initialCapital}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, initialCapital: Number(event.target.value) }))
              }
              className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 outline-none ring-cyan-400 transition focus:ring-2"
            />
          </label>

          <label className="flex flex-col gap-2 text-sm text-slate-200">
            Fee (bps)
            <input
              type="number"
              min={0}
              max={200}
              value={form.feeBps}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, feeBps: Number(event.target.value) }))
              }
              className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 outline-none ring-cyan-400 transition focus:ring-2"
            />
          </label>

          <label className="flex flex-col gap-2 text-sm text-slate-200">
            Slippage (bps)
            <input
              type="number"
              min={0}
              max={200}
              value={form.slippageBps}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, slippageBps: Number(event.target.value) }))
              }
              className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 outline-none ring-cyan-400 transition focus:ring-2"
            />
          </label>

          <div className="flex items-end">
            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-xl bg-cyan-400 px-4 py-2.5 font-semibold text-slate-950 transition hover:bg-cyan-300 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loading ? "Running..." : "Run Backtest"}
            </button>
          </div>
        </form>
      </section>

      {error ? (
        <section className="rounded-2xl border border-red-400/40 bg-red-950/40 px-4 py-3 text-sm text-red-200">
          {error}
        </section>
      ) : null}

      {result ? (
        <>
          <section className="grid grid-cols-1 gap-4 md:grid-cols-4">
            <article className="rounded-2xl border border-emerald-400/25 bg-slate-900/70 p-4">
              <p className="text-xs uppercase tracking-wider text-emerald-300">Best Strategy</p>
              <h2 className="mt-1 text-lg font-semibold text-emerald-100">{result.bestStrategy.strategy}</h2>
            </article>
            <article className="rounded-2xl border border-cyan-400/25 bg-slate-900/70 p-4">
              <p className="text-xs uppercase tracking-wider text-cyan-300">Total Return</p>
              <h2 className="mt-1 text-lg font-semibold text-cyan-100">
                {asPercent(result.bestStrategy.totalReturnPct)}
              </h2>
            </article>
            <article className="rounded-2xl border border-amber-400/25 bg-slate-900/70 p-4">
              <p className="text-xs uppercase tracking-wider text-amber-300">Sharpe</p>
              <h2 className="mt-1 text-lg font-semibold text-amber-100">
                {asNumber(result.bestStrategy.sharpe)}
              </h2>
            </article>
            <article className="rounded-2xl border border-rose-400/25 bg-slate-900/70 p-4">
              <p className="text-xs uppercase tracking-wider text-rose-300">Max Drawdown</p>
              <h2 className="mt-1 text-lg font-semibold text-rose-100">
                {asPercent(result.bestStrategy.maxDrawdownPct)}
              </h2>
            </article>
          </section>

          <section className="rounded-2xl border border-slate-700 bg-slate-900/70 p-4">
            <h3 className="mb-2 text-sm uppercase tracking-widest text-slate-400">Best Equity Curve</h3>
            <div className="h-72 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={selectedCurve}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                  <XAxis
                    dataKey="time"
                    tickFormatter={(value: number) =>
                      new Date(value).toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                      })
                    }
                    stroke="#94a3b8"
                  />
                  <YAxis
                    tickFormatter={(value: number) => asCurrency(value)}
                    stroke="#94a3b8"
                    width={100}
                  />
                  <Tooltip />
                  <Line
                    type="monotone"
                    dataKey="equity"
                    stroke="#22d3ee"
                    strokeWidth={2}
                    dot={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
            <p className="mt-2 text-xs text-slate-400">{result.note}</p>
          </section>

          <section className="overflow-hidden rounded-2xl border border-slate-700 bg-slate-900/70">
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-800/80 text-slate-300">
                  <tr>
                    <th className="px-3 py-2 text-left">Rank</th>
                    <th className="px-3 py-2 text-left">Strategy</th>
                    <th className="px-3 py-2 text-right">Return</th>
                    <th className="px-3 py-2 text-right">CAGR</th>
                    <th className="px-3 py-2 text-right">Sharpe</th>
                    <th className="px-3 py-2 text-right">Drawdown</th>
                    <th className="px-3 py-2 text-right">Win Rate</th>
                    <th className="px-3 py-2 text-right">Trades</th>
                    <th className="px-3 py-2 text-right">Score</th>
                  </tr>
                </thead>
                <tbody>
                  {result.results.map((row) => (
                    <tr key={row.strategy} className="border-t border-slate-800 text-slate-100">
                      <td className="px-3 py-2">{row.rank}</td>
                      <td className="px-3 py-2">{row.strategy}</td>
                      <td className="px-3 py-2 text-right">{asPercent(row.totalReturnPct)}</td>
                      <td className="px-3 py-2 text-right">{asPercent(row.cagrPct)}</td>
                      <td className="px-3 py-2 text-right">{asNumber(row.sharpe)}</td>
                      <td className="px-3 py-2 text-right">{asPercent(row.maxDrawdownPct)}</td>
                      <td className="px-3 py-2 text-right">{asPercent(row.winRatePct)}</td>
                      <td className="px-3 py-2 text-right">{row.trades}</td>
                      <td className="px-3 py-2 text-right">{asNumber(row.score)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      ) : null}

      <section className="rounded-2xl border border-slate-700 bg-slate-900/70 p-4">
        <h3 className="mb-2 text-sm uppercase tracking-widest text-slate-400">Recent Runs</h3>
        {historyNote ? <p className="mb-3 text-xs text-slate-400">{historyNote}</p> : null}
        {history.length === 0 ? (
          <p className="text-sm text-slate-300">No saved runs yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-800/80 text-slate-300">
                <tr>
                  <th className="px-3 py-2 text-left">Date</th>
                  <th className="px-3 py-2 text-left">Market</th>
                  <th className="px-3 py-2 text-left">Top Strategy</th>
                  <th className="px-3 py-2 text-right">Return</th>
                  <th className="px-3 py-2 text-right">Sharpe</th>
                </tr>
              </thead>
              <tbody>
                {history.map((item) => (
                  <tr key={item.id} className="border-t border-slate-800 text-slate-100">
                    <td className="px-3 py-2">
                      {new Date(item.createdAt).toLocaleString("en-US", {
                        year: "numeric",
                        month: "short",
                        day: "numeric",
                      })}
                    </td>
                    <td className="px-3 py-2">
                      {item.symbol} / {item.timeframe}
                    </td>
                    <td className="px-3 py-2">{item.topStrategy ?? "-"}</td>
                    <td className="px-3 py-2 text-right">
                      {item.topResult ? asPercent(item.topResult.totalReturnPct) : "-"}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {item.topResult ? asNumber(item.topResult.sharpe) : "-"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}
