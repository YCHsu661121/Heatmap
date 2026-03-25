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
exports.LlmTeamStore = void 0;
const vscode = __importStar(require("vscode"));
const STORE_KEY = 'stockHeatmap.llmTeams';
/**
 * LlmTeamStore — 持久化固定 LLM 協作組設定
 *
 * 使用 VS Code GlobalState 儲存，重啟後仍保留。
 * 實作里程碑：M5
 */
class LlmTeamStore {
    constructor(context) {
        this.context = context;
    }
    /** 取得所有已儲存的協作組 */
    async getAll() {
        return this.context.globalState.get(STORE_KEY, []);
    }
    /** 取得指定 ID 的協作組；不存在時回傳 undefined */
    async getById(id) {
        const all = await this.getAll();
        return all.find((t) => t.id === id);
    }
    /** 新增或更新協作組（以 id 為 key） */
    async save(team) {
        const all = await this.getAll();
        const idx = all.findIndex((t) => t.id === team.id);
        if (idx >= 0) {
            all[idx] = team;
        }
        else {
            all.push(team);
        }
        await this.context.globalState.update(STORE_KEY, all);
    }
    /** 刪除指定 ID 的協作組 */
    async delete(id) {
        const all = await this.getAll();
        const filtered = all.filter((t) => t.id !== id);
        await this.context.globalState.update(STORE_KEY, filtered);
    }
    /** 取得目前預設協作組 ID（讀取使用者設定） */
    getDefaultTeamId() {
        return vscode.workspace.getConfiguration('stockHeatmap').get('llm.defaultTeamId', '');
    }
    /** 設定預設協作組 ID */
    async setDefaultTeamId(id) {
        await vscode.workspace.getConfiguration('stockHeatmap').update('llm.defaultTeamId', id, vscode.ConfigurationTarget.Global);
    }
}
exports.LlmTeamStore = LlmTeamStore;
//# sourceMappingURL=LlmTeamStore.js.map