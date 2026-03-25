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
exports.MarketDataService = void 0;
const vscode = __importStar(require("vscode"));
/**
 * MarketDataService — 雙市場（TW / US）報價與 K 線
 *
 * 台股：FinMind API  https://api.finmindtrade.com/api/v4/data
 * 美股：Finnhub API  https://finnhub.io/api/v1
 *
 * 架構原則（4.1）：所有資料清洗、缺值補齊、欄位標準化均在此執行。
 */
class MarketDataService {
    constructor(context) {
        this.context = context;
        this.cache = new Map();
    }
    // ---------------------------------------------------------------------------
    // 公開 API
    // ---------------------------------------------------------------------------
    /** 取得多檔報價（自動依代碼判斷市場） */
    async getQuotes(symbols) {
        const results = await Promise.allSettled(symbols.map((s) => this.detectMarket(s) === 'TW'
            ? this.getTWQuote(s)
            : this.getUSQuote(s)));
        return results
            .filter((r) => r.status === 'fulfilled')
            .map((r) => r.value);
    }
    /** 取得 K 線資料 */
    async getCandles(symbol, interval, from, to) {
        const cacheKey = `candles:${symbol}:${interval}:${from}:${to}`;
        const cached = this.getCached(cacheKey);
        if (cached) {
            return cached;
        }
        const candles = this.detectMarket(symbol) === 'TW'
            ? await this.getTWCandles(symbol, from, to)
            : await this.getUSCandles(symbol, interval, from, to);
        const ttl = vscode.workspace.getConfiguration('stockHeatmap').get('storage.cacheTtlSec', 300);
        this.setCached(cacheKey, candles, ttl);
        return candles;
    }
    /** 取得熱力圖資料（目前回傳 watchlist 報價格式化為 HeatmapItem） */
    async getHeatmap(market, _groupBy) {
        const watchlist = vscode.workspace.getConfiguration('stockHeatmap').get('watchlist', []);
        const symbols = watchlist.filter((s) => market === 'TW' ? this.detectMarket(s) === 'TW' : this.detectMarket(s) === 'US');
        if (symbols.length === 0) {
            return [];
        }
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
    async getTWQuote(symbol) {
        const cacheKey = `quote:TW:${symbol}`;
        const cached = this.getCached(cacheKey);
        if (cached) {
            return cached;
        }
        const token = this.getApiKey('TW');
        const today = new Date().toISOString().slice(0, 10);
        const url = `${MarketDataService.FINMIND_BASE}?dataset=TaiwanStockPrice&data_id=${symbol}&start_date=${today}&token=${encodeURIComponent(token)}`;
        const resp = await fetch(url);
        if (!resp.ok) {
            throw new Error(`FinMind HTTP ${resp.status}`);
        }
        const json = await resp.json();
        if (!json.data || json.data.length === 0) {
            throw new Error(`FinMind: no data for ${symbol}`);
        }
        const last = json.data[json.data.length - 1];
        const quote = {
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
    async getTWCandles(symbol, from, to) {
        const token = this.getApiKey('TW');
        const url = `${MarketDataService.FINMIND_BASE}?dataset=TaiwanStockPrice&data_id=${symbol}&start_date=${from}&end_date=${to}&token=${encodeURIComponent(token)}`;
        const resp = await fetch(url);
        if (!resp.ok) {
            throw new Error(`FinMind HTTP ${resp.status}`);
        }
        const json = await resp.json();
        return (json.data ?? []).map((row) => ({
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
    async getUSQuote(symbol) {
        const cacheKey = `quote:US:${symbol}`;
        const cached = this.getCached(cacheKey);
        if (cached) {
            return cached;
        }
        const token = this.getApiKey('US');
        const url = `${MarketDataService.FINNHUB_BASE}/quote?symbol=${encodeURIComponent(symbol)}&token=${encodeURIComponent(token)}`;
        const resp = await fetch(url);
        if (!resp.ok) {
            throw new Error(`Finnhub HTTP ${resp.status}`);
        }
        const json = await resp.json();
        const quote = {
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
    async getUSCandles(symbol, resolution, from, to) {
        const token = this.getApiKey('US');
        const fromTs = Math.floor(new Date(from).getTime() / 1000);
        const toTs = Math.floor(new Date(to).getTime() / 1000);
        const res = this.toFinnhubResolution(resolution);
        const url = `${MarketDataService.FINNHUB_BASE}/stock/candle?symbol=${encodeURIComponent(symbol)}&resolution=${res}&from=${fromTs}&to=${toTs}&token=${encodeURIComponent(token)}`;
        const resp = await fetch(url);
        if (!resp.ok) {
            throw new Error(`Finnhub HTTP ${resp.status}`);
        }
        const json = await resp.json();
        if (json.s !== 'ok' || !json.t) {
            return [];
        }
        return json.t.map((ts, i) => ({
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
    detectMarket(symbol) {
        return /^\d{4,6}$/.test(symbol) ? 'TW' : 'US';
    }
    /** 將 Extension 時間框架轉為 Finnhub resolution 字串 */
    toFinnhubResolution(interval) {
        const map = {
            '1D': 'D', '4H': '240', '1H': '60', '15m': '15', '5m': '5', '1m': '1',
        };
        return map[interval] ?? 'D';
    }
    getApiKey(market) {
        // 兩市場共用同一個 apiKey 設定；若需要分開可在 settings 追加欄位
        return vscode.workspace.getConfiguration('stockHeatmap').get('apiKey', '');
    }
    getCached(key) {
        const entry = this.cache.get(key);
        if (!entry) {
            return undefined;
        }
        if (Date.now() > entry.expiry) {
            this.cache.delete(key);
            return undefined;
        }
        return entry.data;
    }
    setCached(key, data, ttlSec) {
        this.cache.set(key, { data, expiry: Date.now() + ttlSec * 1000 });
    }
}
exports.MarketDataService = MarketDataService;
MarketDataService.FINMIND_BASE = 'https://api.finmindtrade.com/api/v4/data';
MarketDataService.FINNHUB_BASE = 'https://finnhub.io/api/v1';
//# sourceMappingURL=MarketDataService.js.map