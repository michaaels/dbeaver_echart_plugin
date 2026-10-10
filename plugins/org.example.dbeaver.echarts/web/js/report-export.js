(() => {
  'use strict';
  const escape = value => String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
  const safeJson = value => JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  const safeScript = value => value.replace(/<\/script/gi, '<\\/script');
  function interactive(report, snapshots, context, assets) {
    if (!assets?.echarts || !assets?.widgets || !assets?.paperCss) throw new Error('Report export assets are not available.');
    const portable = { title: report.title, page: report.page, widgets: report.widgets };
    const scripts = [assets.echarts, assets.worldMap, assets.analytics, assets.widgets].filter(Boolean).map(code => `<script>${safeScript(code)}</script>`).join('\n');
    const runtime = `const report=${safeJson(portable)};const data=${safeJson(snapshots)};const context=${safeJson({ generatedAt: context.generatedAt, parameters: context.parameters, tablePages: context.tablePages })};window.DBeaverReportWidgets.renderReport(document.getElementById('report'),report,data,context);`;
    return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(report.title)}</title><style>body{margin:0;background:#f3f6f9} .report-paper{max-width:100%}${assets.paperCss}</style></head><body><main id="report"></main>${scripts}<script>${runtime}</script><details style="margin:16px;font:12px sans-serif"><summary>Third-party licenses</summary><pre style="white-space:pre-wrap">${escape(assets.licenses || '')}</pre></details></body></html>`;
  }
  function chartImages(charts) {
    return Object.fromEntries([...charts].map(([id, chart]) => [id, chart.getDataURL({ type: 'png', pixelRatio: 2, backgroundColor: '#ffffff', excludeComponents: ['toolbox', 'dataZoom'] })]));
  }
  const INLINE = ['color', 'background-color', 'font-family', 'font-size', 'font-weight', 'line-height', 'text-align', 'vertical-align',
    'padding', 'margin', 'border', 'border-top', 'border-bottom', 'border-collapse', 'white-space'];
  function inlineStyles(root) {
    // Resolve descendant selectors before removing any ancestor classes.
    const styles = [];
    for (const element of [root, ...root.querySelectorAll('*')]) {
      const computed = getComputedStyle(element);
      styles.push([element, INLINE.map(property => [property, computed.getPropertyValue(property)])]);
    }
    for (const [element, properties] of styles) {
      for (const [property, value] of properties) if (value) element.style.setProperty(property, value);
      if (element.tagName === 'IMG') Object.assign(element.style, { width: element.classList.contains('report-chart-image') ? '100%' : 'auto', maxWidth: '100%', height: 'auto', display: 'block' });
      if (element.tagName === 'TABLE') { element.setAttribute('width', '100%'); element.setAttribute('cellpadding', '0'); element.setAttribute('cellspacing', '0'); }
      element.removeAttribute('class');
    }
  }
  function emailHtml(report, snapshots, context, images) {
    const W = window.DBeaverReportWidgets, mount = W.node('div');
    mount.className = 'report-paper'; mount.style.position = 'absolute'; mount.style.left = '-10000px'; mount.style.width = `${report.page.width}px`; mount.style.padding = `${report.page.margin}px`;
    document.body.append(mount);
    try {
      function group(parentId, host) {
        const table = W.node('table'); table.setAttribute('role', 'presentation'); table.setAttribute('width', '100%'); table.setAttribute('cellpadding', '0'); table.setAttribute('cellspacing', '0');
        table.style.borderCollapse = 'collapse'; table.style.tableLayout = 'fixed';
        const columns = W.node('colgroup');
        for (let i = 0; i < 12; i++) { const column = W.node('col'); column.setAttribute('width', `${100 / 12}%`); columns.append(column); }
        table.append(columns); host.append(table);
        const rows = new Map();
        for (const widget of report.widgets.filter(widget => (widget.parentId || null) === parentId).sort((a, b) => a.layout.y - b.layout.y || a.layout.x - b.layout.x)) {
          if (!W.visible(widget, snapshots[widget.sourceId])) continue;
          if (!rows.has(widget.layout.y)) rows.set(widget.layout.y, []);
          rows.get(widget.layout.y).push(widget);
        }
        for (const widgets of rows.values()) {
          const row = W.node('tr'); table.append(row); let column = 0;
          for (const widget of widgets) {
            if (widget.layout.x > column) { const spacer = W.node('td', '\u00a0'); spacer.colSpan = widget.layout.x - column; spacer.setAttribute('width', `${(widget.layout.x - column) / 12 * 100}%`); row.append(spacer); }
            const cell = W.node('td'); cell.colSpan = widget.layout.width; cell.setAttribute('width', `${widget.layout.width / 12 * 100}%`); cell.setAttribute('valign', 'top'); cell.style.padding = `${report.page.gap / 2}px`;
            row.append(cell);
            const body = W.node('div'); cell.append(body);
            if (widget.type === 'table') {
              const height = widget.layout.height * 24 + (widget.layout.height - 1) * report.page.gap;
              body.className = 'report-component-body'; body.style.height = `${height}px`; cell.setAttribute('height', String(height));
            } else body.style.minHeight = `${Math.min(widget.layout.height * 24, 100)}px`;
            W.renderWidget(body, widget, snapshots[widget.sourceId], { ...context, chartImages: images, staticTable: true });
            if (W.registry.get(widget.type)?.container) group(widget.id, body);
            column = widget.layout.x + widget.layout.width;
          }
          if (column < 12) { const spacer = W.node('td', '\u00a0'); spacer.colSpan = 12 - column; spacer.setAttribute('width', `${(12 - column) / 12 * 100}%`); row.append(spacer); }
        }
        return table;
      }
      group(null, mount); inlineStyles(mount);
      const content = mount.innerHTML;
      return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(report.title)}</title></head><body style="margin:0;background:#f3f6f9;font-family:Segoe UI,Arial,sans-serif;color:#243447"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center"><table role="presentation" width="${report.page.width}" cellpadding="0" cellspacing="0" style="width:100%;max-width:${report.page.width}px;background:${report.page.background}"><tr><td style="padding:${report.page.margin}px">${content}</td></tr></table></td></tr></table></body></html>`;
    } finally { mount.remove(); }
  }
  function base64(value) {
    const bytes = new TextEncoder().encode(value); let binary = '';
    for (let index = 0; index < bytes.length; index += 32768) binary += String.fromCharCode(...bytes.subarray(index, index + 32768));
    return btoa(binary);
  }
  const wrap = encoded => (encoded.match(/.{1,76}/g) || ['']).join('\r\n');
  function header(value) {
    if (/[\r\n]/.test(value)) throw new Error('Email headers cannot contain line breaks.');
    const words = []; let chunk = '';
    for (const character of value) {
      if (new TextEncoder().encode(chunk + character).length > 42) { words.push(`=?UTF-8?B?${base64(chunk)}?=`); chunk = ''; }
      chunk += character;
    }
    if (chunk) words.push(`=?UTF-8?B?${base64(chunk)}?=`);
    return words.join('\r\n ');
  }
  function addresses(value, required = false) {
    if (/[\r\n]/.test(value)) throw new Error('Recipients cannot contain line breaks.');
    const list = value.split(/[,;]/).map(item => item.trim()).filter(Boolean);
    if ((required && !list.length) || list.length > 100 || list.some(item => !/^[^\s<>@,;]+@[^\s<>@,;]+\.[^\s<>@,;]+$/.test(item))) throw new Error('Enter email addresses separated by commas.');
    return list.join(', ');
  }
  function withMessage(html, message) {
    return message?.trim() ? html.replace(/<body([^>]*)>/i, (match, attributes) => `<body${attributes}><p style="margin:16px;font-family:Segoe UI,Arial,sans-serif;white-space:pre-wrap">${escape(message)}</p>`) : html;
  }
  function eml({ to, cc, subject, message, html, attachment, title }) {
    const boundary = `report-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`, related = boundary + '-related';
    const images = new Map();
    const body = withMessage(html, message).replace(/data:image\/(png|jpeg|gif|webp);base64,([A-Za-z0-9+/=]+)/g, (url, type, encoded) => {
      if (!images.has(url)) images.set(url, { cid: `image-${images.size + 1}@echarts-report`, type, encoded });
      return `cid:${images.get(url).cid}`;
    });
    const lines = ['MIME-Version: 1.0', 'X-Unsent: 1', `To: ${addresses(to, true)}`, ...(cc.trim() ? [`Cc: ${addresses(cc)}`] : []),
      `Subject: ${header(subject || title)}`, `Content-Type: multipart/mixed; boundary="${boundary}"`, '',
      `--${boundary}`, `Content-Type: multipart/related; boundary="${related}"`, '', `--${related}`,
      'Content-Type: text/html; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', wrap(base64(body))];
    for (const { cid, type, encoded } of images.values()) lines.push(`--${related}`, `Content-Type: image/${type}`, 'Content-Transfer-Encoding: base64', `Content-ID: <${cid}>`, 'Content-Disposition: inline', '', wrap(encoded));
    lines.push(`--${related}--`);
    if (attachment) lines.push(`--${boundary}`, 'Content-Type: text/html; charset=UTF-8; name="report.html"',
      'Content-Disposition: attachment; filename="report.html"', 'Content-Transfer-Encoding: base64', '', wrap(base64(attachment)));
    lines.push(`--${boundary}--`, '');
    return lines.join('\r\n');
  }
  window.DBeaverReportExport = Object.freeze({ interactive, emailHtml, chartImages, eml, withMessage, escape, safeJson });
})();
