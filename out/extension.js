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
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = __importStar(require("vscode"));
const WatchlistProvider_1 = require("./views/WatchlistProvider");
function activate(context) {
    const watchlistProvider = new WatchlistProvider_1.WatchlistProvider(context);
    vscode.window.registerTreeDataProvider('stockHeatmap.watchlist', watchlistProvider);
    context.subscriptions.push(vscode.commands.registerCommand('stockHeatmap.openDashboard', () => {
        vscode.window.showInformationMessage('Stock Heatmap: Dashboard（施工中，M4 完成）');
    }), vscode.commands.registerCommand('stockHeatmap.refresh', () => {
        watchlistProvider.refresh();
    }), vscode.commands.registerCommand('stockHeatmap.addSymbol', async () => {
        const symbol = await vscode.window.showInputBox({
            prompt: '輸入股票代碼（台股：2330，美股：AAPL）',
            placeHolder: '2330',
            validateInput: (v) => v.trim().length === 0 ? '代碼不能為空' : undefined,
        });
        if (!symbol) {
            return;
        }
        const upper = symbol.trim().toUpperCase();
        const config = vscode.workspace.getConfiguration('stockHeatmap');
        const watchlist = config.get('watchlist', []);
        if (watchlist.includes(upper)) {
            vscode.window.showWarningMessage(`${upper} 已在自選股清單中`);
            return;
        }
        await config.update('watchlist', [...watchlist, upper], vscode.ConfigurationTarget.Global);
        watchlistProvider.refresh();
        vscode.window.showInformationMessage(`已加入 ${upper}`);
    }), vscode.commands.registerCommand('stockHeatmap.analyzeSymbol', () => {
        vscode.window.showInformationMessage('Stock Heatmap: Analyze Symbol（施工中，M5 完成）');
    }));
}
function deactivate() { }
//# sourceMappingURL=extension.js.map