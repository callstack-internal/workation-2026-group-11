// Load the extension's IIFE content scripts into a fake-DOM VM sandbox so their
// pure logic can be unit-tested in Node without a browser. Only load files that
// don't touch document/chrome at import time (cost.js, match.js).

import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(fileURLToPath(import.meta.url), '../..');

export function loadMcm(...relFiles) {
  const sandbox = {};
  sandbox.window = sandbox; // scripts do: window.__MCM ||= {}
  sandbox.self = sandbox;
  vm.createContext(sandbox);
  for (const rel of relFiles) {
    const code = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    vm.runInContext(code, sandbox, { filename: rel });
  }
  return sandbox.__MCM;
}
