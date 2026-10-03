const { test } = require('node:test');
const assert = require('node:assert/strict');
const { connectDart } = require('../lib/connection');
const { browserUserAgent } = require('../lib/user-agent');
test('actual app product tokens are removed, retaining Chromium version and platform', () => {
  const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) dart-report-collector/1.0.0 Chrome/152.0.7977.130 Electron/44.5.1 Safari/537.36';
  const expected = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.7977.130 Safari/537.36';
  assert.equal(browserUserAgent(ua), expected);
  assert.equal(browserUserAgent(expected), expected);
});
function contents(failures) {
  const urls = [], closed = [];
  return { urls, closed, isDestroyed: () => false, session: { closeAllConnections: async () => closed.push(true) },
    loadURL: async url => { urls.push(url); const failure = failures.shift(); if (failure) throw failure; } };
}
const empty = () => Object.assign(new Error('ERR_EMPTY_RESPONSE'), { errno: -324 });
test('temporary empty response recovers without changing cookies or list', async () => {
  const wc = contents([empty(), null]);
  assert.equal(await connectDart(wc, () => {}, async () => {}), true);
  assert.equal(wc.urls.length, 2); assert.equal(wc.closed.length, 1);
});
test('homepage failures fall back to search page', async () => {
  const wc = contents([empty(), empty(), null]);
  assert.equal(await connectDart(wc, () => {}, async () => {}), true);
  assert.equal(wc.urls[2], 'https://dart.fss.or.kr/dsab007/main.do');
});
test('persistent failure is reported after bounded retries', async () => {
  const wc = contents([empty(), empty(), empty()]);
  await assert.rejects(connectDart(wc, () => {}, async () => {}), /ERR_EMPTY_RESPONSE/);
  assert.equal(wc.urls.length, 3);
});
test('certificate errors are not retried or bypassed', async () => {
  const wc = contents([new Error('ERR_CERT_AUTHORITY_INVALID')]);
  await assert.rejects(connectDart(wc, () => {}, async () => {}), /ERR_CERT/);
  assert.equal(wc.urls.length, 1);
});
