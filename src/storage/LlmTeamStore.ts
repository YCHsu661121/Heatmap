import * as vscode from 'vscode';
import { LlmTeamConfig } from '../types';

const STORE_KEY = 'stockHeatmap.llmTeams';

/**
 * LlmTeamStore — 持久化固定 LLM 協作組設定
 *
 * 使用 VS Code GlobalState 儲存，重啟後仍保留。
 * 實作里程碑：M5
 */
export class LlmTeamStore {
  constructor(private readonly context: vscode.ExtensionContext) {}

  /** 取得所有已儲存的協作組 */
  async getAll(): Promise<LlmTeamConfig[]> {
    return this.context.globalState.get<LlmTeamConfig[]>(STORE_KEY, []);
  }

  /** 取得指定 ID 的協作組；不存在時回傳 undefined */
  async getById(id: string): Promise<LlmTeamConfig | undefined> {
    const all = await this.getAll();
    return all.find((t) => t.id === id);
  }

  /** 新增或更新協作組（以 id 為 key） */
  async save(team: LlmTeamConfig): Promise<void> {
    const all = await this.getAll();
    const idx = all.findIndex((t) => t.id === team.id);
    if (idx >= 0) {
      all[idx] = team;
    } else {
      all.push(team);
    }
    await this.context.globalState.update(STORE_KEY, all);
  }

  /** 刪除指定 ID 的協作組 */
  async delete(id: string): Promise<void> {
    const all = await this.getAll();
    const filtered = all.filter((t) => t.id !== id);
    await this.context.globalState.update(STORE_KEY, filtered);
  }

  /** 取得目前預設協作組 ID（讀取使用者設定） */
  getDefaultTeamId(): string {
    return vscode.workspace.getConfiguration('stockHeatmap').get<string>('llm.defaultTeamId', '');
  }

  /** 設定預設協作組 ID */
  async setDefaultTeamId(id: string): Promise<void> {
    await vscode.workspace.getConfiguration('stockHeatmap').update(
      'llm.defaultTeamId',
      id,
      vscode.ConfigurationTarget.Global,
    );
  }
}
