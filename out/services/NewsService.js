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
exports.NewsService = void 0;
const vscode = __importStar(require("vscode"));
/**
 * NewsService — 從 Extension Host 呼叫 News API / RSS 抓取新聞
 *
 * 來源優先順序：
 *   1. NewsAPI.org（REST，需 API Key）
 *   2. Yahoo Finance RSS（免費，無須 Key）
 *   3. Finnhub company news（美股，需 Finnhub Key）
 *
 * 架構原則（4.1）：情緒分類（sentiment）以簡易關鍵字規則判斷，不依賴 LLM。
 */
class NewsService {
    constructor(context) {
        this.context = context;
        this.cache = new Map();
    }
    /**
     * 取得指定股票的新聞列表
     * @param symbol  股票代碼
     * @param from    起始日期（ISO 8601，YYYY-MM-DD）
     * @param to      結束日期（ISO 8601，YYYY-MM-DD）
     * @param limit   最多幾則（預設 20）
     */
    async getNews(symbol, from, to, limit = 20) {
        const cacheKey = `news:${symbol}:${from}:${to}:${limit}`;
        const cached = this.cache.get(cacheKey);
        if (cached && Date.now() < cached.expiry) {
            return cached.data;
        }
        const provider = this.getProvider();
        let items = [];
        try {
            if (provider === 'newsapi') {
                items = await this.fetchNewsApi(symbol, from, to, limit);
            }
            else {
                items = await this.fetchRss(symbol, limit);
            }
        }
        catch {
            // newsapi 失敗時降級到 RSS
            items = await this.fetchRss(symbol, limit).catch(() => []);
        }
        // 若還是空的，嘗試 Finnhub（美股限定）
        if (items.length === 0 && !/^\d{4,6}$/.test(symbol)) {
            items = await this.fetchFinnhubNews(symbol, from, to, limit).catch(() => []);
        }
        const cacheTtl = 300; // 5 分鐘
        this.cache.set(cacheKey, { data: items, expiry: Date.now() + cacheTtl * 1000 });
        return items;
    }
    // ---------------------------------------------------------------------------
    // NewsAPI.org
    // ---------------------------------------------------------------------------
    async fetchNewsApi(symbol, from, to, limit) {
        const key = this.getApiKey();
        if (!key) {
            throw new Error('news.apiKey 未設定');
        }
        const params = new URLSearchParams({
            q: symbol,
            from,
            to,
            sortBy: 'publishedAt',
            pageSize: String(Math.min(limit, 100)),
            language: 'en',
            apiKey: key,
        });
        const resp = await fetch(`${NewsService.NEWSAPI_BASE}?${params}`);
        if (!resp.ok) {
            throw new Error(`NewsAPI HTTP ${resp.status}`);
        }
        const json = await resp.json();
        if (json.status !== 'ok') {
            throw new Error(`NewsAPI error: ${json.status}`);
        }
        return (json.articles ?? []).slice(0, limit).map((a) => ({
            title: a.title ?? '',
            source: a.source?.name ?? 'NewsAPI',
            publishedAt: a.publishedAt,
            url: a.url,
            summary: a.description ?? '',
            sentiment: this.classifySentiment(a.title ?? '', a.description ?? ''),
        }));
    }
    // ---------------------------------------------------------------------------
    // Yahoo Finance RSS（免費，無須 Key）
    // ---------------------------------------------------------------------------
    async fetchRss(symbol, limit) {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const Parser = require('rss-parser');
        const parser = new Parser();
        // Yahoo Finance RSS
        const url = `https://feeds.finance.yahoo.com/rss/2.0/headline?s=${encodeURIComponent(symbol)}&region=US&lang=en-US`;
        const feed = await parser.parseURL(url);
        return (feed.items ?? []).slice(0, limit).map((item) => ({
            title: item.title ?? '',
            source: 'Yahoo Finance',
            publishedAt: item.isoDate ?? item.pubDate ?? new Date().toISOString(),
            url: item.link ?? '',
            summary: item.contentSnippet ?? '',
            sentiment: this.classifySentiment(item.title ?? '', item.contentSnippet ?? ''),
        }));
    }
    // ---------------------------------------------------------------------------
    // Finnhub company news（美股）
    // ---------------------------------------------------------------------------
    async fetchFinnhubNews(symbol, from, to, limit) {
        const key = vscode.workspace.getConfiguration('stockHeatmap').get('apiKey', '');
        if (!key) {
            return [];
        }
        const url = `${NewsService.FINNHUB_BASE}/company-news?symbol=${encodeURIComponent(symbol)}&from=${from}&to=${to}&token=${encodeURIComponent(key)}`;
        const resp = await fetch(url);
        if (!resp.ok) {
            return [];
        }
        const json = await resp.json();
        return (json ?? []).slice(0, limit).map((n) => ({
            title: n.headline,
            source: n.source,
            publishedAt: new Date(n.datetime * 1000).toISOString(),
            url: n.url,
            summary: n.summary,
            sentiment: this.classifySentiment(n.headline, n.summary),
        }));
    }
    // ---------------------------------------------------------------------------
    // 本地情緒分類（deterministic，不依賴 LLM）
    // ---------------------------------------------------------------------------
    classifySentiment(title, body) {
        const text = (title + ' ' + body).toLowerCase();
        const pos = /beat|surpass|record|growth|profit|bullish|upgrade|buy|raise|strong|exceed/.test(text);
        const neg = /miss|decline|loss|bearish|downgrade|sell|cut|weak|concern|risk|warn|layoff|sue/.test(text);
        if (pos && !neg) {
            return 'positive';
        }
        if (neg && !pos) {
            return 'negative';
        }
        return 'neutral';
    }
    // ---------------------------------------------------------------------------
    // 工具
    // ---------------------------------------------------------------------------
    getApiKey() {
        return vscode.workspace.getConfiguration('stockHeatmap').get('news.apiKey', '');
    }
    getProvider() {
        return vscode.workspace.getConfiguration('stockHeatmap').get('news.provider', 'newsapi');
    }
}
exports.NewsService = NewsService;
NewsService.NEWSAPI_BASE = 'https://newsapi.org/v2/everything';
NewsService.FINNHUB_BASE = 'https://finnhub.io/api/v1';
//# sourceMappingURL=NewsService.js.map