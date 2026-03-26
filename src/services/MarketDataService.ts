import * as vscode from 'vscode';
import { Quote, Candle, HeatmapItem, Market } from '../types';

// ---------------------------------------------------------------------------
// FinMind API 回應型別（台股）
// ---------------------------------------------------------------------------
interface FinMindQuoteRow {
  stock_id: string;
  date: string;
  Trading_Volume: number;
  Trading_money: number;
  open: number;
  max: number;
  min: number;
  close: number;
  spread: number;
  Trading_turnover: number;
}
interface FinMindResponse<T> {
  status: number;
  msg: string;
  data: T[];
}
interface FinMindStockInfoRow {
  stock_id: string;
  stock_name: string;
  industry_category?: string; // 產業別
  type?: string;              // '上市' | '上櫃'
}
interface TwseStockDayAllRow {
  Code: string;
  Name: string;
  TradeVolume: string;
  TradeValue: string;
  OpeningPrice: string;
  HighestPrice: string;
  LowestPrice: string;
  ClosingPrice: string;
  Change: string;
  Transaction: string;
}
interface TpexMainboardQuoteRow {
  SecuritiesCompanyCode: string;
  CompanyName: string;
  Close: string;
  Change: string;
  Open: string;
  High: string;
  Low: string;
  TradingShares: string;
  TransactionAmount: string;
  TransactionNumber: string;
}

// ---------------------------------------------------------------------------
// Finnhub API 回應型別（美股）
// ---------------------------------------------------------------------------
interface FinnhubProfile {
  name: string;
  ticker: string;
  country: string;
  currency: string;
  exchange: string;
}

// ---------------------------------------------------------------------------
// Finnhub API 回應型別（內部 quote / candle）
// ---------------------------------------------------------------------------
interface FinnhubQuote {
  c: number;  // current price
  d: number;  // change
  dp: number; // change percent
  h: number;  // high
  l: number;  // low
  o: number;  // open
  pc: number; // prev close
  t: number;  // timestamp
}
interface FinnhubCandle {
  c: number[]; o: number[]; h: number[]; l: number[];
  v: number[]; t: number[]; s: string;
}

// ---------------------------------------------------------------------------
// Yahoo Finance v8 chart API（指數 K 線，免 API Key）
// ---------------------------------------------------------------------------
interface YahooFinanceQuote {
  open: (number | null)[];
  high: (number | null)[];
  low:  (number | null)[];
  close: (number | null)[];
  volume: (number | null)[];
}
interface YahooFinanceChartMeta {
  currency?: string;
  symbol?: string;
  regularMarketPrice?: number;
  regularMarketChange?: number;
  regularMarketChangePercent?: number;
  regularMarketVolume?: number;
  chartPreviousClose?: number;
  previousClose?: number;
}
interface YahooFinanceChartResult {
  meta: YahooFinanceChartMeta;
  timestamp: number[];
  indicators: { quote: YahooFinanceQuote[] };
}
interface YahooFinanceChartResponse {
  chart: { result: YahooFinanceChartResult[] | null; error: unknown };
}

/**
 * MarketDataService — 雙市場（TW / US）報價與 K 線
 *
 * 台股：FinMind API  https://api.finmindtrade.com/api/v4/data
 * 美股：Finnhub API  https://finnhub.io/api/v1
 *
 * 架構原則（4.1）：所有資料清洗、缺值補齊、欄位標準化均在此執行。
 */
export class MarketDataService {
  private readonly cache = new Map<string, { data: unknown; expiry: number }>();
  private _lastHeatmapMarketUsedFallback = false;
  private _didWarnNoToken = false;

  /** 若未設定 FinMind token，彈出一次性警示並引導使用者設定 */
  private warnNoFinMindToken(): void {
    if (this._didWarnNoToken) { return; }
    this._didWarnNoToken = true;
    vscode.window.showWarningMessage(
      '⚠️ 未設定 FinMind API Token，K 線圖與財報功能將使用免費替代資料源（功能受限）。',
      '前往設定',
    ).then(choice => {
      if (choice === '前往設定') {
        vscode.commands.executeCommand('workbench.action.openSettings', 'stockHeatmap.apiKey');
      }
    });
  }

  private static readonly FINMIND_BASE = 'https://api.finmindtrade.com/api/v4/data';
  private static readonly FINNHUB_BASE = 'https://finnhub.io/api/v1';
  /** TWSE 代碼查詢（免 Key，回傳 suggestions 陣列，每格格式："2330     台積電"） */
  private static readonly TWSE_CODE_QUERY = 'https://www.twse.com.tw/zh/api/codeQuery';
  private static readonly TWSE_STOCK_DAY_ALL = 'https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL';
  private static readonly TPEX_MAINBOARD_QUOTES = 'https://www.tpex.org.tw/openapi/v1/tpex_mainboard_quotes';

  constructor(private readonly context: vscode.ExtensionContext) {}

  // ---------------------------------------------------------------------------
  // 公開 API
  // ---------------------------------------------------------------------------

  /**
   * 取得股票中文（或英文）名稱
   * 台股：TWSE/TPEx 公開 API（免 Key）→ 中文名稱
   * 美股：Finnhub /stock/profile2 → 英文名稱
   * 查不到則回傳空字串
   */
  async getStockName(symbol: string): Promise<string> {
    const cacheKey = `name:${symbol}`;
    const cached = this.getCached<string>(cacheKey);
    if (cached !== undefined) { return cached; }

    try {
      let name = '';
      if (this.detectMarket(symbol) === 'TW') {
        name = await this.getTWStockName(symbol);
      } else {
        const token = this.getApiKey('US');
        const url = `${MarketDataService.FINNHUB_BASE}/stock/profile2?symbol=${encodeURIComponent(symbol)}&token=${encodeURIComponent(token)}`;
        const resp = await fetch(url);
        if (resp.ok) {
          const json = await resp.json() as FinnhubProfile;
          name = json.name ?? '';
        }
      }
      this.setCached(cacheKey, name, 3600); // 名稱快取 1 小時
      return name;
    } catch {
      return '';
    }
  }

  /**
   * 從 TWSE codeQuery API 取得台股中文名稱（免 API Key）
   * 回應格式：{ suggestions: ["2330     台積電", ...] }
   * 取第一筆，去掉代碼前置後取餘下部分
   */
  private async getTWStockName(symbol: string): Promise<string> {
    const url = `${MarketDataService.TWSE_CODE_QUERY}?query=${encodeURIComponent(symbol)}`;
    const resp = await fetch(url, { headers: { 'Accept': 'application/json' } });
    if (!resp.ok) { return ''; }
    const json = await resp.json() as { suggestions?: string[] };
    const first = json.suggestions?.[0] ?? '';
    if (!first) { return ''; }
    // 格式："2330     台積電" — 移除開頭的代碼與空白，取中文名稱部分
    const name = first.replace(/^\S+\s+/, '').trim();
    return name;
  }

  /** 取得多檔報價（自動依代碼判斷市場） */
  async getQuotes(symbols: string[]): Promise<Quote[]> {
    const results = await Promise.allSettled(
      symbols.map((s) => this.detectMarket(s) === 'TW'
        ? this.getTWQuote(s)
        : this.getUSQuote(s)),
    );
    return results
      .filter((r): r is PromiseFulfilledResult<Quote> => r.status === 'fulfilled')
      .map((r) => r.value);
  }

  /** 取得 K 線資料 */
  async getCandles(
    symbol: string,
    interval: string,
    from: string,
    to: string,
  ): Promise<Candle[]> {
    const cacheKey = `candles:${symbol}:${interval}:${from}:${to}`;
    const cached = this.getCached<Candle[]>(cacheKey);
    if (cached) { return cached; }

    const candles = this.detectMarket(symbol) === 'TW'
      ? await this.getTWCandles(symbol, from, to, interval)
      : await this.getUSCandles(symbol, interval, from, to);

    const ttl = vscode.workspace.getConfiguration('stockHeatmap').get<number>('storage.cacheTtlSec', 300);
    this.setCached(cacheKey, candles, ttl);
    return candles;
  }

  /** 取得熱力圖資料（watchlist 自選股）
   *  台股：使用 Yahoo Finance（~15 分鐘延遲，當日資料），産業別從 TWSE/FinMind 查詢
   *  美股：Finnhub 逐檔查詢，需 apiKey
   */
  async getHeatmap(market: Market, _groupBy: 'sector' | 'index'): Promise<HeatmapItem[]> {
    const raw: unknown[] = vscode.workspace.getConfiguration('stockHeatmap').get('watchlist', []);
    // watchlist 可能是舊版 string[] 或新版 WatchlistEntry[]，統一正規化取出代碼
    const allSymbols = raw.map((e) =>
      typeof e === 'string' ? (e as string).toUpperCase() : (e as { symbol: string }).symbol,
    );
    const symbols = allSymbols.filter((s) =>
      market === 'TW' ? this.detectMarket(s) === 'TW' : this.detectMarket(s) === 'US',
    );
    if (symbols.length === 0) { return []; }

    if (market === 'TW') {
      // 使用 Yahoo Finance 取得當日（~15 分鐘延遲）報價，比 TWSE 批次昨日收盤更準確
      const [infoMap, quotes] = await Promise.all([
        this.getTWStockInfoMap(),
        this.getQuotes(symbols),
      ]);
      // 補充 TWSE/TPEX 批次產業別（背景取得，不阻塞主流程）
      const [twseResult, tpexResult] = await Promise.all([
        this.fetchTwseStockDayAllWithFallback(),
        this.fetchTpexMainboardQuotesWithFallback(),
      ]);
      const twseMarketMap = new Map<string, 'TSE' | 'OTC'>();
      const twseSectorMap = new Map<string, string>();
      for (const row of twseResult.rows) {
        const sym = row.Code?.trim();
        if (sym) { twseMarketMap.set(sym, 'TSE'); }
      }
      for (const row of tpexResult.rows) {
        const sym = row.SecuritiesCompanyCode?.trim();
        if (sym) { twseMarketMap.set(sym, 'OTC'); }
      }
      return quotes.map((q): HeatmapItem => {
        const info = infoMap.get(q.symbol);
        const sector = info?.industry_category || twseSectorMap.get(q.symbol) || '其他';
        const mkt = twseMarketMap.get(q.symbol) ?? 'TSE';
        return {
          sector,
          symbol: q.symbol,
          name: (q.name !== q.symbol ? q.name : null) ?? info?.stock_name ?? q.symbol,
          changePercent: q.changePercent,
          score: Math.round(q.changePercent * 10) / 10,
          volume: q.volume,
          market: mkt,
        } as HeatmapItem;
      });
    }

    // 美股：仍透過 Finnhub 逐檔查詢
    const quotes = await this.getQuotes(symbols);
    return quotes.map((q) => ({
      sector: 'watchlist',
      symbol: q.symbol,
      name: q.name,
      changePercent: q.changePercent,
      score: Math.round(q.changePercent * 10) / 10,
    }));
  }

  /** 取得全台股今日行情（依成交額排序，最多 300 檔） */
  async getHeatmapMarket(_market: 'TW'): Promise<HeatmapItem[]> {
    const today = new Date().toISOString().slice(0, 10);
    const cacheKey = `heatmap-market:TW:${today}`;
    const cached = this.getCached<HeatmapItem[]>(cacheKey);
    if (cached) {
      this._lastHeatmapMarketUsedFallback = false;
      return cached;
    }

    const infoMap = await this.getTWStockInfoMap();
    const [twseResult, tpexResult] = await Promise.all([
      this.fetchTwseStockDayAllWithFallback(),
      this.fetchTpexMainboardQuotesWithFallback(),
    ]);
    this._lastHeatmapMarketUsedFallback = twseResult.usedFallback || tpexResult.usedFallback;

    const items = [
      ...twseResult.rows.map((row) => this.mapTwseHeatmapRow(row, infoMap)),
      ...tpexResult.rows.map((row) => this.mapTpexHeatmapRow(row, infoMap)),
    ]
      .filter((item): item is HeatmapItem => item !== undefined)
      .sort((a, b) => (b.turnover ?? 0) - (a.turnover ?? 0))
      .slice(0, 300);

    const heatmapTtl = Math.max(30, vscode.workspace.getConfiguration('stockHeatmap').get<number>('refreshIntervalSec', 30));
    this.setCached(cacheKey, items, heatmapTtl);
    return items;
  }

  didLastHeatmapMarketUseFallback(): boolean {
    return this._lastHeatmapMarketUsedFallback;
  }

  /** 取得指數 K 線（Yahoo Finance v8 API，加權指數 / OTC，免 API Key） */
  async getIndexCandles(index: 'TWII' | 'OTC', months = 3): Promise<Candle[]> {
    const sym = index === 'TWII' ? '%5ETWII' : '%5ETWOII';
    const cacheKey = `index-candles:${index}:${months}`;
    const cached = this.getCached<Candle[]>(cacheKey);
    if (cached) { return cached; }

    const range = months <= 1 ? '1mo' : months <= 3 ? '3mo' : months <= 6 ? '6mo' : '1y';
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${sym}?interval=1d&range=${range}`;
    const resp = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; VSCode-Extension/1.0)' },
    }).catch(() => null);
    if (!resp || !resp.ok) { return []; }

    const json = await resp.json() as YahooFinanceChartResponse;
    const result = json.chart?.result?.[0];
    if (!result?.timestamp) { return []; }

    const q = result.indicators.quote[0];
    const candles = result.timestamp.map((ts, i): Candle => ({
      time:   new Date(ts * 1000).toISOString().slice(0, 10),
      open:   q.open[i]   ?? q.close[i] ?? 0,
      high:   q.high[i]   ?? q.close[i] ?? 0,
      low:    q.low[i]    ?? q.close[i] ?? 0,
      close:  q.close[i]  ?? 0,
      volume: q.volume[i] ?? 0,
    })).filter(c => c.close > 0);

    this.setCached(cacheKey, candles, 300);
    return candles;
  }

  /** 台股代碼資訊對照表（中文名稱 + 產業 + 市場別）Quick cache 1 hour */
  private async getTWStockInfoMap(): Promise<Map<string, FinMindStockInfoRow>> {
    const cacheKey = 'stock-info-map:TW';
    const cached = this.getCached<Map<string, FinMindStockInfoRow>>(cacheKey);
    if (cached) { return cached; }
    const token = this.getApiKey('TW');
    if (!token) {
      this.warnNoFinMindToken();
      return new Map(); // 無 token 時回空 Map，名稱 fallback 到 TWSE 原始資料
    }
    const url = `${MarketDataService.FINMIND_BASE}?dataset=TaiwanStockInfo&token=${encodeURIComponent(token)}`;
    const resp = await fetch(url).catch(() => null);
    if (!resp || !resp.ok) { return new Map(); }
    const json = await resp.json() as FinMindResponse<FinMindStockInfoRow>;
    if (json.status !== 200 || !Array.isArray(json.data) || json.data.length === 0) { return new Map(); }
    const map = new Map<string, FinMindStockInfoRow>();
    json.data.forEach(row => map.set(row.stock_id, row));
    this.setCached(cacheKey, map, 3600);
    return map;
  }

  private async fetchTwseStockDayAll(): Promise<TwseStockDayAllRow[]> {
    const resp = await fetch(MarketDataService.TWSE_STOCK_DAY_ALL).catch(() => null);
    if (!resp || !resp.ok) { return []; }
    const json = await resp.json() as TwseStockDayAllRow[];
    return Array.isArray(json) ? json : [];
  }

  private async fetchTwseStockDayAllWithFallback(): Promise<{ rows: TwseStockDayAllRow[]; usedFallback: boolean }> {
    const cacheKey = 'heatmap-source:TWSE';
    const rows = await this.fetchTwseStockDayAll();
    if (rows.length > 0) {
      this.setCached(cacheKey, rows, 3600);
      return { rows, usedFallback: false };
    }
    return { rows: this.getCached<TwseStockDayAllRow[]>(cacheKey) ?? [], usedFallback: true };
  }

  private async fetchTpexMainboardQuotes(): Promise<TpexMainboardQuoteRow[]> {
    const resp = await fetch(MarketDataService.TPEX_MAINBOARD_QUOTES).catch(() => null);
    if (!resp || !resp.ok) { return []; }
    const json = await resp.json() as TpexMainboardQuoteRow[];
    return Array.isArray(json) ? json : [];
  }

  private async fetchTpexMainboardQuotesWithFallback(): Promise<{ rows: TpexMainboardQuoteRow[]; usedFallback: boolean }> {
    const cacheKey = 'heatmap-source:TPEX';
    const rows = await this.fetchTpexMainboardQuotes();
    if (rows.length > 0) {
      this.setCached(cacheKey, rows, 3600);
      return { rows, usedFallback: false };
    }
    return { rows: this.getCached<TpexMainboardQuoteRow[]>(cacheKey) ?? [], usedFallback: true };
  }

  private mapTwseHeatmapRow(
    row: TwseStockDayAllRow,
    infoMap: Map<string, FinMindStockInfoRow>,
  ): HeatmapItem | undefined {
    const symbol = row.Code?.trim();
    if (!symbol || !/^\d{4,6}$/.test(symbol)) { return undefined; }

    const close = this.parseMarketNumber(row.ClosingPrice);
    const turnover = this.parseMarketNumber(row.TradeValue);
    const volume = this.parseMarketNumber(row.TradeVolume);
    // TWSE Change 欄位是絕對値（無符號），以收盤 vs 開盤推斷方向
    const absChange = this.parseMarketNumber(row.Change);
    if (close <= 0 || turnover <= 0 || volume <= 0 || !Number.isFinite(absChange)) { return undefined; }
    const openPrice = this.parseMarketNumber(row.OpeningPrice);
    const sign = (Number.isFinite(openPrice) && openPrice > 0 && close < openPrice) ? -1 : 1;
    const change = sign * Math.abs(absChange);
    const prevClose = close - change;
    if (prevClose <= 0) { return undefined; }

    const info = infoMap.get(symbol);
    const changePercent = (change / prevClose) * 100;
    return {
      sector: info?.industry_category || '其他',
      symbol,
      name: info?.stock_name || row.Name?.trim() || symbol,
      changePercent,
      score: Math.round(changePercent * 10) / 10,
      turnover,
      volume,
      market: 'TSE',
    };
  }

  private mapTpexHeatmapRow(
    row: TpexMainboardQuoteRow,
    infoMap: Map<string, FinMindStockInfoRow>,
  ): HeatmapItem | undefined {
    const symbol = row.SecuritiesCompanyCode?.trim();
    if (!symbol || !/^\d{4,6}$/.test(symbol)) { return undefined; }

    const close = this.parseMarketNumber(row.Close);
    const turnover = this.parseMarketNumber(row.TransactionAmount);
    const volume = this.parseMarketNumber(row.TradingShares);
    const change = this.parseSignedMarketNumber(row.Change);
    if (close <= 0 || turnover <= 0 || volume <= 0 || !Number.isFinite(change)) { return undefined; }

    const prevClose = close - change;
    if (prevClose <= 0) { return undefined; }

    const info = infoMap.get(symbol);
    const changePercent = (change / prevClose) * 100;
    return {
      sector: info?.industry_category || '其他',
      symbol,
      name: info?.stock_name || row.CompanyName?.trim() || symbol,
      changePercent,
      score: Math.round(changePercent * 10) / 10,
      turnover,
      volume,
      market: 'OTC',
    };
  }

  // ---------------------------------------------------------------------------
  // 台股 FinMind
  // ---------------------------------------------------------------------------

  private async getTWQuote(symbol: string): Promise<Quote> {
    const cacheKey = `quote:TW:${symbol}`;
    const cached = this.getCached<Quote>(cacheKey);
    if (cached) { return cached; }

    const token = this.getApiKey('TW');
    if (!token) {
      this.warnNoFinMindToken();
      // 降級：Yahoo Finance 免費延遲報價（含正確漲跌符號）
      return this.getTWQuoteFromYahoo(symbol);
    }

    const today = new Date().toISOString().slice(0, 10);
    const url = `${MarketDataService.FINMIND_BASE}?dataset=TaiwanStockPrice&data_id=${symbol}&start_date=${today}&token=${encodeURIComponent(token)}`;

    const resp = await fetch(url).catch(() => null);
    if (!resp || !resp.ok) { return this.getTWQuoteFromBatch(symbol); }
    const json = await resp.json() as FinMindResponse<FinMindQuoteRow>;
    if (!json.data || json.data.length === 0) { return this.getTWQuoteFromBatch(symbol); }

    const last = json.data[json.data.length - 1];
    const quote: Quote = {
      symbol,
      name: symbol,
      price: last.close,
      change: last.spread,
      changePercent: last.close > 0 ? (last.spread / (last.close - last.spread)) * 100 : 0,
      volume: last.Trading_Volume,
      updatedAt: new Date(last.date).toISOString(),
    };

    const quoteTtl = Math.max(10, vscode.workspace.getConfiguration('stockHeatmap').get<number>('refreshIntervalSec', 30));
    this.setCached(cacheKey, quote, quoteTtl);
    return quote;
  }

  /** 從 Yahoo Finance 取單檔 TW 報價（免費、含符號漲跌、延遲 ~15 分鐘） */
  private async getTWQuoteFromYahoo(symbol: string): Promise<Quote> {
    const yahooSym = encodeURIComponent(symbol + '.TW');
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${yahooSym}?interval=1d&range=2d`;
    const resp = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; VSCode-Extension/1.0)' },
    }).catch(() => null);
    if (resp && resp.ok) {
      const json = await resp.json() as YahooFinanceChartResponse;
      const meta = json.chart?.result?.[0]?.meta;
      if (meta && meta.regularMarketPrice && meta.regularMarketPrice > 0) {
        const price = meta.regularMarketPrice;
        const prevClose = meta.chartPreviousClose ?? meta.previousClose ?? price;
        const change = meta.regularMarketChange ?? (price - prevClose);
        const changePercent = meta.regularMarketChangePercent ?? (prevClose > 0 ? (change / prevClose) * 100 : 0);
        const quote: Quote = {
          symbol,
          name: symbol,
          price,
          change,
          changePercent,
          volume: meta.regularMarketVolume ?? 0,
          updatedAt: new Date().toISOString(),
        };
        const quoteTtl = Math.max(10, vscode.workspace.getConfiguration('stockHeatmap').get<number>('refreshIntervalSec', 30));
        this.setCached(`quote:TW:${symbol}`, quote, quoteTtl);
        return quote;
      }
    }
    // Yahoo 失敗時降級到 TWSE 批次資料（符號經修正）
    return this.getTWQuoteFromBatch(symbol);
  }

  /** 從 TWSE/TPEX 批次資料取單檔報價（不需 token） */
  private async getTWQuoteFromBatch(symbol: string): Promise<Quote> {
    const [twseResult, tpexResult] = await Promise.all([
      this.fetchTwseStockDayAllWithFallback(),
      this.fetchTpexMainboardQuotesWithFallback(),
    ]);
    const twseRow = twseResult.rows.find(r => r.Code?.trim() === symbol);
    if (twseRow) {
      const close  = this.parseMarketNumber(twseRow.ClosingPrice);
      // TWSE Change 無符號：以開盤 vs 收盤推斷方向
      const absChange = this.parseMarketNumber(twseRow.Change);
      const openP = this.parseMarketNumber(twseRow.OpeningPrice);
      const sign = (Number.isFinite(openP) && openP > 0 && close < openP) ? -1 : 1;
      const change = sign * Math.abs(absChange);
      const prev   = close - change;
      const quote: Quote = {
        symbol,
        name: twseRow.Name?.trim() || symbol,
        price: close,
        change,
        changePercent: prev > 0 ? (change / prev) * 100 : 0,
        volume: this.parseMarketNumber(twseRow.TradeVolume),
        updatedAt: new Date().toISOString(),
      };
      const quoteTtl1 = Math.max(10, vscode.workspace.getConfiguration('stockHeatmap').get<number>('refreshIntervalSec', 30));
      this.setCached(`quote:TW:${symbol}`, quote, quoteTtl1);
      return quote;
    }
    const tpexRow = tpexResult.rows.find(r => r.SecuritiesCompanyCode?.trim() === symbol);
    if (tpexRow) {
      const close  = this.parseMarketNumber(tpexRow.Close);
      const change = this.parseSignedMarketNumber(tpexRow.Change);
      const prev   = close - change;
      const quote: Quote = {
        symbol,
        name: tpexRow.CompanyName?.trim() || symbol,
        price: close,
        change,
        changePercent: prev > 0 ? (change / prev) * 100 : 0,
        volume: this.parseMarketNumber(tpexRow.TradingShares),
        updatedAt: new Date().toISOString(),
      };
      const quoteTtl2 = Math.max(10, vscode.workspace.getConfiguration('stockHeatmap').get<number>('refreshIntervalSec', 30));
      this.setCached(`quote:TW:${symbol}`, quote, quoteTtl2);
      return quote;
    }
    throw new Error(`No data for ${symbol} in TWSE/TPEX batch`);
  }

  private async getTWCandles(symbol: string, from: string, to: string, interval = '1D'): Promise<Candle[]> {
    const token = this.getApiKey('TW');
    if (!token) {
      this.warnNoFinMindToken();
      // 降級：Yahoo Finance v8 免費 K 線
      return this.getTWCandlesFromYahoo(symbol, from, to, interval);
    }
    // 依 interval 選 FinMind dataset
    let dataset = 'TaiwanStockPrice';
    if (interval === '1W') { dataset = 'TaiwanStockWeekPrice'; }
    else if (interval === '1M' || interval === '1Y') { dataset = 'TaiwanStockMonthPrice'; }
    const url = `${MarketDataService.FINMIND_BASE}?dataset=${dataset}&data_id=${symbol}&start_date=${from}&end_date=${to}&token=${encodeURIComponent(token)}`;
    const resp = await fetch(url).catch(() => null);
    if (!resp || !resp.ok) { return this.getTWCandlesFromYahoo(symbol, from, to, interval); }
    const json = await resp.json() as FinMindResponse<FinMindQuoteRow>;
    if (!json.data || json.data.length === 0) { return this.getTWCandlesFromYahoo(symbol, from, to, interval); }

    return json.data.map((row): Candle => ({
      time: row.date,
      open: row.open,
      high: row.max,
      low: row.min,
      close: row.close,
      volume: row.Trading_Volume,
    }));
  }

  /** 免費 K 線降級路徑：Yahoo Finance v8（台股代碼加 .TW 後綴） */
  private async getTWCandlesFromYahoo(symbol: string, from: string, _to: string, interval: string): Promise<Candle[]> {
    const yahooSym = encodeURIComponent(symbol + '.TW');
    const fromDate = new Date(from);
    const now = new Date();
    const diffDays = Math.ceil((now.getTime() - fromDate.getTime()) / 86400000);
    const range = diffDays <= 30 ? '1mo' : diffDays <= 90 ? '3mo' : diffDays <= 180 ? '6mo' : '1y';
    const yInterval = interval === '1W' ? '1wk' : interval === '1M' || interval === '1Y' ? '1mo' : '1d';
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${yahooSym}?interval=${yInterval}&range=${range}`;
    const resp = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; VSCode-Extension/1.0)' },
    }).catch(() => null);
    if (!resp || !resp.ok) { return []; }
    const json = await resp.json() as YahooFinanceChartResponse;
    const result = json.chart?.result?.[0];
    if (!result?.timestamp) { return []; }
    const q = result.indicators.quote[0];
    return result.timestamp
      .map((ts, i): Candle => ({
        time: new Date(ts * 1000).toISOString().slice(0, 10),
        open:   q.open[i]   ?? q.close[i] ?? 0,
        high:   q.high[i]   ?? q.close[i] ?? 0,
        low:    q.low[i]    ?? q.close[i] ?? 0,
        close:  q.close[i]  ?? 0,
        volume: q.volume[i] ?? 0,
      }))
      .filter(c => c.close > 0);
  }

  // ---------------------------------------------------------------------------
  // 美股 Finnhub
  // ---------------------------------------------------------------------------

  private async getUSQuote(symbol: string): Promise<Quote> {
    const cacheKey = `quote:US:${symbol}`;
    const cached = this.getCached<Quote>(cacheKey);
    if (cached) { return cached; }

    const token = this.getApiKey('US');
    const url = `${MarketDataService.FINNHUB_BASE}/quote?symbol=${encodeURIComponent(symbol)}&token=${encodeURIComponent(token)}`;
    const resp = await fetch(url);
    if (!resp.ok) { throw new Error(`Finnhub HTTP ${resp.status}`); }
    const json = await resp.json() as FinnhubQuote;

    const quote: Quote = {
      symbol,
      name: symbol,
      price: json.c,
      change: json.d,
      changePercent: json.dp,
      volume: 0, // Finnhub quote endpoint 不回傳 volume，由 candle 取得
      updatedAt: new Date(json.t * 1000).toISOString(),
    };

    const usTtl = Math.max(10, vscode.workspace.getConfiguration('stockHeatmap').get<number>('refreshIntervalSec', 30));
    this.setCached(cacheKey, quote, usTtl);
    return quote;
  }

  private async getUSCandles(
    symbol: string,
    resolution: string,
    from: string,
    to: string,
  ): Promise<Candle[]> {
    const token = this.getApiKey('US');
    const fromTs = Math.floor(new Date(from).getTime() / 1000);
    const toTs = Math.floor(new Date(to).getTime() / 1000);
    const res = this.toFinnhubResolution(resolution);
    const url = `${MarketDataService.FINNHUB_BASE}/stock/candle?symbol=${encodeURIComponent(symbol)}&resolution=${res}&from=${fromTs}&to=${toTs}&token=${encodeURIComponent(token)}`;

    const resp = await fetch(url);
    if (!resp.ok) { throw new Error(`Finnhub HTTP ${resp.status}`); }
    const json = await resp.json() as FinnhubCandle;
    if (json.s !== 'ok' || !json.t) { return []; }

    return json.t.map((ts, i): Candle => ({
      time: new Date(ts * 1000).toISOString().slice(0, 10),
      open: json.o[i],
      high: json.h[i],
      low: json.l[i],
      close: json.c[i],
      volume: json.v[i],
    }));
  }

  // ---------------------------------------------------------------------------
  // 工具方法
  // ---------------------------------------------------------------------------

  /** 以代碼格式自動判斷市場：純數字 4~6 碼 → 台股，其他 → 美股 */
  detectMarket(symbol: string): 'TW' | 'US' {
    return /^\d{4,6}$/.test(symbol) ? 'TW' : 'US';
  }

  /** 將 Extension 時間框架轉為 Finnhub resolution 字串 */
  private toFinnhubResolution(interval: string): string {
    const map: Record<string, string> = {
      '1D': 'D', '4H': '240', '1H': '60', '15m': '15', '5m': '5', '1m': '1',
      '1W': 'W', '1M': 'M', '1Y': 'M',
    };
    return map[interval] ?? 'D';
  }

  private parseMarketNumber(value: string | number | undefined): number {
    if (typeof value === 'number') { return Number.isFinite(value) ? value : NaN; }
    if (!value) { return NaN; }
    const normalized = value.replace(/,/g, '').trim();
    if (!normalized || normalized === '---' || normalized === '----') { return NaN; }
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : NaN;
  }

  private parseSignedMarketNumber(value: string | number | undefined): number {
    if (typeof value === 'number') { return Number.isFinite(value) ? value : NaN; }
    if (!value) { return NaN; }
    const normalized = value.replace(/,/g, '').trim();
    if (!normalized || normalized === '---' || normalized === '----') { return NaN; }
    const matched = normalized.match(/[+-]?\d+(?:\.\d+)?/);
    if (!matched) { return NaN; }
    const parsed = Number(matched[0]);
    return Number.isFinite(parsed) ? parsed : NaN;
  }

  private getApiKey(market: 'TW' | 'US'): string {
    // 兩市場共用同一個 apiKey 設定；若需要分開可在 settings 追加欄位
    return vscode.workspace.getConfiguration('stockHeatmap').get<string>('apiKey', '');
  }

  private getCached<T>(key: string): T | undefined {
    const entry = this.cache.get(key);
    if (!entry) { return undefined; }
    if (Date.now() > entry.expiry) { this.cache.delete(key); return undefined; }
    return entry.data as T;
  }

  private setCached(key: string, data: unknown, ttlSec: number): void {
    this.cache.set(key, { data, expiry: Date.now() + ttlSec * 1000 });
  }
}
