import { classifyNewsItem } from '../src/news.js';

const entities = new Map([['amp','&'],['lt','<'],['gt','>'],['quot','"'],['apos',"'"],['#39',"'"]]);
const decode = value => String(value || '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (_, key) => {
  if (key[0] === '#') {
    const hex = key[1]?.toLowerCase() === 'x';
    return String.fromCodePoint(Number.parseInt(key.slice(hex ? 2 : 1), hex ? 16 : 10));
  }
  return entities.get(key.toLowerCase()) || `&${key};`;
}).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const tag = (xml, name) => decode(xml.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, 'i'))?.[1]);

export function parseGoogleNewsXml(xml) {
  return [...String(xml || '').matchAll(/<item>([\s\S]*?)<\/item>/gi)].map(match => {
    const body = match[1];
    const rawTitle = tag(body, 'title');
    const url = tag(body, 'link');
    const source = tag(body, 'source') || 'Google News';
    const escapedSource = source.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const title = rawTitle.replace(new RegExp(`\\s+-\\s+${escapedSource}$`, 'i'), '').trim();
    const item = {
      id: tag(body, 'guid') || url,
      title,
      url,
      source,
      publishedAt: new Date(tag(body, 'pubDate') || 0).toISOString()
    };
    return { ...item, type: classifyNewsItem(item) };
  }).filter(item => item.title && item.url.startsWith('https://'));
}

function extractJsonObject(html, marker = 'ytInitialData') {
  const markerIndex = html.indexOf(marker);
  if (markerIndex < 0) return null;
  const start = html.indexOf('{', markerIndex + marker.length);
  if (start < 0) return null;
  let depth = 0, quoted = false, escaped = false;
  for (let index = start; index < html.length; index += 1) {
    const char = html[index];
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') quoted = false;
      continue;
    }
    if (char === '"') { quoted = true; continue; }
    if (char === '{') depth += 1;
    if (char === '}' && --depth === 0) return html.slice(start, index + 1);
  }
  return null;
}

const textOf = value => value?.simpleText || value?.runs?.map(run => run.text).join('') || '';
function approximateDate(relative, now) {
  const text = String(relative || '').toLocaleLowerCase('ko-KR');
  const match = text.match(/(\d+)\s*(분|시간|일|주|개월|달|년|minute|hour|day|week|month|year)/i);
  if (!match) return now.toISOString();
  const amount = Number(match[1]);
  const unit = match[2].toLocaleLowerCase('ko-KR');
  const hours = /분|minute/.test(unit) ? amount / 60 : /시간|hour/.test(unit) ? amount : /일|day/.test(unit) ? amount * 24 : /주|week/.test(unit) ? amount * 168 : /개월|달|month/.test(unit) ? amount * 720 : amount * 8760;
  return new Date(now.getTime() - hours * 3_600_000).toISOString();
}

export function parseYouTubeInitialData(html, now = new Date()) {
  const json = extractJsonObject(String(html || ''));
  if (!json) return [];
  let data;
  try { data = JSON.parse(json); } catch { return []; }
  const videos = [];
  const seen = new Set();
  const walk = value => {
    if (!value || typeof value !== 'object' || videos.length >= 12) return;
    const renderer = value.videoRenderer;
    if (renderer?.videoId && !seen.has(renderer.videoId)) {
      seen.add(renderer.videoId);
      const relativeTime = textOf(renderer.publishedTimeText);
      const thumbnails = renderer.thumbnail?.thumbnails || [];
      videos.push({
        id: `youtube-${renderer.videoId}`,
        type: 'video',
        title: textOf(renderer.title),
        url: `https://www.youtube.com/watch?v=${renderer.videoId}`,
        source: textOf(renderer.ownerText) || textOf(renderer.longBylineText) || 'YouTube',
        publishedAt: approximateDate(relativeTime, now),
        relativeTime,
        thumbnail: thumbnails.at(-1)?.url || `https://i.ytimg.com/vi/${renderer.videoId}/hqdefault.jpg`
      });
    }
    for (const child of Array.isArray(value) ? value : Object.values(value)) walk(child);
  };
  walk(data);
  return videos.filter(item => item.title);
}
