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
  private _ready = false;
  private _messageQueue: unknown[] = [];

  public static readonly VIEW_TYPE = 'stockHeatmap.dashboard';

  // ---------------------------------------------------------------------------
  // Singleton 取得 / 建立
  // ---------------------------------------------------------------------------

  /** 取得目前開啟的面板（若未開啟則傳回 undefined） */
  static get current(): DashboardPanel | undefined {
    return DashboardPanel.instance;
  }

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

  updateHeatmap(items: HeatmapItem[], source: 'watchlist' | 'market' = 'watchlist', meta?: { stale?: boolean }): void {
    this.post({ type: 'heatmap', data: items, source, stale: meta?.stale === true });
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
    if (this._ready) {
      this.panel.webview.postMessage(message);
    } else {
      this._messageQueue.push(message);
    }
  }

  // ---------------------------------------------------------------------------
  // 處理 Webview → Extension 訊息
  // ---------------------------------------------------------------------------

  private handleWebviewMessage(msg: { command: string; payload?: unknown }): void {
    if (msg.command === 'ready') {
      this._ready = true;
      for (const m of this._messageQueue) {
        this.panel.webview.postMessage(m);
      }
      this._messageQueue = [];
      return;
    }
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
  #current-sym { font-size: 14px; font-weight: 700; min-width: 64px; letter-spacing: 0.03em;
                 color: var(--vscode-foreground); }
  .btn { padding: 3px 10px; background: var(--accent); color: var(--vscode-button-foreground);
         border: none; border-radius: 3px; cursor: pointer; font-size: 12px; }
  .btn:hover { opacity: 0.85; }
  #status-bar { font-size: 11px; color: var(--vscode-descriptionForeground); }

  /* Layout */
  .top-section { display: grid; grid-template-columns: 55fr 45fr; gap: 8px; margin-bottom: 8px; }
  #main { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
  @media (max-width: 700px) { .top-section { grid-template-columns: 1fr; } #main { grid-template-columns: 1fr; } }
  .card { background: var(--panel-bg); border: 1px solid var(--border); border-radius: 4px; padding: 8px; }

  /* Heatmap Section */
  #heatmap-section { margin-bottom: 0; }
  #hm-title-row { display: flex; align-items: center; gap: 6px; margin-bottom: 6px; }
  #hm-title-row h2 { margin: 0; }
  #hm-help { cursor: help; color: var(--vscode-descriptionForeground); font-size: 12px; }
  #heatmap-status { font-size: 11px; color: var(--vscode-descriptionForeground); margin-left: auto; }

  /* Filter Bar */
  .hm-filter-row { display: flex; align-items: center; gap: 6px; margin-bottom: 5px; flex-wrap: wrap; }
  .hm-filter-label { font-size: 11px; color: var(--vscode-descriptionForeground); white-space: nowrap; }
  .hm-btn-group { display: flex; border: 1px solid var(--border); border-radius: 3px; overflow: hidden; }
  .hm-btn { padding: 2px 9px; font-size: 11px; background: none; color: var(--fg);
            border: none; border-right: 1px solid var(--border); cursor: pointer; white-space: nowrap;
            transition: background 0.15s; }
  .hm-btn:last-child { border-right: none; }
  .hm-btn:hover { background: rgba(128,128,128,0.15); }
  .hm-btn.active { background: rgba(0,120,212,0.18); color: #0078d4; font-weight: 600; }

  /* Heatmap Grid */
  #heatmap-grid { display: grid; grid-template-columns: repeat(24, minmax(0, 1fr));
                  grid-auto-flow: dense; grid-auto-rows: var(--hm-row-h, 18px); gap: 2px;
                  margin-top: 4px; min-height: 80px; overflow-y: auto; max-height: 560px; }
  .hm-grid-wrap { position: relative; }
  .hm-zoom-hint { position: absolute; right: 6px; top: 6px; font-size: 10px;
                  color: var(--vscode-descriptionForeground); pointer-events: none;
                  opacity: 0; transition: opacity 0.4s; }
  .hm-grid-wrap:hover .hm-zoom-hint { opacity: 1; }
  .hm-group { width: 100%; margin-bottom: 2px; }
  .hm-group-label { font-size: 10px; color: var(--vscode-descriptionForeground); padding: 1px 4px; margin-bottom: 2px; }
  .hm-group-cells { display: grid; grid-template-columns: repeat(24, minmax(0, 1fr));
                    grid-auto-flow: dense; grid-auto-rows: var(--hm-row-h, 18px); gap: 2px; }
  .hm-cell { display: flex; flex-direction: column; align-items: center; justify-content: center;
             padding: 3px 4px; border-radius: 3px; cursor: pointer; overflow: hidden;
             min-width: 0; min-height: 0; text-align: center; transition: opacity 0.1s;
             grid-column: span var(--hm-col, 2); grid-row: span var(--hm-row, 2); }
  .hm-cell:hover { opacity: 0.8; }
  .hm-cell .hm-name { font-size: 11px; font-weight: 700; line-height: 1.3; white-space: nowrap;
                      overflow: hidden; text-overflow: ellipsis; max-width: 100%; }
  .hm-cell .hm-sym  { font-size: 9px; opacity: 0.75; line-height: 1.2; }
  .hm-cell .hm-pct  { font-size: 11px; font-weight: 600; line-height: 1.3; }
  .hm-cell.compact .hm-name { font-size: 10px; }
  .hm-cell.compact .hm-sym { display: none; }
  .hm-cell.compact .hm-pct { font-size: 10px; }
  .hm-cell.tiny .hm-name { font-size: 9px; }
  .hm-cell.tiny .hm-sym { display: none; }
  .hm-cell.tiny .hm-pct { font-size: 9px; }
  @media (max-width: 700px) {
    #heatmap-grid { grid-template-columns: repeat(12, minmax(0, 1fr)); }
    .hm-group-cells { grid-template-columns: repeat(12, minmax(0, 1fr)); }
  }

  /* Chart */
  #chart-container { width: 100%; height: 260px; background: var(--bg); position: relative;
                     cursor: grab; user-select: none; }
  #chart-container.dragging { cursor: grabbing; }
  #chart-canvas { display: block; width: 100%; height: 100%; }
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
  <span id="current-sym" title="目前選取股票">—</span>
  <select id="timeframe-select">
    <option value="1D">日線</option>
    <option value="4H">4小時</option>
    <option value="1H">1小時</option>
    <option value="15m">15分鐘</option>
    <option value="1W">週線</option>
    <option value="1M">月線</option>
    <option value="1Y">年線</option>
  </select>
  <button class="btn" id="btn-refresh">刷新</button>
  <span id="status-bar">請從自選股清單或熱力圖點選股票</span>
</div>

<!-- Heatmap Section（全寬，獨立於 main grid 之上）-->
<div id="heatmap-section" class="card">
  <div id="hm-title-row">
    <h2>股價漲跌即時熱力圖 <span id="hm-help" title="格子大小 = 總市值（可切換）；顏色深淺 = 漲跌幅度">ⓘ</span></h2>
    <span id="heatmap-status"></span>
  </div>
  <div class="hm-filter-row">
    <span class="hm-filter-label">資料：</span>
    <div class="hm-btn-group">
      <button class="hm-btn active" data-hm-filter="source" data-hm-val="watchlist">自選股</button>
      <button class="hm-btn"        data-hm-filter="source" data-hm-val="market">全台股</button>
    </div>
    <span class="hm-filter-label" style="margin-left:8px">條件：</span>
  </div>
  <div class="hm-filter-row">
    <div class="hm-btn-group">
      <button class="hm-btn active" data-hm-filter="market" data-hm-val="ALL">全部</button>
      <button class="hm-btn"        data-hm-filter="market" data-hm-val="TSE">上市</button>
      <button class="hm-btn"        data-hm-filter="market" data-hm-val="OTC">上櫃</button>
    </div>
    <div class="hm-btn-group">
      <button class="hm-btn active" data-hm-filter="groupBy" data-hm-val="none">不分產業</button>
      <button class="hm-btn"        data-hm-filter="groupBy" data-hm-val="sector">區分產業</button>
    </div>
    <div class="hm-btn-group">
      <button class="hm-btn"        data-hm-filter="display" data-hm-val="sector">顯示產業</button>
      <button class="hm-btn active" data-hm-filter="display" data-hm-val="stock">顯示個股</button>
    </div>
  </div>
  <div class="hm-filter-row">
    <div class="hm-btn-group">
      <button class="hm-btn active" data-hm-filter="sizeBy" data-hm-val="marketCap">總市值</button>
      <button class="hm-btn"        data-hm-filter="sizeBy" data-hm-val="turnover">成交額</button>
      <button class="hm-btn"        data-hm-filter="sizeBy" data-hm-val="volume">成交量</button>
    </div>
    <div class="hm-btn-group">
      <button class="hm-btn active" data-hm-filter="period" data-hm-val="1D">今日</button>
      <button class="hm-btn"        data-hm-filter="period" data-hm-val="5D">5日</button>
      <button class="hm-btn"        data-hm-filter="period" data-hm-val="20D">20日</button>
      <button class="hm-btn"        data-hm-filter="period" data-hm-val="60D">60日</button>
      <button class="hm-btn"        data-hm-filter="period" data-hm-val="240D">240日</button>
    </div>
  </div>
  <div class="hm-grid-wrap">
    <div id="heatmap-grid"><span style="color:var(--vscode-descriptionForeground)">載入中…</span></div>
    <div class="hm-zoom-hint">🔍 滾輪縮放</div>
  </div>
</div>

<!-- Main Grid -->
<div id="main">
  <!-- Chart + Signal -->
  <div class="card">
    <h2 id="chart-title">K 線圖</h2>
    <div id="chart-container">
      <canvas id="chart-canvas"></canvas>
      <div id="signal-badge"></div>
    </div>
    <!-- Indicators -->
    <div id="indicators-grid"></div>
    <div style="display:flex;gap:4px;margin-top:6px">
      <button class="btn" id="btn-twii" style="font-size:11px;padding:2px 8px">加權指數</button>
      <button class="btn" id="btn-otc"  style="font-size:11px;padding:2px 8px">OTC指數</button>
    </div>
  </div>

  <!-- News -->
  <div class="card">
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
      <h2 style="margin:0">最新新聞</h2>
      <button class="btn" id="btn-market-news" style="font-size:11px;padding:2px 8px">大盤新聞</button>
    </div>
    <ul id="news-list"><li style="color:var(--vscode-descriptionForeground)">載入大盤新聞…</li></ul>
  </div>

  <!-- Financials -->
  <div class="card">
    <h2>財報摘要</h2>
    <div id="financials-summary" style="font-size:12px;margin-bottom:6px;color:var(--vscode-descriptionForeground)"></div>
    <table id="financials-table">
      <thead><tr><th>期別</th><th>營收(億)</th><th>EPS</th><th>毛利率</th><th>營收YoY</th><th>QoQ</th></tr></thead>
      <tbody id="financials-body"><tr><td colspan="6" style="color:var(--vscode-descriptionForeground)">請先載入股票</td></tr></tbody>
    </table>
  </div>
</div>

<!-- Loading / Error Overlay -->
<div id="overlay"><div id="overlay-msg">載入中…</div></div>

<script nonce="${nonce}">
(function() {
  const vscode = acquireVsCodeApi();
  // 通知 Extension webview 已就緒，觸發緩衝訊息刷新
  vscode.postMessage({ command: 'ready' });

  // ── 工具 ──────────────────────────────────────────────────────────────────
  const $ = (id) => document.getElementById(id);
  const fmt = (n, d=2) => n != null ? Number(n).toFixed(d) : '—';
  const arrow = (n) => n > 0 ? '▲' : n < 0 ? '▼' : '—';
  const cls = (n) => n > 0 ? 'up-val' : n < 0 ? 'down-val' : '';

  // ── Toolbar ───────────────────────────────────────────────────────────────
  let _currentSym = '';

  // timeframe 切換時自動重載當前股票
  $('timeframe-select').addEventListener('change', () => {
    if (_currentSym) { loadSymbol(_currentSym); }
  });

  $('btn-refresh').addEventListener('click', () => {
    if (_currentSym) {
      loadSymbol(_currentSym);
    } else {
      vscode.postMessage({ command: 'refresh', payload: null });
    }
    setStatus('刷新中…');
  });

  function setStatus(msg) { $('status-bar').textContent = msg; }

  $('btn-market-news').addEventListener('click', () => {
    $('news-list').innerHTML = '<li style="color:var(--vscode-descriptionForeground)">載入大盤新聞…</li>';
    vscode.postMessage({ command: 'loadMarketNews', payload: null });
  });

  $('btn-twii').addEventListener('click', () => {
    vscode.postMessage({ command: 'loadIndex', payload: { index: 'TWII' } });
    setStatus('載入加權指數…');
  });

  $('btn-otc').addEventListener('click', () => {
    vscode.postMessage({ command: 'loadIndex', payload: { index: 'OTC' } });
    setStatus('載入OTC指數…');
  });

  // ── 接收 Extension 訊息 ───────────────────────────────────────────────────
  window.addEventListener('message', (event) => {
    const msg = event.data;
    switch (msg.type) {
      case 'loading':   showOverlay(msg.message); break;
      case 'error':     hideOverlay(); setStatus('⚠ ' + msg.message); break;
      case 'heatmap': {
        const _src = msg.source || 'watchlist';
        _hmCache[_src] = { items: msg.data, stale: msg.stale === true };
        if (_hmState.source === _src) { renderHeatmap(msg.data, msg.stale === true); hideOverlay(); }
        break;
      }
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
  const _hmCache = { watchlist: null, market: null };
  const _hmState = { source: 'watchlist', market: 'ALL', groupBy: 'none', display: 'stock', sizeBy: 'marketCap', period: '1D' };
  let _hmZoom = 1.0;  // 熱力圖格子縮放倍率

  // 熱力圖滾輪縮放
  $('heatmap-grid').addEventListener('wheel', e => {
    e.preventDefault();
    _hmZoom = Math.min(4.0, Math.max(0.4, _hmZoom * (e.deltaY < 0 ? 1.12 : 1 / 1.12)));
    const rowH = Math.round(18 * _hmZoom);
    $('heatmap-grid').style.setProperty('--hm-row-h', rowH + 'px');
    document.querySelectorAll('.hm-group-cells').forEach(el =>
      el.style.setProperty('--hm-row-h', rowH + 'px'));
  }, { passive: false });

  document.querySelectorAll('[data-hm-filter]').forEach(btn => {
    btn.addEventListener('click', () => {
      const filter = btn.dataset.hmFilter;
      const val    = btn.dataset.hmVal;
      _hmState[filter] = val;
      btn.closest('.hm-btn-group').querySelectorAll('.hm-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      if (filter === 'source') {
        // 切換資料來源時自動調整 sizeBy：全台股用成交額，自選股用市值
        const autoSizeBy = val === 'market' ? 'turnover' : 'marketCap';
        _hmState.sizeBy = autoSizeBy;
        document.querySelectorAll('[data-hm-filter="sizeBy"]').forEach(b => b.classList.remove('active'));
        const sbBtn = document.querySelector('[data-hm-filter="sizeBy"][data-hm-val="' + autoSizeBy + '"]');
        if (sbBtn) { sbBtn.classList.add('active'); }
        const cache = _hmCache[val];
        if (cache) {
          renderHeatmap(cache.items, cache.stale === true);
        } else {
          $('heatmap-grid').innerHTML = '<span style="color:var(--vscode-descriptionForeground)">載入' + (val === 'market' ? '全台股' : '自選股') + '中…</span>';
          $('heatmap-status').textContent = '';
          vscode.postMessage({ command: 'loadHeatmap', payload: { source: val } });
        }
      } else {
        const d = _hmCache[_hmState.source];
        if (d) { renderHeatmap(d.items, d.stale === true); }
      }
    });
  });

  // 依漲跌幅取得背景/文字色
  function hmColor(pct) {
    if      (pct >=  5) return ['#0a3d1a','#fff'];
    else if (pct >=  3) return ['#1b5e20','#fff'];
    else if (pct >=  2) return ['#2e7d32','#fff'];
    else if (pct >=  1) return ['#388e3c','#fff'];
    else if (pct >= 0.3) return ['#4caf50','#fff'];
    else if (pct > -0.3) return ['rgba(100,100,100,0.25)','var(--fg)'];
    else if (pct > -1)  return ['#e57373','#fff'];
    else if (pct > -2)  return ['#e53935','#fff'];
    else if (pct > -3)  return ['#c62828','#fff'];
    else if (pct > -5)  return ['#7f0000','#fff'];
    else                return ['#4a0000','#fff'];
  }

  // 依期別取對應漲跌幅
  function hmPct(item) {
    const map = { '5D':'change5D', '20D':'change20D', '60D':'change60D', '240D':'change240D' };
    const f = map[_hmState.period];
    const v = f ? item[f] : null;
    return (v != null) ? Number(v) : Number(item.changePercent);
  }

  // 依尺寸指標取值
  function hmSize(item) {
    const v = _hmState.sizeBy === 'turnover' ? item.turnover
            : _hmState.sizeBy === 'volume'   ? item.volume
            : (item.marketCap ?? item.turnover); // 全台股無 marketCap 時 fallback 成交額
    return (v != null && v > 0) ? Number(v) : 1;
  }

  function clamp(n, min, max) {
    return Math.max(min, Math.min(max, n));
  }

  // 建立單格 HTML；以 grid span 控制相對面積
  function hmCellHtml(item, spanCol, spanRow) {
    const pct  = hmPct(item);
    const [bg, fg] = hmColor(pct);
    const sign = pct > 0 ? '+' : '';
    const sym  = String(item.symbol).replace(/'/g, '&#39;').replace(/</g,'&lt;');
    const name = String(item.name  || '').replace(/'/g, '&#39;').replace(/</g,'&lt;');
    const sizeClass = spanCol <= 3 || spanRow <= 2 ? 'tiny' : spanCol <= 5 || spanRow <= 3 ? 'compact' : '';
    return \`<div class="hm-cell \${sizeClass}" style="--hm-col:\${spanCol};--hm-row:\${spanRow};background:\${bg};color:\${fg}"
          title="[\${sym}] \${name}  \${sign}\${pct.toFixed(2)}%"
          onclick="loadSymbol('\${sym}')">
      <span class="hm-name">\${name || sym}</span>
      <span class="hm-sym">\${sym}</span>
      <span class="hm-pct">\${sign}\${pct.toFixed(2)}%</span>
    </div>\`;
  }

  function renderHeatmap(items, stale) {
    _hmCache[_hmState.source] = { items, stale: stale === true };
    const grid = $('heatmap-grid');
    if (!items || items.length === 0) {
      grid.innerHTML = '<span style="color:var(--vscode-descriptionForeground)">無資料</span>';
      $('heatmap-status').textContent = '';
      return;
    }

    // 市場別篩選
    let list = _hmState.market === 'ALL' ? items
             : items.filter(i => !i.market || i.market === _hmState.market);

    // 顯示產業模式：彙總各產業
    if (_hmState.display === 'sector') {
      const sm = {};
      list.forEach(item => {
        const s = item.sector || '其他';
        if (!sm[s]) { sm[s] = { syms: [], pctTotal: 0, sizeTotal: 0 }; }
        const sz = hmSize(item);
        sm[s].syms.push(item.symbol);
        sm[s].pctTotal  += hmPct(item) * sz;
        sm[s].sizeTotal += sz;
      });
      list = Object.entries(sm).map(([sec, d]) => ({
        symbol: sec, name: d.syms.slice(0,3).join(',') + (d.syms.length > 3 ? '…' : ''),
        sector: sec, changePercent: d.sizeTotal ? d.pctTotal / d.sizeTotal : 0,
        marketCap: d.sizeTotal,
      }));
    }

    // 對數縮放後計算格子跨度，讓面積差異更明顯
    const sizes  = list.map(i => Math.log1p(hmSize(i)));
    const maxSz  = Math.max(...sizes, 1);
    const spans = sizes.map((size) => {
      const ratio = maxSz > 0 ? size / maxSz : 0;
      const col = clamp(Math.round(2 + ratio * 10), 2, 12);
      const row = clamp(Math.round(2 + ratio * 6), 2, 8);
      return { col, row };
    });

    if (_hmState.groupBy === 'none' || _hmState.display === 'sector') {
      grid.innerHTML = list.map((item, i) => hmCellHtml(item, spans[i].col, spans[i].row)).join('');
    } else {
      // 區分產業分組
      const secMap = {};
      list.forEach((item, i) => {
        const s = item.sector || '其他';
        if (!secMap[s]) { secMap[s] = []; }
        secMap[s].push({ item, span: spans[i] });
      });
      grid.innerHTML = Object.entries(secMap).map(([sec, entries]) => {
        const cells = entries.map(e => hmCellHtml(e.item, e.span.col, e.span.row)).join('');
        return \`<div class="hm-group">
          <div class="hm-group-label">\${sec}</div>
          <div class="hm-group-cells">\${cells}</div>
        </div>\`;
      }).join('');
    }

    const up   = list.filter(i => hmPct(i) > 0).length;
    const dn   = list.filter(i => hmPct(i) < 0).length;
    const staleNote = _hmState.source === 'market' && stale ? '　部分資料為快取' : '';
    $('heatmap-status').textContent = '共 ' + list.length + ' 檔　'
      + (up > 0 ? '▲' + up : '') + '　'
      + (dn > 0 ? '▼' + dn : '')
      + staleNote;
  }

  function loadSymbol(sym) {
    if (!sym) { return; }
    _currentSym = sym.toUpperCase();
    $('current-sym').textContent = _currentSym;
    const tf = $('timeframe-select').value;
    vscode.postMessage({ command: 'loadSymbol', payload: { symbol: _currentSym, timeframe: tf } });
    setStatus('載入 ' + _currentSym + ' …');
  }

  // ── K 線圖（Canvas 極簡實作） ─────────────────────────────────────────────
  // 使用 Canvas 手繪 OHLC + 趨勢線（SMA5/SMA20/布林通道），避免外部依賴
  let _lastChart = null;
  let _resizeTimer = null;
  let _chartViewport = { visibleN: 100, offset: 0 };  // 可見蠟燭數 + 右端偏移
  let _dragChart = null;  // { startX, startOffset }

  // 滾輪縮放（改變可見蠟燭數）
  $('chart-container').addEventListener('wheel', e => {
    e.preventDefault();
    if (!_lastChart || !_lastChart.candles.length) { return; }
    const total = _lastChart.candles.length;
    const step = Math.max(5, Math.round(_chartViewport.visibleN * 0.12));
    _chartViewport.visibleN = e.deltaY < 0
      ? Math.max(10, _chartViewport.visibleN - step)
      : Math.min(total, _chartViewport.visibleN + step);
    _chartViewport.offset = Math.max(0, Math.min(_chartViewport.offset, total - _chartViewport.visibleN));
    renderChart(_lastChart.symbol, _lastChart.candles, _lastChart.signal);
  }, { passive: false });

  // 拖曳平移（左右拖移時間軸）
  $('chart-container').addEventListener('mousedown', e => {
    _dragChart = { startX: e.clientX, startOffset: _chartViewport.offset };
    $('chart-container').classList.add('dragging');
  });
  const _endDragChart = () => {
    _dragChart = null;
    $('chart-container').classList.remove('dragging');
  };
  $('chart-container').addEventListener('mouseup', _endDragChart);
  $('chart-container').addEventListener('mouseleave', _endDragChart);
  $('chart-container').addEventListener('mousemove', e => {
    if (!_dragChart || !_lastChart) { return; }
    const total = _lastChart.candles.length;
    const visN  = _chartViewport.visibleN;
    const cw = (($('chart-container').clientWidth || 400) - 68) / visN; // approx px per candle
    const delta = Math.round((_dragChart.startX - e.clientX) / cw);
    _chartViewport.offset = Math.max(0, Math.min(_dragChart.startOffset + delta, total - visN));
    renderChart(_lastChart.symbol, _lastChart.candles, _lastChart.signal);
  });

  // 面板 resize 時重繪（debounce 100ms，避免拖拉時連續重繪）
  if (window.ResizeObserver) {
    new ResizeObserver(() => {
      clearTimeout(_resizeTimer);
      _resizeTimer = setTimeout(() => {
        if (_lastChart) {
          renderChart(_lastChart.symbol, _lastChart.candles, _lastChart.signal);
        }
      }, 100);
    }).observe($('chart-container'));
  }

  function renderChart(symbol, candles, signal) {
    _lastChart = { symbol, candles, signal };
    $('chart-title').textContent = 'K 線圖：' + symbol;
    const canvas = $('chart-canvas');
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const container = canvas.parentElement;
    // 讀取容器當前尺寸（canvas 本身維持 CSS width:100%/height:100%，不覆寫 style）
    const w = container.clientWidth  || 400;
    const h = container.clientHeight || 260;
    // 只設定 buffer 解析度；CSS display:block + width:100%/height:100% 控制視覺大小
    canvas.width  = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx.scale(dpr, dpr);

    if (!candles || candles.length === 0) {
      ctx.fillStyle = 'gray';
      ctx.font = '14px sans-serif';
      ctx.fillText('無 K 線資料', w/2 - 40, h/2);
      return;
    }

    // 根據 viewport 決定顯示哪段蠟燭（支援縮放＋拖曳平移）
    const total = candles.length;
    const visN   = Math.min(_chartViewport.visibleN, total);
    const offset = Math.min(_chartViewport.offset, Math.max(0, total - visN));
    const n = visN;
    const slice = offset > 0
      ? candles.slice(total - visN - offset, total - offset)
      : candles.slice(-visN);
    const closes = slice.map(c => c.close);
    const highs  = slice.map(c => c.high);
    const lows   = slice.map(c => c.low);

    // ── 趨勢指標計算（純本地，不需外部套件）──────────────────────────────────
    // SMA 計算（從完整 candles 取，確保 slice 的每根都有對應值）
    const allCloses = candles.map(c => c.close);
    function sma(arr, period, targetLen) {
      const result = new Array(targetLen).fill(null);
      const offset = arr.length - targetLen;
      for (let i = 0; i < targetLen; i++) {
        const idx = offset + i;
        if (idx < period - 1) { continue; }
        let sum = 0;
        for (let j = idx - period + 1; j <= idx; j++) { sum += arr[j]; }
        result[i] = sum / period;
      }
      return result;
    }
    function bollingerBands(arr, period, mult, targetLen) {
      const mid = sma(arr, period, targetLen);
      const upper = new Array(targetLen).fill(null);
      const lower = new Array(targetLen).fill(null);
      const offset = arr.length - targetLen;
      for (let i = 0; i < targetLen; i++) {
        if (mid[i] === null) { continue; }
        const idx = offset + i;
        let variance = 0;
        for (let j = idx - period + 1; j <= idx; j++) {
          variance += Math.pow(arr[j] - mid[i], 2);
        }
        const stddev = Math.sqrt(variance / period);
        upper[i] = mid[i] + mult * stddev;
        lower[i] = mid[i] - mult * stddev;
      }
      return { mid, upper, lower };
    }

    const sma5  = sma(allCloses, 5,  n);
    const sma20 = sma(allCloses, 20, n);
    const bb    = bollingerBands(allCloses, 20, 2, n);

    // ── 整體價格範圍（含趨勢線極值）──────────────────────────────────────────
    const allVals = [
      ...highs, ...lows,
      ...sma5.filter(v => v !== null),
      ...sma20.filter(v => v !== null),
      ...bb.upper.filter(v => v !== null),
      ...bb.lower.filter(v => v !== null),
    ];
    const minP = Math.min(...allVals);
    const maxP = Math.max(...allVals);
    const range = maxP - minP || 1;

    const pad = { t: 16, b: 30, l: 58, r: 10 };
    const cw  = (w - pad.l - pad.r) / n;
    const toY = (p) => pad.t + (1 - (p - minP) / range) * (h - pad.t - pad.b);
    const toX = (i) => pad.l + i * cw + cw / 2; // 中心 x

    ctx.clearRect(0, 0, w, h);

    // ── 價格刻度（左側 Y 軸，5 格）────────────────────────────────────────────
    ctx.fillStyle = 'rgba(128,128,128,0.6)';
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'right';
    for (let tick = 0; tick <= 4; tick++) {
      const price = minP + (range * tick / 4);
      const y = toY(price);
      ctx.fillText(price.toFixed(0), pad.l - 4, y + 3);
      ctx.strokeStyle = 'rgba(128,128,128,0.1)';
      ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(w - pad.r, y); ctx.stroke();
    }
    ctx.textAlign = 'left';

    // ── 時間刻度（X 軸日期標籤）──────────────────────────────────────────────
    const xStep = Math.max(1, Math.ceil(n / 8));
    ctx.fillStyle = 'rgba(160,160,160,0.85)';
    ctx.font = '9px sans-serif';
    ctx.textAlign = 'center';
    for (let xi = 0; xi < n; xi += xStep) {
      const t = slice[xi].time || '';
      const label = t.length >= 10 ? t.slice(5, 10) : t;
      ctx.fillText(label, toX(xi), h - 8);
    }
    ctx.textAlign = 'left';

    // ── 布林通道（填充半透明區域）────────────────────────────────────────────
    ctx.beginPath();
    let bbStarted = false;
    for (let i = 0; i < n; i++) {
      if (bb.upper[i] === null) { continue; }
      if (!bbStarted) { ctx.moveTo(toX(i), toY(bb.upper[i])); bbStarted = true; }
      else { ctx.lineTo(toX(i), toY(bb.upper[i])); }
    }
    for (let i = n - 1; i >= 0; i--) {
      if (bb.lower[i] === null) { continue; }
      ctx.lineTo(toX(i), toY(bb.lower[i]));
    }
    ctx.closePath();
    ctx.fillStyle = 'rgba(100,149,237,0.08)';
    ctx.fill();

    // 布林通道上下軌線
    function drawLine(arr, color, dash) {
      ctx.strokeStyle = color;
      ctx.setLineDash(dash || []);
      ctx.lineWidth = 1;
      ctx.beginPath();
      let started = false;
      for (let i = 0; i < n; i++) {
        if (arr[i] === null) { continue; }
        if (!started) { ctx.moveTo(toX(i), toY(arr[i])); started = true; }
        else { ctx.lineTo(toX(i), toY(arr[i])); }
      }
      ctx.stroke();
      ctx.setLineDash([]);
    }
    drawLine(bb.upper, 'rgba(100,149,237,0.5)', [3,3]);
    drawLine(bb.lower, 'rgba(100,149,237,0.5)', [3,3]);
    drawLine(bb.mid,   'rgba(100,149,237,0.35)', [2,4]);

    // ── K 線蠟燭 ────────────────────────────────────────────────────────────
    ctx.lineWidth = 1;
    slice.forEach((c, i) => {
      const x  = pad.l + i * cw + cw * 0.15;
      const bw = cw * 0.7;
      const isUp = c.close >= c.open;
      ctx.strokeStyle = isUp ? '#4caf50' : '#f44336';
      ctx.fillStyle   = isUp ? '#4caf50' : '#f44336';

      // 影線
      const mx = x + bw / 2;
      ctx.beginPath(); ctx.moveTo(mx, toY(c.high)); ctx.lineTo(mx, toY(c.low)); ctx.stroke();

      // 實體
      const y1 = toY(Math.max(c.open, c.close));
      const y2 = toY(Math.min(c.open, c.close));
      ctx.fillRect(x, y1, bw, Math.max(y2 - y1, 1));
    });

    // ── 趨勢均線（疊加在蠟燭上方）────────────────────────────────────────────
    ctx.lineWidth = 1.5;
    drawLine(sma5,  'rgba(255, 193,  7, 0.9)');   // 金色：均線5
    drawLine(sma20, 'rgba(255, 112, 67, 0.9)');   // 橘色：均線20

    // ── 圖例 ─────────────────────────────────────────────────────────────────
    const legend = [
      { color: '#ffc107', label: '均5' },
      { color: '#ff7043', label: '均20' },
      { color: 'rgba(100,149,237,0.7)', label: 'BB' },
    ];
    ctx.font = '10px sans-serif';
    let lx = pad.l + 4;
    legend.forEach(({ color, label }) => {
      ctx.strokeStyle = color; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(lx, 8); ctx.lineTo(lx + 14, 8); ctx.stroke();
      ctx.fillStyle = 'rgba(200,200,200,0.85)';
      ctx.fillText(label, lx + 16, 11);
      lx += label.length * 7 + 26;
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
    const summary = $('financials-summary');
    if (!reports || reports.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" style="color:var(--vscode-descriptionForeground)">無財報資料</td></tr>';
      if (summary) { summary.textContent = ''; }
      return;
    }
    const recent = reports.slice(-4).reverse();
    // 顯示最新一期的 highlights 摘要
    if (summary) {
      const latest = recent[0];
      summary.textContent = (latest && latest.highlights && latest.highlights.length > 0)
        ? '📊 ' + latest.highlights[0]
        : '';
    }
    tbody.innerHTML = recent.map(r => {
      const rev   = r.revenue    != null ? (r.revenue / 1e8).toFixed(2) : '—';
      const eps   = r.eps        != null ? r.eps.toFixed(2) : '—';
      const gm    = r.grossMargin != null ? r.grossMargin.toFixed(1) + '%' : '—';
      const yoyV  = r.revenueYoY;
      const qoqV  = r.revenueQoQ;
      const yoy   = yoyV != null ? \`<span class="\${cls(yoyV)}">\${arrow(yoyV)}\${Math.abs(yoyV).toFixed(1)}%</span>\` : '—';
      const qoq   = qoqV != null ? \`<span class="\${cls(qoqV)}">\${arrow(qoqV)}\${Math.abs(qoqV).toFixed(1)}%</span>\` : '—';
      const epsYoy = r.epsYoY != null ? \` <span class="\${cls(r.epsYoY)}" style="font-size:9px">\${arrow(r.epsYoY)}\${Math.abs(r.epsYoY).toFixed(0)}%</span>\` : '';
      return \`<tr>
        <td>\${r.period}</td>
        <td>\${rev}</td>
        <td>\${eps}\${epsYoy}</td>
        <td>\${gm}</td>
        <td>\${yoy}</td>
        <td>\${qoq}</td>
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
