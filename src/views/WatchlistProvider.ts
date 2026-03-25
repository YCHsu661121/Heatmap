import * as vscode from 'vscode';
import { Quote } from '../types';
import { MarketDataService } from '../services/MarketDataService';

/**
 * WatchlistProvider — Sidebar TreeView 資料源
 * 定期向 MarketDataService 拉取報價並顯示漲跌幅
 */
export class WatchlistProvider implements vscode.TreeDataProvider<WatchlistItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<WatchlistItem | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private quotes = new Map<string, Quote>();
  private timer: ReturnType<typeof setInterval> | undefined;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly marketDataService: MarketDataService,
  ) {
    // 初始化時立即拉一次
    this.loadQuotes();
    // 每分鐘自動刷新
    this.timer = setInterval(() => this.loadQuotes(), 60_000);
    context.subscriptions.push({ dispose: () => clearInterval(this.timer) });
  }

  refresh(): void {
    this.loadQuotes();
  }

  private async loadQuotes(): Promise<void> {
    const config = vscode.workspace.getConfiguration('stockHeatmap');
    const watchlist: string[] = config.get('watchlist', []);
    if (watchlist.length === 0) { return; }

    try {
      const quotes = await this.marketDataService.getQuotes(watchlist);
      this.quotes.clear();
      for (const q of quotes) { this.quotes.set(q.symbol, q); }
    } catch {
      // 靜默失敗，保留上一次快取
    }
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: WatchlistItem): vscode.TreeItem {
    return element;
  }

  getChildren(): WatchlistItem[] {
    const config = vscode.workspace.getConfiguration('stockHeatmap');
    const watchlist: string[] = config.get('watchlist', []);
    return watchlist.map((symbol) => {
      const q = this.quotes.get(symbol);
      return new WatchlistItem(symbol, q);
    });
  }
}

class WatchlistItem extends vscode.TreeItem {
  constructor(public readonly symbol: string, quote?: Quote) {
    super(symbol, vscode.TreeItemCollapsibleState.None);
    this.tooltip = symbol;
    this.contextValue = 'watchlistItem';
    this.command = {
      command: 'stockHeatmap.openDashboard',
      title: '開啟圖表',
      arguments: [symbol],
    };

    if (quote) {
      const pct = quote.changePercent;
      const sign = pct >= 0 ? '+' : '';
      this.description = `${quote.price.toFixed(2)}  ${sign}${pct.toFixed(2)}%`;
      this.iconPath = new vscode.ThemeIcon(
        pct >= 0.1 ? 'arrow-up' : pct <= -0.1 ? 'arrow-down' : 'dash',
        new vscode.ThemeColor(pct >= 0.1 ? 'charts.green' : pct <= -0.1 ? 'charts.red' : 'foreground'),
      );
    } else {
      this.description = '—';
    }
  }
}

