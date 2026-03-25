import * as vscode from 'vscode';
import { CalendarEvent, Market } from '../types';

/**
 * EventCalendarService — 聚合股票與總經事件
 * 將事件映射到圖表與提醒邏輯
 *
 * 實作里程碑：M2（基礎）/ 第二階段功能
 */
export class EventCalendarService {
  constructor(private readonly context: vscode.ExtensionContext) {}

  /**
   * 取得即將到來的事件
   * @param symbols      關注的股票代碼（空陣列 = 只取總經事件）
   * @param lookaheadDays 預讀天數
   */
  async getUpcomingEvents(symbols: string[], lookaheadDays?: number): Promise<CalendarEvent[]> {
    throw new Error('EventCalendarService.getUpcomingEvents — 尚未實作');
  }

  /**
   * 取得指定時間範圍內的事件（供圖表標記用）
   */
  async getEventsInRange(symbols: string[], from: string, to: string): Promise<CalendarEvent[]> {
    throw new Error('EventCalendarService.getEventsInRange — 尚未實作');
  }

  private getLookaheadDays(): number {
    return vscode.workspace.getConfiguration('stockHeatmap').get<number>('calendar.lookaheadDays', 14);
  }
}
