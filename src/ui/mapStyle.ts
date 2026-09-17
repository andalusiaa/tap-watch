// A minimal map style in the site's palette, drawn from Protomaps basemap tiles
// (layer reference: https://docs.protomaps.com/basemaps/layers).

import type { ExpressionSpecification, StyleSpecification } from 'maplibre-gl';

export interface TileJson {
  tiles: string[];
  bounds: [number, number, number, number];
  minzoom: number;
  maxzoom: number;
  attribution: string;
}

interface Palette {
  land: string;
  water: string;
  park: string;
  building: string;
  buildingLine: string;
  road: string;
  roadCasing: string;
  majorCasing: string;
  path: string;
  rail: string;
  text: string;
  textHalo: string;
  ink: string;
  plate: string;
  gone: string;
  you: string;
}

const LIGHT: Palette = {
  land: '#f1f1f1',
  water: '#cddbe6',
  park: '#dce7d8',
  building: '#e2e2e2',
  buildingLine: '#d2d2d2',
  road: '#ffffff',
  roadCasing: '#d8d8d8',
  majorCasing: '#b4b4b4',
  path: '#a8a8a8',
  rail: '#9a9a9a',
  text: '#3a3a3a',
  textHalo: '#ffffff',
  ink: '#000000',
  plate: '#ffffff',
  gone: '#c4c4c4',
  you: '#1565c0',
};

const DARK: Palette = {
  land: '#141414',
  water: '#1a2630',
  park: '#17231b',
  building: '#202020',
  buildingLine: '#2c2c2c',
  road: '#2e2e2e',
  roadCasing: '#141414',
  majorCasing: '#141414',
  path: '#4a4a4a',
  rail: '#555555',
  text: '#cfcfcf',
  textHalo: '#000000',
  ink: '#ffffff',
  plate: '#000000',
  gone: '#5a5a5a',
  you: '#64b5f6',
};

/** Freshness colours match the badges (see src/styles.css). */
const FRESH = '#1f7a4d';
const AGEING = '#e3a21a';
const STALE = '#8c8c8c';

const zoomed = (stops: [number, number][]): ExpressionSpecification =>
  ['interpolate', ['exponential', 1.6], ['zoom'], ...stops.flat()] as ExpressionSpecification;

const kindIn = (...kinds: string[]): ExpressionSpecification => ['in', ['get', 'kind'], ['literal', kinds]];

const PARKS = kindIn(
  'park', 'nature_reserve', 'forest', 'wood', 'grass', 'grassland', 'meadow', 'cemetery', 'golf_course',
  'recreation_ground', 'village_green', 'garden', 'allotments', 'playground', 'pitch', 'scrub',
);

export function mapStyle(
  tiles: TileJson,
  dark: boolean,
  data: { pubs: GeoJSON.FeatureCollection; you: GeoJSON.FeatureCollection },
): StyleSpecification {
  const c = dark ? DARK : LIGHT;
  const origin = location.origin;

  return {
    version: 8,
    glyphs: `${origin}/map/fonts/{fontstack}/{range}.pbf`,
    sources: {
      base: {
        type: 'vector',
        tiles: tiles.tiles.map((t) => `${origin}${t}`),
        bounds: tiles.bounds,
        minzoom: tiles.minzoom,
        maxzoom: tiles.maxzoom,
        attribution: tiles.attribution,
      },
      pubs: { type: 'geojson', data: data.pubs },
      you: { type: 'geojson', data: data.you },
    },
    layers: [
      { id: 'land', type: 'background', paint: { 'background-color': c.land } },
      {
        id: 'parks',
        type: 'fill',
        source: 'base',
        'source-layer': 'landuse',
        filter: PARKS,
        paint: { 'fill-color': c.park },
      },
      {
        id: 'water',
        type: 'fill',
        source: 'base',
        'source-layer': 'water',
        filter: ['==', ['geometry-type'], 'Polygon'],
        paint: { 'fill-color': c.water },
      },
      {
        id: 'waterways',
        type: 'line',
        source: 'base',
        'source-layer': 'water',
        filter: ['==', ['geometry-type'], 'LineString'],
        paint: { 'line-color': c.water, 'line-width': zoomed([[12, 1], [16, 4]]) },
      },
      {
        id: 'buildings',
        type: 'fill',
        source: 'base',
        'source-layer': 'buildings',
        minzoom: 14,
        paint: { 'fill-color': c.building, 'fill-outline-color': c.buildingLine },
      },
      {
        id: 'rail',
        type: 'line',
        source: 'base',
        'source-layer': 'roads',
        filter: ['all', ['==', ['get', 'kind'], 'rail'], ['!', ['to-boolean', ['get', 'is_tunnel']]]],
        paint: { 'line-color': c.rail, 'line-width': zoomed([[12, 1], [16, 2]]), 'line-dasharray': [3, 2] },
      },
      {
        id: 'paths',
        type: 'line',
        source: 'base',
        'source-layer': 'roads',
        minzoom: 14,
        filter: kindIn('path'),
        paint: { 'line-color': c.path, 'line-width': zoomed([[14, 0.75], [18, 2]]), 'line-dasharray': [2, 1.5] },
      },
      {
        id: 'minor-casing',
        type: 'line',
        source: 'base',
        'source-layer': 'roads',
        filter: kindIn('minor_road'),
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': c.roadCasing, 'line-width': zoomed([[12, 0.5], [14, 3], [18, 14]]) },
      },
      {
        id: 'major-casing',
        type: 'line',
        source: 'base',
        'source-layer': 'roads',
        filter: kindIn('major_road', 'highway'),
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': c.majorCasing, 'line-width': zoomed([[11, 1.5], [14, 6], [18, 22]]) },
      },
      {
        id: 'minor',
        type: 'line',
        source: 'base',
        'source-layer': 'roads',
        minzoom: 13,
        filter: kindIn('minor_road'),
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': c.road, 'line-width': zoomed([[13, 1], [14, 2], [18, 12]]) },
      },
      {
        id: 'major',
        type: 'line',
        source: 'base',
        'source-layer': 'roads',
        filter: kindIn('major_road', 'highway'),
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': c.road, 'line-width': zoomed([[11, 0.75], [14, 4], [18, 19]]) },
      },
      {
        id: 'road-names',
        type: 'symbol',
        source: 'base',
        'source-layer': 'roads',
        minzoom: 14,
        filter: kindIn('major_road', 'minor_road'),
        layout: {
          'symbol-placement': 'line',
          'text-field': ['get', 'name'],
          'text-font': ['Noto Sans Regular'],
          'text-size': zoomed([[14, 10], [18, 13]]),
        },
        paint: { 'text-color': c.text, 'text-halo-color': c.textHalo, 'text-halo-width': 1.5 },
      },
      {
        id: 'stations',
        type: 'symbol',
        source: 'base',
        'source-layer': 'pois',
        minzoom: 13,
        filter: kindIn('station'),
        layout: {
          'text-field': ['get', 'name'],
          'text-font': ['Noto Sans Medium'],
          'text-size': 11,
          'text-max-width': 8,
        },
        paint: { 'text-color': c.text, 'text-halo-color': c.textHalo, 'text-halo-width': 1.5 },
      },
      {
        id: 'places',
        type: 'symbol',
        source: 'base',
        'source-layer': 'places',
        minzoom: 11,
        maxzoom: 16,
        filter: kindIn('neighbourhood', 'macrohood', 'locality'),
        layout: {
          'text-field': ['get', 'name'],
          'text-font': ['Noto Sans Medium'],
          'text-size': zoomed([[11, 11], [15, 14]]),
          'text-max-width': 7,
        },
        paint: { 'text-color': c.text, 'text-halo-color': c.textHalo, 'text-halo-width': 2, 'text-opacity': 0.85 },
      },

      // Where the user is (device location with its accuracy, or a postcode).
      {
        id: 'you-accuracy',
        type: 'fill',
        source: 'you',
        filter: ['==', ['geometry-type'], 'Polygon'],
        paint: { 'fill-color': c.you, 'fill-opacity': 0.12, 'fill-outline-color': c.you },
      },
      {
        id: 'you',
        type: 'circle',
        source: 'you',
        filter: ['==', ['geometry-type'], 'Point'],
        paint: { 'circle-radius': 7, 'circle-color': c.you, 'circle-stroke-color': c.plate, 'circle-stroke-width': 2.5 },
      },

      // Pubs. An invisible wider circle makes a 44px tap target.
      {
        id: 'pubs-hit',
        type: 'circle',
        source: 'pubs',
        paint: { 'circle-radius': 22, 'circle-opacity': 0 },
      },
      {
        id: 'pubs',
        type: 'circle',
        source: 'pubs',
        layout: { 'circle-sort-key': ['match', ['get', 'state'], 'gone', 0, 1] },
        paint: {
          'circle-radius': zoomed([[11, 5], [16, 9]]),
          'circle-color': [
            'match',
            ['get', 'state'],
            'fresh', FRESH,
            'ageing', AGEING,
            'stale', STALE,
            'likely', c.plate,
            'gone', c.gone,
            c.ink,
          ],
          'circle-stroke-color': ['match', ['get', 'state'], 'likely', c.ink, c.plate],
          'circle-stroke-width': 2,
        },
      },
      {
        id: 'pub-names',
        type: 'symbol',
        source: 'pubs',
        minzoom: 14,
        layout: {
          'text-field': ['get', 'name'],
          'text-font': ['Noto Sans Medium'],
          'text-size': 12,
          'text-anchor': 'top',
          'text-offset': [0, 0.9],
          'text-max-width': 9,
          'text-optional': true,
        },
        paint: { 'text-color': c.ink, 'text-halo-color': c.plate, 'text-halo-width': 2 },
      },
    ],
  };
}
