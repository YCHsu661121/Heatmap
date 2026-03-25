import { Quote, ScreenerPreset } from '../types';

/** 選股結果：符合條件的股票 + 命中的條件說明 */
export interface ScreenerResult {
  symbol: string;
  quote: Quote;
  matchedConditions: string[];
}

/**
 * ScreenerEngine — 對自選股清單或指定市場執行條件式過濾
 *
 * 分工原則（4.1）：
 *   - 所有條件邏輯為 deterministic，不依賴 LLM
 *   - 篩選結果可重跑與測試
 *
 * 實作里程碑：第二階段
 */
export class ScreenerEngine {
  /**
   * 對指定報價清單執行選股條件
   * @param quotes  要篩選的股票報價
   * @param preset  篩選條件預設組
   */
  run(quotes: Quote[], preset: ScreenerPreset): ScreenerResult[] {
    throw new Error('ScreenerEngine.run — 尚未實作（第二階段）');
  }
}
