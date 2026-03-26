import * as vscode from 'vscode';
import { Quote } from '../types';
import { MarketDataService } from '../services/MarketDataService';

export interface WatchlistEntry {
  symbol: string;
  name: string;
  group: string;
}

/** 將舊版 string[] 或新版 WatchlistEntry[] 統一正規化 */
export function normalizeWatchlist(raw: unknown[]): WatchlistEntry[] {
  return raw.map((e) =>
    typeof e === 'string'
      ? { symbol: (e as string).toUpperCase(), name: e as string, group: '預設' }
      : (e as WatchlistEntry),
  );
}

type WatchlistNode = WatchlistGroupItem | WatchlistStockItem;

/**
 * WatchlistProvider — Sidebar TreeView 資料源
 * 兩層結構：群組 → 股票
 * 定期向 MarketDataService 拉取報價並顯示漲跌幅
 */
export class WatchlistProvider implements vscode.TreeDataProvider<WatchlistNode> {
  private _onDidChangeTreeData = new vscode.EventEmitter<WatchlistNode | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private quotes = new Map<string, Quote>();
  private timer: ReturnType<typeof setInterval> | undefined;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly marketDataService: MarketDataService,
  ) {
    this.loadQuotes();
    this.startTimer();
    context.subscriptions.push({ dispose: () => clearInterval(this.timer) });
    // 監聽使用者修改刷新間隔設定，即時套用新計時器
    context.subscriptions.push(
      vscode.workspace.onDidChangeConfiguration(e => {
        if (e.affectsConfiguration('stockHeatmap.refreshIntervalSec')) {
          clearInterval(this.timer);
          this.startTimer();
        }
      }),
    );
  }

  private getIntervalMs(): number {
    const sec = vscode.workspace.getConfiguration('stockHeatmap').get<number>('refreshIntervalSec', 30);
    return Math.max(10, sec) * 1000;
  }

  private startTimer(): void {
    this.timer = setInterval(() => this.loadQuotes(), this.getIntervalMs());
  }

  refresh(): void {
    this.loadQuotes();
  }

  private async loadQuotes(): Promise<void> {
    const config = vscode.workspace.getConfiguration('stockHeatmap');
    const raw: unknown[] = config.get('watchlist', []);
    const entries = normalizeWatchlist(raw);
    const symbols = entries.map((e) => e.symbol);
    if (symbols.length === 0) { return; }

    // 補查中文名稱：凡 name === symbol 的項目都向 MarketDataService 查詢
    const needName = entries.filter((e) => e.name === e.symbol);
    if (needName.length > 0) {
      const fetched = await Promise.allSettled(
        needName.map((e) => this.marketDataService.getStockName(e.symbol)),
      );
      let updated = false;
      fetched.forEach((result, i) => {
        const name = result.status === 'fulfilled' ? result.value.trim() : '';
        if (name && name !== needName[i].symbol) {
          needName[i].name = name;
          updated = true;
        }
      });
      if (updated) {
        await config.update('watchlist', entries, vscode.ConfigurationTarget.Global);
      }
    }

    try {
      const quotes = await this.marketDataService.getQuotes(symbols);
      this.quotes.clear();
      for (const q of quotes) { this.quotes.set(q.symbol, q); }
    } catch {
      // 靜默失敗，保留上一次快取
    }
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: WatchlistNode): vscode.TreeItem {
    return element;
  }

  getChildren(element?: WatchlistNode): WatchlistNode[] {
    // 第二層：展開群組，回傳股票節點
    if (element instanceof WatchlistGroupItem) {
      return element.entries.map(
        (entry) => new WatchlistStockItem(entry, this.quotes.get(entry.symbol)),
      );
    }

    // 第一層：回傳群組節點
    const config = vscode.workspace.getConfiguration('stockHeatmap');
    const entries = normalizeWatchlist(config.get('watchlist', []));

    const groupMap = new Map<string, WatchlistEntry[]>();
    for (const entry of entries) {
      const g = entry.group || '預設';
      if (!groupMap.has(g)) { groupMap.set(g, []); }
      groupMap.get(g)!.push(entry);
    }

    return Array.from(groupMap.entries()).map(
      ([name, items]) => new WatchlistGroupItem(name, items),
    );
  }
}

// ── 群組節點 ─────────────────────────────────────────────────────────────────
export class WatchlistGroupItem extends vscode.TreeItem {
  constructor(
    public readonly groupName: string,
    public readonly entries: WatchlistEntry[],
  ) {
    super(groupName, vscode.TreeItemCollapsibleState.Expanded);
    this.contextValue = 'watchlistGroup';
    this.iconPath = new vscode.ThemeIcon('folder-opened');
    this.description = `${entries.length} 支`;
    this.tooltip = groupName;
  }
}

// ── 股票節點 ─────────────────────────────────────────────────────────────────
export class WatchlistStockItem extends vscode.TreeItem {
  constructor(public readonly entry: WatchlistEntry, quote?: Quote) {
    // 若有中文名稱則用名稱當 label，否則用代碼
    const hasName = entry.name && entry.name !== entry.symbol;
    super(hasName ? entry.name : entry.symbol, vscode.TreeItemCollapsibleState.None);
    this.contextValue = 'watchlistItem';
    this.tooltip = `${entry.name}（${entry.symbol}）`;
    this.command = {
      command: 'stockHeatmap.openDashboard',
      title: '開啟圖表',
      arguments: [entry.symbol],
    };

    if (quote) {
      const pct = quote.changePercent;
      const sign = pct >= 0 ? '+' : '';
      const symPart = hasName ? `${entry.symbol}  ` : '';
      this.description = `${symPart}${quote.price.toFixed(2)}  ${sign}${pct.toFixed(2)}%`;
      this.iconPath = new vscode.ThemeIcon(
        pct >= 0.1 ? 'arrow-up' : pct <= -0.1 ? 'arrow-down' : 'dash',
        new vscode.ThemeColor(
          pct >= 0.1 ? 'charts.green' : pct <= -0.1 ? 'charts.red' : 'foreground',
        ),
      );
    } else {
      this.description = hasName ? entry.symbol : '—';
    }
  }
}

