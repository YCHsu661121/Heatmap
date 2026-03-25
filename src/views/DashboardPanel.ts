import * as vscode from 'vscode';
import { HeatmapItem, Candle, SignalResult, NewsItem, FinancialReportSummary } from '../types';

/**
 * DashboardPanel — 主要 Webview 面板
 *
 * 包含：
 *   - 熱力圖（HeatmapItem[]）
 *   - K 線圖（Candle[]）+ 訊號標記
 *   - 新聞清單
 *   - 財報摘要
 *   - LLM 建議區（M5 擴展）
 *
 * 架構：
 *   - 使用 vscode.WebviewPanel，單一 singleton 面板
 *   - Extension → Webview 透過 postMessage 傳遞資料
 *   - Webview → Extension 透過 acquireVsCodeApi().postMessage 回傳指令
 */
export class DashboardPanel {
  private static instance: DashboardPanel | undefined;
  private readonly panel: vscode.WebviewPanel;

  public static readonly VIEW_TYPE = 'stockHeatmap.dashboard';

  // ---------------------------------------------------------------------------
  // Singleton 取得 / 建立
  // ---------------------------------------------------------------------------

  static createOrShow(context: vscode.ExtensionContext): DashboardPanel {
    if (DashboardPanel.instance) {
      DashboardPanel.instance.panel.reveal(vscode.ViewColumn.One);
      return DashboardPanel.instance;
    }

    const panel = vscode.window.createWebviewPanel(
      DashboardPanel.VIEW_TYPE,
      'Stock Heatmap',
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'out')],
      },
    );

    DashboardPanel.instance = new DashboardPanel(panel, context);
    return DashboardPanel.instance;
  }

  // ---------------------------------------------------------------------------
  // 建構子
  // ---------------------------------------------------------------------------

  private constructor(
    panel: vscode.WebviewPanel,
    private readonly context: vscode.ExtensionContext,
  ) {
    this.panel = panel;

    // 面板關閉時清除 singleton
    this.panel.onDidDispose(() => {
      DashboardPanel.instance = undefined;
    }, null, context.subscriptions);

    // 處理 Webview → Extension 的訊息
    this.panel.webview.onDidReceiveMessage(
      (msg) => this.handleWebviewMessage(msg),
      null,
      context.subscriptions,
    );

    this.panel.webview.html = this.buildInitialHtml();
  }

  // ---------------------------------------------------------------------------
  // 資料推送：Extension → Webview
  // ---------------------------------------------------------------------------

  updateHeatmap(items: HeatmapItem[]): void {
    this.post({ type: 'heatmap', data: items });
  }

  updateChart(symbol: string, candles: Candle[], signal?: SignalResult): void {
    this.post({ type: 'chart', symbol, candles, signal });
  }

  updateNews(symbol: string, news: NewsItem[]): void {
    this.post({ type: 'news', symbol, data: news });
  }

  updateFinancials(symbol: string, reports: FinancialReportSummary[]): void {
    this.post({ type: 'financials', symbol, data: reports });
  }

  updateRecommendation(symbol: string, recommendation: unknown): void {
    this.post({ type: 'recommendation', symbol, data: recommendation });
  }

  showLoading(message = '載入中…'): void {
    this.post({ type: 'loading', message });
  }

  showError(message: string): void {
    this.post({ type: 'error', message });
  }

  private post(message: unknown): void {
    this.panel.webview.postMessage(message);
  }

  // ---------------------------------------------------------------------------
  // 處理 Webview → Extension 訊息
  // ---------------------------------------------------------------------------

  private handleWebviewMessage(msg: { command: string; payload?: unknown }): void {
    vscode.commands.executeCommand(`stockHeatmap.${msg.command}`, msg.payload);
  }

  // ---------------------------------------------------------------------------
  // 初始 HTML（輕量骨架，資料透過 postMessage 填充）
  // ---------------------------------------------------------------------------

  private buildInitialHtml(): string {
    const nonce = this.generateNonce();
    return /* html */`<!DOCTYPE html>
<html lang="zh-tw">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy"
  content="default-src 'none';
           script-src 'nonce-${nonce}' https://cdn.jsdelivr.net;
           style-src 'unsafe-inline';
           img-src data:;">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Stock Heatmap</title>
<style>
  :root {
    --bg: var(--vscode-editor-background);
    --fg: var(--vscode-editor-foreground);
    --panel-bg: var(--vscode-sideBar-background);
    --border: var(--vscode-panel-border);
    --accent: var(--vscode-button-background);
    --green: #4caf50;
    --red: #f44336;
    --yellow: #ffc107;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: var(--vscode-font-family, sans-serif); font-size: 13px;
         background: var(--bg); color: var(--fg); padding: 8px; }
  h2 { font-size: 14px; font-weight: 600; margin-bottom: 6px; color: var(--vscode-foreground); }
  #toolbar { display: flex; gap: 8px; align-items: center; margin-bottom: 10px; flex-wrap: wrap; }
  #symbol-input { width: 120px; padding: 3px 6px; background: var(--vscode-input-background);
                  color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border);
                  border-radius: 3px; }
  .btn { padding: 3px 10px; background: var(--accent); color: var(--vscode-button-foreground);
         border: none; border-radius: 3px; cursor: pointer; font-size: 12px; }
  .btn:hover { opacity: 0.85; }
  #status-bar { font-size: 11px; color: var(--vscode-descriptionForeground); }

  /* Layout */
  #main { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
  @media (max-width: 700px) { #main { grid-template-columns: 1fr; } }
  .card { background: var(--panel-bg); border: 1px solid var(--border); border-radius: 4px; padding: 8px; }

  /* Heatmap */
  #heatmap-grid { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 6px; }
  .heatmap-cell { padding: 4px 6px; border-radius: 3px; font-size: 11px; text-align: center;
                  min-width: 60px; cursor: pointer; }
  .up   { background: rgba(76,175,80,0.25); color: var(--green); }
  .down { background: rgba(244,67,54,0.25); color: var(--red); }
  .flat { background: rgba(128,128,128,0.15); }

  /* Chart */
  #chart-container { width: 100%; height: 260px; background: var(--bg); position: relative; }
  #chart-canvas { width: 100%; height: 100%; }
  #signal-badge { position: absolute; top: 8px; right: 8px; padding: 4px 10px; border-radius: 12px;
                  font-size: 12px; font-weight: bold; display: none; }
  .signal-buy  { background: rgba(76,175,80,0.3); color: var(--green); }
  .signal-sell { background: rgba(244,67,54,0.3); color: var(--red); }
  .signal-watch { background: rgba(255,193,7,0.3); color: var(--yellow); }

  /* News */
  #news-list { list-style: none; }
  #news-list li { padding: 4px 0; border-bottom: 1px solid var(--border); font-size: 12px;
                  display: flex; gap: 6px; }
  #news-list li:last-child { border-bottom: none; }
  .sentiment-dot { width: 8px; height: 8px; border-radius: 50%; margin-top: 4px; flex-shrink: 0; }
  .pos { background: var(--green); }
  .neg { background: var(--red); }
  .neu { background: gray; }
  .news-title a { color: var(--fg); text-decoration: none; }
  .news-title a:hover { text-decoration: underline; }
  .news-meta { color: var(--vscode-descriptionForeground); font-size: 10px; }

  /* Financials */
  #financials-table { width: 100%; border-collapse: collapse; font-size: 11px; }
  #financials-table th { text-align: left; padding: 2px 6px; border-bottom: 1px solid var(--border);
                         color: var(--vscode-descriptionForeground); }
  #financials-table td { padding: 2px 6px; }
  .up-val { color: var(--green); }
  .down-val { color: var(--red); }

  /* Indicators */
  #indicators-grid { display: grid; grid-template-columns: repeat(3,1fr); gap: 4px; margin-top: 6px; }
  .ind-item { background: var(--bg); padding: 4px 6px; border-radius: 3px; }
  .ind-label { font-size: 10px; color: var(--vscode-descriptionForeground); }
  .ind-value { font-size: 13px; font-weight: 600; }

  /* Error / Loading */
  #overlay { display: none; position: fixed; inset: 0; background: rgba(0,0,0,0.3);
             align-items: center; justify-content: center; z-index: 100; }
  #overlay.visible { display: flex; }
  #overlay-msg { background: var(--panel-bg); padding: 16px 24px; border-radius: 6px;
                 border: 1px solid var(--border); }
</style>
</head>
<body>
<!-- Toolbar -->
<div id="toolbar">
  <input id="symbol-input" type="text" placeholder="2330 / AAPL" />
  <select id="timeframe-select">
    <option value="1D">日線</option>
    <option value="4H">4小時</option>
    <option value="1H">1小時</option>
    <option value="15m">15分鐘</option>
  </select>
  <button class="btn" id="btn-load">載入</button>
  <button class="btn" id="btn-refresh">刷新</button>
  <span id="status-bar">就緒</span>
</div>

<!-- Main Grid -->
<div id="main">
  <!-- Heatmap -->
  <div class="card">
    <h2>熱力圖</h2>
    <div id="heatmap-grid"><span style="color:var(--vscode-descriptionForeground)">無自選股資料</span></div>
  </div>

  <!-- Chart + Signal -->
  <div class="card">
    <h2 id="chart-title">K 線圖</h2>
    <div id="chart-container">
      <canvas id="chart-canvas"></canvas>
      <div id="signal-badge"></div>
    </div>
    <!-- Indicators -->
    <div id="indicators-grid"></div>
  </div>

  <!-- News -->
  <div class="card">
    <h2>最新新聞</h2>
    <ul id="news-list"><li style="color:var(--vscode-descriptionForeground)">請先載入股票</li></ul>
  </div>

  <!-- Financials -->
  <div class="card">
    <h2>財報摘要</h2>
    <table id="financials-table">
      <thead><tr><th>期別</th><th>營收</th><th>EPS</th><th>毛利率</th><th>YoY</th></tr></thead>
      <tbody id="financials-body"><tr><td colspan="5" style="color:var(--vscode-descriptionForeground)">請先載入股票</td></tr></tbody>
    </table>
  </div>
</div>

<!-- Loading / Error Overlay -->
<div id="overlay"><div id="overlay-msg">載入中…</div></div>

<script nonce="${nonce}">
(function() {
  const vscode = acquireVsCodeApi();

  // ── 工具 ──────────────────────────────────────────────────────────────────
  const $ = (id) => document.getElementById(id);
  const fmt = (n, d=2) => n != null ? Number(n).toFixed(d) : '—';
  const arrow = (n) => n > 0 ? '▲' : n < 0 ? '▼' : '—';
  const cls = (n) => n > 0 ? 'up-val' : n < 0 ? 'down-val' : '';

  // ── Toolbar ───────────────────────────────────────────────────────────────
  $('btn-load').addEventListener('click', () => {
    const sym = $('symbol-input').value.trim().toUpperCase();
    const tf  = $('timeframe-select').value;
    if (!sym) { return; }
    vscode.postMessage({ command: 'loadSymbol', payload: { symbol: sym, timeframe: tf } });
    setStatus('載入 ' + sym + ' …');
  });

  $('btn-refresh').addEventListener('click', () => {
    vscode.postMessage({ command: 'refresh', payload: null });
    setStatus('刷新中…');
  });

  function setStatus(msg) { $('status-bar').textContent = msg; }

  // ── 接收 Extension 訊息 ───────────────────────────────────────────────────
  window.addEventListener('message', (event) => {
    const msg = event.data;
    switch (msg.type) {
      case 'loading':   showOverlay(msg.message); break;
      case 'error':     hideOverlay(); setStatus('⚠ ' + msg.message); break;
      case 'heatmap':   renderHeatmap(msg.data); hideOverlay(); break;
      case 'chart':     renderChart(msg.symbol, msg.candles, msg.signal); hideOverlay(); break;
      case 'news':      renderNews(msg.data); break;
      case 'financials': renderFinancials(msg.data); break;
      case 'recommendation': renderRecommendation(msg.symbol, msg.data); break;
    }
  });

  // ── 載入狀態 ──────────────────────────────────────────────────────────────
  function showOverlay(msg) {
    $('overlay-msg').textContent = msg || '載入中…';
    $('overlay').classList.add('visible');
  }
  function hideOverlay() { $('overlay').classList.remove('visible'); }

  // ── 熱力圖 ────────────────────────────────────────────────────────────────
  function renderHeatmap(items) {
    const grid = $('heatmap-grid');
    if (!items || items.length === 0) {
      grid.innerHTML = '<span style="color:var(--vscode-descriptionForeground)">無資料</span>';
      return;
    }
    grid.innerHTML = items.map(item => {
      const pct = Number(item.changePercent);
      const c = pct > 0.5 ? 'up' : pct < -0.5 ? 'down' : 'flat';
      return \`<div class="heatmap-cell \${c}" title="\${item.sector}" onclick="loadSymbol('\${item.symbol}')">
        <div>\${item.symbol}</div>
        <div>\${pct > 0 ? '+' : ''}\${pct.toFixed(2)}%</div>
      </div>\`;
    }).join('');
  }

  function loadSymbol(sym) {
    $('symbol-input').value = sym;
    $('btn-load').click();
  }

  // ── K 線圖（Canvas 極簡實作） ─────────────────────────────────────────────
  // 使用 Canvas 手繪 OHLC，避免外部依賴
  function renderChart(symbol, candles, signal) {
    $('chart-title').textContent = 'K 線圖：' + symbol;
    const canvas = $('chart-canvas');
    const ctx = canvas.getContext('2d');
    const w = canvas.offsetWidth || 400;
    const h = canvas.offsetHeight || 240;
    canvas.width = w;
    canvas.height = h;

    if (!candles || candles.length === 0) {
      ctx.fillStyle = 'gray';
      ctx.font = '14px sans-serif';
      ctx.fillText('無 K 線資料', w/2 - 40, h/2);
      return;
    }

    const n = Math.min(candles.length, 100); // 只顯示最後 100 根
    const slice = candles.slice(-n);
    const closes = slice.map(c => c.close);
    const highs = slice.map(c => c.high);
    const lows  = slice.map(c => c.low);
    const minP = Math.min(...lows);
    const maxP = Math.max(...highs);
    const range = maxP - minP || 1;

    const pad = { t: 10, b: 20, l: 10, r: 10 };
    const cw = (w - pad.l - pad.r) / n;
    const toY = (p) => pad.t + (1 - (p - minP) / range) * (h - pad.t - pad.b);

    ctx.clearRect(0, 0, w, h);

    slice.forEach((c, i) => {
      const x = pad.l + i * cw + cw * 0.1;
      const bw = cw * 0.7;
      const isUp = c.close >= c.open;
      ctx.strokeStyle = isUp ? '#4caf50' : '#f44336';
      ctx.fillStyle   = isUp ? '#4caf50' : '#f44336';

      // wick
      const mx = x + bw / 2;
      ctx.beginPath();
      ctx.moveTo(mx, toY(c.high));
      ctx.lineTo(mx, toY(c.low));
      ctx.stroke();

      // body
      const y1 = toY(Math.max(c.open, c.close));
      const y2 = toY(Math.min(c.open, c.close));
      ctx.fillRect(x, y1, bw, Math.max(y2 - y1, 1));
    });

    // 顯示訊號 badge
    const actionMap = { BUY: '買入', SELL: '賣出', WATCH: '觀望' };
    const badge = $('signal-badge');
    if (signal) {
      const clsMap = { BUY: 'signal-buy', SELL: 'signal-sell', WATCH: 'signal-watch' };
      badge.className = 'signal-badge ' + (clsMap[signal.action] || '');
      badge.textContent = (actionMap[signal.action] || signal.action) + ' ' + Math.round(signal.confidence * 100) + '%';
      badge.style.display = 'block';
    } else {
      badge.style.display = 'none';
    }

    // Indicators bar
    if (signal && signal.indicators) {
      renderIndicators(signal.indicators);
    }

    setStatus('已載入 ' + symbol + '（' + n + ' 根 K 線）');
  }

  // ── 技術指標列 ────────────────────────────────────────────────────────────
  function renderIndicators(ind) {
    const items = [
      { label: '均線5',    value: fmt(ind.sma5) },
      { label: '均線20',   value: fmt(ind.sma20) },
      { label: 'RSI',     value: fmt(ind.rsi14, 1) },
      { label: 'MACD',    value: fmt(ind.macd, 4) },
      { label: '布林上軌', value: fmt(ind.bollingerUpper) },
      { label: '布林下軌', value: fmt(ind.bollingerLower) },
    ];
    $('indicators-grid').innerHTML = items.map(it =>
      \`<div class="ind-item"><div class="ind-label">\${it.label}</div><div class="ind-value">\${it.value}</div></div>\`
    ).join('');
  }

  // ── 新聞 ──────────────────────────────────────────────────────────────────
  function renderNews(news) {
    const ul = $('news-list');
    if (!news || news.length === 0) {
      ul.innerHTML = '<li style="color:var(--vscode-descriptionForeground)">無新聞</li>';
      return;
    }
    ul.innerHTML = news.slice(0, 8).map(n => {
      const dotCls = n.sentiment === 'positive' ? 'pos' : n.sentiment === 'negative' ? 'neg' : 'neu';
      const d = new Date(n.publishedAt).toLocaleDateString('zh-TW');
      return \`<li>
        <span class="sentiment-dot \${dotCls}"></span>
        <div>
          <div class="news-title"><a href="\${n.url}" target="_blank">\${n.title}</a></div>
          <div class="news-meta">\${n.source} · \${d}</div>
        </div>
      </li>\`;
    }).join('');
  }

  // ── 財報 ──────────────────────────────────────────────────────────────────
  function renderFinancials(reports) {
    const tbody = $('financials-body');
    if (!reports || reports.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5" style="color:var(--vscode-descriptionForeground)">無財報資料</td></tr>';
      return;
    }
    tbody.innerHTML = reports.slice(-4).reverse().map(r => {
      const rev = r.revenue ? (r.revenue / 1e8).toFixed(2) + ' 億' : '—';
      const yoy = r.revenueYoY != null ? \`<span class="\${cls(r.revenueYoY)}">\${arrow(r.revenueYoY)}\${fmt(r.revenueYoY)}%</span>\` : '—';
      return \`<tr>
        <td>\${r.period}</td>
        <td>\${rev}</td>
        <td>\${fmt(r.eps)}</td>
        <td>\${r.grossMargin != null ? fmt(r.grossMargin) + '%' : '—'}</td>
        <td>\${yoy}</td>
      </tr>\`;
    }).join('');
  }

  // ── LLM 建議（M5 擴展）────────────────────────────────────────────────────
  function renderRecommendation(symbol, rec) {
    if (!rec) { return; }
    const actionMap = { BUY: '買入', SELL: '賣出', WATCH: '觀望' };
    const action = actionMap[rec.action] || rec.action;
    const reasons = (rec.reasons || (rec.reason ? [rec.reason] : [])).join(' / ');
    setStatus('[' + symbol + '] AI建議：' + action + '（' + Math.round((rec.confidence||0)*100) + '%）' + (reasons ? ' — ' + reasons : ''));
  }
})();
</script>
</body>
</html>`;
  }

  private generateNonce(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    for (let i = 0; i < 32; i++) {
      result += chars[Math.floor(Math.random() * chars.length)];
    }
    return result;
  }
}
