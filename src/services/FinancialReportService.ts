import * as vscode from 'vscode';
import { FinancialReportSummary } from '../types';

// ---------------------------------------------------------------------------
// MOPS（公開資訊觀測站）月營收回應型別
// ---------------------------------------------------------------------------
interface MopsRevenueRow {
  year: string;        // 民國年
  month: string;
  revenue: string;     // 當月營收（千元）
  revenue_yoy: string; // 年增率（%）
}

// ---------------------------------------------------------------------------
// FinMind 季損益表
// ---------------------------------------------------------------------------
interface FinMindIncomeRow {
  date: string;              // "2024-09-30"
  stock_id: string;
  type: string;              // "Q1" | "Q2" | "Q3" | "Q4"
  revenue: number;           // 千元
  gross_profit: number;      // 千元
  operating_income: number;  // 千元
  net_income: number;        // 千元
  eps: number;
}
interface FinMindResponse<T> { status: number; data: T[]; }

// ---------------------------------------------------------------------------
// SEC EDGAR submissions 型別（精簡）
// ---------------------------------------------------------------------------
interface SecFiling {
  accessionNumber: string;
  filingDate: string;
  form: string;
  primaryDocument: string;
}
interface SecSubmissions {
  cik: string;
  entityType: string;
  filings: { recent: { accessionNumber: string[]; filingDate: string[]; form: string[]; primaryDocument: string[] } };
}

/**
 * FinancialReportService — 雙市場財報摘要抓取
 *
 * 台股：
 *   1. FinMind TaiwanStockIncomeStatement（需 API key，含 EPS / 毛利率）
 *   2. Fallback → MOPS 月營收 JSON (t21sc03_{ROC}.json 格式)
 *
 * 美股：SEC EDGAR XBRL Company Facts API
 *        https://data.sec.gov/api/xbrl/companyfacts/CIK{cik}.json
 *
 * 架構原則（4.1）：
 *   - 財務數值抽取、期間對齊、YoY/QoQ 計算均在此執行（deterministic）
 *   - highlights / risks 等文字欄位留空，由 LLMOrchestrator 填充
 */
export class FinancialReportService {
  private readonly cache = new Map<string, { data: FinancialReportSummary[]; expiry: number }>();

  constructor(private readonly context?: vscode.ExtensionContext) {}

  // MOPS 公開資訊觀測站（上市公司月營收 JSON）
  // 正確 URL 格式：https://mops.twse.com.tw/nas/t21/sii/t21sc03_{ROC_YEAR}_{MONTH}.json
  private static readonly MOPS_SII_BASE = 'https://mops.twse.com.tw/nas/t21/sii';
  // 上櫃公司月營收 JSON
  private static readonly MOPS_OTC_BASE = 'https://mops.twse.com.tw/nas/t21/otc';
  private static readonly SEC_BASE = 'https://data.sec.gov';
  private static readonly FINMIND_BASE = 'https://api.finmindtrade.com/api/v4/data';

  // ---------------------------------------------------------------------------

  /**
   * 取得最近幾季財報摘要
   * @param symbol  股票代碼（台股：4 位數字；美股：英文代碼）
   * @param periods 要取幾季（預設讀取 settings，預設 4）
   */
  async getLatestReports(symbol: string, periods?: number): Promise<FinancialReportSummary[]> {
    const cacheKey = `financials:${symbol}:${periods ?? 'default'}`;
    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() < cached.expiry) { return cached.data; }

    const n = periods ?? this.getLookbackQuarters();

    let reports: FinancialReportSummary[] = [];
    try {
      reports = this.detectMarket(symbol) === 'TW'
        ? await this.fetchTWReports(symbol, n)
        : await this.fetchUSReports(symbol, n);
    } catch (err) {
      // 整體失敗不拋出，回傳空陣列讓 UI 顯示「無財報資料」
      console.error(`[FinancialReportService] ${symbol} 財報抓取失敗:`, err);
      return [];
    }

    const withCompare = this.comparePeriods(reports);
    const withHighlights = this.addHighlights(withCompare);
    this.cache.set(cacheKey, { data: withHighlights, expiry: Date.now() + 3600_000 }); // 快取 1 小時
    return withHighlights;
  }

  // ---------------------------------------------------------------------------
  // Highlights（摘要文字）
  // ---------------------------------------------------------------------------

  private addHighlights(reports: FinancialReportSummary[]): FinancialReportSummary[] {
    return reports.map((r, i) => ({
      ...r,
      highlights: this.buildHighlights(r, i > 0 ? reports[i - 1] : undefined),
    }));
  }

  private buildHighlights(r: FinancialReportSummary, prev?: FinancialReportSummary): string[] {
    const parts: string[] = [];
    const f1 = (n: number) => Math.abs(n).toFixed(1);
    const dir = (n: number) => n >= 0 ? '▲' : '▼';

    // 營收 YoY / QoQ
    if (r.revenueYoY !== undefined) {
      const abs = Math.abs(r.revenueYoY);
      const s = abs >= 20 ? '大幅' : abs < 3 ? '小幅' : '';
      parts.push(`營收${s}年${r.revenueYoY >= 0 ? '增' : '減'} ${dir(r.revenueYoY)}${f1(r.revenueYoY)}%`);
    } else if (r.revenueQoQ !== undefined) {
      parts.push(`營收季${r.revenueQoQ >= 0 ? '增' : '減'} ${dir(r.revenueQoQ)}${f1(r.revenueQoQ)}%`);
    }

    // 毛利率 QoQ
    if (r.grossMargin !== undefined && prev?.grossMargin !== undefined) {
      const diff = r.grossMargin - prev.grossMargin;
      if (Math.abs(diff) >= 0.5) {
        parts.push(`毛利率${diff >= 0 ? '提升' : '下滑'} ${dir(diff)}${Math.abs(diff).toFixed(1)}pp`);
      }
    }

    // EPS YoY
    if (r.epsYoY !== undefined) {
      parts.push(`EPS 年${r.epsYoY >= 0 ? '增' : '減'} ${dir(r.epsYoY)}${f1(r.epsYoY)}%`);
    }

    if (parts.length === 0) { return []; }
    // 合成一行摘要
    return [parts.join('，')];
  }

  /**
   * 計算 YoY / QoQ 並回傳帶有對比欄位的摘要陣列
   * 輸入應按 period 升冪排列
   */
  comparePeriods(reports: FinancialReportSummary[]): FinancialReportSummary[] {
    return reports.map((r, i) => {
      if (i === 0) { return r; }

      const prev = reports[i - 1]; // QoQ 比較
      const yoyIdx = reports.findIndex((x) => this.periodDiff(r.period, x.period) === 4);
      const yoy = yoyIdx >= 0 ? reports[yoyIdx] : undefined;

      const pct = (a?: number, b?: number): number | undefined => {
        if (a === undefined || b === undefined || b === 0) { return undefined; }
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
  // 台股：FinMind 季損益（優先）；降級到 MOPS 月營收彙總
  // ---------------------------------------------------------------------------

  private async fetchTWReports(symbol: string, periods: number): Promise<FinancialReportSummary[]> {
    // 優先嘗試 FinMind 季損益（含 EPS / 毛利率）
    const finmind = await this.fetchFinMindQuarterly(symbol, periods + 4).catch(() => []);
    if (finmind.length >= 2) { return finmind.slice(-periods); }

    // 降級：MOPS 月營收並行抓取後彙總為季
    return this.fetchMopsQuarterly(symbol, periods);
  }

  /** FinMind TaiwanStockIncomeStatement 季損益 */
  private async fetchFinMindQuarterly(symbol: string, periods: number): Promise<FinancialReportSummary[]> {
    const token = vscode.workspace.getConfiguration('stockHeatmap').get<string>('apiKey', '');
    if (!token) { return []; }
    const yearsBack = Math.ceil(periods / 4) + 1;
    const start = new Date();
    start.setFullYear(start.getFullYear() - yearsBack);
    const url = `${FinancialReportService.FINMIND_BASE}?dataset=TaiwanStockIncomeStatement` +
      `&data_id=${encodeURIComponent(symbol)}&start_date=${start.toISOString().slice(0, 10)}&token=${encodeURIComponent(token)}`;
    const resp = await fetch(url).catch(() => null);
    if (!resp || !resp.ok) { return []; }
    const json = await resp.json() as FinMindResponse<FinMindIncomeRow>;
    if (!Array.isArray(json.data) || json.data.length === 0) { return []; }

    // 過濾只保留季度資料（type = Q1~Q4）
    const quarters = json.data
      .filter(r => /^Q[1-4]$/.test(r.type))
      .sort((a, b) => a.date.localeCompare(b.date));

    return quarters.map((r): FinancialReportSummary => {
      const rev = (r.revenue ?? 0) * 1000; // FinMind 單位為千元
      return {
        symbol: r.stock_id,
        period: this.toQuarterPeriod(r.date),
        revenue: rev,
        eps: (r.eps != null && r.eps !== 0) ? r.eps : undefined,
        grossMargin: (r.gross_profit > 0 && r.revenue > 0)
          ? Math.round(r.gross_profit / r.revenue * 10000) / 100 : undefined,
        operatingMargin: (r.operating_income > 0 && r.revenue > 0)
          ? Math.round(r.operating_income / r.revenue * 10000) / 100 : undefined,
        highlights: [],
        sourceUrls: ['https://api.finmindtrade.com'],
      };
    });
  }

  /**
   * MOPS 月營收並行抓取，彙總為季度
   * URL 格式：https://mops.twse.com.tw/nas/t21/sii/t21sc03_{ROC_YEAR}_{MONTH}.json
   * 回應為陣列，每個元素含上市公司月營收；代碼在 "公司代號" 欄位。
   */
  private async fetchMopsQuarterly(symbol: string, periods: number): Promise<FinancialReportSummary[]> {
    const monthsNeeded = periods * 3 + 6; // 額外抓半年以便 YoY 對比
    const now = new Date();
    const configs = Array.from({ length: monthsNeeded }, (_, i) => {
      const dt = new Date(now.getFullYear(), now.getMonth() - i - 1, 1);
      return { dt, rocYear: dt.getFullYear() - 1911, month: dt.getMonth() + 1 };
    });

    const settled = await Promise.allSettled(
      configs.map(c => this.fetchMopsRevenue(symbol, c.rocYear, c.month)
        .then(rev => rev !== undefined
          ? { year: c.dt.getFullYear(), month: c.month, revenue: rev }
          : null)
      ),
    );

    const monthly = settled
      .filter((r): r is PromiseFulfilledResult<{ year: number; month: number; revenue: number } | null> =>
        r.status === 'fulfilled' && r.value != null)
      .map(r => r.value!)
      .sort((a, b) => a.year !== b.year ? a.year - b.year : a.month - b.month);

    if (monthly.length === 0) { return []; }

    // 彙總為季度
    const qMap = new Map<string, number>();
    for (const m of monthly) {
      const q = Math.ceil(m.month / 3);
      const key = `${m.year}Q${q}`;
      qMap.set(key, (qMap.get(key) ?? 0) + m.revenue);
    }

    return Array.from(qMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-periods)
      .map(([period, revenue]) => ({
        symbol,
        period,
        revenue,
        highlights: [],
        sourceUrls: ['https://mops.twse.com.tw'],
      }));
  }

  /**
   * 抓取指定民國年月的 MOPS 月營收 JSON（上市 sii，上櫃 otc）
   * 回傳該 symbol 的當月營收（元），無資料時回傳 undefined
   */
  private async fetchMopsRevenue(
    symbol: string, rocYear: number, month: string | number,
  ): Promise<number | undefined> {
    // 嘗試上市（sii）再嘗試上櫃（otc）
    for (const base of [FinancialReportService.MOPS_SII_BASE, FinancialReportService.MOPS_OTC_BASE]) {
      try {
        const url = `${base}/t21sc03_${rocYear}_${month}.json`;
        const resp = await fetch(url, {
          headers: {
            'User-Agent': 'StockHeatmapVSCodeExtension/1.0',
            'Referer': 'https://mops.twse.com.tw/',
          },
        });
        if (!resp.ok) { continue; }
        // MOPS JSON 格式為陣列，每元素為 { "公司代號": "2330", "當月營收": "123,456,789", ... }
        interface MopsRow { [key: string]: string }
        const json = await resp.json() as MopsRow[];
        if (!Array.isArray(json)) { continue; }
        const row = json.find(r =>
          (r['公司代號'] ?? '').trim() === symbol ||
          (r['stock_id'] ?? '').trim() === symbol,
        );
        if (!row) { continue; }
        // 欄位可能是 "當月營收" 或 "revenue"（千元）
        const raw = row['當月營收'] ?? row['revenue'] ?? '';
        const num = Number(raw.replace(/,/g, '').trim());
        if (Number.isFinite(num) && num > 0) {
          // MOPS 單位為千元，轉成元
          return num * 1000;
        }
      } catch {
        // 繼續嘗試下一個 base
      }
    }
    return undefined;
  }

  // ---------------------------------------------------------------------------
  // 美股：SEC EDGAR XBRL
  // ---------------------------------------------------------------------------

  private async fetchUSReports(symbol: string, periods: number): Promise<FinancialReportSummary[]> {
    const cik = await this.resolveCik(symbol);
    if (!cik) { return []; }

    // 取 XBRL Company Facts（含 Revenue / EPS / Gross Profit 等財務數據）
    const url = `${FinancialReportService.SEC_BASE}/api/xbrl/companyfacts/CIK${cik}.json`;
    const resp = await fetch(url, {
      headers: { 'User-Agent': 'StockHeatmapVSCodeExtension/1.0 (contact@example.com)' },
    });
    if (!resp.ok) { return []; }

    interface XbrlFact {
      end: string;
      val: number;
      form: string;
      accn: string;
      fp?: string;  // 財務期間：Q1/Q2/Q3/Q4/FY
      frame?: string;
    }
    interface XbrlConcept { units: { USD?: XbrlFact[]; shares?: XbrlFact[]; pure?: XbrlFact[] } }
    interface XbrlCompanyFacts {
      facts: {
        'us-gaap'?: {
          Revenues?: XbrlConcept;
          RevenueFromContractWithCustomerExcludingAssessedTax?: XbrlConcept;
          SalesRevenueNet?: XbrlConcept;
          EarningsPerShareBasic?: XbrlConcept;
          GrossProfit?: XbrlConcept;
          OperatingIncomeLoss?: XbrlConcept;
        }
      }
    }
    const facts = await resp.json() as XbrlCompanyFacts;

    const gaap = facts.facts?.['us-gaap'];
    if (!gaap) { return []; }

    // 抽取季度 Revenue（多個可能欄位，優先順序：Revenues > RevenueFromContract > SalesRevenueNet）
    const revenueSource =
      gaap.Revenues ??
      gaap.RevenueFromContractWithCustomerExcludingAssessedTax ??
      gaap.SalesRevenueNet;

    const revenueEntries = (revenueSource?.units?.USD ?? [])
      .filter((f) => (f.form === '10-Q' || f.form === '10-K') && f.end)
      .sort((a, b) => a.end.localeCompare(b.end));

    // EPS：units 可能在 USD（每股盈餘 USD），也可能在 shares（不常見）
    const epsSource = gaap.EarningsPerShareBasic;
    const epsEntries: XbrlFact[] = [
      ...(epsSource?.units?.USD ?? []),
      ...(epsSource?.units?.shares ?? []),
    ].filter(f => f.form === '10-Q' || f.form === '10-K');

    const gpEntries = (gaap.GrossProfit?.units?.USD ?? [])
      .filter(f => f.form === '10-Q' || f.form === '10-K');

    const opEntries = (gaap.OperatingIncomeLoss?.units?.USD ?? [])
      .filter(f => f.form === '10-Q' || f.form === '10-K');

    // 去重（相同 end 日期保留最新的 accn）
    const uniqueRevMap = new Map<string, XbrlFact>();
    for (const f of revenueEntries) {
      const existing = uniqueRevMap.get(f.end);
      if (!existing || f.accn > existing.accn) { uniqueRevMap.set(f.end, f); }
    }

    const recent = [...uniqueRevMap.values()]
      .sort((a, b) => a.end.localeCompare(b.end))
      .slice(-periods);

    return recent.map((rev): FinancialReportSummary => {
      const period = this.toQuarterPeriod(rev.end);
      const eps = epsEntries
        .filter(e => e.end === rev.end)
        .sort((a, b) => b.accn.localeCompare(a.accn))[0]; // 取最新申報
      const gp  = gpEntries
        .filter(e => e.end === rev.end)
        .sort((a, b) => b.accn.localeCompare(a.accn))[0];
      const op  = opEntries
        .filter(e => e.end === rev.end)
        .sort((a, b) => b.accn.localeCompare(a.accn))[0];

      return {
        symbol,
        period,
        revenue: rev.val,
        eps: eps?.val,
        grossMargin: (gp && rev.val > 0)
          ? Math.round((gp.val / rev.val) * 10000) / 100 : undefined,
        operatingMargin: (op && rev.val > 0)
          ? Math.round((op.val / rev.val) * 10000) / 100 : undefined,
        highlights: [],
        sourceUrls: [
          `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${cik}&type=10-Q&dateb=&owner=include&count=10`,
        ],
      };
    });
  }

  /** 將 EDGAR CIK 查詢（以 ticker symbol 對應）*/
  private async resolveCik(symbol: string): Promise<string | undefined> {
    // EDGAR 提供 company tickers JSON
    const tickerUrl = `${FinancialReportService.SEC_BASE}/files/company_tickers.json`;
    try {
      const resp = await fetch(tickerUrl, {
        headers: { 'User-Agent': 'StockHeatmapVSCodeExtension/1.0 (contact@example.com)' },
      });
      if (!resp.ok) { return undefined; }
      interface TickerEntry { cik_str: number; ticker: string; title: string }
      const json = await resp.json() as Record<string, TickerEntry>;
      const entry = Object.values(json).find(
        (e) => e.ticker.toUpperCase() === symbol.toUpperCase(),
      );
      if (!entry) { return undefined; }
      return String(entry.cik_str).padStart(10, '0');
    } catch {
      return undefined;
    }
  }

  // ---------------------------------------------------------------------------
  // 工具方法
  // ---------------------------------------------------------------------------

  /** 判斷台股還是美股 */
  private detectMarket(symbol: string): 'TW' | 'US' {
    return /^\d{4,6}$/.test(symbol) ? 'TW' : 'US';
  }

  /**
   * 結束日期 → 季度字串，例如 "2024-09-30" → "2024Q3"
   * 同時相容 FinMind 格式 "2024-09-30" 與 SEC EDGAR 格式 "2024-09-30"
   */
  private toQuarterPeriod(endDate: string): string {
    const d = new Date(endDate);
    if (isNaN(d.getTime())) { return endDate; }
    const q = Math.ceil((d.getMonth() + 1) / 3);
    return `${d.getFullYear()}Q${q}`;
  }

  /** 計算兩個 period 字串之間差幾個季度（僅支援 YYYYQq 格式） */
  private periodDiff(a: string, b: string): number {
    const parseQ = (s: string) => {
      const m = s.match(/^(\d{4})Q(\d)$/);
      return m ? parseInt(m[1]) * 4 + parseInt(m[2]) : 0;
    };
    return parseQ(a) - parseQ(b);
  }

  private getLookbackQuarters(): number {
    return vscode.workspace.getConfiguration('stockHeatmap').get<number>('financials.lookbackQuarters', 4);
  }
}
