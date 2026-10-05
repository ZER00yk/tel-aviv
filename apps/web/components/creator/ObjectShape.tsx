import type { LevelObject } from "../../../../packages/creator-runtime/src/schema";
import { objectPolygon } from "./physics";

/** The editor, local game and authoritative collision use identical vertices. */
export default function ObjectShape({
  object,
  fill,
  opacity,
  stroke,
  strokeWidth,
  strokeDasharray,
  dataId,
  dataObjectId,
}: {
  object: LevelObject;
  fill: string;
  opacity?: number;
  stroke?: string;
  strokeWidth?: number;
  strokeDasharray?: string;
  dataId?: string;
  dataObjectId?: string;
}) {
  if (!["slope", "angled-platform", "polygon-platform"].includes(object.type))
    return (
      <rect
        data-id={dataId}
        data-object-id={dataObjectId}
        x={object.x}
        y={object.y}
        width={object.width}
        height={object.height}
        rx={object.type === "spikes" ? 0 : 3}
        fill={fill}
        opacity={opacity}
        stroke={stroke}
        strokeWidth={strokeWidth}
        strokeDasharray={strokeDasharray}
        transform={`rotate(${object.rotation} ${object.x + object.width / 2} ${object.y + object.height / 2})`}
      >
        <title>{object.label || object.type}</title>
      </rect>
    );
  return (
    <polygon
      data-id={dataId}
      data-object-id={dataObjectId}
      points={objectPolygon(object)
        .map((point) => `${point.x},${point.y}`)
        .join(" ")}
      fill={fill}
      opacity={opacity}
      stroke={stroke}
      strokeWidth={strokeWidth}
      strokeDasharray={strokeDasharray}
    >
      <title>{object.label || object.type}</title>
    </polygon>
  );
}
