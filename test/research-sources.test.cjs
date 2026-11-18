'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { Readable } = require('node:stream');
const https = require('node:https');
const dns = require('node:dns/promises');
const { searchResearch, searchCode, readResearchSource } = require('./load-ts.cjs')('src/main/researchSources.ts');

const PUBLIC = { address: '93.184.216.34', family: 4 };
const TEXT = 'Offline research fixture evidence with enough readable text. ';
function mockNetwork(t, route = () => ({}), addresses = [PUBLIC]) {
  const requests = [], lookups = [];
  t.mock.method(dns, 'lookup', async (host, options) => {
    lookups.push({ host, options });
    return typeof addresses === 'function' ? addresses(host) : addresses;
  });
  t.mock.method(https, 'get', (url, options, callback) => {
    assert.equal(url.protocol, 'https:', 'never use live HTTP');
    const request = new EventEmitter();
    const record = { url: new URL(url), options }; requests.push(record);
    const response = route(record.url, options) ?? {};
    const abort = () => request.emit('error', Object.assign(new Error('offline abort'), { name: 'AbortError' }));
    options.signal.addEventListener('abort', abort, { once: true });
    process.nextTick(() => {
      if (response.hang) return;
      if (response.error) { options.signal.removeEventListener('abort', abort); request.emit('error', response.error); return; }
      const stream = Readable.from(response.chunks ?? [Buffer.from(response.body ?? TEXT.repeat(4))]);
      stream.statusCode = response.status ?? 200;
      stream.headers = { 'content-type': response.type ?? 'text/plain; charset=utf-8', ...(response.headers ?? {}) };
      stream.on('close', () => options.signal.removeEventListener('abort', abort));
      callback(stream);
      if (response.incomplete) stream.destroy(new Error('offline truncated response'));
    });
    return request;
  });
  return { requests, lookups };
}
function mockDate(t, iso) {
  const OriginalDate = Date;
  globalThis.Date = class extends OriginalDate {
    constructor(...args) { super(...(args.length ? args : [iso])); }
    static now() { return new OriginalDate(iso).getTime(); }
  };
  t.after(() => { globalThis.Date = OriginalDate; });
}
function mockPdf(t, parse) {
  const filename = require.resolve('pdf-parse');
  const previous = require.cache[filename];
  require.cache[filename] = { exports: parse };
  t.after(() => { if (previous) require.cache[filename] = previous; else delete require.cache[filename]; });
}

test('research sources validate every DNS result and pin the chosen public address', async t => {
  const network = mockNetwork(t);
  const result = await readResearchSource('https://source-fixture.org/paper');
  assert.match(result.text, /Offline research fixture/);
  assert.equal(result.url, 'https://source-fixture.org/paper');
  assert.deepEqual(network.lookups, [{ host: 'source-fixture.org', options: { all: true } }]);
  const { options } = network.requests[0];
  assert.equal(options.family, 4); assert.ok(options.headers['User-Agent']);
  assert.equal(options.headers.Authorization, undefined); assert.equal(options.headers.Cookie, undefined);
  assert.equal(options.headers['Accept-Encoding'], 'identity');
  options.lookup('dns-rebinding-must-not-resolve', {}, (error, address, family) => {
    assert.equal(error, null); assert.equal(address, PUBLIC.address); assert.equal(family, 4);
  });
  assert.equal(network.lookups.length, 1);
});

test('research sources fail closed for unsafe URL and literal IP forms', async t => {
  const cases = ['http://source-fixture.org/paper', 'file:///D:/private/paper.pdf', 'https://user:pass@source-fixture.org/paper', 'https://localhost/', 'https://private.lan/', 'https://intranet/', 'https://127.0.0.1/', 'https://2130706433/', 'https://10.1.2.3/', 'https://169.254.169.254/', 'https://192.0.2.1/', 'https://[::1]/', 'https://[::ffff:7f00:1]/', 'https://[2001:db8::1]/', 'https://[2002:0808:0808::1]/', 'https://[fc00::1]/'];
  for (const url of cases) await t.test(url, async child => {
    const network = mockNetwork(child);
    await assert.rejects(readResearchSource(url));
    assert.equal(network.requests.length, 0, 'unsafe addresses must not reach HTTPS');
  });
});

test('research sources reject a hostname if any DNS answer is private', async t => {
  const network = mockNetwork(t, () => ({}), [PUBLIC, { address: '10.10.0.1', family: 4 }]);
  await assert.rejects(readResearchSource('https://mixed-fixture.org/paper'), /内网|保留地址/);
  assert.equal(network.requests.length, 0);
});

test('research sources reject unresolvable hostnames', async t => {
  const network = mockNetwork(t, () => ({}), async () => { throw new Error('offline DNS failure'); });
  await assert.rejects(readResearchSource('https://source-fixture.org/paper'), /无法解析/);
  assert.equal(network.requests.length, 0);
});

test('research sources support public IPv6 and pin its address', async t => {
  const network = mockNetwork(t);
  await readResearchSource('https://[2606:4700::1111]/paper');
  assert.equal(network.lookups.length, 0);
  network.requests[0].options.lookup('ignored', {}, (error, address, family) => {
    assert.equal(error, null); assert.equal(address, '2606:4700::1111'); assert.equal(family, 6);
  });
});

test('research sources revalidate redirects and refuse a private next hop', async t => {
  const network = mockNetwork(t, () => ({ status: 302, headers: { location: 'https://169.254.169.254/secret' } }));
  await assert.rejects(readResearchSource('https://source-fixture.org/redirect'), /内网|保留地址/);
  assert.equal(network.requests.length, 1);
});

test('research sources resolve relative redirects and cap the chain at three hops', async t => {
  const network = mockNetwork(t, url => ({ status: 302, headers: { location: '/redirect/' + (Number(url.pathname.split('/').at(-1)) + 1) } }));
  await assert.rejects(readResearchSource('https://source-fixture.org/redirect/0'), /最多跳转 3/);
  assert.deepEqual(network.requests.map(item => item.url.pathname), ['/redirect/0', '/redirect/1', '/redirect/2', '/redirect/3']);
  assert.equal(network.lookups.length, 4);
});

test('research sources enforce both advertised and chunked body size limits', async t => {
  await t.test('content-length', async child => {
    mockNetwork(child, () => ({ headers: { 'content-length': String(20 * 1024 * 1024 + 1) } }));
    await assert.rejects(readResearchSource('https://source-fixture.org/large'), /超过 20 MB/);
  });
  await t.test('chunked bytes', async child => {
    mockNetwork(child, () => ({ chunks: [Buffer.alloc(10 * 1024 * 1024), Buffer.alloc(10 * 1024 * 1024 + 1)] }));
    await assert.rejects(readResearchSource('https://source-fixture.org/large'), /超过 20 MB/);
  });
});

test('research sources enforce the 20-second timeout while DNS is pending', async t => {
  const schedule = globalThis.setTimeout;
  const timeouts = [];
  t.mock.method(globalThis, 'setTimeout', (callback, milliseconds, ...args) => { timeouts.push(milliseconds); return schedule(callback, milliseconds === 20000 ? 5 : milliseconds, ...args); });
  const network = mockNetwork(t, () => ({}), () => new Promise(() => {}));
  await assert.rejects(readResearchSource('https://source-fixture.org/paper'), /超过 20 秒/);
  assert.ok(timeouts.includes(20000)); assert.equal(network.requests.length, 0);
});

test('research sources abort a stalled HTTPS body', async t => {
  const schedule = globalThis.setTimeout;
  t.mock.method(globalThis, 'setTimeout', (callback, milliseconds, ...args) => schedule(callback, milliseconds === 20000 ? 5 : milliseconds, ...args));
  const network = mockNetwork(t, () => ({ hang: true }));
  await assert.rejects(readResearchSource('https://source-fixture.org/paper'), /超过 20 秒/);
  assert.equal(network.requests.length, 1);
});

test('research source segments stay bounded and nextOffset continues the extracted text', async t => {
  const content = TEXT.repeat(1200);
  mockNetwork(t, () => ({ body: content }));
  const first = await readResearchSource('https://source-fixture.org/paper');
  assert.equal(first.text.length, 30000); assert.ok(first.nextOffset > 29000);
  const second = await readResearchSource('https://source-fixture.org/paper', first.nextOffset);
  const firstBody = first.text.slice(first.text.indexOf('\n') + 1);
  const secondBody = second.text.slice(second.text.indexOf('\n') + 1);
  assert.equal(firstBody, content.trim().slice(0, first.nextOffset));
  assert.equal(secondBody, content.trim().slice(first.nextOffset, second.nextOffset));
  assert.ok(second.text.length <= 30000);
  await assert.rejects(readResearchSource('https://source-fixture.org/paper', -1), /偏移无效/);
  await assert.rejects(readResearchSource('https://source-fixture.org/paper', 0.5), /偏移无效/);
  await assert.rejects(readResearchSource('https://source-fixture.org/paper', 1000000), /超过来源文本/);
});

test('research sources extract HTML text without scripts or active markup', async t => {
  mockNetwork(t, () => ({ type: 'text/html; charset=utf-8', body: '<html><script>do_not_execute()</script><style>.hidden{}</style><p>Visible research &amp; evidence, with enough readable text for a useful source excerpt.</p><p>Second &#x4e2d;&#25991; paragraph.</p></html>' }));
  const result = await readResearchSource('https://source-fixture.org/paper');
  assert.match(result.text, /Visible research & evidence/); assert.match(result.text, /中文/);
  assert.ok(!result.text.includes('do_not_execute')); assert.ok(!result.text.includes('<p>')); assert.ok(!result.text.includes('.hidden'));
});

test('research sources report unsupported, incomplete or insufficient content clearly', async t => {
  for (const [name, response, error] of [
    ['image', { type: 'image/png' }, /不受支持/],
    ['missing type', { type: '' }, /不受支持/],
    ['compressed', { headers: { 'content-encoding': 'gzip' } }, /压缩格式/],
    ['short extraction', { body: 'short' }, /文本不足.*OCR/],
    ['denied', { status: 403 }, /HTTP 403/],
    ['incomplete response', { incomplete: true }, /无法读取|中断/]
  ]) await t.test(name, async child => {
    mockNetwork(child, () => response);
    await assert.rejects(readResearchSource('https://source-fixture.org/paper'), error);
  });
});

test('research paper search uses exact six-calendar-month bounds including short months', async t => {
  for (const [today, expected] of [['2026-11-17T12:00:00Z', '2026-05-17'], ['2026-08-31T12:00:00Z', '2026-02-28'], ['2024-08-31T12:00:00Z', '2024-02-29']]) await t.test(today, async child => {
    mockDate(child, today);
    const network = mockNetwork(child, () => ({ type: 'application/json', body: JSON.stringify({ message: { items: [] } }) }));
    const result = await searchResearch('optical SAR change detection');
    const url = network.requests[0].url;
    assert.equal(url.origin + url.pathname, 'https://api.crossref.org/works');
    assert.equal(url.searchParams.get('rows'), '6'); assert.equal(url.searchParams.get('query'), 'optical SAR change detection');
    assert.equal(url.searchParams.get('filter'), `from-pub-date:${expected},until-pub-date:${today.slice(0, 10)}`);
    assert.deepEqual(result.publicationDateRange, { from: expected, through: today.slice(0, 10) });
  });
});

test('research paper search returns dated source metadata and labels abstracts as partial', async t => {
  mockNetwork(t, () => ({ type: 'application/json', body: JSON.stringify({ message: { items: [
    { title: ['Offline paper'], URL: 'https://source-fixture.org/paper', DOI: '10.fixture/paper', 'published-online': { 'date-parts': [[2026, 10, 2]] }, abstract: '<jats:p>Source abstract only.</jats:p>' },
    { title: ['Undated fixture'] }
  ] } }) }));
  const result = await searchResearch('fixture');
  assert.equal(result.source, 'Crossref');
  assert.deepEqual(result.items[0], { title: 'Offline paper', URL: 'https://source-fixture.org/paper', DOI: '10.fixture/paper', published: '2026-10-02', dateSource: 'Crossref.published-online', abstract: 'Source abstract only.', abstractIsFullPaper: false });
  assert.equal(result.items[1].published, null); assert.equal(result.items[1].abstract, null);
  assert.match(result.limitation, /列表不完整/); assert.match(result.limitation, /不代表最佳/); assert.match(result.limitation, /不是论文全文/);
});

test('research code search returns GitHub metadata without treating updates as publication dates', async t => {
  const network = mockNetwork(t, () => ({ type: 'application/json', body: JSON.stringify({ incomplete_results: true, total_count: 12, items: [{ full_name: 'fixture/research', html_url: 'https://github.com/fixture/research', stargazers_count: 42, updated_at: '2026-10-03T00:00:00Z', description: 'Offline metadata' }] }) }));
  const result = await searchCode('fixture');
  const url = network.requests[0].url;
  assert.equal(url.origin + url.pathname, 'https://api.github.com/search/repositories'); assert.equal(url.searchParams.get('per_page'), '5'); assert.equal(url.searchParams.get('q'), 'fixture');
  assert.deepEqual(result.items[0], { name: 'fixture/research', URL: 'https://github.com/fixture/research', stars: 42, updatedAt: '2026-10-03T00:00:00Z', description: 'Offline metadata' });
  assert.equal(result.incomplete, true); assert.equal(result.totalCount, 12);
  assert.match(result.limitation, /不代表论文发表时间/); assert.match(result.limitation, /不证明.*官方实现/);
});

test('research source searches reject malformed remote metadata and empty queries', async t => {
  mockNetwork(t, () => ({ type: 'application/json', body: 'null' }));
  await assert.rejects(searchResearch('fixture'), /结果格式无效/);
  await assert.rejects(searchCode('fixture'), /结果格式无效/);
  await assert.rejects(searchResearch(' '), /检索词不能为空/);
  await assert.rejects(searchCode('x'.repeat(2001)), /最多 2000/);
});

test('research sources read bounded partial PDF text and explain extraction limits', async t => {
  mockNetwork(t, () => ({ type: 'application/pdf', body: '%PDF-offline-fixture' }));
  let parses = 0;
  mockPdf(t, async (bytes, options) => { parses++; assert.match(bytes.toString(), /^%PDF-/); assert.equal(options.max, 200); return { text: TEXT.repeat(1000) }; });
  const result = await readResearchSource('https://source-fixture.org/paper.pdf');
  assert.equal(parses, 1); assert.ok(result.nextOffset); assert.ok(result.text.length <= 30000);
  assert.match(result.text, /不保证完整论文/); assert.match(result.text, /最多提取前 200 页/);
});

test('research sources do not claim to read scanned or broken PDF content', async t => {
  for (const [name, parse, error] of [
    ['scanned PDF', async () => ({ text: ' \n\n ' }), /文本不足.*OCR/],
    ['encrypted or broken PDF', async () => { throw new Error('offline parser failure'); }, /PDF 文本提取失败.*未读取到全文/]
  ]) await t.test(name, async child => {
    mockNetwork(child, () => ({ type: 'application/pdf', body: '%PDF-offline-fixture' })); mockPdf(child, parse);
    await assert.rejects(readResearchSource('https://source-fixture.org/paper.pdf'), error);
  });
});
