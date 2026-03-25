import * as vscode from 'vscode';

/**
 * CacheStore — 通用記憶體 + WorkspaceState 快取
 *
 * 依 TTL 自動過期，支援報價、新聞、LLM 回覆等各類資料快取。
 */
export class CacheStore {
  /** 記憶體快取（程序重啟即清空） */
  private readonly mem = new Map<string, { data: unknown; expiry: number }>();

  constructor(private readonly context: vscode.ExtensionContext) {}

  /** 取得快取；若不存在或已過期則回傳 undefined */
  get<T>(key: string): T | undefined {
    const entry = this.mem.get(key);
    if (!entry) { return undefined; }
    if (Date.now() > entry.expiry) {
      this.mem.delete(key);
      return undefined;
    }
    return entry.data as T;
  }

  /** 寫入記憶體快取 */
  set(key: string, data: unknown, ttlSec: number): void {
    this.mem.set(key, { data, expiry: Date.now() + ttlSec * 1000 });
  }

  /** 清除指定 key */
  delete(key: string): void {
    this.mem.delete(key);
  }

  /** 清除所有快取 */
  clear(): void {
    this.mem.clear();
  }

  /** 取得目前快取條目數（診斷用） */
  get size(): number {
    return this.mem.size;
  }

  // ---------------------------------------------------------------------------
  // 持久化快取（WorkspaceState，程式重啟後仍存在）
  // ---------------------------------------------------------------------------

  async getPersisted<T>(key: string): Promise<T | undefined> {
    return this.context.workspaceState.get<T>(key);
  }

  async setPersisted<T>(key: string, data: T): Promise<void> {
    await this.context.workspaceState.update(key, data);
  }

  async deletePersisted(key: string): Promise<void> {
    await this.context.workspaceState.update(key, undefined);
  }
}
