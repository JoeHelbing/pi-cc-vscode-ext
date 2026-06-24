import fs from 'node:fs';
import path from 'node:path';

const DEFAULT_PROTOCOL_VERSION = '2024-11-05';
const DEFAULT_POLL_INTERVAL_MS = 2000;
const DEFAULT_QUERY_TIMEOUT_MS = 3500;
const DEFAULT_MAX_PROMPT_CHARS = 20000;

export type SelectionPosition = {
  line?: number;
  character?: number;
};

export type SelectionRange = {
  start?: SelectionPosition;
  end?: SelectionPosition;
  isEmpty?: boolean;
};

export type ClaudeIdeContext = {
  ok?: boolean;
  success?: boolean;
  reason?: string;
  message?: string;
  source?: string;
  ideName?: string;
  port?: number;
  workspaceFolders?: string[];
  filePath?: string;
  relativePath?: string;
  text?: string;
  selection?: SelectionRange;
  selectedLineCount?: number;
  [key: string]: unknown;
};

export type ClaudeIdeLock = {
  path?: string;
  port: number;
  pid?: number;
  pidAlive?: boolean;
  workspaceFolders?: string[];
  ideName?: string;
  transport?: string;
  runningInWindows?: boolean;
  authToken?: string;
  mtimeMs?: number;
};

export type VscodeStatus = {
  state: 'disconnected' | 'active_file' | 'selection';
  icon: string;
  label: string;
  line: string;
};

type TextBlock = { type: 'text'; text: string };
type ToolResult = { content: TextBlock[]; details?: unknown; isError?: boolean };
type ExtensionContext = {
  cwd: string;
  hasUI?: boolean;
  mode?: string;
  signal?: AbortSignal;
  sessionManager?: { getBranch?: () => unknown[] };
  ui: {
    theme?: { fg?: (color: string, text: string) => string };
    setStatus?: (name: string, value: string | undefined) => void;
    notify?: (message: string, level?: 'info' | 'warning' | 'error') => void;
    select?: (title: string, options: string[]) => Promise<string | undefined>;
  };
};
type ExtensionAPI = {
  on: (name: string, handler: (event: unknown, ctx: ExtensionContext) => unknown | Promise<unknown>) => void;
  registerCommand: (name: string, command: { description: string; handler: (args: string, ctx: ExtensionContext) => Promise<void> | void }) => void;
  registerTool: (tool: {
    name: string;
    label: string;
    description: string;
    promptSnippet?: string;
    promptGuidelines?: string[];
    parameters: Record<string, unknown>;
    execute: (
      toolCallId: string,
      params: Record<string, never>,
      signal: AbortSignal | undefined,
      onUpdate: unknown,
      ctx: ExtensionContext,
    ) => Promise<ToolResult>;
  }) => void;
};
type WebSocketLike = {
  send: (message: string) => void;
  close: () => void;
  addEventListener: (event: 'open' | 'message' | 'error', handler: (event: any) => void) => void;
};
type WebSocketConstructor = new (url: string, options?: unknown) => WebSocketLike;

type BridgeOptions = {
  cwd?: string;
  home?: string;
  ideDir?: string;
  timeoutMs?: number;
  maxChars?: number;
  signal?: AbortSignal;
  webSocketCtor?: WebSocketConstructor;
};

type ExtensionOptions = {
  pollIntervalMs?: number;
  queryTimeoutMs?: number;
  maxPromptChars?: number;
  getContext?: (options: BridgeOptions) => Promise<ClaudeIdeContext>;
};

export function countSelectedLines(selection?: SelectionRange): number {
  if (!selection || selection.isEmpty) return 0;
  const start = Number(selection.start?.line ?? 0);
  const end = Number(selection.end?.line ?? start);
  return Math.max(1, end - start + 1);
}

export function toDisplayLine(line?: number): number {
  return Number(line ?? 0) + 1;
}

export function relativePathFor(filePath?: string, cwd?: string): string | undefined {
  if (!filePath || !cwd) return filePath;
  const relative = path.relative(cwd, filePath);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return filePath;
  return relative;
}

export function languageFromPath(filePath?: string): string {
  const ext = path.extname(filePath ?? '').replace(/^\./, '').toLowerCase();
  const aliases: Record<string, string> = {
    js: 'javascript',
    jsx: 'jsx',
    ts: 'ts',
    tsx: 'tsx',
    mjs: 'javascript',
    cjs: 'javascript',
    py: 'python',
    rs: 'rust',
    sh: 'bash',
    bash: 'bash',
    zsh: 'zsh',
    md: 'markdown',
    json: 'json',
    toml: 'toml',
    yaml: 'yaml',
    yml: 'yaml',
  };
  return aliases[ext] ?? ext;
}

export function hasActiveFileContext(payload?: ClaudeIdeContext): boolean {
  return Boolean(payload?.ok && payload.success !== false && payload.filePath);
}

export function statusLineSummary(payload?: ClaudeIdeContext, options: BridgeOptions = {}): VscodeStatus {
  if (!hasActiveFileContext(payload)) {
    return {
      state: 'disconnected',
      icon: '◇',
      label: 'VS Code  disconnected',
      line: '  ◇  VS Code  disconnected',
    };
  }

  const filePath = payload?.relativePath || relativePathFor(payload?.filePath, options.cwd) || payload?.filePath || '(unknown)';
  const selectedLines = Number(payload?.selectedLineCount ?? countSelectedLines(payload?.selection));
  if (selectedLines > 0) {
    const noun = selectedLines === 1 ? 'line' : 'lines';
    const label = `VS Code  ${filePath}  ${selectedLines} selected ${noun}`;
    return { state: 'selection', icon: '▣', label, line: `  ▣  ${label}` };
  }

  const startLine = toDisplayLine(payload?.selection?.start?.line);
  const label = `VS Code  ${filePath}:${startLine}`;
  return { state: 'active_file', icon: '◧', label, line: `  ◧  ${label}` };
}

export function formatSelectionContext(payload?: ClaudeIdeContext, options: BridgeOptions = {}): string {
  if (!hasActiveFileContext(payload)) return '';
  const filePath = payload?.relativePath || relativePathFor(payload?.filePath, options.cwd) || payload?.filePath;
  const selection = payload?.selection;
  const startLine = toDisplayLine(selection?.start?.line);
  const endLine = toDisplayLine(selection?.end?.line);
  const selectedLines = countSelectedLines(selection);
  const maxChars = Math.max(1000, Number(options.maxChars ?? DEFAULT_MAX_PROMPT_CHARS));
  const rawText = typeof payload?.text === 'string' ? payload.text : '';
  const truncated = rawText.length > maxChars;
  const text = truncated ? rawText.slice(0, maxChars) : rawText;

  const lines = [
    'VS Code context from the connected Claude Code IDE bridge:',
    `Active VS Code file: ${filePath}`,
  ];

  if (selectedLines > 0) {
    lines.push(`Selected lines: ${startLine}-${endLine} (${selectedLines} ${selectedLines === 1 ? 'line' : 'lines'})`);
  } else if (selection?.start) {
    lines.push(`Cursor: line ${startLine}, character ${Number(selection.start.character ?? 0) + 1}`);
  }

  if (text) {
    const lang = languageFromPath(filePath);
    lines.push('', 'Selected text:', `\`\`\`${lang}`, text, '```');
    if (truncated) lines.push(`Selection truncated from ${rawText.length} to ${maxChars} characters.`);
  }

  return lines.join('\n');
}

export function parseMcpToolText(message: any): unknown {
  const text = message?.result?.content?.find((item: any) => item?.type === 'text' && typeof item.text === 'string')?.text;
  if (!text) return undefined;
  return JSON.parse(text);
}

export function pathMatchesWorkspace(cwd?: string, workspaceFolders: string[] = []): boolean {
  if (!cwd) return false;
  const resolvedCwd = path.resolve(cwd);
  return workspaceFolders.some((folder) => {
    const resolvedFolder = path.resolve(folder);
    const rel = path.relative(resolvedFolder, resolvedCwd);
    return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
  });
}

export function selectBestLock(locks: ClaudeIdeLock[], cwd?: string): ClaudeIdeLock | undefined {
  const live = locks.filter((lock) => lock.pidAlive !== false);
  const pool = live.length > 0 ? live : locks;
  return [...pool].sort((a, b) => {
    const aMatch = pathMatchesWorkspace(cwd, a.workspaceFolders) ? 1 : 0;
    const bMatch = pathMatchesWorkspace(cwd, b.workspaceFolders) ? 1 : 0;
    if (aMatch !== bMatch) return bMatch - aMatch;
    return Number(b.mtimeMs ?? 0) - Number(a.mtimeMs ?? 0);
  })[0];
}

export function isPidAlive(pid?: number): boolean | undefined {
  if (!pid || typeof pid !== 'number') return undefined;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function readClaudeIdeLocks(options: BridgeOptions = {}): ClaudeIdeLock[] {
  const home = options.home ?? process.env.HOME;
  const ideDir = options.ideDir ?? (home ? path.join(home, '.claude', 'ide') : undefined);
  if (!ideDir || !fs.existsSync(ideDir)) return [];

  return fs.readdirSync(ideDir)
    .filter((name) => name.endsWith('.lock'))
    .flatMap((name) => {
      const lockPath = path.join(ideDir, name);
      try {
        const stat = fs.statSync(lockPath);
        const data = JSON.parse(fs.readFileSync(lockPath, 'utf8')) as Record<string, unknown>;
        const port = Number(name.replace(/\.lock$/, ''));
        if (!Number.isInteger(port)) return [];
        return [{
          path: lockPath,
          port,
          pid: typeof data.pid === 'number' ? data.pid : undefined,
          pidAlive: isPidAlive(typeof data.pid === 'number' ? data.pid : undefined),
          workspaceFolders: Array.isArray(data.workspaceFolders) ? data.workspaceFolders.filter((item) => typeof item === 'string') : [],
          ideName: typeof data.ideName === 'string' ? data.ideName : undefined,
          transport: typeof data.transport === 'string' ? data.transport : undefined,
          runningInWindows: typeof data.runningInWindows === 'boolean' ? data.runningInWindows : undefined,
          authToken: typeof data.authToken === 'string' ? data.authToken : undefined,
          mtimeMs: stat.mtimeMs,
        }];
      } catch {
        return [];
      }
    });
}

export async function callClaudeIdeTool(lock: ClaudeIdeLock, toolName: string, args: Record<string, unknown> = {}, options: BridgeOptions = {}): Promise<unknown> {
  if (!lock?.authToken) throw new Error('Claude IDE lock does not contain an auth token');
  const ctor = options.webSocketCtor ?? (globalThis as unknown as { WebSocket?: WebSocketConstructor }).WebSocket;
  if (typeof ctor !== 'function') throw new Error('This Node.js runtime does not provide global WebSocket');

  const timeoutMs = Math.max(1000, Number(options.timeoutMs ?? 3000));
  const url = `ws://127.0.0.1:${lock.port}`;
  const ws = new ctor(url, { headers: { 'x-claude-code-ide-authorization': lock.authToken } });
  let nextId = 1;
  let initialized = false;

  return await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out calling Claude IDE tool ${toolName}`));
    }, timeoutMs);

    function cleanup(): void {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', onAbort);
      try { ws.close(); } catch {}
    }

    function onAbort(): void {
      cleanup();
      reject(new Error(`Cancelled calling Claude IDE tool ${toolName}`));
    }

    function send(message: Record<string, unknown>): void {
      ws.send(JSON.stringify(message));
    }

    options.signal?.addEventListener('abort', onAbort, { once: true });

    ws.addEventListener('open', () => {
      send({
        jsonrpc: '2.0',
        id: nextId++,
        method: 'initialize',
        params: {
          protocolVersion: DEFAULT_PROTOCOL_VERSION,
          capabilities: {},
          clientInfo: { name: 'pi-claude-ide-context', version: '0.1.0' },
        },
      });
    });

    ws.addEventListener('message', (event: any) => {
      let message: any;
      try {
        message = JSON.parse(String(event.data));
      } catch {
        return;
      }

      if (message.id === 1 && message.result && !initialized) {
        initialized = true;
        send({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} });
        send({ jsonrpc: '2.0', id: nextId++, method: 'tools/call', params: { name: toolName, arguments: args } });
        return;
      }

      if (message.id === 2) {
        cleanup();
        if (message.error) {
          reject(new Error(message.error.message || `Claude IDE tool ${toolName} failed`));
          return;
        }
        try {
          resolve(parseMcpToolText(message));
        } catch (error) {
          reject(error);
        }
      }
    });

    ws.addEventListener('error', (error: any) => {
      cleanup();
      reject(new Error(error?.message || `Failed to connect to Claude IDE bridge on ${url}`));
    });
  });
}

export async function getClaudeIdeContext(options: BridgeOptions = {}): Promise<ClaudeIdeContext> {
  const cwd = options.cwd ?? process.cwd();
  const locks = readClaudeIdeLocks(options);
  if (locks.length === 0) return { ok: false, reason: 'no_lock', message: 'No Claude Code IDE lock files found.' };

  const lock = selectBestLock(locks, cwd);
  if (!lock) return { ok: false, reason: 'no_matching_lock', message: 'No usable Claude Code IDE lock found.' };

  try {
    const selection = await callClaudeIdeTool(lock, 'getLatestSelection', {}, options) as ClaudeIdeContext | undefined;
    const filePath = selection?.filePath;
    if (selection?.success === false || !filePath) {
      return {
        ...selection,
        ok: false,
        reason: selection?.success === false ? 'no_selection' : 'no_active_file',
        source: 'claude-code-ide',
        ideName: lock.ideName,
        port: lock.port,
        workspaceFolders: lock.workspaceFolders,
        message: selection?.message || 'No active VS Code file found.',
        selectedLineCount: 0,
      };
    }

    return {
      ...selection,
      ok: true,
      source: 'claude-code-ide',
      ideName: lock.ideName,
      port: lock.port,
      workspaceFolders: lock.workspaceFolders,
      relativePath: relativePathFor(filePath, cwd),
      selectedLineCount: countSelectedLines(selection?.selection),
    };
  } catch (error) {
    return {
      ok: false,
      reason: 'tool_failed',
      source: 'claude-code-ide',
      ideName: lock.ideName,
      port: lock.port,
      workspaceFolders: lock.workspaceFolders,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

export function redactedLockSummary(lock?: ClaudeIdeLock): Omit<ClaudeIdeLock, 'authToken'> | undefined {
  if (!lock) return undefined;
  return {
    port: lock.port,
    pid: lock.pid,
    pidAlive: lock.pidAlive,
    workspaceFolders: lock.workspaceFolders,
    ideName: lock.ideName,
    transport: lock.transport,
    runningInWindows: lock.runningInWindows,
    mtimeMs: lock.mtimeMs,
  };
}

export function fingerprintText(text: string): string {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `${text.length}:${(hash >>> 0).toString(36)}`;
}

export function textFromMessageContent(content: unknown): string | undefined {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return undefined;
  const textBlocks = content.filter((item): item is TextBlock => Boolean(item && item.type === 'text' && typeof item.text === 'string'));
  return textBlocks.length > 0 ? textBlocks.map((item) => item.text).join('\n') : undefined;
}

export function vscodeMessageFromEntry(entry: any): any | undefined {
  const message = entry?.type === 'message' ? entry.message : entry;
  const roleMatches = message?.role === 'custom' || entry?.type === 'custom_message';
  return roleMatches && message?.customType === 'vscode' ? message : undefined;
}

export function fingerprintFromVscodeEntry(entry: any): string | undefined {
  const message = vscodeMessageFromEntry(entry);
  if (!message) return undefined;
  if (typeof message.details?.fingerprint === 'string' && message.details.fingerprint) return message.details.fingerprint;
  const content = textFromMessageContent(message.content);
  return content ? fingerprintText(content) : undefined;
}

export function restoreLastInjectedFingerprint(ctx: ExtensionContext): string | undefined {
  const branch = typeof ctx.sessionManager?.getBranch === 'function' ? ctx.sessionManager.getBranch() : [];
  for (let index = branch.length - 1; index >= 0; index -= 1) {
    const fingerprint = fingerprintFromVscodeEntry(branch[index]);
    if (fingerprint) return fingerprint;
  }
  return undefined;
}

function themedStatus(ctx: ExtensionContext, status: VscodeStatus): string {
  const color = status.state === 'disconnected' ? 'dim' : 'muted';
  return ctx.ui.theme?.fg?.(color, status.line) ?? status.line;
}

async function queryContext(ctx: ExtensionContext, options: Required<Pick<ExtensionOptions, 'queryTimeoutMs' | 'maxPromptChars'>> & Pick<ExtensionOptions, 'getContext'>): Promise<ClaudeIdeContext> {
  const getContext = options.getContext ?? getClaudeIdeContext;
  return await getContext({ cwd: ctx.cwd, timeoutMs: options.queryTimeoutMs, maxChars: options.maxPromptChars, signal: ctx.signal });
}

export function createClaudeIdeVscodeExtension(pi: ExtensionAPI, extensionOptions: ExtensionOptions = {}): void {
  const options = {
    pollIntervalMs: extensionOptions.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS,
    queryTimeoutMs: extensionOptions.queryTimeoutMs ?? DEFAULT_QUERY_TIMEOUT_MS,
    maxPromptChars: extensionOptions.maxPromptChars ?? DEFAULT_MAX_PROMPT_CHARS,
    getContext: extensionOptions.getContext,
  };
  let pollTimer: ReturnType<typeof setInterval> | undefined;
  let lastStatus: string | undefined;
  let lastInjectedFingerprint: string | undefined;
  let active = true;

  async function refreshStatus(ctx: ExtensionContext): Promise<VscodeStatus> {
    let status: VscodeStatus;
    try {
      const context = await queryContext(ctx, options);
      status = statusLineSummary(context, { cwd: ctx.cwd });
    } catch {
      status = statusLineSummary({ ok: false, reason: 'tool_failed' });
    }

    if (!active) return status;
    const next = themedStatus(ctx, status);
    if (next !== lastStatus) {
      lastStatus = next;
      ctx.ui.setStatus?.('vscode', next);
    }
    return status;
  }

  pi.on('session_start', async (_event: unknown, ctx: ExtensionContext) => {
    active = true;
    lastInjectedFingerprint = restoreLastInjectedFingerprint(ctx);
    if (!ctx.hasUI) return;
    await refreshStatus(ctx);
    pollTimer = setInterval(() => { void refreshStatus(ctx); }, options.pollIntervalMs);
  });

  pi.on('session_shutdown', () => {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = undefined;
  });

  pi.on('before_agent_start', async (_event: unknown, ctx: ExtensionContext) => {
    if (!active) return undefined;
    try {
      const context = await queryContext(ctx, options);
      const prompt = formatSelectionContext(context, { cwd: ctx.cwd, maxChars: options.maxPromptChars });
      if (!prompt || prompt.startsWith('No VS Code context')) return undefined;
      const fingerprint = fingerprintText(prompt);
      if (fingerprint === lastInjectedFingerprint) return undefined;
      lastInjectedFingerprint = fingerprint;
      return {
        message: {
          customType: 'vscode',
          content: prompt,
          display: true,
          details: { fingerprint },
        },
      };
    } catch {
      return undefined;
    }
  });

  pi.registerCommand('vscode', {
    description: 'Open the VS Code context menu (show context, refresh/reset bridge, or toggle activation)',
    handler: async (_args: string, ctx: ExtensionContext) => {
      const toggleChoice = active ? 'Deactivate footer and context injection' : 'Activate footer and context injection';
      const choice = await ctx.ui.select?.('VS Code context', [
        'Show current context',
        'Refresh / reset connection',
        toggleChoice,
      ]);

      if (!choice) return;
      if (choice === 'Deactivate footer and context injection') {
        active = false;
        lastStatus = undefined;
        ctx.ui.setStatus?.('vscode', undefined);
        ctx.ui.notify?.('VS Code context deactivated for this session.', 'info');
        return;
      }

      try {
        if (choice === 'Activate footer and context injection' || choice === 'Refresh / reset connection') {
          active = true;
          lastStatus = undefined;
          const status = await refreshStatus(ctx);
          ctx.ui.notify?.(`${status.icon} ${status.label}`, status.state === 'disconnected' ? 'warning' : 'info');
          return;
        }

        const context = await queryContext(ctx, options);
        const prompt = formatSelectionContext(context, { cwd: ctx.cwd, maxChars: options.maxPromptChars });
        ctx.ui.notify?.(prompt || 'No VS Code context available.', 'info');
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        ctx.ui.notify?.(`VS Code context unavailable: ${message}`, 'warning');
      }
    },
  });

  pi.registerTool({
    name: 'vscode_context',
    label: 'VS Code Context',
    description: "Read the active VS Code file and current selection through Claude Code's local IDE bridge. Returns no auth tokens.",
    promptSnippet: 'Read the active VS Code file and current selected lines through the local Claude Code IDE bridge.',
    promptGuidelines: [
      'Use vscode_context when the user refers to the current VS Code editor, active file, cursor, selection, or highlighted code.',
      'Do not treat vscode_context as authoritative if the user says VS Code is focused on another project or window; ask for clarification or use explicit file paths.',
    ],
    parameters: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
    async execute(_toolCallId: string, _params: Record<string, never>, signal: AbortSignal | undefined, _onUpdate: unknown, ctx: ExtensionContext) {
      try {
        const getContext = options.getContext ?? getClaudeIdeContext;
        const context = await getContext({ cwd: ctx.cwd, timeoutMs: options.queryTimeoutMs, maxChars: options.maxPromptChars, signal });
        if (!context.ok) {
          return {
            content: [{ type: 'text', text: context.message || 'No VS Code context available.' }],
            details: context,
            isError: false,
          };
        }

        const prompt = formatSelectionContext(context, { cwd: ctx.cwd, maxChars: options.maxPromptChars });
        return { content: [{ type: 'text', text: prompt }], details: context };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: 'text', text: `VS Code context failed: ${message}` }],
          details: { ok: false, error: message },
          isError: true,
        };
      }
    },
  });
}

export default function claudeIdeVscodeExtension(pi: ExtensionAPI): void {
  createClaudeIdeVscodeExtension(pi);
}
