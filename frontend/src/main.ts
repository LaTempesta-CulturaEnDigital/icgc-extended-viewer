import OpenSeadragon from 'openseadragon';
import { fetchJson, route, loadConfig } from './config';
import { annotationReference, httpUrl, parseManifest, textValue } from './manifest';
import { detectionObjects, imageRect, paragraphRegions, parseAnnotations, type Annotation, type Region } from './annotations';
import './styles.css';

const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const controls = { detections: el<HTMLInputElement>('detections'), paragraphs: el<HTMLInputElement>('paragraphs') };
const categoryFilter = el('category-filter');
function positionCategories() {
  const button = el('categories').getBoundingClientRect();
  const width = Math.min(300, innerWidth - 16);
  categoryFilter.style.width = `${width}px`;
  categoryFilter.style.left = `${Math.max(8, Math.min(button.left, innerWidth - width - 8))}px`;
  categoryFilter.style.top = `${button.bottom + 4}px`;
  categoryFilter.style.maxHeight = `${Math.max(0, innerHeight - button.bottom - 12)}px`;
}
categoryFilter.addEventListener('beforetoggle', positionCategories);
window.addEventListener('resize', positionCategories);
controls.detections.checked = true;
controls.paragraphs.checked = false;
el('retry').onclick = () => location.reload();
el('retry-image').onclick = () => location.reload();
const information = el<HTMLDialogElement>('information-dialog');
el('information').onclick = () => information.showModal();
el('close-information').onclick = () => information.close();
information.addEventListener('close', () => el('information').focus());
information.addEventListener('keydown', event => {
  if (event.key !== 'Tab') return;
  const first = el('close-information'), last = el('source');
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
});
let fatalError = false;

function plainMetadata(value: unknown): string {
  // CONTENTdm may include HTML in metadata; display only its text, never insert its markup.
  const doc = new DOMParser().parseFromString(textValue(value), 'text/html');
  return doc.body.textContent ?? '';
}

async function start() {
  const config = await loadConfig();
  const params = new URLSearchParams(location.search);
  const collection = params.get(config.collectionParameter) ?? '';
  const id = params.get(config.idParameter) ?? '';
  if (!config.allowedCollections.includes(collection) || !/^\d{1,12}$/.test(id)) {
    el('empty-title').textContent = 'Tria un mapa per començar';
    el('empty-detail').textContent = `Obre aquest visor amb ?${config.collectionParameter}=fonscec&${config.idParameter}=1021 a l’adreça.`;
    el('status').textContent = 'Falta una col·lecció o un identificador vàlid.';
    return;
  }
  el('record').textContent = `${collection.toUpperCase()} / ${id}`;
  const manifestUrl = route(config.manifestTemplate, collection, id);
  const map = parseManifest(await fetchJson(manifestUrl, config.requestTimeoutMs));
  document.title = `${map.title} · Cartoteca Digital`;
  el('map-title').textContent = map.title;
  el<HTMLButtonElement>('information').disabled = false;
  el('metadata').hidden = false;
  el('attribution').textContent = plainMetadata(map.manifest.attribution);
  for (const row of map.manifest.metadata ?? []) {
    const term = document.createElement('dt'), value = document.createElement('dd');
    term.textContent = plainMetadata(row.label); value.textContent = plainMetadata(row.value);
    el('metadata-list').append(term, value);
  }
  // The original manifest ID isn't inferred from the canvas. Show the enriched manifest as the source contract.
  const source = el<HTMLAnchorElement>('source');
  source.textContent = 'Manifest IIIF ↗'; source.href = httpUrl(manifestUrl); source.hidden = false;

  const viewer = OpenSeadragon({ element: el('viewer'), showNavigationControl: false, showNavigator: false,
    animationTime: 0.35, blendTime: 0.1, maxZoomPixelRatio: 3, visibilityRatio: 0.5,
    crossOriginPolicy: 'Anonymous', ajaxWithCredentials: false });
  el('zoom-in').onclick = () => { viewer.viewport.zoomBy(1.5); viewer.viewport.applyConstraints(); };
  el('zoom-out').onclick = () => { viewer.viewport.zoomBy(1 / 1.5); viewer.viewport.applyConstraints(); };
  el('home').onclick = () => viewer.viewport.goHome();

  let objects: Annotation[] = [], regions: Region[] = [], opened = false;
  const categories = new Map<string, { label: string; count: number; selected: boolean }>();
  let detectionsFailed = false;
  let annotationLoading = true, annotationFailed = false, tileFailed = false;
  let warnings: string[] = [];
  const trackers: OpenSeadragon.MouseTracker[] = [];

  function updateCategories() {
    const selected = [...categories.values()].filter(category => category.selected).length;
    const visible = objects.filter(object => categories.get(object.category)?.selected).length;
    el('category-count').textContent = `${selected}/${categories.size}`;
    el('detection-count').textContent = detectionsFailed || annotationLoading ? '—'
      : visible === objects.length ? String(visible) : `${visible}/${objects.length}`;
    el<HTMLButtonElement>('categories').disabled = !controls.detections.checked || !categories.size;
    el('categories').setAttribute('aria-label', `Categories de detecció: ${selected} de ${categories.size} seleccionades`);
    el('category-list').querySelectorAll<HTMLInputElement>('input').forEach(input => {
      input.checked = categories.get(input.value)?.selected ?? false;
    });
  }

  function selectCategories(only: string | boolean) {
    categories.forEach((category, key) => { category.selected = typeof only === 'boolean' ? only : only === key; });
    render();
  }
  el('categories-all').onclick = () => selectCategories(true);
  el('categories-none').onclick = () => selectCategories(false);

  function buildCategories() {
    const previous = new Map(categories);
    categories.clear();
    for (const object of objects) {
      const category = categories.get(object.category) ?? { label: object.label, count: 0,
        selected: previous.get(object.category)?.selected ?? true };
      category.count++; categories.set(object.category, category);
    }
    el('category-list').replaceChildren();
    for (const [key, category] of [...categories].sort((a, b) => a[1].label.localeCompare(b[1].label, 'ca'))) {
      const row = document.createElement('div'); row.className = 'category-row';
      const label = document.createElement('label'), input = document.createElement('input');
      input.type = 'checkbox'; input.value = key; input.checked = category.selected;
      const name = document.createElement('span');
      name.textContent = category.label.charAt(0).toLocaleUpperCase('ca') + category.label.slice(1);
      const count = document.createElement('span'); count.className = 'count'; count.textContent = String(category.count);
      input.setAttribute('aria-label', name.textContent);
      input.onchange = () => { category.selected = input.checked; render(); };
      label.append(input, name, count);
      const only = document.createElement('button'); only.type = 'button'; only.textContent = 'Només';
      only.setAttribute('aria-label', `Mostra només: ${category.label}`);
      only.onclick = () => selectCategories(key);
      row.append(label, only); el('category-list').append(row);
    }
    updateCategories();
  }

  function updateStatus() {
    if (fatalError) return;
    const message = !opened ? 'Carregant el mapa…' : annotationLoading ? 'Mapa carregat. Carregant les anotacions…'
      : warnings.length ? warnings.join(' ') : objects.length || regions.length
        ? 'Mapa carregat. Activa les capes per explorar-ne els detalls.' : 'Mapa carregat. No hi ha anotacions disponibles.';
    el('status').textContent = tileFailed ? `No s’han pogut carregar algunes parts de la imatge. ${message}` : message;
    el('retry-image').hidden = !tileFailed;
    el('retry-annotations').hidden = !annotationFailed;
    el<HTMLButtonElement>('retry-annotations').disabled = annotationLoading;
  }

  function selectRegion(index: number, focus = true) {
    const region = regions[index];
    const container = el('transcription'); container.replaceChildren();
    const title = document.createElement('h3'); title.textContent = `Paràgraf ${index + 1}`; container.append(title);
    if (!region.versions.length) {
      const text = document.createElement('p'); text.textContent = 'Sense transcripció disponible.'; container.append(text);
    }
    region.versions.forEach((annotation, version) => {
      const heading = document.createElement('h4'); heading.textContent = region.versions.length > 1 ? `Versió ${version + 1}` : 'Transcripció';
      const text = document.createElement('p'); text.className = 'transcription-text'; text.textContent = annotation.text;
      container.append(heading, text);
      const details = document.createElement('details'); details.className = 'annotation-details';
      const summary = document.createElement('summary'); summary.textContent = 'Detalls de l’anotació';
      const provenance = document.createElement('dl');
      for (const [key, label] of [['paragraph_id', 'Identificador del paràgraf'], ['model', 'Model'], ['date', 'Data']]) {
        const value = annotation.resource[key];
        if (value == null || value === '') continue;
        const term = document.createElement('dt'), description = document.createElement('dd');
        term.textContent = label; description.textContent = String(value); provenance.append(term, description);
      }
      if (provenance.childElementCount) { details.append(summary, provenance); container.append(details); }
    });
    el('region-list').querySelectorAll('button').forEach((button, i) => button.setAttribute('aria-pressed', String(i === index)));
    if (focus) {
      container.focus({ preventScroll: true });
      const panel = el('text-panel');
      panel.scrollTop += container.getBoundingClientRect().top - panel.getBoundingClientRect().top - 52;
    }
  }

  function render() {
    updateCategories();
    trackers.splice(0).forEach(tracker => tracker.destroy());
    viewer.clearOverlays();
    el('text-panel').hidden = !controls.paragraphs.checked;
    if (!opened) return;
    const tiled = viewer.world.getItemAt(0), size = tiled.getContentSize();
    const rectangle = (rect: Region['rect']) => {
      const r = imageRect(rect, map.width, map.height, size.x, size.y);
      return tiled.imageToViewportRectangle(r.x, r.y, r.width, r.height);
    };
    for (const object of objects) {
      if (!controls.detections.checked || !categories.get(object.category)?.selected) continue;
      const rect = rectangle(object.rect);
      const box = document.createElement('div'); box.className = 'detection-box'; box.setAttribute('aria-hidden', 'true');
      const label = document.createElement('span'); label.className = 'detection-label'; label.textContent = object.label;
      box.append(label);
      viewer.addOverlay({ element: box, location: rect });
    }
    if (controls.paragraphs.checked) regions.forEach((region, index) => {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'paragraph-box';
      button.setAttribute('aria-label', `Llegeix el paràgraf ${index + 1}`);
      const badge = document.createElement('span'); badge.textContent = String(index + 1); button.append(badge);
      viewer.addOverlay({ element: button, location: rectangle(region.rect) });
      // OSD owns pointer gestures. A tracker distinguishes taps from drags; native click handles keyboard activation.
      trackers.push(new OpenSeadragon.MouseTracker({ element: button, clickHandler: event => {
        const click = event as OpenSeadragon.MouseTrackerEvent & { quick: boolean; preventDefaultAction: boolean };
        if (click.quick) { click.preventDefaultAction = true; selectRegion(index); }
      }}));
      button.onclick = event => { if (event.detail === 0) selectRegion(index); };
    });
  }
  Object.values(controls).forEach(input => { input.onchange = render; });
  const closeText = () => { controls.paragraphs.checked = false; render(); controls.paragraphs.focus(); };
  el('close-text').onclick = closeText;
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !information.open && !categoryFilter.matches(':popover-open') && controls.paragraphs.checked) closeText();
  });

  async function loadImage() {
    try {
      const info = await fetchJson(map.serviceUrl + '/info.json', config.requestTimeoutMs);
      await new Promise<void>((resolve, reject) => {
        viewer.addOnceHandler('open', () => {
          opened = true; el('empty-state').hidden = true; render(); updateStatus(); resolve();
        });
        viewer.addOnceHandler('open-failed', () => reject(new Error('El servei d’imatges no ha pogut obrir el mapa.')));
        viewer.open(info);
      });
    } catch (error) {
      throw new Error(`No s’ha pogut carregar la imatge IIIF. ${error instanceof Error ? error.message : ''}`);
    }
  }
  viewer.addHandler('tile-load-failed', () => { tileFailed = true; updateStatus(); });

  async function layer(kind: string): Promise<{ items: Annotation[]; warning?: string; failed?: boolean }> {
    const expected = route(config.annotationTemplate, collection, id, kind);
    const reference = annotationReference(map.manifest, expected);
    const label = kind === 'detections' ? 'Deteccions' : 'Transcripcions';
    if (!reference) return { items: [], warning: `${label}: sense referència al manifest.` };
    try {
      const parsed = parseAnnotations(await fetchJson(reference, config.requestTimeoutMs), map.canvasId, map.width, map.height);
      return { items: parsed.items, warning: parsed.rejected ? `${label}: ${parsed.rejected} anotacions no compatibles omeses.` : undefined };
    } catch {
      return { items: [], warning: `${label} no disponibles: no s’ha pogut carregar el fitxer.`, failed: true };
    }
  }
  async function loadAnnotations() {
    annotationLoading = true; updateStatus();
    if (!regions.length) el('transcription').textContent = 'Carregant els paràgrafs…';
    const [detections, transcriptions] = await Promise.all([layer('detections'), layer('transcriptions')]);
    annotationLoading = false;
    annotationFailed = Boolean(detections.failed || transcriptions.failed);
    warnings = [detections.warning, transcriptions.warning].filter((warning): warning is string => Boolean(warning));
    detectionsFailed = Boolean(detections.failed);
    objects = detectionObjects(detections.items);
    buildCategories();
    regions = paragraphRegions(detections.items, transcriptions.items);
    el('paragraph-count').textContent = !regions.length && annotationFailed ? '—' : String(regions.length);
    el('region-list').replaceChildren();
    el('transcription').replaceChildren();
    regions.forEach((_, index) => {
      const button = document.createElement('button'); button.textContent = `Paràgraf ${index + 1}`; button.setAttribute('aria-pressed', 'false');
      button.onclick = () => selectRegion(index); el('region-list').append(button);
    });
    if (!regions.length) el('transcription').textContent = annotationFailed
      ? 'No s’han pogut carregar els paràgrafs. Torna a carregar les anotacions.'
      : 'No hi ha paràgrafs disponibles per a aquest mapa.';
    updateStatus(); render();
  }
  el('retry-annotations').onclick = () => {
    void loadAnnotations().then(() => {
      if (!annotationFailed) (controls.paragraphs.checked ? el('close-text') : controls.detections).focus();
    });
  };
  await Promise.all([loadImage(), loadAnnotations()]);
  // OpenSeadragon's default autoResize tracks changes to the map container, including panel opening.
  window.addEventListener('pagehide', event => {
    // A page retained in the browser's back/forward cache must keep its viewer alive.
    if (!event.persisted) { trackers.forEach(t => t.destroy()); viewer.destroy(); }
  });
}

start().catch(error => {
  fatalError = true;
  el('empty-state').hidden = false;
  el('empty-title').textContent = 'No s’ha pogut obrir el mapa';
  el('empty-detail').textContent = error instanceof Error ? error.message : 'S’ha produït un error inesperat.';
  el('status').textContent = el('empty-detail').textContent;
  el('retry').hidden = false;
  el('retry-annotations').hidden = true;
  el('retry-image').hidden = true;
});
