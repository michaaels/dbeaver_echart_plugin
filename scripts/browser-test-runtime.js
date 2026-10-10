'use strict';
const playwright = require('../.dev/browser-tests/node_modules/playwright');

/** Keep Windows on WebView2's Edge engine; exercise Linux with Chromium/WebKit. */
async function launchBrowser() {
  const engine = process.env.ECHARTS_TEST_BROWSER || (process.platform === 'win32' ? 'msedge' : 'chromium');
  if (!['msedge', 'chromium', 'webkit'].includes(engine)) throw new Error('ECHARTS_TEST_BROWSER must be msedge, chromium or webkit');
  const timeout = process.env.ECHARTS_TEST_TIMEOUT_MS ? Number(process.env.ECHARTS_TEST_TIMEOUT_MS) : undefined;
  if (timeout !== undefined && (!Number.isSafeInteger(timeout) || timeout < 1)) throw new Error('ECHARTS_TEST_TIMEOUT_MS must be a positive integer');
  const options = { headless: true, ...(timeout ? { timeout } : {}) };
  const browser = await (engine === 'msedge' ? playwright.chromium.launch({ ...options, channel: 'msedge' }) : playwright[engine].launch(options));
  // Fixtures assert exact formatted text; keep them independent of the host locale.
  // Native SWT checks separately exercise the operating system's real locale.
  for (const method of ['newContext', 'newPage']) {
    const create = browser[method].bind(browser);
    browser[method] = async options => {
      const target = await create({ locale: 'en-US', ...options });
      if (timeout) { target.setDefaultTimeout(timeout); target.setDefaultNavigationTimeout(timeout); }
      return target;
    };
  }
  return browser;
}
module.exports = { launchBrowser };
