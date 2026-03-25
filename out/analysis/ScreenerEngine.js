"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ScreenerEngine = void 0;
/**
 * ScreenerEngine — 對自選股清單或指定市場執行條件式過濾
 *
 * 分工原則（4.1）：
 *   - 所有條件邏輯為 deterministic，不依賴 LLM
 *   - 篩選結果可重跑與測試
 *
 * 實作里程碑：第二階段
 */
class ScreenerEngine {
    /**
     * 對指定報價清單執行選股條件
     * @param quotes  要篩選的股票報價
     * @param preset  篩選條件預設組
     */
    run(quotes, preset) {
        throw new Error('ScreenerEngine.run — 尚未實作（第二階段）');
    }
}
exports.ScreenerEngine = ScreenerEngine;
//# sourceMappingURL=ScreenerEngine.js.map