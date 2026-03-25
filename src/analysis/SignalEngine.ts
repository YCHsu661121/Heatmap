import { Candle, IndicatorSnapshot, SignalResult } from '../types';

/** 訊號規則設定（使用者可覆寫閾值） */
export interface SignalConfig {
  rsiOverbought: number;
  rsiOversold: number;
  breakoutLookback: number;
}

/** 預設訊號設定 */
export const DEFAULT_SIGNAL_CONFIG: SignalConfig = {
  rsiOverbought: 70,
  rsiOversold: 30,
  breakoutLookback: 20,
};

/**
 * SignalEngine — 根據本地計算指標輸出 BUY / SELL / WATCH 訊號
 *
 * 規則清單：
 *   [B1] SMA5 上穿 SMA20（多頭交叉）       → +2 分
 *   [B2] RSI < rsiOversold（超賣反彈）      → +2 分
 *   [B3] MACD 黃金交叉（macd > signal）     → +1 分
 *   [B4] 價格站回布林中線以上               → +1 分
 *   [S1] SMA5 下穿 SMA20（空頭交叉）        → -2 分
 *   [S2] RSI > rsiOverbought（超買回落）     → -2 分
 *   [S3] MACD 死亡交叉（macd < signal）     → -1 分
 *   [S4] 價格跌破布林中線以下               → -1 分
 *
 *   score ≥ +2 → BUY  |  score ≤ -2 → SELL  |  其他 → WATCH
 *   confidence = min(|score| / 6, 1)（最高分 6）
 *
 * 分工原則（4.1）：
 *   - 所有規則均為 deterministic，不依賴 LLM
 *   - 同一份輸入永遠產生相同輸出
 */
export class SignalEngine {
  /**
   * 根據指標快照評估並輸出訊號
   *
   * @param indicators 由 TechnicalIndicatorEngine.calculate() 產出的快照
   * @param candles    升冪排序的 K 線（用於突破判斷，可省略）
   * @param config     閾值設定（預設使用 DEFAULT_SIGNAL_CONFIG）
   */
  evaluate(
    indicators: IndicatorSnapshot,
    candles: Candle[] = [],
    config: SignalConfig = DEFAULT_SIGNAL_CONFIG,
  ): SignalResult {
    let score = 0;
    const reasons: string[] = [];

    const bollingerMid = (indicators.bollingerUpper + indicators.bollingerLower) / 2;
    const currentClose = candles.length > 0 ? candles[candles.length - 1].close : undefined;

    // ── 多頭訊號 ──────────────────────────────────────────────────────────────
    if (indicators.sma5 > indicators.sma20) {
      score += 2;
      reasons.push('SMA5 > SMA20（短線多頭排列）');
    }

    if (indicators.rsi14 < config.rsiOversold) {
      score += 2;
      reasons.push(`RSI ${indicators.rsi14} < ${config.rsiOversold}（超賣，反彈機率高）`);
    }

    if (indicators.macd > indicators.macdSignal) {
      score += 1;
      reasons.push('MACD 黃金交叉（MACD > Signal）');
    }

    if (currentClose !== undefined && currentClose > bollingerMid) {
      score += 1;
      reasons.push('收盤價站回布林中線之上');
    }

    // ── 空頭訊號 ──────────────────────────────────────────────────────────────
    if (indicators.sma5 < indicators.sma20) {
      score -= 2;
      reasons.push('SMA5 < SMA20（短線空頭排列）');
    }

    if (indicators.rsi14 > config.rsiOverbought) {
      score -= 2;
      reasons.push(`RSI ${indicators.rsi14} > ${config.rsiOverbought}（超買，注意回落）`);
    }

    if (indicators.macd < indicators.macdSignal) {
      score -= 1;
      reasons.push('MACD 死亡交叉（MACD < Signal）');
    }

    if (currentClose !== undefined && currentClose < bollingerMid) {
      score -= 1;
      reasons.push('收盤價跌破布林中線');
    }

    // ── 突破/跌破近期高低點 ──────────────────────────────────────────────────
    if (candles.length >= config.breakoutLookback && currentClose !== undefined) {
      const lookback = candles.slice(-config.breakoutLookback - 1, -1);
      const recentHigh = Math.max(...lookback.map((c) => c.high));
      const recentLow = Math.min(...lookback.map((c) => c.low));

      if (currentClose > recentHigh) {
        score += 1;
        reasons.push(`收盤突破近 ${config.breakoutLookback} 日高點（${recentHigh}）`);
      } else if (currentClose < recentLow) {
        score -= 1;
        reasons.push(`收盤跌破近 ${config.breakoutLookback} 日低點（${recentLow}）`);
      }
    }

    // ── 判斷動作 ─────────────────────────────────────────────────────────────
    const action: 'BUY' | 'SELL' | 'WATCH' =
      score >= 2 ? 'BUY' : score <= -2 ? 'SELL' : 'WATCH';

    const maxScore = 7; // 最高可能得分（含突破加分）
    const confidence = Math.round(Math.min(Math.abs(score) / maxScore, 1) * 100) / 100;

    return { action, confidence, reasons, indicators };
  }
}

