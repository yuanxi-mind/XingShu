import { get } from 'node:https';
import { lookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';

const MAX_BYTES = 20 * 1024 * 1024;
const MAX_SEGMENT = 30_000;
const blocked = new BlockList();
for (const [ip, bits] of [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4]] as const) blocked.addSubnet(ip, bits, 'ipv4');
const globalV6 = new BlockList();
globalV6.addSubnet('2000::', 3, 'ipv6');
for (const [ip, bits] of [['2001::', 23], ['2001:db8::', 32], ['2002::', 16], ['3fff::', 20]] as const) blocked.addSubnet(ip, bits, 'ipv6');

interface Download { url: string; bytes: Buffer; contentType: string }

async function download(url: URL, signal: AbortSignal, redirects = 0): Promise<Download> {
  if (url.protocol !== 'https:' || url.username || url.password || redirects > 3 || url.href.length > 8_192) throw new Error('只允许不含账号密码的公开 HTTPS 来源，最多跳转 3 次');
  const host = url.hostname.replace(/^\[|\]$/gu, '').toLowerCase();
  if (!isIP(host) && (!host.includes('.') || /(?:^|\.)(?:localhost|local|internal|intranet|lan|home|test|invalid|example|onion)$/u.test(host.replace(/\.$/u, '')))) throw new Error('来源不能是本机或内网地址');
  const addresses = await new Promise<Array<{ address: string; family: number }>>((resolve, reject) => {
    const abort = () => reject(new Error('来源读取超时'));
    signal.addEventListener('abort', abort, { once: true });
    const resolution = isIP(host) ? Promise.resolve([{ address: host, family: isIP(host) }]) : lookup(host, { all: true });
    resolution.then(resolve, () => reject(new Error('无法解析来源地址'))).finally(() => signal.removeEventListener('abort', abort));
    if (signal.aborted) abort();
  });
  if (!addresses.length || addresses.some(({ address, family }) => ![4, 6].includes(family) || isIP(address) !== family || blocked.check(address, family === 6 ? 'ipv6' : 'ipv4') || (family === 6 && !globalV6.check(address, 'ipv6')))) throw new Error('来源解析到本机、内网或保留地址，已拒绝读取');
  signal.throwIfAborted();
  const address = addresses[0];
  // Pin the checked address so DNS cannot change the connection target.
  return new Promise((resolve, reject) => {
    const request = get(url, {
      signal, family: address.family,
      headers: { 'User-Agent': 'Xingshu-Research/0.4', Accept: 'application/json, text/html, application/pdf, text/plain;q=0.9, */*;q=0.5', 'Accept-Encoding': 'identity' },
      lookup: (_hostname, _options, callback) => callback(null, address.address, address.family)
    }, response => {
      if ([301, 302, 303, 307, 308].includes(response.statusCode ?? 0) && response.headers.location) {
        response.destroy();
        let next: URL;
        try { next = new URL(response.headers.location, url); } catch { reject(new Error('来源跳转地址无效')); return; }
        void download(next, signal, redirects + 1).then(resolve, reject);
        return;
      }
      if (response.statusCode !== 200) { response.destroy(); reject(new Error(`来源读取失败：HTTP ${response.statusCode}`)); return; }
      if (response.headers['content-encoding'] && response.headers['content-encoding'] !== 'identity') { response.destroy(); reject(new Error('来源返回不支持的压缩格式')); return; }
      if (Number(response.headers['content-length'] ?? 0) > MAX_BYTES) { response.destroy(); reject(new Error('来源超过 20 MB，已停止读取')); return; }
      const chunks: Buffer[] = [];
      let size = 0;
      response.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > MAX_BYTES) { response.destroy(); reject(new Error('来源超过 20 MB，已停止读取')); }
        else chunks.push(chunk);
      });
      response.on('end', () => resolve({ url: url.href, bytes: Buffer.concat(chunks), contentType: response.headers['content-type'] ?? '' }));
      response.on('error', reject);
      response.on('aborted', () => reject(new Error('来源连接中断，未提取完整内容')));
    });
    request.on('error', reject);
  });
}

async function fetchPublic(rawUrl: string): Promise<Download> {
  let url: URL;
  try { url = new URL(rawUrl); } catch { throw new Error('来源 URL 无效'); }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  try { return await download(url, controller.signal); }
  catch (error) {
    if (controller.signal.aborted) throw new Error('来源读取超过 20 秒，已停止');
    if (error instanceof Error && /只允许|来源|无法解析/u.test(error.message)) throw error;
    throw new Error('无法读取公开来源，请检查地址、网络、证书或网站访问限制');
  } finally { clearTimeout(timer); }
}

function plainHtml(html: string): string {
  const entities: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
  return html.replace(/<!--[\s\S]*?(?:-->|$)/gu, ' ').replace(/<(script|style|noscript|template|svg)\b[^<>]*>[\s\S]*?(?:<\/\1\s*>|$)/giu, ' ')
    .replace(/<\/?(?:p|div|section|article|h[1-6]|li|br|tr|blockquote)\b[^<>]*>/giu, '\n').replace(/<[^<>]*>/gu, ' ')
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/giu, (original, entity: string) => {
      if (!entity.startsWith('#')) return entities[entity.toLowerCase()] ?? original;
      const code = entity[1]?.toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
      return Number.isInteger(code) && code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : ' ';
    }).replace(/[ \t\r\f]+/gu, ' ').replace(/ *\n */gu, '\n').replace(/\n{3,}/gu, '\n\n').trim();
}

function queryText(value: string): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 2_000) throw new Error('检索词不能为空，且最多 2000 字符');
  return value.trim();
}

function decode(downloaded: Download): string {
  const charset = downloaded.contentType.match(/charset\s*=\s*["']?([^;\s"']+)/iu)?.[1] ?? 'utf-8';
  try { return new TextDecoder(charset).decode(downloaded.bytes); }
  catch { throw new Error('来源文本编码不受支持，未能提取正文'); }
}

export async function searchResearch(query: string): Promise<unknown> {
  const now = new Date();
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 6, 1));
  from.setUTCDate(Math.min(now.getUTCDate(), new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + 1, 0)).getUTCDate()));
  const startDate = from.toISOString().slice(0, 10);
  const endDate = now.toISOString().slice(0, 10);
  const url = new URL('https://api.crossref.org/works');
  url.search = new URLSearchParams({ query: queryText(query), filter: `from-pub-date:${startDate},until-pub-date:${endDate}`, rows: '6', sort: 'relevance' }).toString();
  const downloaded = await fetchPublic(url.href);
  let data: { message?: { items?: Array<Record<string, unknown>> } };
  try { data = JSON.parse(decode(downloaded)); } catch { throw new Error('Crossref 未返回有效检索数据'); }
  if (!Array.isArray(data?.message?.items) || data.message.items.some(item => !item || typeof item !== 'object' || Array.isArray(item))) throw new Error('Crossref 检索结果格式无效');
  const items = data.message.items.slice(0, 6).map(item => {
    const dateSource = ['published', 'published-online', 'published-print', 'issued'].find(key => {
      const value = item[key] as { 'date-parts'?: unknown[][] } | undefined;
      return Array.isArray(value?.['date-parts']?.[0]) && value!['date-parts']![0].length > 0;
    });
    const parts = dateSource ? (item[dateSource] as { 'date-parts': unknown[][] })['date-parts'][0] : [];
    const date = parts.slice(0, 3).filter(value => typeof value === 'number').map((value, index) => String(value).padStart(index ? 2 : 4, '0')).join('-');
    return { title: Array.isArray(item.title) ? String(item.title[0] ?? '') : '', URL: typeof item.URL === 'string' ? item.URL : '', DOI: typeof item.DOI === 'string' ? item.DOI : '', published: date || null,
      dateSource: dateSource ? `Crossref.${dateSource}` : '未提供发表日期', abstract: typeof item.abstract === 'string' ? plainHtml(item.abstract).slice(0, 20_000) : null, abstractIsFullPaper: false };
  });
  return { source: 'Crossref', url: downloaded.url, query, publicationDateRange: { from: startDate, through: endDate }, items,
    limitation: '仅返回 Crossref 收录的相关结果，列表不完整，不代表最佳或全部论文；摘要由来源提供，不是论文全文。' };
}

export async function searchCode(query: string): Promise<unknown> {
  const url = new URL('https://api.github.com/search/repositories');
  url.search = new URLSearchParams({ q: queryText(query), per_page: '5' }).toString();
  const downloaded = await fetchPublic(url.href);
  let data: { items?: Array<Record<string, unknown>>; incomplete_results?: boolean; total_count?: number };
  try { data = JSON.parse(decode(downloaded)); } catch { throw new Error('GitHub 未返回有效检索数据'); }
  if (!Array.isArray(data?.items) || data.items.some(item => !item || typeof item !== 'object' || Array.isArray(item))) throw new Error('GitHub 仓库检索结果格式无效');
  return { source: 'GitHub Repository Search API', url: downloaded.url, query, incomplete: data.incomplete_results === true, totalCount: data.total_count,
    items: data.items.slice(0, 5).map(item => ({ name: item.full_name, URL: item.html_url, stars: item.stargazers_count, updatedAt: item.updated_at, description: typeof item.description === 'string' ? item.description.slice(0, 4_000) : null })),
    limitation: '仅为 GitHub 官方 API 返回的仓库元数据，不证明仓库是论文作者官方实现；更新时间不代表论文发表时间，列表不完整。' };
}

export async function readResearchSource(url: string, offset = 0): Promise<{ url: string; text: string; nextOffset?: number }> {
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > 20_000_000) throw new Error('来源读取偏移无效');
  const downloaded = await fetchPublic(url);
  const type = downloaded.contentType.split(';')[0].trim().toLowerCase();
  let text: string;
  if (type === 'application/pdf' || downloaded.bytes.subarray(0, 5).toString('ascii') === '%PDF-') {
    try {
      const parse = require('pdf-parse') as (buffer: Buffer, options: { max: number }) => Promise<{ text: string }>;
      text = (await parse(downloaded.bytes, { max: 200 })).text;
    } catch { throw new Error('PDF 文本提取失败；可能是加密文件、扫描件或格式不受支持，未读取到全文'); }
  } else if (type === 'text/html' || type === 'application/xhtml+xml') text = plainHtml(decode(downloaded));
  else if (type.startsWith('text/') || ['application/json', 'application/xml'].includes(type)) text = decode(downloaded);
  else throw new Error(`来源内容类型不受支持：${type || '未提供'}；只支持文本、HTML 和 PDF`);
  text = text.replace(/\0/gu, '').trim();
  if (!text || text.replace(/\s/gu, '').length < 40) throw new Error('来源可提取文本不足；可能需要 OCR、登录或其他访问权限，不能据此声称已阅读论文全文');
  if (offset >= text.length) throw new Error('读取偏移已超过来源文本长度');
  const prefix = `[来源可提取文本片段，字符偏移 ${offset}；不保证完整论文，PDF 最多提取前 200 页。]\n`;
  const end = Math.min(text.length, offset + MAX_SEGMENT - prefix.length);
  return { url: downloaded.url, text: prefix + text.slice(offset, end), ...(end < text.length ? { nextOffset: end } : {}) };
}
