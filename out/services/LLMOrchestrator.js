"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.LLMOrchestrator = void 0;
const vscode = __importStar(require("vscode"));
/**
 * LLMOrchestrator — 多模型分析路由
 *
 * 支援的 Provider：
 *   - OpenAI（openai npm 套件）
 *   - Ollama（多個 HTTP 節點，round-robin / priority / failover）
 *   - GitHub Copilot（vscode.lm.selectChatModels）
 *
 * 分工原則（4.1）：
 *   - LLM 不計算技術指標
 *   - LLM 只解讀本地已計算的事實
 *   - 無資料時回傳保守 WATCH 建議
 *
 * 實作里程碑：M5
 */
class LLMOrchestrator {
    constructor(context) {
        this.context = context;
    }
    // ---------------------------------------------------------------------------
    // 單模型 / 多模型建議
    // ---------------------------------------------------------------------------
    /** 單模型建議（依設定選取 provider） */
    async getRecommendation(payload) {
        throw new Error('LLMOrchestrator.getRecommendation — 尚未實作（M5）');
    }
    /** 多模型並行建議（parallel / consensus 模式） */
    async getRecommendations(payload) {
        throw new Error('LLMOrchestrator.getRecommendations — 尚未實作（M5）');
    }
    /** 將多模型結果依指定策略彙總為單一建議 */
    mergeRecommendations(results, strategy) {
        throw new Error('LLMOrchestrator.mergeRecommendations — 尚未實作（M5）');
    }
    // ---------------------------------------------------------------------------
    // 固定協作組
    // ---------------------------------------------------------------------------
    /** 使用指定協作組執行分析 */
    async runTeam(teamId, payload) {
        throw new Error('LLMOrchestrator.runTeam — 尚未實作（M5）');
    }
    /** 儲存固定協作組設定 */
    async saveTeamConfig(config) {
        throw new Error('LLMOrchestrator.saveTeamConfig — 尚未實作（M5）');
    }
    // ---------------------------------------------------------------------------
    // 圖表說明
    // ---------------------------------------------------------------------------
    /** 對圖表說明 payload 呼叫 LLM，回傳 ChartInsight */
    async explainChart(insight) {
        throw new Error('LLMOrchestrator.explainChart — 尚未實作（M5）');
    }
    // ---------------------------------------------------------------------------
    // 內部工具
    // ---------------------------------------------------------------------------
    /** 取得設定中的 LLM endpoint 清單 */
    getEndpoints() {
        return vscode.workspace.getConfiguration('stockHeatmap').get('llm.ollamaEndpoints', []);
    }
    /** 無資料或模型失敗時回傳的保守 fallback 建議 */
    conservativeFallback(reason) {
        return {
            action: 'WATCH',
            confidence: 0.3,
            reason,
            disclaimer: '以上分析僅供參考，不構成任何投資建議。投資有風險，決策前請自行研判。',
        };
    }
}
exports.LLMOrchestrator = LLMOrchestrator;
//# sourceMappingURL=LLMOrchestrator.js.map