import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { geoGraticule10, geoPath } from 'd3-geo';
import { feature } from 'topojson-client';
import landTopology from 'world-atlas/land-110m.json';
import type { Topology, GeometryCollection } from 'topojson-specification';
import { Maximize2, Minus, Plus } from 'lucide-react';
import { routeGeometry, routeProjection, validPoint } from '../shared/map.mjs';
import type { MapPoint, Plan } from './types';

const topology = landTopology as unknown as Topology<{ land: GeometryCollection }>;
const land = feature(topology, topology.objects.land);
const graticule = geoGraticule10();
export const planPoints = (plan: Plan): MapPoint[] => [
  { ident: plan.origin.icao, lat: plan.origin.lat, lon: plan.origin.lon },
  ...(plan.ofp?.navlog || []),
  { ident: plan.destination.icao, lat: plan.destination.lat, lon: plan.destination.lon },
];
export default function RouteMap({ points, planned = false, airac, caption, compact = false }: { points: MapPoint[]; planned?: boolean; airac?: string; caption?: string; compact?: boolean }) {
  const clip = useId().replace(/:/g, '');
  const [view, setView] = useState({ zoom: 1, x: 0, y: 0 });
  const [selected, setSelected] = useState<string | null>(null);
  const drag = useRef<{ x: number; y: number; startX: number; startY: number } | null>(null);
  const fingerprint = JSON.stringify(points);
  useEffect(() => { setView({ zoom: 1, x: 0, y: 0 }); setSelected(null); }, [fingerprint]);
  const map = useMemo(() => {
    const projection = routeProjection(points);
    const path = geoPath(projection);
    return { land: path(land) || '', grid: path(graticule) || '', route: path(routeGeometry(points)) || '',
      positions: points.flatMap((point, index) => {
        if (!validPoint(point)) return [];
        const xy = projection([point.lon!, point.lat!]);
        return xy ? [{ ...point, x: xy[0], y: xy[1], index }] : [];
      }) };
  }, [fingerprint]);
  const missing = points.filter(p => !validPoint(p)).length;
  const endpointsReady = points.length >= 2 && validPoint(points[0]) && validPoint(points.at(-1));
  const changeZoom = (factor: number) => setView(v => ({ ...v, zoom: Math.max(1, Math.min(8, v.zoom * factor)) }));
  return <div className={`route-map ${compact ? 'compact-map' : ''}`}>
    <div className="map-caption"><span>{caption || (planned ? 'Planned route' : 'Airport pair preview')}</span>{planned && <span>AIRAC {airac || '—'}</span>}</div>
    <svg viewBox="0 0 480 300" className="map-svg" aria-label={planned ? 'SimBrief planned route map' : 'Departure and destination map'} role="img"
      onPointerDown={event => { if (event.button !== 0) return; event.currentTarget.setPointerCapture(event.pointerId); drag.current = { x: event.clientX, y: event.clientY, startX: view.x, startY: view.y }; }}
      onPointerMove={event => { const start = drag.current; if (!start) return; const ratio = 480 / event.currentTarget.getBoundingClientRect().width; setView(v => ({ ...v, x: start.startX + (event.clientX - start.x) * ratio, y: start.startY + (event.clientY - start.y) * ratio })); }}
      onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }}>
      <title>{planned ? 'Route from the SimBrief OFP navigation log' : 'Airport pair only; generate an OFP for the planned route'}</title>
      <defs><clipPath id={clip}><rect width="480" height="300"/></clipPath></defs>
      <g clipPath={`url(#${clip})`}><g transform={`translate(${240 + view.x} ${150 + view.y}) scale(${view.zoom}) translate(-240 -150)`}>
        <path d={map.land} className="map-land"/><path d={map.grid} className="map-graticule"/>
        {endpointsReady && <path d={map.route} className={`map-route ${planned ? '' : 'map-direct'}`}/>}
        {map.positions.map(point => {
          const endpoint = point.index === 0 || point.index === points.length - 1;
          const label = endpoint || selected === `${point.index}`;
          return <g key={`${point.index}-${point.ident}`} className="map-fix" onMouseEnter={() => setSelected(`${point.index}`)} onMouseLeave={() => setSelected(null)}>
            <title>{point.ident} · {point.lat?.toFixed(4)}, {point.lon?.toFixed(4)}</title>
            <circle cx={point.x} cy={point.y} r={(endpoint ? 5 : 2.4) / view.zoom}/>
            {label && <text x={point.x + 9 / view.zoom} y={point.y - 10 / view.zoom} style={{ fontSize: 13 / view.zoom, strokeWidth: 3 / view.zoom }}>{point.ident}</text>}
          </g>;
        })}
      </g></g>
      {!endpointsReady && <text x="240" y="153" textAnchor="middle" className="map-empty">Airport coordinates unavailable</text>}
    </svg>
    <div className="map-controls"><button type="button" className="icon-button" aria-label="Zoom route map in" onClick={() => changeZoom(1.5)} disabled={view.zoom >= 8}><Plus size={14}/></button><button type="button" className="icon-button" aria-label="Zoom route map out" onClick={() => changeZoom(1 / 1.5)} disabled={view.zoom <= 1}><Minus size={14}/></button><button type="button" className="icon-button" aria-label="Fit route map" onClick={() => setView({ zoom: 1, x: 0, y: 0 })}><Maximize2 size={13}/></button></div>
    <div className="map-source">{planned ? `SimBrief OFP${missing ? ` · ${missing} missing position${missing > 1 ? 's' : ''}` : ''}` : 'Airport pair only · Generate to resolve route'}<small>Land: Natural Earth · Drag to pan</small></div>
  </div>;
}
