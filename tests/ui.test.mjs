import assert from 'node:assert/strict';
import test from 'node:test';
import { createClaudeIdeVscodeExtension } from '../extensions/claude-ide-vscode.ts';

for (const [client, usesWidget] of [['prime-agent', true], ['pi', false]]) {
  test(`${client} displays and clears VS Code context in its own UI`, async () => {
    const originalArgv = process.argv[1];
    process.argv[1] = `/bin/${client}`;
    const events = new Map();
    const commands = new Map();
    const status = [];
    const widgets = [];
    const ctx = {
      cwd: '/workspace',
      hasUI: true,
      sessionManager: { getBranch: () => [] },
      ui: {
        setStatus: (...args) => status.push(args),
        setWidget: (...args) => widgets.push(args),
        select: async () => 'Deactivate footer and context injection',
        notify: () => {},
      },
    };
    try {
      createClaudeIdeVscodeExtension({
        on: (name, handler) => events.set(name, handler),
        registerCommand: (name, command) => commands.set(name, command),
        registerTool: () => {},
      }, {
        pollIntervalMs: 60_000,
        getContext: async () => ({ ok: true, filePath: '/workspace/file.ts', selection: { start: { line: 14 } } }),
      });
      await events.get('session_start')(undefined, ctx);
      await events.get('before_agent_start')(undefined, ctx);
      assert.equal(widgets.length > 0, usesWidget);
      assert.equal(status.length > 0, !usesWidget);
      if (usesWidget) {
        assert.deepEqual(widgets.at(-1)[2], { placement: 'belowEditor' });
        assert.match(widgets.at(-1)[1][0], /file\.ts/);
      } else assert.match(status.at(-1)[1], /file\.ts/);
      await commands.get('vscode').handler('', ctx);
      assert.equal(usesWidget ? widgets.at(-1)[1] : status.at(-1)[1], undefined);
    } finally {
      events.get('session_shutdown')?.();
      process.argv[1] = originalArgv;
    }
  });
}
