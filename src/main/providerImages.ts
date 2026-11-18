import { get } from 'node:https';
import { lookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const blocked = new BlockList();
for (const [ip, bits] of [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['224.0.0.0', 4], ['240.0.0.0', 4]] as const) blocked.addSubnet(ip, bits, 'ipv4');
for (const [ip, bits] of [['::', 96], ['64:ff9b::', 96], ['100::', 64], ['2001::', 32], ['2002::', 16], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8]] as const) blocked.addSubnet(ip, bits, 'ipv6');
blocked.addAddress('::1', 'ipv6');
const mappedV6 = new BlockList();
mappedV6.addSubnet('::ffff:0:0', 96, 'ipv6');

async function downloadImage(rawUrl: string, signal: AbortSignal, redirects = 0): Promise<Buffer> {
  const url = new URL(rawUrl);
  if (url.protocol !== 'https:' || url.username || url.password || redirects > 3) throw new Error('图片下载地址无效：仅支持公开 HTTPS 地址');
  const host = url.hostname.replace(/^\[|\]$/gu, '');
  const addresses = isIP(host) ? [{ address: host, family: isIP(host) }] : await lookup(host, { all: true });
  if (!addresses.length || addresses.some(({ address, family }) => blocked.check(address, family === 6 ? 'ipv6' : 'ipv4') || (family === 6 && mappedV6.check(address, 'ipv6')))) throw new Error('图片下载地址不能指向本机或内网');
  signal.throwIfAborted();
  const address = addresses[0];
  // Pin the validated IP; never send the relay API key to an image/CDN host.
  return new Promise((resolve, reject) => {
    const request = get(url, {
      signal, family: address.family,
      lookup: (_hostname, _options, callback) => callback(null, address.address, address.family)
    }, (response) => {
      if ([301, 302, 303, 307, 308].includes(response.statusCode ?? 0) && response.headers.location) {
        response.resume();
        void downloadImage(new URL(response.headers.location, url).href, signal, redirects + 1).then(resolve, reject);
        return;
      }
      if (response.statusCode !== 200) { response.resume(); reject(new Error(`图片下载失败：HTTP ${response.statusCode}`)); return; }
      if (Number(response.headers['content-length'] ?? 0) > MAX_IMAGE_BYTES) { response.destroy(); reject(new Error('生成图片超过 10 MB，请降低输出尺寸')); return; }
      const chunks: Buffer[] = [];
      let size = 0;
      response.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > MAX_IMAGE_BYTES) { response.destroy(); reject(new Error('生成图片超过 10 MB，请降低输出尺寸')); }
        else chunks.push(chunk);
      });
      response.on('end', () => resolve(Buffer.concat(chunks)));
      response.on('error', reject);
      response.on('aborted', () => reject(new Error('图片下载中断；未重新提交生图请求')));
    });
    request.on('error', reject);
  });
}

export async function readGeneratedImage(response: Response, signal: AbortSignal): Promise<{ bytes: Buffer; extension: string }> {
  const maxJsonBytes = Math.ceil(MAX_IMAGE_BYTES * 4 / 3) + 1024 * 1024;
  let raw: string;
  if (response.body?.getReader) {
    const reader = response.body.getReader();
    const chunks: Buffer[] = [];
    let size = 0;
    try {
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        size += part.value.byteLength;
        if (size > maxJsonBytes) throw new Error('生图响应过大，请降低输出尺寸');
        chunks.push(Buffer.from(part.value));
      }
      raw = Buffer.concat(chunks).toString('utf8');
    } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  } else raw = await response.text();
  if (Buffer.byteLength(raw) > maxJsonBytes) throw new Error('生图响应过大，请降低输出尺寸');
  let data: { error?: { message?: string }; data?: Array<{ b64_json?: string; url?: string }> };
  try { data = JSON.parse(raw); } catch { throw new Error('生图接口未返回有效 JSON；请检查中转站是否支持 /images/generations'); }
  if (data?.error) throw new Error(`生图失败：${String(data.error.message ?? '中转站返回错误').slice(0, 500)}`);
  const item = data?.data?.[0];
  let bytes: Buffer;
  if (typeof item?.b64_json === 'string' && item.b64_json) {
    const encoded = item.b64_json.replace(/\s/gu, '');
    if (!/^[A-Za-z0-9+/]+={0,2}$/u.test(encoded)) throw new Error('中转站返回了无效的图片 Base64');
    bytes = Buffer.from(encoded, 'base64');
  } else if (typeof item?.url === 'string' && item.url) bytes = await downloadImage(item.url, signal);
  else throw new Error('生图接口未返回图片（需要 data[0].b64_json 或 data[0].url）');
  if (!bytes.length || bytes.length > MAX_IMAGE_BYTES) throw new Error('生成图片为空或超过 10 MB');
  const extension = bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ? 'png'
    : bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff ? 'jpg'
    : bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP' ? 'webp' : undefined;
  if (!extension) throw new Error('中转站返回的内容不是支持的 PNG、JPEG 或 WebP 图片');
  return { bytes, extension };
}
