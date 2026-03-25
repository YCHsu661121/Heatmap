import { Candle, IndicatorSnapshot } from '../types';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const ti = require('technicalindicators') as typeof import('technicalindicators');

/**
 * TechnicalIndicatorEngine — 使用 technicalindicators npm 套件計算所有技術指標
 *
 * 分工原則（4.1）：
 *   - 所有計算在本地執行，結果為 deterministic
 *   - 不負責生成自然語言解釋
 *   - 供 SignalEngine 與 LLMOrchestrator 讀取
 *
 * 指標清單（對應 IndicatorSnapshot）：
 *   sma5, sma20, rsi14, macd, macdSignal, bollingerUpper, bollingerLower
 */
export class TechnicalIndicatorEngine {
  private static readonly MIN_CANDLES = 26; // MACD 需要至少 26 根

  /**
   * 對一組 K 線資料計算所有指標快照
   * @param candles 按時間升冪排序的 K 線陣列（至少需要 26 根以上）
   * @throws 若 candles 不足 26 根
   */
  calculate(candles: Candle[]): IndicatorSnapshot {
    if (candles.length < TechnicalIndicatorEngine.MIN_CANDLES) {
      throw new Error(
        `TechnicalIndicatorEngine: 需要至少 ${TechnicalIndicatorEngine.MIN_CANDLES} 根 K 線，目前只有 ${candles.length} 根`,
      );
    }

    const closes = candles.map((c) => c.close);

    // ── SMA ──────────────────────────────────────────────────────────────────
    const sma5Arr: number[] = ti.SMA.calculate({ period: 5, values: closes });
    const sma20Arr: number[] = ti.SMA.calculate({ period: 20, values: closes });

    // ── RSI ──────────────────────────────────────────────────────────────────
    const rsi14Arr: number[] = ti.RSI.calculate({ period: 14, values: closes });

    // ── MACD ─────────────────────────────────────────────────────────────────
    const macdArr = ti.MACD.calculate({
      fastPeriod: 12,
      slowPeriod: 26,
      signalPeriod: 9,
      values: closes,
      SimpleMAOscillator: false,
      SimpleMASignal: false,
    });
    const lastMacd = [...macdArr].reverse().find(
      (m: { MACD?: number; signal?: number }) => m.MACD !== undefined && m.signal !== undefined,
    ) as { MACD: number; signal: number } | undefined;

    // ── Bollinger Bands ───────────────────────────────────────────────────────
    const bbArr = ti.BollingerBands.calculate({ period: 20, stdDev: 2, values: closes }) as Array<{ upper: number; middle: number; lower: number }>;

    // ── 取最後一個有效值 ─────────────────────────────────────────────────────
    const last = <T>(arr: T[]): T => arr[arr.length - 1];

    return {
      sma5: this.round(last(sma5Arr)),
      sma20: this.round(last(sma20Arr)),
      rsi14: this.round(last(rsi14Arr), 2),
      macd: this.round(lastMacd?.MACD ?? 0, 4),
      macdSignal: this.round(lastMacd?.signal ?? 0, 4),
      bollingerUpper: this.round(last(bbArr).upper),
      bollingerLower: this.round(last(bbArr).lower),
    };
  }

  // ---------------------------------------------------------------------------
  // 工具
  // ---------------------------------------------------------------------------

  private round(value: number, decimals = 2): number {
    const factor = Math.pow(10, decimals);
    return Math.round(value * factor) / factor;
  }
}

