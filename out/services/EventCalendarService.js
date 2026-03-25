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
exports.EventCalendarService = void 0;
const vscode = __importStar(require("vscode"));
/**
 * EventCalendarService — 聚合股票與總經事件
 * 將事件映射到圖表與提醒邏輯
 *
 * 實作里程碑：M2（基礎）/ 第二階段功能
 */
class EventCalendarService {
    constructor(context) {
        this.context = context;
    }
    /**
     * 取得即將到來的事件
     * @param symbols      關注的股票代碼（空陣列 = 只取總經事件）
     * @param lookaheadDays 預讀天數
     */
    async getUpcomingEvents(symbols, lookaheadDays) {
        throw new Error('EventCalendarService.getUpcomingEvents — 尚未實作');
    }
    /**
     * 取得指定時間範圍內的事件（供圖表標記用）
     */
    async getEventsInRange(symbols, from, to) {
        throw new Error('EventCalendarService.getEventsInRange — 尚未實作');
    }
    getLookaheadDays() {
        return vscode.workspace.getConfiguration('stockHeatmap').get('calendar.lookaheadDays', 14);
    }
}
exports.EventCalendarService = EventCalendarService;
//# sourceMappingURL=EventCalendarService.js.map