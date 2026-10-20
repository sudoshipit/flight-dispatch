import { geoAzimuthalEquidistant, geoCentroid, geoPath } from 'd3-geo';

export function zoomRouteView(view, factor, at = { x: 240, y: 150 }) {
  const zoom = Math.max(1, Math.min(8, view.zoom * factor));
  const ratio = zoom / view.zoom;
  return { zoom, x: at.x - 240 - (at.x - 240 - view.x) * ratio, y: at.y - 150 - (at.y - 150 - view.y) * ratio };
}

export const validPoint = point => point && typeof point.lat === 'number' && typeof point.lon === 'number' && Number.isFinite(point.lat) && Number.isFinite(point.lon) && Math.abs(point.lat) <= 90 && Math.abs(point.lon) <= 180;
// Preserve gaps instead of drawing an apparently verified leg through missing fixes.
/** @returns {import('geojson').MultiLineString} */
export function routeGeometry(points) {
  const segments = []; let segment = [];
  for (const point of points) {
    if (!validPoint(point)) { if (segment.length > 1) segments.push(segment); segment = []; continue; }
    const coordinate = [point.lon, point.lat];
    if (!segment.length || coordinate.some((v, i) => v !== segment.at(-1)[i])) segment.push(coordinate);
  }
  if (segment.length > 1) segments.push(segment);
  return { type: 'MultiLineString', coordinates: segments };
}
export function routeProjection(points, width = 480, height = 300) {
  const positions = points.filter(validPoint).map(p => [p.lon, p.lat]);
  const geometry = routeGeometry(points);
  const center = positions.length ? geoCentroid({ type: 'MultiPoint', coordinates: positions }) : [0, 20];
  const projection = geoAzimuthalEquidistant().rotate([-center[0], -center[1]]).clipAngle(175).translate([width / 2, height / 2]).scale(80);
  if (positions.length > 1) {
    const bounds = geoPath(projection).bounds({ type: 'MultiPoint', coordinates: positions });
    if (Math.max(bounds[1][0] - bounds[0][0], bounds[1][1] - bounds[0][1]) > 0.001) {
      projection.fitExtent([[48, 42], [width - 48, height - 42]], { type: 'GeometryCollection', geometries: [geometry, { type: 'MultiPoint', coordinates: positions }] });
      projection.scale(Math.min(12000, projection.scale()));
    }
  }
  return projection;
}
