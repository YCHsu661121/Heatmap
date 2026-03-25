"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TechnicalIndicatorEngine = void 0;
/**
 * TechnicalIndicatorEngine — 使用 technicalindicators npm 套件計算所有技術指標
 *
 * 分工原則（4.1）：
 *   - 所有計算在本地執行，結果為 deterministic
 *   - 不負責生成自然語言解釋
 *   - 供 SignalEngine 與 LLMOrchestrator 讀取
 *
 * 實作里程碑：M3
 */
class TechnicalIndicatorEngine {
    /**
     * 對一組 K 線資料計算所有指標快照
     * @param candles 按時間升冪排序的 K 線陣列（至少需要 26 根以上）
     */
    calculate(candles) {
        throw new Error('TechnicalIndicatorEngine.calculate — 尚未實作（M3）');
    }
}
exports.TechnicalIndicatorEngine = TechnicalIndicatorEngine;
//# sourceMappingURL=TechnicalIndicatorEngine.js.map