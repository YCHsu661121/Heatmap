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

  private static readonly FINMIND_BASE = 'https://api.finmindtrade.com/api/v4/data';
  private static readonly FINNHUB_BASE = 'https://finnhub.io/api/v1';
  /** TWSE 代碼查詢（免 Key，回傳 suggestions 陣列，每格格式："2330     台積電"） */
  private static readonly TWSE_CODE_QUERY = 'https://www.twse.com.tw/zh/api/codeQuery';

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

  /** 取得熱力圖資料（目前回傳 watchlist 報價格式化為 HeatmapItem） */
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
    const quotes = await this.getQuotes(symbols);
    return quotes.map((q) => ({
      sector: 'watchlist',
      symbol: q.symbol,
      name: q.name,
      changePercent: q.changePercent,
      score: Math.round(q.changePercent * 10) / 10,
    }));
  }

  // ---------------------------------------------------------------------------
  // 台股 FinMind
  // ---------------------------------------------------------------------------

  private async getTWQuote(symbol: string): Promise<Quote> {
    const cacheKey = `quote:TW:${symbol}`;
    const cached = this.getCached<Quote>(cacheKey);
    if (cached) { return cached; }

    const token = this.getApiKey('TW');
    const today = new Date().toISOString().slice(0, 10);
    const url = `${MarketDataService.FINMIND_BASE}?dataset=TaiwanStockPrice&data_id=${symbol}&start_date=${today}&token=${encodeURIComponent(token)}`;

    const resp = await fetch(url);
    if (!resp.ok) { throw new Error(`FinMind HTTP ${resp.status}`); }
    const json = await resp.json() as FinMindResponse<FinMindQuoteRow>;
    if (!json.data || json.data.length === 0) {
      throw new Error(`FinMind: no data for ${symbol}`);
    }

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

    this.setCached(cacheKey, quote, 60);
    return quote;
  }

  private async getTWCandles(symbol: string, from: string, to: string, interval = '1D'): Promise<Candle[]> {
    const token = this.getApiKey('TW');
    // 依 interval 選 FinMind dataset
    let dataset = 'TaiwanStockPrice';
    if (interval === '1W') { dataset = 'TaiwanStockWeekPrice'; }
    else if (interval === '1M' || interval === '1Y') { dataset = 'TaiwanStockMonthPrice'; }
    const url = `${MarketDataService.FINMIND_BASE}?dataset=${dataset}&data_id=${symbol}&start_date=${from}&end_date=${to}&token=${encodeURIComponent(token)}`;
    const resp = await fetch(url);
    if (!resp.ok) { throw new Error(`FinMind HTTP ${resp.status}`); }
    const json = await resp.json() as FinMindResponse<FinMindQuoteRow>;

    return (json.data ?? []).map((row): Candle => ({
      time: row.date,
      open: row.open,
      high: row.max,
      low: row.min,
      close: row.close,
      volume: row.Trading_Volume,
    }));
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

    this.setCached(cacheKey, quote, 60);
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
