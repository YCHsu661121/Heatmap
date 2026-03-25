import * as vscode from 'vscode';
import { WatchlistProvider } from './views/WatchlistProvider';
import { DashboardPanel } from './views/DashboardPanel';
import { MarketDataService } from './services/MarketDataService';
import { NewsService } from './services/NewsService';
import { FinancialReportService } from './services/FinancialReportService';
import { LLMOrchestrator, AnalysisPayload } from './services/LLMOrchestrator';
import { TechnicalIndicatorEngine } from './analysis/TechnicalIndicatorEngine';
import { SignalEngine } from './analysis/SignalEngine';
import { Candle, SignalResult } from './types';

export function activate(context: vscode.ExtensionContext) {
  // ── 服務初始化 ─────────────────────────────────────────────────────────────
  const marketData = new MarketDataService(context);
  const news       = new NewsService(context);
  const financials = new FinancialReportService(context);
  const indicator  = new TechnicalIndicatorEngine();
  const signal     = new SignalEngine();
  const llm        = new LLMOrchestrator(context);

  // ── Sidebar TreeView ───────────────────────────────────────────────────────
  const watchlistProvider = new WatchlistProvider(context, marketData);
  vscode.window.registerTreeDataProvider('stockHeatmap.watchlist', watchlistProvider);

  // ── 指令：開啟 Dashboard ───────────────────────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand('stockHeatmap.openDashboard', async (symbol?: string) => {
      const panel = DashboardPanel.createOrShow(context);

      if (symbol) {
        await loadSymbolIntoPanel(panel, symbol, '1D');
      } else {
        // 開啟時載入熱力圖（TW + US 各自抓取後合併）
        panel.showLoading('載入熱力圖中…');
        try {
          const [tw, us] = await Promise.allSettled([
            marketData.getHeatmap('TW', 'sector'),
            marketData.getHeatmap('US', 'sector'),
          ]);
          const heatmap = [
            ...(tw.status === 'fulfilled' ? tw.value : []),
            ...(us.status === 'fulfilled' ? us.value : []),
          ];
          panel.updateHeatmap(heatmap);
        } catch (e: unknown) {
          panel.showError(`熱力圖載入失敗：${String(e)}`);
        }
      }
    }),

    // ── 指令：刷新 ────────────────────────────────────────────────────────────
    vscode.commands.registerCommand('stockHeatmap.refresh', () => {
      watchlistProvider.refresh();
    }),

    // ── 指令：加入自選股 ─────────────────────────────────────────────────────
    vscode.commands.registerCommand('stockHeatmap.addSymbol', async () => {
      const sym = await vscode.window.showInputBox({
        prompt: '輸入股票代碼（台股：2330，美股：AAPL）',
        placeHolder: '2330',
        validateInput: (v) => v.trim().length === 0 ? '代碼不能為空' : undefined,
      });
      if (!sym) { return; }
      const upper = sym.trim().toUpperCase();
      const config = vscode.workspace.getConfiguration('stockHeatmap');
      const watchlist: string[] = config.get('watchlist', []);
      if (watchlist.includes(upper)) {
        vscode.window.showWarningMessage(`${upper} 已在自選股清單中`);
        return;
      }
      await config.update('watchlist', [...watchlist, upper], vscode.ConfigurationTarget.Global);
      watchlistProvider.refresh();
      vscode.window.showInformationMessage(`已加入 ${upper}`);
    }),

    // ── 指令：分析股票（Webview loadSymbol）───────────────────────────────────
    vscode.commands.registerCommand('stockHeatmap.loadSymbol',
      async (payload: { symbol: string; timeframe: string }) => {
        const panel = DashboardPanel.createOrShow(context);
        await loadSymbolIntoPanel(panel, payload.symbol, payload.timeframe);
      }),

    // ── 指令：分析（LLM）──────────────────────────────────────────────────────
    vscode.commands.registerCommand('stockHeatmap.analyzeSymbol', async (symbolOrPayload?: string | { symbol: string; timeframe?: string }) => {
      const sym = typeof symbolOrPayload === 'string'
        ? symbolOrPayload
        : (symbolOrPayload as { symbol: string } | undefined)?.symbol;
      if (!sym) {
        vscode.window.showWarningMessage('請先選取或在工具列輸入股票代碼');
        return;
      }
      const panel = DashboardPanel.createOrShow(context);
      panel.showLoading(`LLM 分析 ${sym} …`);
      try {
        const tf = typeof symbolOrPayload === 'object' && symbolOrPayload !== null
          ? (symbolOrPayload as { timeframe?: string }).timeframe ?? '1D'
          : '1D';
        const to = new Date().toISOString().slice(0, 10);
        const from = new Date(Date.now() - 120 * 86_400_000).toISOString().slice(0, 10);
        const newsFrom = new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10);

        const [candleRes, newsRes] = await Promise.allSettled([
          marketData.getCandles(sym, tf, from, to),
          news.getNews(sym, newsFrom, to),
        ]);
        const candleData: Candle[] = candleRes.status === 'fulfilled' ? candleRes.value : [];
        const newsData = newsRes.status === 'fulfilled' ? newsRes.value : [];

        let signalResult: SignalResult | undefined;
        let snapshotForLlm = { sma5: 0, sma20: 0, rsi14: 50, macd: 0, macdSignal: 0, bollingerUpper: 0, bollingerLower: 0 };
        if (candleData.length >= 26) {
          try {
            snapshotForLlm = indicator.calculate(candleData);
            signalResult = signal.evaluate(snapshotForLlm, candleData);
          } catch { /* 繼續 */ }
        }

        const lp: AnalysisPayload = {
          symbol: sym,
          market: /^\d{4,6}$/.test(sym) ? 'TW' : 'US',
          timeframe: tf,
          trend: signalResult?.action === 'BUY' ? '上升' : signalResult?.action === 'SELL' ? '下降' : '觀望',
          signal: signalResult?.action ?? 'WATCH',
          rsi14: snapshotForLlm.rsi14,
          macdState: snapshotForLlm.macd > snapshotForLlm.macdSignal ? '多頭' : '空頭',
          maState: snapshotForLlm.sma5 > snapshotForLlm.sma20 ? '多頭排列' : '空頭排列',
          breakoutState: '未突破',
          newsList: newsData.slice(0, 5).map((n) => ({
            title: n.title, summary: n.summary, publishedAt: n.publishedAt,
          })),
        };

        const rec = await llm.getRecommendation(lp);
        panel.updateRecommendation(sym, rec);
      } catch (e: unknown) {
        panel.showError(`LLM 分析失敗：${String(e)}`);
      }
    }),
  );

  // ---------------------------------------------------------------------------
  // 核心：載入單支股票全套資料到 DashboardPanel
  // ---------------------------------------------------------------------------
  async function loadSymbolIntoPanel(
    panel: DashboardPanel,
    sym: string,
    timeframe: string,
  ): Promise<void> {
    panel.showLoading(`載入 ${sym} …`);
    try {
      // 依據 timeframe 計算 from/to
      const to = new Date().toISOString().slice(0, 10);
      const daysBack: Record<string, number> = { '1D': 120, '4H': 30, '1H': 7, '15m': 2 };
      const fromDate = new Date(Date.now() - (daysBack[timeframe] ?? 120) * 86_400_000)
        .toISOString().slice(0, 10);

      const newsFrom = new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10);

      const [candles, newsItems, financialReports] = await Promise.allSettled([
        marketData.getCandles(sym, timeframe, fromDate, to),
        news.getNews(sym, newsFrom, to),
        financials.getLatestReports(sym),
      ]);

      const candleData = candles.status === 'fulfilled' ? candles.value : [];
      const newsData   = newsItems.status === 'fulfilled' ? newsItems.value : [];
      const finData    = financialReports.status === 'fulfilled' ? financialReports.value : [];

      // 計算技術指標 + 訊號
      let signalResult;
      if (candleData.length >= 26) {
        try {
          const snapshot = indicator.calculate(candleData);
          signalResult = signal.evaluate(snapshot, candleData);
        } catch {
          // 指標計算失敗不影響其他面板
        }
      }

      panel.updateChart(sym, candleData, signalResult);
      panel.updateNews(sym, newsData);
      panel.updateFinancials(sym, finData);
    } catch (e: unknown) {
      panel.showError(`載入 ${sym} 失敗：${String(e)}`);
    }
  }
}

export function deactivate() {}

