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
exports.FinancialReportService = void 0;
const vscode = __importStar(require("vscode"));
/**
 * FinancialReportService — 雙市場財報摘要抓取
 *
 * 台股：MOPS 月營收 API（公開資訊觀測站）
 *        https://mops.twse.com.tw
 * 美股：SEC EDGAR data API
 *        https://data.sec.gov/submissions/CIK{cik}.json
 *        https://data.sec.gov/api/xbrl/companyfacts/CIK{cik}.json
 *
 * 架構原則（4.1）：
 *   - 財務數值抽取、期間對齊、YoY/QoQ 計算均在此執行（deterministic）
 *   - highlights / risks 等文字欄位留空，由 LLMOrchestrator 填充
 */
class FinancialReportService {
    constructor(context) {
        this.context = context;
        this.cache = new Map();
    }
    // ---------------------------------------------------------------------------
    // 公開 API
    // ---------------------------------------------------------------------------
    /**
     * 取得最近幾季財報摘要
     * @param symbol  股票代碼（台股：4 位數字；美股：英文代碼）
     * @param periods 要取幾季（預設讀取 settings，預設 4）
     */
    async getLatestReports(symbol, periods) {
        const cacheKey = `financials:${symbol}:${periods ?? 'default'}`;
        const cached = this.cache.get(cacheKey);
        if (cached && Date.now() < cached.expiry) {
            return cached.data;
        }
        const n = periods ?? this.getLookbackQuarters();
        const reports = this.detectMarket(symbol) === 'TW'
            ? await this.fetchTWReports(symbol, n)
            : await this.fetchUSReports(symbol, n);
        const withCompare = this.comparePeriods(reports);
        this.cache.set(cacheKey, { data: withCompare, expiry: Date.now() + 3600000 }); // 快取 1 小時
        return withCompare;
    }
    /**
     * 計算 YoY / QoQ 並回傳帶有對比欄位的摘要陣列
     * 輸入應按 period 升冪排列
     */
    comparePeriods(reports) {
        return reports.map((r, i) => {
            if (i === 0) {
                return r;
            }
            const prev = reports[i - 1]; // QoQ 比較
            const yoyIdx = reports.findIndex((x) => this.periodDiff(r.period, x.period) === 4);
            const yoy = yoyIdx >= 0 ? reports[yoyIdx] : undefined;
            const pct = (a, b) => {
                if (a === undefined || b === undefined || b === 0) {
                    return undefined;
                }
                return Math.round(((a - b) / Math.abs(b)) * 10000) / 100;
            };
            return {
                ...r,
                revenueQoQ: pct(r.revenue, prev.revenue),
                epsQoQ: pct(r.eps, prev.eps),
                revenueYoY: yoy ? pct(r.revenue, yoy.revenue) : r.revenueYoY,
                epsYoY: yoy ? pct(r.eps, yoy.eps) : r.epsYoY,
            };
        });
    }
    // ---------------------------------------------------------------------------
    // 台股：MOPS 月營收
    // ---------------------------------------------------------------------------
    async fetchTWReports(symbol, periods) {
        const results = [];
        const now = new Date();
        // 抓最近 periods 個月的月營收（月報為台股最易取得的定期財務資料）
        for (let i = 0; i < periods; i++) {
            const dt = new Date(now.getFullYear(), now.getMonth() - i - 1, 1);
            const rocYear = dt.getFullYear() - 1911;
            const month = dt.getMonth() + 1;
            const periodStr = `${dt.getFullYear()}M${String(month).padStart(2, '0')}`;
            try {
                const row = await this.fetchMopsRevenue(symbol, rocYear, month);
                if (row) {
                    results.push({
                        symbol,
                        period: periodStr,
                        revenue: Number(row.revenue.replace(/,/g, '')) * 1000, // 千元 → 元
                        highlights: [],
                        sourceUrls: [`https://mops.twse.com.tw`],
                    });
                }
            }
            catch {
                // 單月失敗不中斷，繼續抓其他月份
            }
        }
        return results.reverse(); // 升冪
    }
    async fetchMopsRevenue(symbol, rocYear, month) {
        // MOPS 月營收 JSON API
        const url = `${FinancialReportService.MOPS_BASE}/t21sc03_${rocYear}_${month}.json`;
        const resp = await fetch(url, {
            headers: { 'User-Agent': 'StockHeatmapVSCodeExtension/1.0' },
        });
        if (!resp.ok) {
            return undefined;
        }
        const json = await resp.json();
        return json[symbol];
    }
    // ---------------------------------------------------------------------------
    // 美股：SEC EDGAR XBRL
    // ---------------------------------------------------------------------------
    async fetchUSReports(symbol, periods) {
        const cik = await this.resolveCik(symbol);
        if (!cik) {
            return [];
        }
        // 取 XBRL Company Facts（含 Revenue / EPS / Gross Profit 等財務數據）
        const url = `${FinancialReportService.SEC_BASE}/api/xbrl/companyfacts/CIK${cik}.json`;
        const resp = await fetch(url, {
            headers: { 'User-Agent': 'StockHeatmapVSCodeExtension/1.0 (contact@example.com)' },
        });
        if (!resp.ok) {
            return [];
        }
        const facts = await resp.json();
        const gaap = facts.facts?.['us-gaap'];
        if (!gaap) {
            return [];
        }
        // 抽取季度 Revenue（10-Q / 10-K 申報）
        const revenueEntries = (gaap.Revenues?.units?.USD ?? [])
            .filter((f) => f.form === '10-Q' || f.form === '10-K')
            .sort((a, b) => a.end.localeCompare(b.end));
        const epsEntries = gaap.EarningsPerShareBasic?.units?.shares ?? [];
        const gpEntries = gaap.GrossProfit?.units?.USD ?? [];
        const recent = revenueEntries.slice(-periods);
        return recent.map((rev) => {
            const period = this.toQuarterPeriod(rev.end);
            const eps = epsEntries.find((e) => e.end === rev.end && (e.form === '10-Q' || e.form === '10-K'));
            const gp = gpEntries.find((e) => e.end === rev.end && (e.form === '10-Q' || e.form === '10-K'));
            return {
                symbol,
                period,
                revenue: rev.val,
                eps: eps?.val,
                grossMargin: gp && rev.val > 0 ? Math.round((gp.val / rev.val) * 10000) / 100 : undefined,
                highlights: [],
                sourceUrls: [`https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${cik}&type=10-Q&dateb=&owner=include&count=10`],
            };
        });
    }
    /** 將 EDGAR CIK 查詢（以 ticker symbol 對應）*/
    async resolveCik(symbol) {
        // EDGAR 提供 company tickers JSON
        const tickerUrl = `${FinancialReportService.SEC_BASE}/files/company_tickers.json`;
        try {
            const resp = await fetch(tickerUrl, {
                headers: { 'User-Agent': 'StockHeatmapVSCodeExtension/1.0 (contact@example.com)' },
            });
            if (!resp.ok) {
                return undefined;
            }
            const json = await resp.json();
            const entry = Object.values(json).find((e) => e.ticker.toUpperCase() === symbol.toUpperCase());
            if (!entry) {
                return undefined;
            }
            return String(entry.cik_str).padStart(10, '0');
        }
        catch {
            return undefined;
        }
    }
    // ---------------------------------------------------------------------------
    // 工具方法
    // ---------------------------------------------------------------------------
    /** 判斷台股還是美股 */
    detectMarket(symbol) {
        return /^\d{4,6}$/.test(symbol) ? 'TW' : 'US';
    }
    /** SEC EDGAR 結束日期 → 季度字串，例如 "2024-09-30" → "2024Q3" */
    toQuarterPeriod(endDate) {
        const d = new Date(endDate);
        const q = Math.ceil((d.getMonth() + 1) / 3);
        return `${d.getFullYear()}Q${q}`;
    }
    /** 計算兩個 period 字串之間差幾個季度（僅支援 YYYYQq 或 YYYYMmm 格式） */
    periodDiff(a, b) {
        const parseQ = (s) => {
            const m = s.match(/^(\d{4})Q(\d)$/);
            return m ? parseInt(m[1]) * 4 + parseInt(m[2]) : 0;
        };
        return parseQ(a) - parseQ(b);
    }
    getLookbackQuarters() {
        return vscode.workspace.getConfiguration('stockHeatmap').get('financials.lookbackQuarters', 4);
    }
}
exports.FinancialReportService = FinancialReportService;
FinancialReportService.MOPS_BASE = 'https://mops.twse.com.tw/nas/t21/sii';
FinancialReportService.SEC_BASE = 'https://data.sec.gov';
//# sourceMappingURL=FinancialReportService.js.map