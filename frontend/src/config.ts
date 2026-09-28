export interface Config {
  manifestTemplate: string; annotationTemplate: string; collectionParameter: string; idParameter: string;
  allowedCollections: string[]; requestTimeoutMs: number;
}

export async function loadConfig(): Promise<Config> {
  const local = await fetchJson(new URL('./config.json', location.href).href);
  const apiUrl = new URL(local.apiConfigUrl);
  if (!['http:', 'https:'].includes(apiUrl.protocol)) throw new Error('URL de configuració de l’API no vàlida.');
  const api = await fetchJson(apiUrl.href);
  const collectionParameter = local.collectionParameter ?? 'collection';
  const idParameter = local.idParameter ?? 'id';
  if (collectionParameter === idParameter || ![collectionParameter, idParameter].every(
    name => typeof name === 'string' && /^[A-Za-z][A-Za-z0-9_-]*$/.test(name))) {
    throw new Error('Els paràmetres de selecció del mapa no són vàlids.');
  }
  return { ...api, collectionParameter, idParameter };
}

export function route(template: string, collection: string, id: string, kind = ''): string {
  return template.replace('{collection}', encodeURIComponent(collection)).replace('{id}', encodeURIComponent(id)).replace('{kind}', kind);
}

export async function fetchJson(url: string, timeoutMs = 15000): Promise<any> {
  let response: Response;
  try { response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs), credentials: 'omit' }); }
  catch { throw new Error('No s’ha pogut connectar amb el servei. Comprova la connexió i torna-ho a provar.'); }
  if (!response.ok) {
    const errors: Record<number, string> = {
      404: 'No s’ha trobat el recurs.', 422: 'Aquest manifest no és compatible amb el visor.',
      502: 'La Cartoteca Digital no està disponible ara mateix.', 504: 'La Cartoteca Digital ha trigat massa a respondre.',
    };
    throw new Error(errors[response.status] ?? 'No s’ha pogut carregar el recurs.');
  }
  return response.json();
}
