import { z } from "zod";

export const movementActions = ["up", "down", "left", "right"] as const;
export const movementCodes = [
  "KeyW",
  "KeyA",
  "KeyS",
  "KeyD",
  "KeyI",
  "KeyO",
  "KeyU",
  "KeyH",
  "KeyF",
  "KeyG",
  "KeyV",
  "KeyB",
  "KeyN",
  "KeyM",
  "KeyT",
  "KeyY",
  "KeyR",
] as const;
export type MovementKeys = Partial<
  Record<(typeof movementActions)[number], (typeof movementCodes)[number]>
>;
export const defaultMovement = {
  up: "KeyW",
  down: "KeyS",
  left: "KeyA",
  right: "KeyD",
} as const;
export const movementKeysSchema = z
  .object({
    up: z.enum(movementCodes).optional(),
    down: z.enum(movementCodes).optional(),
    left: z.enum(movementCodes).optional(),
    right: z.enum(movementCodes).optional(),
  })
  .strict()
  .refine(
    (value) =>
      new Set(Object.values({ ...defaultMovement, ...value })).size === 4,
    "Choose a different key for each movement direction",
  );

/** Translate physical movement keys while retaining arrows and unrelated action keys. */
export function translateMovementCode(
  code: string,
  bindings: MovementKeys = {},
): string {
  const effective = { ...defaultMovement, ...bindings };
  for (const action of movementActions)
    if (code === effective[action]) return defaultMovement[action];
  if (Object.values(defaultMovement).some((value) => value === code)) return "";
  return code;
}
export function translateMovementKey(
  code: string,
  key: string,
  bindings: MovementKeys = {},
) {
  const translated = translateMovementCode(code, bindings);
  if (!translated) return "";
  if (/^Key[A-Z]$/.test(translated)) return translated.slice(3).toLowerCase();
  return key.toLowerCase();
}
