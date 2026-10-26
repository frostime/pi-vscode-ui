#!/usr/bin/env node

// Reuse the controlled shared Pi. Desktop adds one ordinary Extension UI request
// to test Project attention routing, without changing shared fixtures or using a model.
require('../../../pi-client/test/fixtures/fake-pi.cjs');

let pending = '';
process.stdin.on('data', (chunk) => {
  pending += chunk;
  for (;;) {
    const end = pending.indexOf('\n');
    if (end < 0) return;
    const line = pending.slice(0, end).trim();
    pending = pending.slice(end + 1);
    if (!line) continue;
    const command = JSON.parse(line);
    if (command.type === 'prompt' && command.message === 'navigation-needs-input') {
      process.stdout.write(JSON.stringify({
        type: 'extension_ui_request', id: 'desktop-navigation-confirm', method: 'confirm',
        title: 'Desktop navigation fixture', message: 'Confirm the synthetic Project navigation check?',
      }) + '\n');
    }
  }
});
