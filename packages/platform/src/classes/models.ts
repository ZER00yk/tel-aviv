import { z } from "zod";

export const idSchema = z.string().uuid();
export const titleSchema = z.string().trim().min(1).max(160);
const text = z.string().max(500_000);
const url = z
  .string()
  .url()
  .max(2048)
  .refine((value) => /^https?:\/\//i.test(value), "Use an HTTP or HTTPS URL");
export const resourceKind = z.enum([
  "folder",
  "note",
  "assignment",
  "flashcards",
  "quiz",
  "link",
  "file",
]);
export const quizQuestion = z
  .object({
    prompt: z.string().trim().min(1).max(2000),
    type: z.enum(["multiple-choice", "multi-select", "true-false", "short-answer"]),
    options: z.array(z.string().max(500)).max(8).default([]),
    answer: z.union([z.string().max(500), z.array(z.string().max(500)).min(1).max(8)]),
  })
  .strict()
  .superRefine((question, context) => {
    if (
      question.type === "multiple-choice" &&
      (question.options.length < 2 ||
        typeof question.answer !== "string" || !question.options.includes(question.answer))
    )
      context.addIssue({
        code: "custom",
        message: "Choice questions need options including the answer",
      });
    if (
      question.type === "true-false" &&
      (typeof question.answer !== "string" || !["true", "false"].includes(question.answer.toLowerCase()))
    )
      context.addIssue({
        code: "custom",
        message: "Answer must be true or false",
      });
    if (question.type === "short-answer" && typeof question.answer !== "string")
      context.addIssue({code:"custom",message:"Short answers must be text"});
    if (question.type === "multi-select" && (question.options.length < 2 || !Array.isArray(question.answer) || new Set(question.answer).size !== question.answer.length || question.answer.some(answer => !question.options.includes(answer))))
      context.addIssue({code:"custom",message:"Multi-select questions need distinct answers from their choices"});
    if (new Set(question.options).size !== question.options.length)
      context.addIssue({code:"custom",message:"Choices must be distinct"});
  });
export const resourceData = {
  folder: z.object({}).strict(),
  note: z.object({ markdown: text.default("") }).strict(),
  assignment: z
    .object({
      description: z.string().max(20_000).default(""),
      dueDate: z
        .string()
        .datetime({ offset: true })
        .transform((value) => new Date(value).toISOString())
        .nullable()
        .default(null),
      status: z
        .enum(["not-started", "in-progress", "done"])
        .default("not-started"),
      priority: z.enum(["low", "normal", "high"]).default("normal"),
      notes: z.string().max(20_000).default(""),
      links: z.array(url).max(20).default([]),
      attachments: z.array(idSchema).max(20).default([]),
    })
    .strict(),
  flashcards: z
    .object({
      cards: z
        .array(
          z
            .object({
              front: z.string().min(1).max(2000),
              back: z.string().min(1).max(5000),
              tags: z.array(z.string().max(40)).max(10).default([]),
            })
            .strict(),
        )
        .max(500),
    })
    .strict(),
  quiz: z
    .object({
      questions: z.array(quizQuestion).min(1).max(100),
      randomOrder: z.boolean().default(true),
    })
    .strict(),
  link: z
    .object({ url, description: z.string().max(2000).default("") })
    .strict(),
  file: z
    .object({
      key: z.string(),
      name: z.string(),
      mime: z.string(),
      size: z.number().int().nonnegative(),
    })
    .strict(),
};
export type ResourceKind = z.infer<typeof resourceKind>;
export type Quiz = z.infer<typeof resourceData.quiz>;
export type QuizAnswer = string | string[];
export function scoreQuiz(quiz: Quiz, answers: QuizAnswer[]) {
  const normalize = (value: string) => value.trim().toLowerCase();
  const results = quiz.questions.map((question, index) => {
    const submitted = answers[index] ?? "";
    const correct = question.type === "multi-select"
      ? Array.isArray(submitted) && Array.isArray(question.answer) && new Set(submitted).size === submitted.length && submitted.length === question.answer.length && submitted.every(answer => question.answer.includes(answer))
      : typeof submitted === "string" && typeof question.answer === "string" && normalize(submitted) === normalize(question.answer);
    return { index, prompt:question.prompt, type:question.type, submitted, correct, answer:question.answer };
  });
  return {
    score: results.filter((result) => result.correct).length,
    total: results.length,
    results,
  };
}

// Creator schema is shared by visual authoring, client play and server replay.
export * from "../../../creator-runtime/src/schema";
