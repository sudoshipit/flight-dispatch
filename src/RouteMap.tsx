import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, LocateFixed, Maximize2, Minus, Plus, X } from 'lucide-react';
import { geoGraticule10, geoPath } from 'd3-geo';
import { feature, mesh } from 'topojson-client';
import atlas from 'world-atlas/countries-50m.json';
import { routeGeometry, routeProjection, validPoint, zoomRouteView } from '../shared/map.mjs';
import { formatWind } from '../shared/ofp.mjs';
import type { MapPoint, NavFix, Plan } from './types';
import './route-map.css';

type RoutePoint = MapPoint & Partial<Omit<NavFix, keyof MapPoint>> & { kind?: 'departure' | 'arrival' };
type View = { zoom: number; x: number; y: number };
// The bundled geography works offline; route coordinates always come from the OFP.
const topology = atlas as unknown as Parameters<typeof feature>[0];
const land = feature(topology, topology.objects.land);
const borders = mesh(topology, topology.objects.countries as Parameters<typeof mesh>[1], (a, b) => a !== b);
const graticule = geoGraticule10();
const initialView = { zoom: 1, x: 0, y: 0 };
const number = (value: number | null | undefined, unit = '') => value == null ? '—' : `${value.toLocaleString('en-US')}${unit}`;
const utc = (value?: string | null) => value ? new Date(value).toLocaleString('en-GB', { timeZone: 'UTC', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) + 'Z' : '—';
const phase = (point: RoutePoint) => point.kind === 'arrival' || point.stage === 'DSC' ? 'descent' : point.kind === 'departure' || point.stage === 'CLB' ? 'climb' : 'cruise';

export function planPoints(plan: Plan): RoutePoint[] {
  const navlog = [...(plan.ofp?.navlog || [])];
  // Avoid overlapping airport markers, but retain missing-coordinate gaps.
  if (navlog[0]?.ident === plan.origin.icao && validPoint(navlog[0]) && validPoint(plan.origin)) navlog.shift();
  if (navlog.at(-1)?.ident === plan.destination.icao && validPoint(navlog.at(-1)) && validPoint(plan.destination)) navlog.pop();
  return [
    { ident: plan.origin.icao, ...plan.origin, kind: 'departure', altitude: plan.origin.elevation, eta: plan.ofp?.timing.off.estimated, fuelRemaining: plan.ofp?.fuel.takeoff },
    ...navlog,
    { ident: plan.destination.icao, ...plan.destination, kind: 'arrival', altitude: plan.destination.elevation, eta: plan.ofp?.timing.on.estimated, fuelRemaining: plan.ofp?.fuel.landing },
  ];
}

export default function RouteMap({ plan }: { plan: Plan }) {
  const points = useMemo(() => planPoints(plan), [plan]);
  const [view, setView] = useState<View>(initialView);
  const [selected, setSelected] = useState<number | null>(null);
  const [hovered, setHovered] = useState<number | null>(null);
  const [expanded, setExpanded] = useState(false);
  const svgRef = useRef<SVGSVGElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const expandRef = useRef<HTMLButtonElement>(null);
  const drag = useRef<{ id: number; x: number; y: number; view: View; moved: boolean } | null>(null);
  const clipId = useId().replace(/:/g, '');
  const chart = useMemo(() => {
    const projection = routeProjection(points);
    const path = geoPath(projection);
    return {
      land: path(land) || '', borders: path(borders) || '', grid: path(graticule) || '',
      route: path(routeGeometry(points)) || '',
      legs: points.slice(1).map((point, i) => ({ path: path(routeGeometry([points[i], point])) || '', phase: phase(point) })),
      positions: points.map(point => validPoint(point) ? projection([point.lon!, point.lat!]) : null),
    };
  }, [points]);
  const missing = points.filter(point => !validPoint(point)).length;
  const fix = selected == null ? null : points[selected];
  const units = ['LBS', 'KGS'].includes(plan.units) ? plan.units : '';

  useEffect(() => { setView(initialView); setSelected(null); }, [plan.id]);
  useEffect(() => {
    const dialog = dialogRef.current;
    if (expanded) {
      dialog?.showModal();
      const overflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      return () => { document.body.style.overflow = overflow; };
    }
    if (dialog?.open) { dialog.close(); expandRef.current?.focus(); }
  }, [expanded]);

  function location(clientX: number, clientY: number) {
    const matrix = svgRef.current?.getScreenCTM();
    return matrix ? new DOMPoint(clientX, clientY).matrixTransform(matrix.inverse()) : new DOMPoint(240, 150);
  }
  useEffect(() => {
    const svg = svgRef.current;
    const wheel = (event: WheelEvent) => {
      if (!event.ctrlKey) return;
      event.preventDefault();
      const at = location(event.clientX, event.clientY);
      setView(old => zoomRouteView(old, event.deltaY < 0 ? 1.2 : 1 / 1.2, at));
    };
    svg?.addEventListener('wheel', wheel, { passive: false });
    return () => svg?.removeEventListener('wheel', wheel);
  }, [expanded]);

  function choose(index: number, center = false) {
    setSelected(index);
    const position = chart.positions[index];
    if (center && position) setView(old => ({ ...old, x: (240 - position[0]) * old.zoom, y: (150 - position[1]) * old.zoom }));
  }

  function content(full: boolean) {
    return <>
      <div className="map-heading"><div><strong>Route explorer</strong><span>{plan.ofp?.navlog.length ? `${plan.origin.icao} → ${plan.destination.icao}` : 'Direct reference · no navlog'}</span></div>
        <span className="map-airac">AIRAC {plan.ofp?.airac || '—'}</span>
        <button ref={full ? undefined : expandRef} className="icon-button" aria-label={full ? 'Close expanded map' : 'Expand route map'} onClick={() => setExpanded(!full)}>{full ? <X size={17}/> : <Maximize2 size={16}/>}</button>
      </div>
      <div className="map-toolbar">
        <select aria-label="Inspect waypoint" value={selected ?? ''} onChange={event => { if (event.target.value === '') setSelected(null); else choose(Number(event.target.value), true); }}>
          <option value="">Select a waypoint…</option>{points.map((point, index) => <option key={index} value={index}>{point.ident}{point.kind ? ` · ${point.kind}` : point.ident === 'TOC' ? ' · top of climb' : point.ident === 'TOD' ? ' · top of descent' : ''}{!validPoint(point) ? ' · no position' : ''}</option>)}
        </select>
        <div className="map-zoom"><button className="icon-button" aria-label="Zoom out" disabled={view.zoom <= 1} onClick={() => setView(old => zoomRouteView(old, 1 / 1.4))}><Minus size={15}/></button><output aria-label="Map zoom">{Math.round(view.zoom * 100)}%</output><button className="icon-button" aria-label="Zoom in" disabled={view.zoom >= 8} onClick={() => setView(old => zoomRouteView(old, 1.4))}><Plus size={15}/></button><button className="icon-button" aria-label="Fit route" onClick={() => setView(initialView)}><LocateFixed size={16}/></button></div>
      </div>
      <div className="map-body"><div className="map-viewport">
        <svg ref={svgRef} className="map-svg" viewBox="0 0 480 300" role="group" aria-label="Interactive planned route" tabIndex={0}
          onKeyDown={event => {
            if (event.target !== event.currentTarget) return;
            if (['+', '=', '-', 'Home', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) {
              event.preventDefault();
              if (event.key === 'Home') setView(initialView);
              else if (['+', '=', '-'].includes(event.key)) setView(old => zoomRouteView(old, event.key === '-' ? 1 / 1.4 : 1.4));
              else setView(old => ({ ...old, x: old.x + (event.key === 'ArrowLeft' ? 30 : event.key === 'ArrowRight' ? -30 : 0), y: old.y + (event.key === 'ArrowUp' ? 30 : event.key === 'ArrowDown' ? -30 : 0) }));
            }
          }}
          onPointerDown={event => {
            if (event.button !== 0) return;
            const at = location(event.clientX, event.clientY);
            drag.current = { id: event.pointerId, x: at.x, y: at.y, view, moved: false };
          }}
          onPointerMove={event => {
            const start = drag.current;
            if (!start || start.id !== event.pointerId) return;
            const at = location(event.clientX, event.clientY);
            if (Math.hypot(at.x - start.x, at.y - start.y) > 3) {
              start.moved = true; event.currentTarget.setPointerCapture(event.pointerId);
              setView({ ...start.view, x: start.view.x + at.x - start.x, y: start.view.y + at.y - start.y });
            }
          }}
          onPointerUp={event => { if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); drag.current = null; }}
          onPointerCancel={() => { drag.current = null; }}
          onPointerLeave={() => { if (!svgRef.current?.hasPointerCapture(drag.current?.id ?? -1)) drag.current = null; }}
          onDoubleClick={event => { const at = location(event.clientX, event.clientY); setView(old => zoomRouteView(old, 1.6, at)); }}>
          <defs><clipPath id={clipId}><rect width="480" height="300"/></clipPath></defs>
          <g clipPath={`url(#${clipId})`}>
            <g transform={`translate(${240 + view.x},${150 + view.y}) scale(${view.zoom}) translate(-240,-150)`}>
              <path className="map-land" d={chart.land}/><path className="map-borders" d={chart.borders}/><path className="map-graticule" d={chart.grid}/>
              <path className="map-route-halo" d={chart.route}/>
              {chart.legs.map((leg, index) => <path key={index} className={`map-route map-${leg.phase}${!plan.ofp?.navlog.length ? ' map-direct' : ''}`} d={leg.path}/>)}
            </g>
            {points.map((point, index) => {
              const position = chart.positions[index];
              if (!position) return null;
              const x = 240 + (position[0] - 240) * view.zoom + view.x;
              const y = 150 + (position[1] - 150) * view.zoom + view.y;
              if (x < -20 || x > 500 || y < -20 || y > 320) return null;
              const milestone = ['TOC', 'TOD'].includes(point.ident);
              const label = point.kind || milestone || selected === index || hovered === index || view.zoom >= 3;
              return <g key={index} className={`map-fix map-${phase(point)}${selected === index ? ' selected' : ''}`} transform={`translate(${x},${y})`} role="button" tabIndex={0} aria-label={`Inspect ${point.ident}`} aria-pressed={selected === index}
                onClick={event => { event.stopPropagation(); choose(index); }}
                onDoubleClick={event => event.stopPropagation()}
                onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); choose(index); } }}
                onMouseEnter={() => setHovered(index)} onMouseLeave={() => setHovered(null)}>
                <circle className="map-hit" r="12"/><circle className="map-selection" r="9"/>
                {milestone ? <path className="map-dot" d="M0,-5L5,0L0,5L-5,0Z"/> : <circle className="map-dot" r={point.kind ? 4.5 : 2.7}/>}
                {point.kind && <circle className="map-airport-ring" r="7"/>}
                {label && <text x={x > 400 ? -10 : 10} y={y < 22 || point.ident === 'TOD' && y < 278 ? 17 : -9} textAnchor={x > 400 ? 'end' : 'start'}>{point.ident}</text>}
              </g>;
            })}
            {!chart.route && <text className="map-empty" x="240" y="150" textAnchor="middle">Route coordinates unavailable</text>}
          </g>
        </svg>
        <div className="map-legend" aria-label="Route phases"><span className="climb">Climb</span><span className="cruise">Cruise</span><span className="descent">Descent</span><span>◇ TOC / TOD</span></div>
      </div>
      <section className="map-inspector" aria-label="Waypoint details" aria-live="polite">
        {fix ? <>
          <div className="map-fix-heading"><div><strong>{fix.ident}</strong><span>{fix.kind ? `${fix.kind} airport` : fix.ident === 'TOC' ? 'Top of climb' : fix.ident === 'TOD' ? 'Top of descent' : [fix.airway, fix.stage].filter(Boolean).join(' · ') || 'Route waypoint'}</span></div>
            <button className="icon-button" aria-label="Previous waypoint" disabled={selected === 0} onClick={() => choose(selected! - 1, true)}><ChevronLeft size={16}/></button><button className="icon-button" aria-label="Next waypoint" disabled={selected === points.length - 1} onClick={() => choose(selected! + 1, true)}><ChevronRight size={16}/></button>
          </div>
          <dl className="map-metrics">
            <div><dt>{fix.kind ? 'Field elevation' : 'Planned altitude'}</dt><dd>{number(fix.altitude, ' ft')}</dd></div>
            <div><dt>{fix.kind === 'departure' ? 'Takeoff UTC' : fix.kind === 'arrival' ? 'Landing UTC' : 'ETO UTC'}</dt><dd>{utc(fix.eta)}</dd></div>
            <div><dt>Wind</dt><dd>{formatWind(fix.windDirection ?? null, fix.windSpeed ?? null)}</dd></div>
            <div><dt>Fuel remaining</dt><dd>{number(fix.fuelRemaining, units ? ` ${units}` : '')}</dd></div>
            <div><dt>Groundspeed</dt><dd>{number(fix.groundspeed, ' kt')}</dd></div><div><dt>Temperature</dt><dd>{number(fix.temperature, ' °C')}</dd></div>
          </dl>{!validPoint(fix) && <p className="map-warning">No coordinates supplied for this waypoint.</p>}
        </> : <div className="map-inspector-hint"><LocateFixed size={22}/><div><strong>Explore your flight</strong><p>Select a waypoint for planned altitude, time, wind and fuel.</p></div></div>}
      </section></div>
      <footer className="map-source">{missing > 0 && <span className="map-warning">{missing} missing position{missing === 1 ? '' : 's'} · gaps are left open.</span>}<span>SimBrief OFP snapshot · Natural Earth</span><small>Drag to pan · Ctrl + scroll to zoom · Arrow keys to pan · Home to fit</small></footer>
    </>;
  }
  return <div className="route-map">{expanded ? <div className="map-placeholder">Route explorer is open in expanded view.</div> : content(false)}
    <dialog className="map-dialog" ref={dialogRef} aria-label="Expanded route map" onCancel={event => { event.preventDefault(); setExpanded(false); }} onClick={event => { if (event.target === event.currentTarget) setExpanded(false); }}>{expanded && content(true)}</dialog>
  </div>;
}
