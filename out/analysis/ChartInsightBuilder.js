"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ChartInsightBuilder = void 0;
/**
 * ChartInsightBuilder — 將 K 線區段、指標快照、事件與訊號整理為 ChartInsight
 *
 * 三種說明模式（對應設定 stockHeatmap.chartInsights.mode）：
 *   local  → 只用本地模板，不呼叫 LLM
 *   llm    → 組裝 payload 後傳給 LLMOrchestrator.explainChart()
 *   hybrid → 先本地模板，再由 LLM 補充敘述（預設）
 *
 * 分工原則（4.1）：
 *   - 本模組負責本地事實彙整
 *   - LLM 補充說明由呼叫端（LLMOrchestrator）負責，不在此直接呼叫
 *
 * 實作里程碑：M4
 */
class ChartInsightBuilder {
    /**
     * 針對圖表上的單一蠟燭點生成說明
     */
    buildPointInsight(point, context) {
        throw new Error('ChartInsightBuilder.buildPointInsight — 尚未實作（M4）');
    }
    /**
     * 針對選取的 K 線區間生成趨勢說明
     */
    buildRangeInsight(range, context) {
        throw new Error('ChartInsightBuilder.buildRangeInsight — 尚未實作（M4）');
    }
    /**
     * 針對訊號標記點生成觸發原因說明
     */
    buildSignalInsight(signal, context) {
        throw new Error('ChartInsightBuilder.buildSignalInsight — 尚未實作（M4）');
    }
    /**
     * 將 InsightContext + K 線資料組裝成 ChartInsightPayload，供 LLMOrchestrator 使用
     */
    buildPayload(candles, signal, context, selectedRange) {
        return {
            symbol: context.symbol,
            timeframe: context.timeframe,
            selectedRange,
            candles,
            indicators: context.indicators,
            signal,
            events: context.events,
            news: context.news,
            financials: context.financials,
        };
    }
}
exports.ChartInsightBuilder = ChartInsightBuilder;
//# sourceMappingURL=ChartInsightBuilder.js.map