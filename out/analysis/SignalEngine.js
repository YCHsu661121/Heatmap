"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SignalEngine = exports.DEFAULT_SIGNAL_CONFIG = void 0;
/** 預設訊號設定 */
exports.DEFAULT_SIGNAL_CONFIG = {
    rsiOverbought: 70,
    rsiOversold: 30,
    smaPeriodFast: 5,
    smaPeriodSlow: 20,
    breakoutLookback: 20,
};
/**
 * SignalEngine — 根據本地計算指標輸出 BUY / SELL / WATCH 訊號
 *
 * 規則首版：
 *   - SMA5 上穿 SMA20 → 短線偏多
 *   - SMA5 下穿 SMA20 → 短線偏空
 *   - RSI < rsiOversold → 超賣觀察
 *   - RSI > rsiOverbought → 超買觀察
 *   - MACD 黃金交叉 / 死亡交叉
 *   - 價格突破近 N 日高點或跌破近 N 日低點
 *
 * 分工原則（4.1）：
 *   - 所有規則均為 deterministic，不依賴 LLM
 *   - 同一份 IndicatorSnapshot 輸入永遠產生相同輸出
 *
 * 實作里程碑：M3
 */
class SignalEngine {
    /**
     * 根據指標快照與設定，評估並輸出訊號
     * @param indicators 由 TechnicalIndicatorEngine.calculate() 產出的快照
     * @param config     訊號閾值設定（預設使用 DEFAULT_SIGNAL_CONFIG）
     */
    evaluate(indicators, config = exports.DEFAULT_SIGNAL_CONFIG) {
        throw new Error('SignalEngine.evaluate — 尚未實作（M3）');
    }
}
exports.SignalEngine = SignalEngine;
//# sourceMappingURL=SignalEngine.js.map