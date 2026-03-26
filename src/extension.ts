import * as vscode from 'vscode';
import { WatchlistProvider, WatchlistEntry, WatchlistStockItem, normalizeWatchlist } from './views/WatchlistProvider';
import { DashboardPanel } from './views/DashboardPanel';
import { MarketDataService } from './services/MarketDataService';
import { NewsService } from './services/NewsService';
import { FinancialReportService } from './services/FinancialReportService';
import { LLMOrchestrator, AnalysisPayload } from './services/LLMOrchestrator';
import { TechnicalIndicatorEngine } from './analysis/TechnicalIndicatorEngine';
import { SignalEngine } from './analysis/SignalEngine';
import { AlertEngine } from './alerts/AlertEngine';
import { Candle, SignalResult, AlertRule } from './types';

export function activate(context: vscode.ExtensionContext) {
  // ── 服務初始化 ─────────────────────────────────────────────────────────────
  const marketData = new MarketDataService(context);
  const news       = new NewsService(context);
  const financials = new FinancialReportService(context);
  const indicator  = new TechnicalIndicatorEngine();
  const signal     = new SignalEngine();
  const llm        = new LLMOrchestrator(context);  const alertEng   = new AlertEngine(context);

  // ── 提醒定時器（依 refreshIntervalSec 周期檢查） ──────────────────────────
  async function runAlertCheck(): Promise<void> {
    const rules = alertEng.getRules();
    if (rules.filter(r => r.enabled).length === 0) { return; }
    try {
      const cfg   = vscode.workspace.getConfiguration('stockHeatmap');
      const alertsEnabled = cfg.get<boolean>('alerts.enabled', true);
      if (!alertsEnabled) { return; }

      // 從 watchlist 取得所有需要監控的股票代碼
      const raw: unknown[] = cfg.get('watchlist', []);
      const allSymbols = raw.map((e) =>
        typeof e === 'string' ? (e as string).toUpperCase() : (e as WatchlistEntry).symbol,
      );
      const ruleSymbols = [...new Set(rules.map(r => r.symbol))];
      const symbols = [...new Set([...allSymbols, ...ruleSymbols])];
      if (symbols.length === 0) { return; }

      // 從 TWSE/TPEX 免費批次資料將 quotes 准備好
      const quotes = await marketData.getQuotes(symbols);

      // 技術指標（僅有 indicator 類型提醒才需要 candles）
      const indicatorRuleSymbols = [...new Set(
        rules.filter(r => r.enabled && r.type === 'indicator').map(r => r.symbol),
      )];
      const signalMap = new Map<string, SignalResult>();
      await Promise.allSettled(indicatorRuleSymbols.map(async (sym) => {
        try {
          const to   = new Date().toISOString().slice(0, 10);
          const from = new Date(Date.now() - 120 * 86_400_000).toISOString().slice(0, 10);
          const candles = await marketData.getCandles(sym, '1D', from, to);
          if (candles.length >= 26) {
            const snap = indicator.calculate(candles);
            signalMap.set(sym, signal.evaluate(snap, candles));
          }
        } catch { /* 單檔失敗不中斷 */ }
      }));

      alertEng.checkAlerts(quotes, signalMap, rules);
    } catch { /* 整體檢查失敗不影響主流程 */ }
  }

  const intervalSec = vscode.workspace.getConfiguration('stockHeatmap')
    .get<number>('refreshIntervalSec', 60);
  const alertTimer = setInterval(() => { void runAlertCheck(); }, Math.max(intervalSec, 30) * 1000);
  context.subscriptions.push({ dispose: () => clearInterval(alertTimer) });
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
        // 背景載入大盤新聞（不阻塞主流程）
        news.getMarketNews().then(items => {
          if (items.length > 0) { panel.updateNews('大盤新聞', items); }
        }).catch(() => {});
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

    // ── 指令：新增提醒規則 ─────────────────────────────────────────────────
    vscode.commands.registerCommand('stockHeatmap.addAlertRule', async () => {
      // 安全使用 showQuickPick + showInputBox 於正常 TypeScript 检查
      const sym = await vscode.window.showInputBox({
        prompt: '輸入要監控的股票代碼（如 2330 或 AAPL）',
        placeHolder: '2330',
        validateInput: (v: string) => v.trim().length === 0 ? '不能為空' : undefined,
      });
      if (!sym) { return; }

      const typePick = await vscode.window.showQuickPick([
        { label: '💹 股價突砻', description: 'price', detail: '股價 > / < / ≥ / ≤ 閨値' },
        { label: '📈 漲跌幅', description: 'changePercent', detail: '漲跌幅 ≥ x% 或 ≤ -x%' },
        { label: '📉 RSI 指標', description: 'rsi14', detail: 'RSI14 超賣 < 30 或超買 > 70' },
        { label: '🔄 均線交叉', description: 'sma_cross', detail: 'SMA5 黄金/死亡交叉' },
        { label: '📰 新聞情緒', description: 'news', detail: '偵測負面或關鍵字新聞' },
      ], { placeHolder: '選擇提醒類型' });
      if (!typePick) { return; }

      let ruleType: AlertRule['type'] = 'price';
      let ruleTarget = '';
      let ruleOperator: AlertRule['operator'] = '>';
      let ruleValue: number | string = 0;
      let ruleSeverity: AlertRule['severity'] = 'info';

      switch (typePick.description) {
        case 'price': {
          ruleType = 'price';
          const opPick = await vscode.window.showQuickPick(
            [{ label: '> 大於', v: '>' }, { label: '< 小於', v: '<' }, { label: '≥ 大於等於', v: '>=' }, { label: '≤ 小於等於', v: '<=' }],
            { placeHolder: '選擇運算符' },
          );
          if (!opPick) { return; }
          ruleOperator = opPick.v as AlertRule['operator'];
          const val = await vscode.window.showInputBox({ prompt: '輸入閨値價格', placeHolder: '100', validateInput: (v: string) => isNaN(Number(v)) ? '請輸入數字' : undefined });
          if (!val) { return; }
          ruleValue = Number(val);
          ruleSeverity = 'warning';
          break;
        }
        case 'changePercent': {
          ruleType = 'changePercent';
          const opPick = await vscode.window.showQuickPick(
            [{ label: '≥ 漲幅達...', v: '>=' }, { label: '≤ 跌幅達...', v: '<=' }],
            { placeHolder: '選擇運算符' },
          );
          if (!opPick) { return; }
          ruleOperator = opPick.v as AlertRule['operator'];
          const val = await vscode.window.showInputBox({ prompt: '輸入漲跌幅熾値（%），如 3 或 -3', placeHolder: '3', validateInput: (v: string) => isNaN(Number(v)) ? '請輸入數字' : undefined });
          if (!val) { return; }
          ruleValue = Number(val);
          ruleSeverity = 'info';
          break;
        }
        case 'rsi14': {
          ruleType = 'indicator';
          ruleTarget = 'rsi14';
          const opPick = await vscode.window.showQuickPick(
            [{ label: '< 超賣區', v: '<' }, { label: '> 超買區', v: '>' }],
            { placeHolder: '選擇條件' },
          );
          if (!opPick) { return; }
          ruleOperator = opPick.v as AlertRule['operator'];
          const defaultV = ruleOperator === '<' ? '30' : '70';
          const val = await vscode.window.showInputBox({ prompt: 'RSI 熾値', value: defaultV, validateInput: (v: string) => isNaN(Number(v)) ? '請輸入數字' : undefined });
          if (!val) { return; }
          ruleValue = Number(val);
          ruleSeverity = 'warning';
          break;
        }
        case 'sma_cross': {
          ruleType = 'indicator';
          ruleTarget = 'sma5';
          const crossPick = await vscode.window.showQuickPick(
            [{ label: '🟢 黄金交叉（SMA5 上穿 SMA20）', v: 'crossesAbove' }, { label: '🔴 死亡交叉（SMA5 下穿 SMA20）', v: 'crossesBelow' }],
            { placeHolder: '選擇交叉方向' },
          );
          if (!crossPick) { return; }
          ruleOperator = crossPick.v as AlertRule['operator'];
          ruleValue = 0; // sma_cross 不需要 threshold
          ruleSeverity = 'warning';
          break;
        }
        case 'news': {
          ruleType = 'news';
          ruleTarget = 'sentiment';
          const newsPick = await vscode.window.showQuickPick(
            [
              { label: '🟥 負面新聞', v: 'negative', op: 'contains' as AlertRule['operator'] },
              { label: '🟢 正面新聞', v: 'positive', op: 'contains' as AlertRule['operator'] },
              { label: '🔍 關鍵字', v: '__keyword__', op: 'contains' as AlertRule['operator'] },
            ],
            { placeHolder: '選擇新聞類型' },
          );
          if (!newsPick) { return; }
          if (newsPick.v === '__keyword__') {
            const kw = await vscode.window.showInputBox({ prompt: '輸入關鍵字（如: 寿险安装、斷貨）' });
            if (!kw) { return; }
            ruleValue = kw;
            ruleOperator = 'contains';
          } else {
            ruleTarget = 'sentiment';
            ruleValue = newsPick.v;
            ruleOperator = 'contains';
          }
          ruleSeverity = 'info';
          break;
        }
        default: return;
      }

      const cooldownStr = await vscode.window.showInputBox({
        prompt: '提醒冷卻時間（秒），防止重複詰暴',
        value: '1800',
        validateInput: (v: string) => isNaN(Number(v)) || Number(v) < 0 ? '請輸入正整數' : undefined,
      });
      if (cooldownStr === undefined) { return; }

      const newRule: AlertRule = {
        id: `${sym.trim().toUpperCase()}_${ruleType}_${Date.now()}`,
        symbol: sym.trim().toUpperCase(),
        enabled: true,
        type: ruleType,
        operator: ruleOperator,
        target: ruleTarget,
        value: ruleValue,
        cooldownSec: Number(cooldownStr) || 1800,
        severity: ruleSeverity,
      };
      await alertEng.addRule(newRule);
      vscode.window.showInformationMessage(`✅ 已新增提醒規則：${newRule.id}`);
    }),

    // ── 指令：查看 / 刪除提醒規則 ──────────────────────────────────────────
    vscode.commands.registerCommand('stockHeatmap.manageAlerts', async () => {
      const rules = alertEng.getRules();
      if (rules.length === 0) {
        const pick = await vscode.window.showInformationMessage('目前無提醒規則。', '新增規則');
        if (pick === '新增規則') { await vscode.commands.executeCommand('stockHeatmap.addAlertRule'); }
        return;
      }
      const items = rules.map(r => ({
        label: `${r.enabled ? '✅' : '⏸️'} [${r.symbol}] ${r.type} ${r.operator} ${r.value}`,
        description: `cooldown ${r.cooldownSec}s  severity=${r.severity}`,
        detail: r.id,
        id: r.id,
      }));
      const picked = await vscode.window.showQuickPick(items, { placeHolder: '選擇規則進行操作' });
      if (!picked) { return; }
      const action = await vscode.window.showQuickPick(
        ['🔴 刪除此規則', `${rules.find(r => r.id === picked.id)?.enabled ? '⏸️ 停用' : '▶️ 啟用'}此規則`],
        { placeHolder: '選擇操作' },
      );
      if (!action) { return; }
      if (action.startsWith('🔴')) {
        await alertEng.deleteRule(picked.id);
        vscode.window.showInformationMessage(`已刪除規則 ${picked.id}`);
      } else {
        const updated = alertEng.getRules().map(r =>
          r.id === picked.id ? { ...r, enabled: !r.enabled } : r,
        );
        await alertEng.saveRules(updated);
        vscode.window.showInformationMessage(`已更新規則狀態`);
      }
    }),

    // ── 指令：立即執行一次提醒檢查 ─────────────────────────────────
    vscode.commands.registerCommand('stockHeatmap.runAlertCheck', async () => {
      await runAlertCheck();
      vscode.window.showInformationMessage('提醒檢查完成（如有觸發將顯示通知）。');
    }),

    // ── 指令：大盤新聞 ────────────────────────────────────────────────────────
    vscode.commands.registerCommand('stockHeatmap.loadMarketNews', async () => {
      const panel = DashboardPanel.current;
      if (!panel) { return; }
      try {
        const items = await news.getMarketNews();
        panel.updateNews('大盤新聞', items);
      } catch { /* ignore */ }
    }),

    // ── 指令：指數 K 線（加權 / OTC）─────────────────────────────────────────
    vscode.commands.registerCommand('stockHeatmap.loadIndex',
      async (payload: { index: 'TWII' | 'OTC' }) => {
        const panel = DashboardPanel.createOrShow(context);
        const label = payload.index === 'TWII' ? '加權指數(^TWII)' : 'OTC指數(^TWOII)';
        panel.showLoading(`載入${label}…`);
        try {
          const candles = await marketData.getIndexCandles(payload.index);
          panel.updateChart(label, candles);
        } catch (e: unknown) {
          panel.showError(`指數載入失敗：${String(e)}`);
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

