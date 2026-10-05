export type Tool =
  | "select"
  | "box"
  | "ball"
  | "plank"
  | "domino"
  | "ragdoll"
  | "vehicle"
  | "explosive"
  | "joint"
  | "hazard"
  | "bumper"
  | "delete";
export interface SavedBody {
  id: string;
  type: string;
  x: number;
  y: number;
  angle: number;
  width: number;
  height: number;
  radius: number;
  isStatic: boolean;
}
export interface SavedJoint {
  a: string;
  b: string;
  length: number;
  stiffness: number;
}
export interface SceneSave {
  version: 1;
  gravity: number;
  bodies: SavedBody[];
  joints: SavedJoint[];
}
export function validateScene(value: unknown): value is SceneSave {
  if (typeof value !== "object" || value === null) return false;
  const s = value as SceneSave;
  return (
    s.version === 1 &&
    Number.isFinite(s.gravity) &&
    s.gravity >= -2 &&
    s.gravity <= 2 &&
    Array.isArray(s.bodies) &&
    s.bodies.length <= 150 &&
    s.bodies.every(
      (b) =>
        typeof b.id === "string" &&
        b.id.length < 100 &&
        [
          "box",
          "ball",
          "plank",
          "domino",
          "ragdoll",
          "vehicle",
          "wheel",
          "explosive",
          "hazard",
          "bumper",
        ].includes(b.type) &&
        [b.x, b.y, b.angle, b.width, b.height, b.radius].every(
          Number.isFinite,
        ) &&
        b.width >= 0 &&
        b.width <= 400 &&
        b.height >= 0 &&
        b.height <= 400 &&
        b.radius >= 0 &&
        b.radius <= 200 &&
        b.x >= -1000 &&
        b.x <= 2000 &&
        b.y >= -1000 &&
        b.y <= 2000,
    ) &&
    Array.isArray(s.joints) &&
    s.joints.length <= 250 &&
    s.joints.every(
      (j) =>
        typeof j.a === "string" &&
        typeof j.b === "string" &&
        Number.isFinite(j.length) &&
        j.length >= 0 &&
        j.length <= 1500 &&
        Number.isFinite(j.stiffness) &&
        j.stiffness >= 0 &&
        j.stiffness <= 1,
    )
  );
}
