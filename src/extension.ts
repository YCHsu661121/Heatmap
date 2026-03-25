import * as vscode from 'vscode';
import { WatchlistProvider, WatchlistEntry, WatchlistStockItem, normalizeWatchlist } from './views/WatchlistProvider';
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
          panel.updateHeatmap(heatmap, 'watchlist');
        } catch (e: unknown) {
          panel.showError(`熱力圖載入失敗：${String(e)}`);
        }
      }
    }),

    // ── 指令：刷新 ────────────────────────────────────────────────────────────
    vscode.commands.registerCommand('stockHeatmap.refresh', async () => {
      watchlistProvider.refresh();
      const panel = DashboardPanel.current;
      if (panel) {
        panel.showLoading('刷新熱力圖中…');
        const [tw, us] = await Promise.allSettled([
          marketData.getHeatmap('TW', 'sector'),
          marketData.getHeatmap('US', 'sector'),
        ]);
        const heatmap = [
          ...(tw.status === 'fulfilled' ? tw.value : []),
          ...(us.status === 'fulfilled' ? us.value : []),
        ];
        panel.updateHeatmap(heatmap, 'watchlist');
      }
    }),

    // ── 指令：切換熱力圖資料來源（Webview loadHeatmap）─────────────────────
    vscode.commands.registerCommand('stockHeatmap.loadHeatmap',
      async (payload: { source?: 'watchlist' | 'market' }) => {
        const panel = DashboardPanel.current;
        if (!panel) { return; }
        const source = payload?.source ?? 'watchlist';
        if (source === 'market') {
          panel.showLoading('載入全台股熱力圖…');
          try {
            const items = await marketData.getHeatmapMarket('TW');
            panel.updateHeatmap(items, 'market', { stale: marketData.didLastHeatmapMarketUseFallback() });
          } catch (e: unknown) {
            panel.showError(`全台股熱力圖載入失敗：${String(e)}`);
          }
        } else {
          panel.showLoading('載入自選股熱力圖…');
          try {
            const [tw, us] = await Promise.allSettled([
              marketData.getHeatmap('TW', 'sector'),
              marketData.getHeatmap('US', 'sector'),
            ]);
            const items = [
              ...(tw.status === 'fulfilled' ? tw.value : []),
              ...(us.status === 'fulfilled' ? us.value : []),
            ];
            panel.updateHeatmap(items, 'watchlist');
          } catch (e: unknown) {
            panel.showError(`自選股熱力圖載入失敗：${String(e)}`);
          }
        }
      }),

    // ── 指令：加入自選股 ────────────────────────────────────────────
    vscode.commands.registerCommand('stockHeatmap.addSymbol', async () => {
      // 1) 股票代碼
      const sym = await vscode.window.showInputBox({
        prompt: '輸入股票代碼（台股：2330，美股：AAPL）',
        placeHolder: '2330',
        validateInput: (v) => v.trim().length === 0 ? '代碼不能為空' : undefined,
      });
      if (!sym) { return; }
      const upper = sym.trim().toUpperCase();

      // 2) 自動查詢名稱，查到後預填；查不到則空白讓使用者填
      let fetchedName = '';
      await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: `查詢 ${upper} 名稱…`, cancellable: false },
        async () => { fetchedName = await marketData.getStockName(upper); },
      );

      const name = await vscode.window.showInputBox({
        prompt: `${upper} 的顯示名稱（可手動修改）`,
        placeHolder: fetchedName || upper,
        value: fetchedName || upper,
      });
      if (name === undefined) { return; }

      // 3) 選擇或新增群組
      const config = vscode.workspace.getConfiguration('stockHeatmap');
      const watchlist = normalizeWatchlist(config.get<unknown[]>('watchlist', []));

      if (watchlist.some((e) => e.symbol === upper)) {
        vscode.window.showWarningMessage(`${upper} 已在自選股清單中`);
        return;
      }

      const existingGroups = [...new Set(watchlist.map((e) => e.group || '預設'))];
      const ADD_NEW = '＋ 新增群組…';
      const groupChoices = existingGroups.length > 0 ? [...existingGroups, ADD_NEW] : [ADD_NEW];

      const picked = await vscode.window.showQuickPick(groupChoices, {
        placeHolder: '選擇群組（或新增）',
      });
      if (!picked) { return; }

      let group: string;
      if (picked === ADD_NEW) {
        const newGroup = await vscode.window.showInputBox({
          prompt: '輸入新群組名稱',
          placeHolder: '半導體',
          validateInput: (v) => v.trim().length === 0 ? '群組名稱不能為空' : undefined,
        });
        if (!newGroup) { return; }
        group = newGroup.trim();
      } else {
        group = picked;
      }

      const entry: WatchlistEntry = {
        symbol: upper,
        name: (name || upper).trim(),
        group,
      };
      await config.update('watchlist', [...watchlist, entry], vscode.ConfigurationTarget.Global);
      watchlistProvider.refresh();
      vscode.window.showInformationMessage(`已加入 ${entry.name}（${upper}）到「${group}」`);
    }),

    // ── 指令：移除自選股（右鍵選單）─────────────────────────────────────────
    vscode.commands.registerCommand('stockHeatmap.removeSymbol', async (item: WatchlistStockItem) => {
      const symbol = item.entry.symbol;
      const label = typeof item.label === 'string' ? item.label : symbol;
      const confirm = await vscode.window.showWarningMessage(
        `確定要從自選股移除 ${label}（${symbol}）嗎？`,
        { modal: true },
        '確定',
      );
      if (confirm !== '確定') { return; }

      const config = vscode.workspace.getConfiguration('stockHeatmap');
      const watchlist = normalizeWatchlist(config.get<unknown[]>('watchlist', []));
      await config.update(
        'watchlist',
        watchlist.filter((e) => e.symbol !== symbol),
        vscode.ConfigurationTarget.Global,
      );
      watchlistProvider.refresh();
      vscode.window.showInformationMessage(`已移除 ${label}（${symbol}）`);
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
      const daysBack: Record<string, number> = {
        '1D': 120, '4H': 30, '1H': 7, '15m': 2,
        '1W': 730, '1M': 1825, '1Y': 3650,
      };
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

