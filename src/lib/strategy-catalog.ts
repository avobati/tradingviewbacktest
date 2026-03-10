export type StrategyCatalogItem = {
  id: string;
  name: string;
};

export const STRATEGY_CATALOG: StrategyCatalogItem[] = [
  { id: "sma_20_50_cross", name: "SMA 20/50 Crossover" },
  { id: "ema_12_26_cross", name: "EMA 12/26 Crossover" },
  { id: "ema_200_cross", name: "EMA 200 Cross" },
  { id: "rsi_14_reversion", name: "RSI 14 Reversion" },
  { id: "macd_signal_cross", name: "MACD Signal Cross" },
  { id: "bollinger_reentry", name: "Bollinger Re-Entry (20,2)" },
  { id: "stochastic_14_3", name: "Stochastic 14/3" },
  { id: "williams_r_14", name: "Williams %R 14" },
  { id: "cci_20_threshold", name: "CCI 20 Threshold" },
  { id: "ema_200_rsi_regime", name: "EMA 200 + RSI Regime" },
  { id: "ut_buy_alert", name: "UT Buy Alert" },
  { id: "wavetrend_cross", name: "WaveTrend Cross" },
];

export const STRATEGY_IDS = STRATEGY_CATALOG.map((strategy) => strategy.id);
