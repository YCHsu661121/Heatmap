import { test, expect } from '@playwright/test';

const VSC_LAUNCH_ARGS = [
  '--disable-updates',
  '--disable-workspace-trust',
  '--extensionDevelopmentPath=${workspaceFolder}',
  '--extensionTestsPath=${workspaceFolder}/test/e2e',
];

test.describe('Stock Heatmap Extension', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('vscode://vscode.env/app');
    await page.waitForTimeout(2000); // Wait for VS Code to load
  });

  test('should show Stock Heatmap view container', async ({ page }) => {
    const activityBar = page.locator('.activitybar');
    await expect(activityBar).toBeVisible();
    
    const stockHeatmapButton = activityBar.locator('a[title="Stock Heatmap"]');
    await expect(stockHeatmapButton).toBeVisible();
    
    await stockHeatmapButton.click();
    
    const viewContainer = page.locator('.sidebar .stock-heatmap-view');
    await expect(viewContainer).toBeVisible();
  });

  test('should add stock to watchlist', async ({ page }) => {
    await page.click('.sidebar .stock-heatmap-view .add-stock-button');
    
    const input = page.locator('.quick-input-input');
    await input.fill('2330');
    await page.keyboard.press('Enter');
    
    const stockItem = page.locator('.stock-heatmap-view .stock-item:has-text("2330")');
    await expect(stockItem).toBeVisible();
  });

  test('should open dashboard for selected stock', async ({ page }) => {
    await page.click('.stock-heatmap-view .stock-item:has-text("2330")');
    
    const dashboard = page.locator('.webview-container.dashboard-panel');
    await expect(dashboard).toBeVisible({ timeout: 10000 });
    
    const title = dashboard.locator('.stock-title');
    await expect(title).toContainText('2330');
  });

  test('should trigger LLM analysis', async ({ page }) => {
    await page.click('.stock-heatmap-view .stock-item:has-text("2330")');
    
    const dashboard = page.locator('.webview-container.dashboard-panel');
    await dashboard.waitFor();
    
    const llmButton = dashboard.locator('.llm-analyze-button');
    await llmButton.click();
    
    const analysisResult = dashboard.locator('.llm-analysis-result');
    await expect(analysisResult).toBeVisible({ timeout: 30000 });
  });
});