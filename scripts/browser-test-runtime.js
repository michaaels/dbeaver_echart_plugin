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
  if (timeout) {
    const newPage = browser.newPage.bind(browser);
    browser.newPage = async options => {
      const page = await newPage(options);
      page.setDefaultTimeout(timeout); page.setDefaultNavigationTimeout(timeout);
      return page;
    };
  }
  return browser;
}
module.exports = { launchBrowser };
