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
exports.WatchlistProvider = void 0;
const vscode = __importStar(require("vscode"));
/**
 * WatchlistProvider — Sidebar TreeView 資料源
 * M4 完成後將替換為完整實作（含即時報價）
 */
class WatchlistProvider {
    constructor(context) {
        this.context = context;
        this._onDidChangeTreeData = new vscode.EventEmitter();
        this.onDidChangeTreeData = this._onDidChangeTreeData.event;
    }
    refresh() {
        this._onDidChangeTreeData.fire();
    }
    getTreeItem(element) {
        return element;
    }
    getChildren() {
        const config = vscode.workspace.getConfiguration('stockHeatmap');
        const watchlist = config.get('watchlist', []);
        return watchlist.map((symbol) => new WatchlistItem(symbol));
    }
}
exports.WatchlistProvider = WatchlistProvider;
class WatchlistItem extends vscode.TreeItem {
    constructor(symbol) {
        super(symbol, vscode.TreeItemCollapsibleState.None);
        this.symbol = symbol;
        this.tooltip = symbol;
        this.description = '—'; // 報價尚未載入（M2 完成後更新）
        this.contextValue = 'watchlistItem';
    }
}
//# sourceMappingURL=WatchlistProvider.js.map