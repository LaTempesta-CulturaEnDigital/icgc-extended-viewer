import type { Json } from './manifest';

export interface Rect { x: number; y: number; width: number; height: number }
export interface Annotation { id: string; rect: Rect; text: string; label: string; category: string; paragraph: boolean; resource: Json }
export interface Region { rect: Rect; versions: Annotation[] }

export function parseAnnotations(data: Json, canvasId: string, width: number, height: number): { items: Annotation[]; rejected: number } {
  if (data['@type'] !== 'sc:AnnotationList' || !Array.isArray(data.resources)) throw new Error('Llista d’anotacions no vàlida.');
  let rejected = 0;
  const items: Annotation[] = [];
  for (const item of data.resources) {
    const on = typeof item?.on === 'string' ? item.on : '';
    const match = on.startsWith(canvasId + '#') ? /^xywh=(\d+(?:\.\d+)?),(\d+(?:\.\d+)?),(\d+(?:\.\d+)?),(\d+(?:\.\d+)?)$/.exec(on.slice(canvasId.length + 1)) : null;
    if (!match || item['@type'] !== 'oa:Annotation' || typeof item.resource?.chars !== 'string') { rejected++; continue; }
    const [x, y, w, h] = match.slice(1).map(Number);
    if (![x, y, w, h].every(Number.isFinite) || w <= 0 || h <= 0 || x + w > width || y + h > height) { rejected++; continue; }
    const source = String(item.resource.source_label ?? item.resource.label ?? '').trim().toLowerCase();
    const label = source === 'other_objects' ? 'Altres objectes' : String(item.resource.label ?? item.resource.chars);
    items.push({ id: String(item['@id'] ?? ''), rect: { x, y, width: w, height: h }, text: item.resource.chars,
      label, category: source || label.trim().toLowerCase(), paragraph: ['paragraph', 'paragraphs'].includes(source), resource: item.resource });
  }
  return { items, rejected };
}

export function detectionObjects(items: Annotation[]): Annotation[] {
  return items.filter(item => !item.paragraph && !['other_objects', 'altres objectes'].includes(item.category)
    && !['other_objects', 'altres objectes'].includes(item.label.trim().toLowerCase()));
}

export function paragraphRegions(detections: Annotation[], transcriptions: Annotation[]): Region[] {
  const groups = new Map<string, Region>();
  const source = transcriptions.length ? transcriptions : detections.filter(item => item.paragraph);
  for (const item of source) {
    const key = JSON.stringify(item.rect);
    const region = groups.get(key) ?? { rect: item.rect, versions: [] };
    if (transcriptions.length) region.versions.push(item);
    groups.set(key, region);
  }
  return [...groups.values()];
}

export function imageRect(rect: Rect, canvasWidth: number, canvasHeight: number, imageWidth: number, imageHeight: number): Rect {
  return { x: rect.x * imageWidth / canvasWidth, y: rect.y * imageHeight / canvasHeight,
    width: rect.width * imageWidth / canvasWidth, height: rect.height * imageHeight / canvasHeight };
}
