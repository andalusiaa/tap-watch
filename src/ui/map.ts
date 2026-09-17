// The pub map. This module (and MapLibre with it) is only downloaded when the user
// switches to the map view.

import { AttributionControl, LngLatBounds, Map as MapLibreMap, NavigationControl, setWorkerUrl } from 'maplibre-gl';
import type { GeoJSONSource, IControl } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import type { Freshness } from '../freshness';
import type { LatLng } from '../geo';
import { mapStyle, type TileJson } from './mapStyle';

setWorkerUrl(workerUrl);

/** 'none' when no beer is chosen: every pub looks the same. */
export type MarkerState = Freshness | 'none';

export interface PubPoint {
  id: string;
  name: string;
  lat: number;
  lng: number;
  state: MarkerState;
}

export interface YouPoint {
  point: LatLng;
  /** Metres; draws a circle when set. */
  accuracy?: number;
}

export interface PubMap {
  showPubs(pubs: PubPoint[], options?: { fit?: boolean }): void;
  showYou(you: YouPoint | null): void;
  resize(): void;
}

const EMPTY: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };

function pubsGeoJson(pubs: PubPoint[]): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: pubs.map((p) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [p.lng, p.lat] },
      properties: { id: p.id, name: p.name, state: p.state },
    })),
  };
}

/** A circle of the given radius in metres, as a polygon (accurate enough at this scale). */
function circle([lat, lng]: LatLng, metres: number): GeoJSON.Polygon {
  const dLat = metres / 111_320;
  const dLng = metres / (111_320 * Math.cos((lat * Math.PI) / 180));
  const ring: [number, number][] = [];
  for (let i = 0; i <= 48; i++) {
    const a = (i / 48) * 2 * Math.PI;
    ring.push([lng + dLng * Math.cos(a), lat + dLat * Math.sin(a)]);
  }
  return { type: 'Polygon', coordinates: [ring] };
}

function youGeoJson(you: YouPoint | null): GeoJSON.FeatureCollection {
  if (!you) return EMPTY;
  const [lat, lng] = you.point;
  const features: GeoJSON.Feature[] = [{ type: 'Feature', geometry: { type: 'Point', coordinates: [lng, lat] }, properties: {} }];
  if (you.accuracy && you.accuracy > 15) {
    features.unshift({ type: 'Feature', geometry: circle(you.point, you.accuracy), properties: {} });
  }
  return { type: 'FeatureCollection', features };
}

/** A map button that centres the map on the user. Hidden until their position is known. */
class CentreOnYouControl implements IControl {
  private readonly container = document.createElement('div');
  private readonly button = document.createElement('button');

  constructor(onClick: () => void) {
    this.container.className = 'maplibregl-ctrl maplibregl-ctrl-group';
    this.button.type = 'button';
    this.button.className = 'map-centre-button';
    this.button.setAttribute('aria-label', 'Centre the map on your location');
    this.button.title = 'Centre on your location';
    this.button.textContent = '◎';
    this.button.addEventListener('click', onClick);
    this.container.append(this.button);
    this.setVisible(false);
  }

  onAdd() {
    return this.container;
  }

  onRemove() {
    this.container.remove();
  }

  setVisible(visible: boolean) {
    this.container.hidden = !visible;
  }
}

export async function createPubMap(
  container: HTMLElement,
  options: { areaId: string; onPubClick: (pubId: string) => void },
): Promise<PubMap> {
  const res = await fetch(`/map/${options.areaId}.json`);
  if (!res.ok) throw new Error(`Map settings failed to load: ${res.status}`);
  const tiles = (await res.json()) as TileJson;

  const darkQuery = matchMedia('(prefers-color-scheme: dark)');
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let data = { pubs: EMPTY, you: EMPTY };
  let pubs: PubPoint[] = [];
  let you: YouPoint | null = null;

  const [west, south, east, north] = tiles.bounds;
  const map = new MapLibreMap({
    container,
    style: mapStyle(tiles, darkQuery.matches, data),
    bounds: [west, south, east, north],
    // Let people pan a little past the edge of the map data, but no further.
    maxBounds: [
      [west - 0.02, south - 0.01],
      [east + 0.02, north + 0.01],
    ],
    minZoom: 11,
    maxZoom: 18,
    attributionControl: false,
    dragRotate: false,
    pitchWithRotate: false,
    touchPitch: false,
    fadeDuration: reducedMotion ? 0 : 300,
  });
  map.touchZoomRotate.disableRotation();
  map.keyboard.disableRotation();
  map.addControl(new NavigationControl({ showCompass: false }), 'top-right');
  map.addControl(new AttributionControl({ compact: true }), 'bottom-right');
  const centreControl = new CentreOnYouControl(() => {
    if (!you) return;
    const [lat, lng] = you.point;
    map.easeTo({ center: [lng, lat], zoom: Math.max(map.getZoom(), 15), duration: reducedMotion ? 0 : 500 });
  });
  map.addControl(centreControl, 'top-right');

  map.on('click', 'pubs-hit', (e) => {
    const id = e.features?.[0]?.properties?.id;
    if (typeof id === 'string') options.onPubClick(id);
  });
  map.on('mouseenter', 'pubs-hit', () => (map.getCanvas().style.cursor = 'pointer'));
  map.on('mouseleave', 'pubs-hit', () => (map.getCanvas().style.cursor = ''));

  darkQuery.addEventListener('change', () => map.setStyle(mapStyle(tiles, darkQuery.matches, data)));

  await new Promise<void>((resolve, reject) => {
    map.once('load', () => resolve());
    map.once('error', (e) => reject(e.error));
  });

  function setSource(id: 'pubs' | 'you', geojson: GeoJSON.FeatureCollection) {
    (map.getSource(id) as GeoJSONSource | undefined)?.setData(geojson);
  }

  function fit() {
    const shown = pubs.filter((p) => p.state !== 'gone');
    const points: LatLng[] = (shown.length ? shown : pubs).map((p) => [p.lat, p.lng]);
    // Include the user's position when it is on the map.
    if (you) {
      const [lat, lng] = you.point;
      if (lng >= west && lng <= east && lat >= south && lat <= north) points.push(you.point);
    }
    if (points.length === 0) return;
    const bounds = new LngLatBounds();
    for (const [lat, lng] of points) bounds.extend([lng, lat]);
    map.fitBounds(bounds, { padding: 48, maxZoom: 16, duration: 0 });
  }

  return {
    showPubs(next, { fit: shouldFit = false } = {}) {
      pubs = next;
      data = { ...data, pubs: pubsGeoJson(next) };
      setSource('pubs', data.pubs);
      if (shouldFit) fit();
    },
    showYou(next) {
      you = next;
      centreControl.setVisible(next !== null);
      data = { ...data, you: youGeoJson(next) };
      setSource('you', data.you);
    },
    resize() {
      map.resize();
    },
  };
}
