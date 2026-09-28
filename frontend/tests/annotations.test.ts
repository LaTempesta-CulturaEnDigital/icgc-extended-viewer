import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { detectionObjects, parseAnnotations, paragraphRegions, imageRect } from '../src/annotations';
import { parseManifest } from '../src/manifest';

const fixture = (path: string) => JSON.parse(readFileSync(new URL('../../fixtures/' + path, import.meta.url), 'utf8'));

describe('real IIIF data', () => {
  it('keeps duplicate text versions behind a single region and excludes paragraphs from objects', () => {
    const map = parseManifest(fixture('manifests/catalunya_1037.json'));
    const parse = (kind: string) => parseAnnotations(fixture(`annotations/catalunya/1037/${kind}.json`), map.canvasId, map.width, map.height);
    const detections = parse('detections'), text = parse('transcriptions');
    expect(detections.rejected).toBe(0); expect(text.rejected).toBe(0);
    expect(detections.items.filter(item => !item.paragraph)).toHaveLength(3);
    const regions = paragraphRegions(detections.items, text.items);
    expect(regions).toHaveLength(1); expect(regions[0].versions).toHaveLength(2);
    expect(regions[0].versions[0].text).toContain('\n');
  });
  it('handles empty lists and fallback paragraph detections', () => {
    const map = parseManifest(fixture('manifests/fonscec_1019.json'));
    expect(parseAnnotations(fixture('annotations/fonscec/1019/detections.json'), map.canvasId, map.width, map.height).items).toEqual([]);
    const populated = parseManifest(fixture('manifests/catalunya_1037.json'));
    const detections = parseAnnotations(fixture('annotations/catalunya/1037/detections.json'), populated.canvasId, populated.width, populated.height).items;
    expect(paragraphRegions(detections, [])[0].versions).toEqual([]);
  });
  it('uses source categories and excludes other objects without discarding source annotations', () => {
    const map = parseManifest(fixture('manifests/fonscec_1021.json'));
    const parsed = parseAnnotations(fixture('annotations/fonscec/1021/detections.json'), map.canvasId, map.width, map.height);
    expect(parsed.items).toHaveLength(6);
    expect(parsed.rejected).toBe(0);
    expect(detectionObjects(parsed.items).map(item => item.category).sort()).toEqual(['coat_of_arms', 'compass_rose', 'graphic_scale']);
    const rose = detectionObjects(parsed.items).find(item => item.category === 'compass_rose')!;
    expect(rose.label).toBe('rosa dels vents');
    expect(detectionObjects([{ ...rose, category: 'altres objectes', label: 'Altres objectes' }])).toEqual([]);
  });
  it('rejects other canvas targets and invalid rectangles', () => {
    const data = fixture('annotations/fonscec/308/detections.json');
    expect(parseAnnotations(data, 'https://wrong/canvas', 10000, 10000).rejected).toBe(1);
    expect(parseAnnotations(data, data.resources[0].on.split('#')[0], 10, 10).rejected).toBe(1);
  });
  it('maps canvas coordinates to differently sized image pixels on both axes', () => {
    expect(imageRect({ x: 100, y: 50, width: 200, height: 80 }, 1000, 500, 4000, 3000))
      .toEqual({ x: 400, y: 300, width: 800, height: 480 });
  });
  it('rejects unsupported image paintings', () => {
    const manifest = fixture('manifests/fonscec_308.json');
    manifest.sequences[0].canvases[0].images[0].on += '#xywh=0,0,10,10';
    expect(() => parseManifest(manifest)).toThrow();
  });
});
