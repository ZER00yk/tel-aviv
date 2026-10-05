import type { LevelObject } from "./schema";

export type Point = { x: number; y: number };
export type Rectangle = Point & { width: number; height: number };
export const preciseSolidTypes = [
  "slope",
  "angled-platform",
  "polygon-platform",
  "destructible",
  "cart",
];

/** World-space convex collision polygon, also used by the SVG scene renderer. */
export function objectPolygon(object: LevelObject): Point[] {
  const local =
    object.type === "slope"
      ? object.slopeDirection === "left"
        ? [
            { x: 0, y: 0 },
            { x: 1, y: 1 },
            { x: 0, y: 1 },
          ]
        : [
            { x: 0, y: 1 },
            { x: 1, y: 0 },
            { x: 1, y: 1 },
          ]
      : (object.vertices ?? [
          { x: 0, y: 0 },
          { x: 1, y: 0 },
          { x: 1, y: 1 },
          { x: 0, y: 1 },
        ]);
  const angle = (object.rotation * Math.PI) / 180;
  const cosine = Math.cos(angle),
    sine = Math.sin(angle);
  const cx = object.x + object.width / 2,
    cy = object.y + object.height / 2;
  return local.map((point) => {
    const x = (point.x - 0.5) * object.width,
      y = (point.y - 0.5) * object.height;
    return { x: cx + x * cosine - y * sine, y: cy + x * sine + y * cosine };
  });
}

/** Separating-axis test with at most ten axes (eight creator edges + X/Y). */
export function convexCollision(rectangle: Rectangle, polygon: Point[]) {
  const axes: Point[] = [
    { x: 1, y: 0 },
    { x: 0, y: 1 },
  ];
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i],
      b = polygon[(i + 1) % polygon.length];
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    if (length > 1e-8)
      axes.push({ x: -(b.y - a.y) / length, y: (b.x - a.x) / length });
  }
  const corners = [
    { x: rectangle.x, y: rectangle.y },
    { x: rectangle.x + rectangle.width, y: rectangle.y },
    { x: rectangle.x + rectangle.width, y: rectangle.y + rectangle.height },
    { x: rectangle.x, y: rectangle.y + rectangle.height },
  ];
  let depth = Infinity;
  let normal = axes[0];
  for (const axis of axes) {
    const project = (point: Point) => point.x * axis.x + point.y * axis.y;
    const values = polygon.map(project),
      box = corners.map(project);
    const polygonMin = Math.min(...values),
      polygonMax = Math.max(...values);
    const boxMin = Math.min(...box),
      boxMax = Math.max(...box);
    if (boxMax <= polygonMin + 1e-8 || polygonMax <= boxMin + 1e-8) return null;
    // Include containment: use the smaller distance that completely separates.
    const negative = boxMax - polygonMin,
      positive = polygonMax - boxMin;
    const amount = Math.min(negative, positive);
    if (amount < depth) {
      depth = amount;
      normal = negative < positive ? { x: -axis.x, y: -axis.y } : axis;
    }
  }
  return { depth, normal };
}

export function surfaceY(polygon: Point[], x: number): number | null {
  const hits: number[] = [];
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i],
      b = polygon[(i + 1) % polygon.length];
    if (Math.abs(b.x - a.x) < 1e-8) continue;
    if (x < Math.min(a.x, b.x) - 1e-8 || x > Math.max(a.x, b.x) + 1e-8)
      continue;
    hits.push(a.y + ((b.y - a.y) * (x - a.x)) / (b.x - a.x));
  }
  return hits.length ? Math.min(...hits) : null;
}

export function distanceToPolygon(point: Point, polygon: Point[]): number {
  let direction = 0,
    inside = true,
    distance = Infinity;
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i],
      b = polygon[(i + 1) % polygon.length];
    const cross = (b.x - a.x) * (point.y - a.y) - (b.y - a.y) * (point.x - a.x);
    const sign = Math.sign(cross);
    if (direction && sign && direction !== sign) inside = false;
    direction ||= sign;
    const length2 = (b.x - a.x) ** 2 + (b.y - a.y) ** 2;
    const t =
      length2 > 0
        ? Math.max(
            0,
            Math.min(
              1,
              ((point.x - a.x) * (b.x - a.x) + (point.y - a.y) * (b.y - a.y)) /
                length2,
            ),
          )
        : 0;
    distance = Math.min(
      distance,
      Math.hypot(
        point.x - a.x - t * (b.x - a.x),
        point.y - a.y - t * (b.y - a.y),
      ),
    );
  }
  return inside ? 0 : distance;
}
