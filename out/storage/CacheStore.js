"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CacheStore = void 0;
/**
 * CacheStore — 通用記憶體 + WorkspaceState 快取
 *
 * 依 TTL 自動過期，支援報價、新聞、LLM 回覆等各類資料快取。
 */
class CacheStore {
    constructor(context) {
        this.context = context;
        /** 記憶體快取（程序重啟即清空） */
        this.mem = new Map();
    }
    /** 取得快取；若不存在或已過期則回傳 undefined */
    get(key) {
        const entry = this.mem.get(key);
        if (!entry) {
            return undefined;
        }
        if (Date.now() > entry.expiry) {
            this.mem.delete(key);
            return undefined;
        }
        return entry.data;
    }
    /** 寫入記憶體快取 */
    set(key, data, ttlSec) {
        this.mem.set(key, { data, expiry: Date.now() + ttlSec * 1000 });
    }
    /** 清除指定 key */
    delete(key) {
        this.mem.delete(key);
    }
    /** 清除所有快取 */
    clear() {
        this.mem.clear();
    }
    /** 取得目前快取條目數（診斷用） */
    get size() {
        return this.mem.size;
    }
    // ---------------------------------------------------------------------------
    // 持久化快取（WorkspaceState，程式重啟後仍存在）
    // ---------------------------------------------------------------------------
    async getPersisted(key) {
        return this.context.workspaceState.get(key);
    }
    async setPersisted(key, data) {
        await this.context.workspaceState.update(key, data);
    }
    async deletePersisted(key) {
        await this.context.workspaceState.update(key, undefined);
    }
}
exports.CacheStore = CacheStore;
//# sourceMappingURL=CacheStore.js.map