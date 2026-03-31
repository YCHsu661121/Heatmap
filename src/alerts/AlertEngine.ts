import * as vscode from 'vscode';
import { AlertRule, Quote, SignalResult, NewsItem } from '../types';

/** 已觸發的提醒紀錄 */
export interface TriggeredAlert {
  rule: AlertRule;
  triggeredAt: string; // ISO 8601
  previousValue: number | string;
  currentValue: number | string;
  message: string;
}

type PrevSnap = Record<string, number>; // sma5, sma20, rsi14, macd, macdSignal

/**
 * AlertEngine — 條件式提醒系統（Alert Center P1）
 *
 * 支援提醒類型：
 *   price        — 股價突破閾值（> < >= <=）
 *   changePercent— 漲跌幅達標（> < >= <=）
 *   volume       — 成交量達標（> < >= <=）
 *   indicator    — 技術指標條件（rsi14 < 30、sma5 crossesAbove sma20 等）
 *   news         — 新聞情緒或關鍵字（contains / sentiment = negative）
 *
 * 分工原則（4.1）：所有條件判斷、cooldown 均為本地 deterministic 邏輯，不使用 LLM。
 */
export class AlertEngine {
  /** key = rule.id, value = 最後觸發時間（ms） */
  private readonly lastTriggered = new Map<string, number>();
  /** 上一次各股票的指標快照（用於偵測交叉方向） */
  private readonly prevIndicators = new Map<string, PrevSnap>();
  /** 所有歷史提醒（in-memory，VS Code 重啟後清空） */
  private readonly history: TriggeredAlert[] = [];

  constructor(private readonly context: vscode.ExtensionContext) {}

  // ---------------------------------------------------------------------------
  // 公開 API
  // ---------------------------------------------------------------------------

  /**
   * 根據最新報價與訊號結果，檢查所有啟用的提醒規則並派送 VS Code 通知。
   * @param quotes      最新報價清單
   * @param signals     各股票的最新技術指標 + 訊號（key = symbol）
   * @param rules       目前全部提醒規則
   * @param recentNews  選填：最近新聞（用於 'news' 類型提醒）
   * @returns 本次觸發的提醒清單
   */
  checkAlerts(
    quotes: Quote[],
    signals: Map<string, SignalResult>,
    rules: AlertRule[],
    recentNews?: Map<string, NewsItem[]>, // key = symbol
  ): TriggeredAlert[] {
    const triggered: TriggeredAlert[] = [];

    for (const rule of rules) {
      if (!rule.enabled) { continue; }
      if (this.isInCooldown(rule)) { continue; }

      const quote = quotes.find(q => q.symbol === rule.symbol);
      const sig   = signals.get(rule.symbol);
      let alert: TriggeredAlert | undefined;

      switch (rule.type) {
        case 'price':
          if (quote) { alert = this.checkNumeric(rule, quote.price) ?? undefined; }
          break;
        case 'changePercent':
          if (quote) { alert = this.checkNumeric(rule, quote.changePercent) ?? undefined; }
          break;
        case 'volume':
          if (quote) { alert = this.checkNumeric(rule, quote.volume) ?? undefined; }
          break;
        case 'indicator':
          if (sig)   { alert = this.checkIndicator(rule, sig) ?? undefined; }
          break;
        case 'news':
          if (recentNews) {
            const items = recentNews.get(rule.symbol) ?? [];
            alert = this.checkNews(rule, items) ?? undefined;
          }
          break;
      }

      if (alert) {
        triggered.push(alert);
        this.history.push(alert);
        this.markTriggered(rule.id);
        this.dispatchNotification(alert);
      }
    }

    // 在檢查結束後更新前一期指標快照（避免同一次的交叉被漏掉）
    for (const [sym, sig] of signals) {
      this.prevIndicators.set(sym, {
        sma5:       sig.indicators.sma5,
        sma20:      sig.indicators.sma20,
        rsi14:      sig.indicators.rsi14,
        macd:       sig.indicators.macd,
        macdSignal: sig.indicators.macdSignal,
      });
    }

    return triggered;
  }

  /** 取得提醒歷史（最多 100 筆） */
  getHistory(): TriggeredAlert[] {
    return this.history.slice(-100);
  }

  /** 清除提醒歷史 */
  clearHistory(): void {
    this.history.length = 0;
  }

  /** 從 globalState 載入提醒規則 */
  getRules(): AlertRule[] {
    return this.context.globalState.get<AlertRule[]>('alertRules', []);
  }

  /** 儲存提醒規則到 globalState */
  async saveRules(rules: AlertRule[]): Promise<void> {
    await this.context.globalState.update('alertRules', rules);
  }

  /** 新增一條規則 */
  async addRule(rule: AlertRule): Promise<void> {
    const rules = this.getRules();
    rules.push(rule);
    await this.saveRules(rules);
  }

  /** 刪除一條規則（by id） */
  async deleteRule(id: string): Promise<void> {
    const rules = this.getRules().filter(r => r.id !== id);
    await this.saveRules(rules);
  }

  // ---------------------------------------------------------------------------
  // 私有：條件判斷
  // ---------------------------------------------------------------------------

  private checkNumeric(rule: AlertRule, current: number): TriggeredAlert | null {
    const threshold = Number(rule.value);
    if (!Number.isFinite(threshold) || !Number.isFinite(current)) { return null; }
    let hit = false;
    switch (rule.operator) {
      case '>':  hit = current > threshold; break;
      case '<':  hit = current < threshold; break;
      case '>=': hit = current >= threshold; break;
      case '<=': hit = current <= threshold; break;
      default: return null;
    }
    if (!hit) { return null; }
    return this.buildAlert(rule, threshold, current, this.formatNumericMsg(rule, current));
  }

  private checkIndicator(rule: AlertRule, sig: SignalResult): TriggeredAlert | null {
    const target    = rule.target;   // 'rsi14' | 'sma5' | 'sma20' | 'macd' ...
    const snap      = sig.indicators as unknown as Record<string, number>;
    const current   = snap[target];
    if (current === undefined || !Number.isFinite(current)) { return null; }

    const threshold = Number(rule.value);
    const prev      = this.prevIndicators.get(rule.symbol);
    const prevVal   = prev?.[target];
    let hit = false;

    switch (rule.operator) {
      case '>':  hit = current > threshold; break;
      case '<':  hit = current < threshold; break;
      case '>=': hit = current >= threshold; break;
      case '<=': hit = current <= threshold; break;

      // SMA5 crossesAbove/crossesBelow：實際是 SMA5 vs SMA20 交叉
      case 'crossesAbove':
        if (target === 'sma5') {
          // 黃金交叉：上一期 sma5 <= sma20，本期 sma5 > sma20
          hit = prev !== undefined
            && prev['sma5'] <= prev['sma20']
            && sig.indicators.sma5 > sig.indicators.sma20;
        } else {
          hit = prevVal !== undefined && prevVal <= threshold && current > threshold;
        }
        break;
      case 'crossesBelow':
        if (target === 'sma5') {
          // 死亡交叉：上一期 sma5 >= sma20，本期 sma5 < sma20
          hit = prev !== undefined
            && prev['sma5'] >= prev['sma20']
            && sig.indicators.sma5 < sig.indicators.sma20;
        } else {
          hit = prevVal !== undefined && prevVal >= threshold && current < threshold;
        }
        break;
      default: return null;
    }

    if (!hit) { return null; }
    return this.buildAlert(rule, prevVal ?? current, current, this.formatIndicatorMsg(rule, current, sig));
  }

  private checkNews(rule: AlertRule, items: NewsItem[]): TriggeredAlert | null {
    if (items.length === 0) { return null; }

    if (rule.operator === 'contains') {
      const keyword = String(rule.value).toLowerCase();
      const match = items.find(n =>
        n.title.toLowerCase().includes(keyword) ||
        (n.summary ?? '').toLowerCase().includes(keyword),
      );
      if (!match) { return null; }
      const msg = `[${rule.symbol}] 新聞含「${rule.value}」：${match.title.slice(0, 60)}`;
      return this.buildAlert(rule, '', match.title.slice(0, 60), msg);
    }

    // sentiment 比對（target = 'sentiment'，value = 'positive'|'negative'|'neutral'）
    const match = items.find(n => n.sentiment === rule.value);
    if (!match) { return null; }
    const label = { positive: '正面', negative: '負面', neutral: '中性' }[String(rule.value)] ?? String(rule.value);
    const msg = `[${rule.symbol}] 偵測到${label}新聞：${match.title.slice(0, 60)}`;
    return this.buildAlert(rule, '', match.title.slice(0, 60), msg);
  }

  // ---------------------------------------------------------------------------
  // 私有：格式化與通知
  // ---------------------------------------------------------------------------

  private buildAlert(
    rule: AlertRule,
    prev: number | string,
    current: number | string,
    message: string,
  ): TriggeredAlert {
    return { rule, triggeredAt: new Date().toISOString(), previousValue: prev, currentValue: current, message };
  }

  private formatNumericMsg(rule: AlertRule, current: number): string {
    const typeLabel: Record<string, string> = {
      price: '股價', changePercent: '漲跌幅 %', volume: '成交量',
    };
    const opLabel: Record<string, string> = { '>': '>', '<': '<', '>=': '≥', '<=': '≤' };
    const unit = rule.type === 'changePercent' ? '%' : '';
    return `[${rule.symbol}] ${typeLabel[rule.type] ?? rule.type} ${opLabel[rule.operator] ?? rule.operator} ${rule.value}${unit}（目前 ${current.toFixed(2)}${unit}）`;
  }

  private formatIndicatorMsg(rule: AlertRule, current: number, sig: SignalResult): string {
    const labels: Record<string, string> = {
      rsi14: 'RSI14', sma5: 'SMA5', sma20: 'SMA20', macd: 'MACD', macdSignal: 'MACD訊號',
    };
    const label = labels[rule.target] ?? rule.target;
    if (rule.operator === 'crossesAbove' && rule.target === 'sma5') {
      return `[${rule.symbol}] 🟢 均線黃金交叉：SMA5(${sig.indicators.sma5.toFixed(2)}) 上穿 SMA20(${sig.indicators.sma20.toFixed(2)})`;
    }
    if (rule.operator === 'crossesBelow' && rule.target === 'sma5') {
      return `[${rule.symbol}] 🔴 均線死亡交叉：SMA5(${sig.indicators.sma5.toFixed(2)}) 下穿 SMA20(${sig.indicators.sma20.toFixed(2)})`;
    }
    if (rule.operator === 'crossesAbove') {
      return `[${rule.symbol}] ${label} 向上穿越 ${rule.value}（目前 ${current.toFixed(2)}）`;
    }
    if (rule.operator === 'crossesBelow') {
      return `[${rule.symbol}] ${label} 向下穿越 ${rule.value}（目前 ${current.toFixed(2)}）`;
    }
    const opLabel: Record<string, string> = { '>': '>', '<': '<', '>=': '≥', '<=': '≤' };
    return `[${rule.symbol}] ${label} ${opLabel[rule.operator] ?? rule.operator} ${rule.value}（目前 ${current.toFixed(2)}）`;
  }

  private dispatchNotification(alert: TriggeredAlert): void {
    const msg   = alert.message;
    const sev   = alert.rule.severity;
    const show  = sev === 'critical'
      ? vscode.window.showErrorMessage
      : sev === 'warning'
        ? vscode.window.showWarningMessage
        : vscode.window.showInformationMessage;
    const icon  = sev === 'critical' ? '🔴' : sev === 'warning' ? '🟡' : '🔔';
    // 通知帶「關閉」按鈕，不影響主流程
    show(`${icon} ${msg}`).then(() => {});
  }

  // ---------------------------------------------------------------------------
  // 私有：cooldown 管理
  // ---------------------------------------------------------------------------

  private isInCooldown(rule: AlertRule): boolean {
    const last = this.lastTriggered.get(rule.id);
    if (!last) { return false; }
    return Date.now() - last < rule.cooldownSec * 1000;
  }

  private markTriggered(ruleId: string): void {
    this.lastTriggered.set(ruleId, Date.now());
  }
}
