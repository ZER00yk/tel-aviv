import { z } from "zod";
import { idSchema, resourceData, type ResourceKind } from "./models";
// School schema extension is separate from creator level schema evolution.
export const flashcardDeckSchema = z
  .object({
    cards: z
      .array(
        z
          .object({
            front: z.string().min(1).max(2000),
            back: z.string().min(1).max(5000),
            tags: z.array(z.string().max(40)).max(10).default([]),
            imageResourceId: idSchema.nullable().default(null),
          })
          .strict(),
      )
      .max(500),
  })
  .strict();
export function schoolResourceSchema(
  kind: ResourceKind,
): z.ZodType<Record<string, unknown>> {
  return (
    kind === "flashcards" ? flashcardDeckSchema : resourceData[kind]
  ) as z.ZodType<Record<string, unknown>>;
}
