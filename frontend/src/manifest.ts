export type Json = Record<string, any>;
export interface MapInfo { canvasId: string; width: number; height: number; serviceUrl: string; title: string; manifest: Json }

export function textValue(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(textValue).filter(Boolean).join(' · ');
  if (value && typeof value === 'object' && '@value' in value) return textValue(value['@value']);
  return '';
}

export function httpUrl(value: string): string {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('URL no compatible.');
  return url.href;
}

export function parseManifest(manifest: Json): MapInfo {
  const sequences = manifest.sequences;
  const canvas = sequences?.[0]?.canvases?.[0];
  if (manifest['@type'] !== 'sc:Manifest' || sequences?.length !== 1 || sequences[0].canvases?.length !== 1
      || !canvas || typeof canvas['@id'] !== 'string' || !Number.isFinite(canvas.width) || !Number.isFinite(canvas.height)
      || canvas.width <= 0 || canvas.height <= 0 || canvas.images?.length !== 1
      || canvas.images[0].on !== canvas['@id'] || typeof canvas.images[0].resource?.service?.['@id'] !== 'string') {
    throw new Error('Aquest manifest no és compatible. Cal un manifest IIIF 2 amb un sol llenç i una imatge completa.');
  }
  return { canvasId: canvas['@id'], width: canvas.width, height: canvas.height,
    serviceUrl: httpUrl(canvas.images[0].resource.service['@id']).replace(/\/$/, ''),
    title: textValue(manifest.label) || 'Mapa històric', manifest };
}

export function annotationReference(manifest: Json, expected: string): string | undefined {
  const content = manifest.sequences[0].canvases[0].otherContent ?? [];
  return (Array.isArray(content) ? content : [content]).map((entry: Json | string) =>
    typeof entry === 'string' ? entry : entry['@id']).find((url: string) => url === expected);
}
