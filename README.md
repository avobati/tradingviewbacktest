# tradingviewbacktest

`tradingviewbacktest` is a full-stack Next.js app that:

- Pulls historical market candles from Yahoo Finance
- Backtests multiple TradingView-style indicator strategies
- Ranks strategies by a risk-adjusted score
- Saves run results to Neon Postgres through Prisma

## Tech Stack

- Next.js 16 (App Router)
- React 19 + Tailwind CSS 4
- Prisma ORM + PostgreSQL (Neon)
- technicalindicators for strategy signals
- Recharts for equity curve visualization

## Included Strategies

- SMA 20/50 Crossover
- EMA 12/26 Crossover
- RSI 14 Reversion
- MACD Signal Cross
- Bollinger Re-Entry (20,2)
- Stochastic 14/3
- Williams %R 14
- CCI 20 Threshold
- EMA 200 + RSI Regime

## Local Setup

1. Install dependencies:

```bash
npm install
```

2. Set environment variables:

```bash
cp .env.example .env
```

Then set your Neon connection string in `.env`:

```bash
DATABASE_URL="postgresql://USER:PASSWORD@YOUR_NEON_HOST/YOUR_DB?sslmode=require"
```

3. Create database schema:

```bash
npx prisma generate
npx prisma db push
```

4. Run locally:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Neon + Vercel Deployment

1. Ensure Neon project/database exists and `DATABASE_URL` is ready.
2. In Vercel, add project env var:
   - `DATABASE_URL=<your_neon_connection_string>`
3. Deploy:

```bash
vercel --prod
```

4. Apply schema to production database (from local machine):

```bash
npx prisma db push
```

## Notes

- Market data comes from Yahoo Finance. Crypto pairs like `BTCUSDT` are normalized to `BTC-USD`, and equity tickers like `AAPL` are supported.
- Strategy logic is TradingView-style indicator behavior, not direct execution of arbitrary Pine scripts.
