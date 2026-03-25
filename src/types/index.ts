/**
 * Stock Heatmap VS Code Extension — 統一型別定義
 * 所有跨模組共用的 TypeScript 介面與型別別名均定義於此。
 */

// ---------------------------------------------------------------------------
// 6.1 Quote（自選股報價）
// ---------------------------------------------------------------------------
export interface Quote {
  symbol: string;
  name: string;
  price: number;
  change: number;
  changePercent: number;
  volume: number;
  updatedAt: string; // ISO 8601
}

// ---------------------------------------------------------------------------
// 6.2 Candle（K 線資料）
// ---------------------------------------------------------------------------
export interface Candle {
  time: string; // "YYYY-MM-DD" or ISO timestamp
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

// ---------------------------------------------------------------------------
// 6.3 HeatmapItem（熱力圖）
// ---------------------------------------------------------------------------
export interface HeatmapItem {
  sector: string;
  symbol: string;
  name: string;
  changePercent: number;
  score: number;
  // 選填：尺寸指標
  marketCap?: number;   // 總市值（元）
  turnover?: number;    // 成交額（元）
  volume?: number;      // 成交量（股）
  // 選填：多期別漲跌幅
  change5D?: number;
  change20D?: number;
  change60D?: number;
  change240D?: number;
  // 選填：市場別
  market?: 'TSE' | 'OTC' | string;
}

// ---------------------------------------------------------------------------
// 6.4 SignalResult + IndicatorSnapshot（技術指標與訊號）
// ---------------------------------------------------------------------------
export interface IndicatorSnapshot {
  sma5: number;
  sma20: number;
  rsi14: number;
  macd: number;
  macdSignal: number;
  bollingerUpper: number;
  bollingerLower: number;
}

export interface SignalResult {
  action: 'BUY' | 'SELL' | 'WATCH';
  confidence: number;
  reasons: string[];
  indicators: IndicatorSnapshot;
}

// ---------------------------------------------------------------------------
// 6.5 NewsItem（新聞）
// ---------------------------------------------------------------------------
export interface NewsItem {
  title: string;
  source: string;
  publishedAt: string; // ISO 8601
  url: string;
  summary: string;
  sentiment: 'positive' | 'negative' | 'neutral';
}

// ---------------------------------------------------------------------------
// 6.6 FinancialReportSummary（財報摘要）
// ---------------------------------------------------------------------------
export interface FinancialReportSummary {
  symbol: string;
  period: string; // e.g. "2024Q3" or "FY2024"
  revenue?: number;
  eps?: number;
  grossMargin?: number;
  operatingMargin?: number;
  netMargin?: number;
  revenueYoY?: number;
  revenueQoQ?: number;
  epsYoY?: number;
  epsQoQ?: number;
  guidance?: string[];
  highlights: string[];
  risks?: string[];
  sourceUrls?: string[];
}

// ---------------------------------------------------------------------------
// 6.7 ChartInsight（圖表分析說明）
// ---------------------------------------------------------------------------
export interface ChartInsight {
  title: string;
  summary: string;
  facts: string[];
  risks?: string[];
  relatedSignals?: string[];
  relatedEvents?: string[];
}

// ---------------------------------------------------------------------------
// 6.8 ChartInsightPayload（圖表說明輸入）
// ---------------------------------------------------------------------------
export interface ChartInsightPayload {
  symbol: string;
  timeframe: string;
  selectedRange?: {
    from: string;
    to: string;
  };
  candles: Candle[];
  indicators: IndicatorSnapshot;
  signal?: SignalResult;
  events?: CalendarEvent[];
  news?: NewsItem[];
  financials?: FinancialReportSummary[];
}

// ---------------------------------------------------------------------------
// 6.9 Recommendation（LLM 建議）
// ---------------------------------------------------------------------------
export interface Recommendation {
  action: 'BUY' | 'SELL' | 'WATCH';
  confidence: number;
  reason: string;
  disclaimer: string;
}

// ---------------------------------------------------------------------------
// 6.10 LlmEndpoint（模型端點）
// ---------------------------------------------------------------------------
export interface LlmEndpoint {
  id: string;
  provider: 'openai' | 'ollama' | 'copilot';
  label: string;
  model: string;
  baseUrl?: string;
  enabled: boolean;
  priority: number;
  tags?: string[];
}

// ---------------------------------------------------------------------------
// 6.11 ModelRecommendation（單模型分析結果）
// ---------------------------------------------------------------------------
export interface ModelRecommendation {
  endpointId: string;
  provider: 'openai' | 'ollama' | 'copilot';
  model: string;
  latencyMs: number;
  action: 'BUY' | 'SELL' | 'WATCH';
  confidence: number;
  reason: string;
  rawText?: string;
}

// ---------------------------------------------------------------------------
// 6.12 MergeStrategy（多模型彙總策略）
// ---------------------------------------------------------------------------
export type MergeStrategy = 'primary' | 'fallback' | 'majority' | 'weighted' | 'showAll';

// ---------------------------------------------------------------------------
// 6.13 LlmTeamConfig（固定協作組）
// ---------------------------------------------------------------------------
export interface LlmTeamConfig {
  id: string;
  name: string;
  enabled: boolean;
  members: Array<{
    endpointId: string;
    role: 'primary' | 'reviewer' | 'risk-checker' | 'tie-breaker';
    weight: number;
    timeoutMs?: number;
  }>;
  mergeStrategy: MergeStrategy;
  fallbackTeamId?: string;
}

// ---------------------------------------------------------------------------
// 6.14 TeamRecommendation（協作組結果）
// ---------------------------------------------------------------------------
export interface TeamRecommendation {
  teamId: string;
  final: Recommendation;
  members: ModelRecommendation[];
  disagreements?: string[];
}

// ---------------------------------------------------------------------------
// 6.15 AlertRule（提醒規則）
// ---------------------------------------------------------------------------
export interface AlertRule {
  id: string;
  symbol: string;
  enabled: boolean;
  type: 'price' | 'changePercent' | 'volume' | 'indicator' | 'news' | 'calendar';
  operator: '>' | '<' | '>=' | '<=' | 'crossesAbove' | 'crossesBelow' | 'contains';
  target: string;
  value: number | string;
  cooldownSec: number;
  severity: 'info' | 'warning' | 'critical';
  lastTriggeredAt?: string; // ISO 8601
}

// ---------------------------------------------------------------------------
// 6.16 ScreenerPreset（選股條件）
// ---------------------------------------------------------------------------
export interface ScreenerPreset {
  id: string;
  name: string;
  scope: 'watchlist' | 'market';
  conditions: Array<{
    field: string;
    operator: '>' | '<' | '>=' | '<=' | '=' | 'between';
    value: number | string | [number, number];
  }>;
  sortBy: 'changePercent' | 'volume' | 'rsi14' | 'score';
}

// ---------------------------------------------------------------------------
// 6.17 CalendarEvent（事件日曆）
// ---------------------------------------------------------------------------
export interface CalendarEvent {
  id: string;
  symbol?: string;
  market: 'TW' | 'US' | 'GLOBAL';
  category: 'earnings' | 'dividend' | 'conference' | 'macro' | 'holiday';
  title: string;
  startsAt: string; // ISO 8601
  importance: 'low' | 'medium' | 'high';
  source: string;
}

// ---------------------------------------------------------------------------
// 6.18 PortfolioPosition（投組觀察）
// ---------------------------------------------------------------------------
export interface PortfolioPosition {
  symbol: string;
  quantity: number;
  avgCost: number;
  currency: 'TWD' | 'USD';
  note?: string;
}

// ---------------------------------------------------------------------------
// 6.19 SnapshotReport（匯出快照）
// ---------------------------------------------------------------------------
export interface SnapshotReport {
  symbol: string;
  generatedAt: string; // ISO 8601
  chartImagePath?: string;
  indicators: IndicatorSnapshot;
  signal: SignalResult;
  news: NewsItem[];
  recommendation?: Recommendation;
}

// ---------------------------------------------------------------------------
// 輔助型別（跨模組使用）
// ---------------------------------------------------------------------------

/** LLM 分析模式 */
export type LlmMode = 'single' | 'fallback' | 'parallel' | 'consensus';

/** 圖表說明模式 */
export type ChartInsightMode = 'local' | 'llm' | 'hybrid';

/** 市場代碼 */
export type Market = 'TW' | 'US';

/** 圖表時間框架 */
export type Timeframe = '1D' | '4H' | '1H' | '15m';
