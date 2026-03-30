import * as vscode from 'vscode';
import {
  Recommendation, ModelRecommendation, MergeStrategy,
  LlmTeamConfig, TeamRecommendation,
  ChartInsight, ChartInsightPayload,
  LlmEndpoint,
} from '../types';
import { LlmTeamStore } from '../storage/LlmTeamStore';

/** LLMOrchestrator 接受的分析輸入 */
export interface AnalysisPayload {
  symbol: string;
  market: 'TW' | 'US';
  timeframe: string;
  trend: string;
  signal: string;
  rsi14: number;
  macdState: string;
  maState: string;
  breakoutState: string;
  newsList: Array<{ title: string; summary: string; publishedAt: string }>;
}

type TeamMemberConfig = LlmTeamConfig['members'][number];

/** JSON 結構化回傳型別 */
interface LlmJsonResponse {
  action: 'BUY' | 'SELL' | 'WATCH';
  confidence: number;   // 0.0 – 1.0
  reason: string;
}

/**
 * LLMOrchestrator — 多模型分析路由
 *
 * 支援的 Provider：
 *   - OpenAI（openai npm 套件）
 *   - Ollama（多個 HTTP 節點，priority / failover）
 *   - GitHub Copilot（vscode.lm.selectChatModels）
 *
 * 分工原則（4.1）：
 *   - LLM 不計算技術指標
 *   - LLM 只解讀本地已計算的事實
 *   - 無資料或模型失敗時回傳保守 WATCH 建議
 */
export class LLMOrchestrator {
  private static readonly DISCLAIMER =
    '以上分析僅供參考，不構成任何投資建議。投資有風險，決策前請自行研判。';
  private static readonly SYSTEM_PROMPT =
    `你是一位量化分析師助理。根據提供的技術指標摘要與近期新聞，
輸出嚴格的 JSON 格式：{"action":"BUY"|"SELL"|"WATCH","confidence":0.0至1.0,"reason":"精簡理由（中文，不超過80字）"}。
禁止輸出任何 JSON 以外的文字。若資料不足，輸出 {"action":"WATCH","confidence":0.3,"reason":"資料不足，暫觀望"}。`;
  private static readonly ROLE_PROMPTS: Record<NonNullable<TeamMemberConfig['role']>, string> = {
    primary: '你是主分析師。請整合技術面、新聞面與風險，產出平衡且可執行的結論。',
    reviewer: '你是複核分析師。請主動找出主結論的漏洞、反例與矛盾之處。',
    'risk-checker': '你是風險官。請優先關注下行風險、事件風險、資料不足與過度自信。',
    'tie-breaker': '你是裁決者。當訊號互相衝突時，請偏保守並清楚說明採信依據。',
  };

  private readonly teamStore: LlmTeamStore;

  constructor(private readonly context: vscode.ExtensionContext) {
    this.teamStore = new LlmTeamStore(context);
  }

  // ---------------------------------------------------------------------------
  // 單模型建議
  // ---------------------------------------------------------------------------

  async getRecommendation(payload: AnalysisPayload): Promise<Recommendation> {
    const config = vscode.workspace.getConfiguration('stockHeatmap');
    const mode = config.get<string>('llm.mode', 'copilot');
    const endpoints = this.getEndpoints();

    let result: LlmJsonResponse | undefined;
    const t0 = Date.now();

    try {
      if (mode === 'openai') {
        result = await this.callOpenAI(payload, endpoints);
      } else if (mode === 'ollama') {
        result = await this.callOllama(payload, endpoints);
      } else {
        // 'copilot' or fallback
        result = await this.callCopilot(payload);
      }
    } catch {
      // 失敗時使用 conservative fallback
    }

    if (!result) {
      return this.conservativeFallback('LLM 不可用或回傳格式錯誤，暫採觀望策略');
    }

    return {
      action: result.action,
      confidence: Math.min(1, Math.max(0, result.confidence)),
      reason: result.reason,
      disclaimer: LLMOrchestrator.DISCLAIMER,
    };
  }

  // ---------------------------------------------------------------------------
  // 多模型並行建議
  // ---------------------------------------------------------------------------

  async getRecommendations(payload: AnalysisPayload): Promise<ModelRecommendation[]> {
    const endpoints = this.getEndpoints().filter((e) => e.enabled);
    if (endpoints.length === 0) { return []; }

    const results = await Promise.allSettled(
      endpoints.map((ep) => this.callEndpoint(ep, payload)),
    );

    return results
      .filter((r): r is PromiseFulfilledResult<ModelRecommendation> => r.status === 'fulfilled')
      .map((r) => r.value);
  }

  mergeRecommendations(results: ModelRecommendation[], strategy: MergeStrategy): Recommendation {
    if (results.length === 0) {
      return this.conservativeFallback('無模型回應');
    }

    switch (strategy) {
      case 'primary': {
        const primary = [...results].sort((a, b) => a.endpointId.localeCompare(b.endpointId))[0];
        return this.toRecommendation(primary);
      }
      case 'majority': {
        const counts: Record<string, number> = { BUY: 0, SELL: 0, WATCH: 0 };
        for (const r of results) { counts[r.action] = (counts[r.action] ?? 0) + 1; }
        const action = (Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0]) as 'BUY' | 'SELL' | 'WATCH';
        const majority = results.filter((r) => r.action === action);
        const avgConf = majority.reduce((s, r) => s + r.confidence, 0) / majority.length;
        return {
          action,
          confidence: Math.round(avgConf * 100) / 100,
          reason: majority.map((r) => `[${r.memberName ?? r.model}] ${r.reason}`).join('；'),
          disclaimer: LLMOrchestrator.DISCLAIMER,
        };
      }
      case 'weighted': {
        // confidence-weighted average
        const totalW = results.reduce((s, r) => s + r.confidence, 0) || 1;
        const scores: Record<string, number> = { BUY: 0, SELL: 0, WATCH: 0 };
        for (const r of results) { scores[r.action] = (scores[r.action] ?? 0) + r.confidence / totalW; }
        const action = (Object.entries(scores).sort((a, b) => b[1] - a[1])[0][0]) as 'BUY' | 'SELL' | 'WATCH';
        return {
          action,
          confidence: Math.round(scores[action] * 100) / 100,
          reason: results.map((r) => `[${r.memberName ?? r.model}] ${r.reason}`).join('；'),
          disclaimer: LLMOrchestrator.DISCLAIMER,
        };
      }
      case 'fallback':
      default:
        return this.toRecommendation(results[0]);
    }
  }

  // ---------------------------------------------------------------------------
  // 固定協作組
  // ---------------------------------------------------------------------------

  async runTeam(teamId: string, payload: AnalysisPayload): Promise<TeamRecommendation> {
    const config = await this.teamStore.getById(teamId);
    if (!config) {
      throw new Error(`找不到協作組：${teamId}`);
    }

    const endpoints = this.getEndpoints();
    const memberResults = await Promise.allSettled(
      config.members.map(async (m) => {
        const ep = endpoints.find((e) => e.id === m.endpointId);
        if (!ep || !ep.enabled) {
          return undefined;
        }
        return this.callEndpoint(ep, payload, m.timeoutMs, m);
      }),
    );

    const members: ModelRecommendation[] = memberResults
      .filter((r): r is PromiseFulfilledResult<ModelRecommendation | undefined> =>
        r.status === 'fulfilled' && r.value !== undefined)
      .map((r) => r.value as ModelRecommendation);

    const final = this.mergeRecommendations(members, config.mergeStrategy);

    const disagreements: string[] = [];
    if (members.length > 1) {
      const actions = [...new Set(members.map((m) => m.action))];
      if (actions.length > 1) {
        disagreements.push(`模型意見分歧：${members.map((m) => `${m.memberName ?? m.model}=${m.action}`).join(', ')}`);
      }
    }

    return { teamId, final, members, disagreements };
  }

  async saveTeamConfig(config: LlmTeamConfig): Promise<void> {
    await this.teamStore.save(config);
  }

  // ---------------------------------------------------------------------------
  // 圖表說明
  // ---------------------------------------------------------------------------

  async explainChart(insight: ChartInsightPayload): Promise<ChartInsight> {
    const userMsg = this.buildChartPrompt(insight);
    const mode = vscode.workspace.getConfiguration('stockHeatmap').get<string>('llm.mode', 'copilot');
    const endpoints = this.getEndpoints();

    try {
      let rawText = '';
      if (mode === 'openai') {
        rawText = await this.callOpenAIRaw(userMsg, endpoints);
      } else if (mode === 'ollama') {
        rawText = await this.callOllamaRaw(userMsg, endpoints);
      } else {
        rawText = await this.callCopilotRaw(userMsg);
      }
      return this.parseChartInsight(rawText);
    } catch {
      return {
        title: `${insight.symbol} 圖表說明`,
        summary: 'LLM 不可用，無法產生圖表說明。',
        facts: [],
      };
    }
  }

  // ---------------------------------------------------------------------------
  // Provider 實作
  // ---------------------------------------------------------------------------

  private async callOpenAI(payload: AnalysisPayload, endpoints: LlmEndpoint[]): Promise<LlmJsonResponse> {
    const ep = endpoints.find((e) => e.enabled && e.provider === 'openai');
    if (!ep) { throw new Error('無可用 OpenAI endpoint'); }
    const raw = await this.callOpenAIRaw(this.buildAnalysisPrompt(payload), [ep]);
    return this.parseJson(raw);
  }

  private async callOpenAIRaw(userMsg: string, endpoints: LlmEndpoint[], systemPrompt = LLMOrchestrator.SYSTEM_PROMPT): Promise<string> {
    const ep = endpoints.find((e) => e.enabled && e.provider === 'openai');
    if (!ep) { throw new Error('無可用 OpenAI endpoint'); }
    const apiKey = vscode.workspace.getConfiguration('stockHeatmap').get<string>('apiKey', '');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { OpenAI } = require('openai') as typeof import('openai');
    const client = new OpenAI({ apiKey, ...(ep.baseUrl ? { baseURL: ep.baseUrl } : {}) });
    const res = await client.chat.completions.create({
      model: ep.model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMsg },
      ],
      max_tokens: 200,
      temperature: 0.2,
    });
    return res.choices[0]?.message?.content ?? '';
  }

  private async callOllama(payload: AnalysisPayload, endpoints: LlmEndpoint[]): Promise<LlmJsonResponse> {
    const raw = await this.callOllamaRaw(this.buildAnalysisPrompt(payload), endpoints);
    return this.parseJson(raw);
  }

  private async callOllamaRaw(userMsg: string, endpoints: LlmEndpoint[], systemPrompt = LLMOrchestrator.SYSTEM_PROMPT): Promise<string> {
    const ollamaEps = endpoints
      .filter((e) => e.enabled && e.provider === 'ollama')
      .sort((a, b) => a.priority - b.priority);
    if (ollamaEps.length === 0) { throw new Error('無可用 Ollama endpoint'); }

    let lastErr: Error = new Error('無可用 Ollama endpoint');
    for (const ep of ollamaEps) {
      try {
        const url = `${ep.baseUrl ?? 'http://localhost:11434'}/api/generate`;
        const resp = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: ep.model,
            prompt: `${systemPrompt}\n\n${userMsg}`,
            stream: false,
          }),
          signal: AbortSignal.timeout(30_000),
        });
        if (!resp.ok) { continue; }
        const json = await resp.json() as { response?: string };
        return json.response ?? '';
      } catch (e) {
        lastErr = e as Error;
      }
    }
    throw lastErr;
  }

  private async callCopilot(payload: AnalysisPayload): Promise<LlmJsonResponse> {
    const raw = await this.callCopilotRaw(this.buildAnalysisPrompt(payload));
    return this.parseJson(raw);
  }

  private async callCopilotRaw(userMsg: string, systemPrompt = LLMOrchestrator.SYSTEM_PROMPT): Promise<string> {
    // VS Code LM API（GitHub Copilot）
    if (!('lm' in vscode)) {
      throw new Error('VS Code LM API 不可用（需要 GitHub Copilot 插件）');
    }
    const lm = (vscode as unknown as { lm: {
      selectChatModels(opts: { vendor: string }): Promise<Array<{
        sendRequest(msgs: unknown[], opts: { justification?: string }, ct: vscode.CancellationToken): Promise<{
          text: AsyncIterable<string>
        }>
      }>>
    } }).lm;

    const models = await lm.selectChatModels({ vendor: 'copilot' });
    if (models.length === 0) { throw new Error('找不到 Copilot 模型'); }

    const model = models[0];
    const ct = new vscode.CancellationTokenSource().token;
    const res = await model.sendRequest(
      [
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        { role: 'system', content: systemPrompt } as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        { role: 'user', content: userMsg } as any,
      ],
      {},
      ct,
    );

    let text = '';
    for await (const chunk of res.text) { text += chunk; }
    return text;
  }

  private async callEndpoint(
    ep: LlmEndpoint,
    payload: AnalysisPayload,
    timeoutMs = 30_000,
    member?: TeamMemberConfig,
  ): Promise<ModelRecommendation> {
    const t0 = Date.now();
    let result: LlmJsonResponse;
    const userPrompt = this.buildAnalysisPrompt(payload, member);
    const systemPrompt = this.buildSystemPrompt(member);

    try {
      if (ep.provider === 'openai') {
        result = await Promise.race([
          this.callOpenAIRaw(userPrompt, [ep], systemPrompt).then((raw) => this.parseJson(raw)),
          new Promise<never>((_, rej) => setTimeout(() => rej(new Error('timeout')), timeoutMs)),
        ]);
      } else if (ep.provider === 'ollama') {
        result = await Promise.race([
          this.callOllamaRaw(userPrompt, [ep], systemPrompt).then((raw) => this.parseJson(raw)),
          new Promise<never>((_, rej) => setTimeout(() => rej(new Error('timeout')), timeoutMs)),
        ]);
      } else {
        result = await this.callCopilotRaw(userPrompt, systemPrompt).then((raw) => this.parseJson(raw));
      }
    } catch {
      result = { action: 'WATCH', confidence: 0.2, reason: '模型超時或回傳格式錯誤' };
    }

    return {
      endpointId: ep.id,
      memberName: member?.name,
      memberRole: member?.role,
      provider: ep.provider,
      model: ep.model,
      latencyMs: Date.now() - t0,
      ...result,
    };
  }

  // ---------------------------------------------------------------------------
  // Prompt 建構
  // ---------------------------------------------------------------------------

  private buildAnalysisPrompt(p: AnalysisPayload, member?: TeamMemberConfig): string {
    const newsText = p.newsList.length > 0
      ? p.newsList.slice(0, 5).map((n) => `• ${n.title}`).join('\n')
      : '（無近期新聞）';

    const memberPrefix = member?.userPromptPrefix?.trim()
      ? `成員附加指令：${member.userPromptPrefix.trim()}\n`
      : '';

    return `${memberPrefix}股票代碼：${p.symbol}（${p.market}）| 時間框架：${p.timeframe}
技術摘要：趨勢=${p.trend}，訊號=${p.signal}，RSI14=${p.rsi14}，MACD=${p.macdState}，均線=${p.maState}，突破=${p.breakoutState}
近期新聞：
${newsText}

請根據以上資訊，輸出 JSON 建議。`;
  }

  private buildSystemPrompt(member?: TeamMemberConfig): string {
    if (!member) { return LLMOrchestrator.SYSTEM_PROMPT; }

    return [
      LLMOrchestrator.SYSTEM_PROMPT,
      `目前角色：${member.name ?? member.role}`,
      LLMOrchestrator.ROLE_PROMPTS[member.role],
      member.systemPrompt?.trim(),
    ].filter(Boolean).join('\n\n');
  }

  private buildChartPrompt(p: ChartInsightPayload): string {
    const ind = p.indicators;
    const range = p.selectedRange
      ? `選取區間：${p.selectedRange.from} ~ ${p.selectedRange.to}`
      : '（無選取區間）';
    return `股票：${p.symbol}，時間框架：${p.timeframe}
${range}
指標：SMA5=${ind.sma5}, SMA20=${ind.sma20}, RSI=${ind.rsi14}, MACD=${ind.macd}/${ind.macdSignal}, BB上=${ind.bollingerUpper}/下=${ind.bollingerLower}
最近收盤：${p.candles.at(-1)?.close ?? 'N/A'}

請以 JSON 格式回傳圖表說明：{"title":"...","summary":"...","facts":["f1","f2"],"risks":["r1"]}`;
  }

  // ---------------------------------------------------------------------------
  // 解析工具
  // ---------------------------------------------------------------------------

  private parseJson(raw: string): LlmJsonResponse {
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) { throw new Error('LLM 不回傳 JSON'); }
    const obj = JSON.parse(match[0]) as Partial<LlmJsonResponse>;
    if (!obj.action || !['BUY', 'SELL', 'WATCH'].includes(obj.action)) {
      throw new Error('action 欄位無效');
    }
    return {
      action: obj.action,
      confidence: typeof obj.confidence === 'number' ? obj.confidence : 0.3,
      reason: typeof obj.reason === 'string' ? obj.reason : '',
    };
  }

  private parseChartInsight(raw: string): ChartInsight {
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) {
      return { title: '圖表說明', summary: raw.slice(0, 200), facts: [] };
    }
    const obj = JSON.parse(match[0]) as Partial<ChartInsight>;
    return {
      title: obj.title ?? '圖表說明',
      summary: obj.summary ?? '',
      facts: Array.isArray(obj.facts) ? obj.facts : [],
      risks: Array.isArray(obj.risks) ? obj.risks : undefined,
    };
  }

  private toRecommendation(m: ModelRecommendation): Recommendation {
    return {
      action: m.action,
      confidence: m.confidence,
      reason: m.reason,
      disclaimer: LLMOrchestrator.DISCLAIMER,
    };
  }

  // ---------------------------------------------------------------------------
  // 內部工具
  // ---------------------------------------------------------------------------

  private getEndpoints(): LlmEndpoint[] {
    return vscode.workspace.getConfiguration('stockHeatmap').get<LlmEndpoint[]>('llm.ollamaEndpoints', []);
  }

  private conservativeFallback(reason: string): Recommendation {
    return {
      action: 'WATCH',
      confidence: 0.3,
      reason,
      disclaimer: LLMOrchestrator.DISCLAIMER,
    };
  }
}
