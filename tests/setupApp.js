import app from '../src/index.js';

let _app = null;

export async function initTestApp() {
  // If you have any async warmup (migrations, seed, etc.), do it here.
  _app = app; // keep it simple: app should be ready to use
}

export function getAppSync() {
  if (!_app) throw new Error('Test app not initialized. Call initTestApp() in beforeAll.');
  return _app;
}
