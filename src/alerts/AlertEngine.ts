import * as vscode from 'vscode';
import { AlertRule, Quote, SignalResult } from '../types';

/** 已觸發的提醒紀錄 */
export interface TriggeredAlert {
  rule: AlertRule;
  triggeredAt: string; // ISO 8601
  previousValue: number | string;
  currentValue: number | string;
  message: string;
}

/**
 * AlertEngine — 條件式提醒系統
 *
 * 分工原則（4.1）：
 *   - 條件判斷、cooldown 管理均為本地 deterministic 邏輯
 *   - 不使用 LLM 判斷是否觸發提醒
 *
 * 實作里程碑：第二階段（Alert Center P1）
 */
export class AlertEngine {
  /** key = rule.id, value = 最後觸發時間（ms） */
  private lastTriggered = new Map<string, number>();

  constructor(private readonly context: vscode.ExtensionContext) {}

  /**
   * 根據最新報價與訊號結果，檢查所有啟用的提醒規則
   * @returns 本次觸發的提醒清單（空陣列表示無觸發）
   */
  checkAlerts(
    quotes: Quote[],
    signals: Map<string, SignalResult>,
    rules: AlertRule[],
  ): TriggeredAlert[] {
    throw new Error('AlertEngine.checkAlerts — 尚未實作（第二階段）');
  }

  /**
   * 判斷某條規則是否在 cooldown 中
   */
  private isInCooldown(rule: AlertRule): boolean {
    const last = this.lastTriggered.get(rule.id);
    if (!last) { return false; }
    return Date.now() - last < rule.cooldownSec * 1000;
  }

  /**
   * 記錄觸發時間
   */
  private markTriggered(ruleId: string): void {
    this.lastTriggered.set(ruleId, Date.now());
  }
}
