import { randomBytes } from "node:crypto";
import { hash, verify, type Options } from "@node-rs/argon2";
import { z } from "zod";
import { fail } from "@tell-aviv/shared";

let runningWork = 0;
const waitingWork: (() => void)[] = [];
async function passwordWork<T>(work: () => Promise<T>): Promise<T> {
  if (runningWork >= 4) {
    if (waitingWork.length >= 32)
      fail(503, "Sign-in is busy. Try again shortly.");
    await new Promise<void>((resolve) => waitingWork.push(resolve));
  } else runningWork++;
  try {
    return await work();
  } finally {
    const next = waitingWork.shift();
    if (next) next();
    else runningWork--;
  }
}

export const passwordSchema = z
  .string()
  .min(12, "Use at least 12 characters")
  .max(128, "Use at most 128 characters")
  .refine(
    (value) => Buffer.byteLength(value, "utf8") <= 512,
    "Password is too long",
  );
export const passwordChangeSchema = z
  .object({
    newPassword: passwordSchema,
    passwordConfirmation: z.string().max(128),
  })
  .refine((value) => value.newPassword === value.passwordConfirmation, {
    message: "Passwords do not match",
    path: ["passwordConfirmation"],
  });

function parameter(
  name: string,
  fallback: number,
  minimum: number,
  maximum: number,
) {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < minimum || value > maximum)
    throw new Error(`${name} is outside its supported secure range`);
  return value;
}
export function passwordParameters(): Options {
  return {
    // NAPI declares Algorithm as an ambient const enum; its Argon2id wire value
    // is 2. A typed literal also works with Next's isolatedModules compilation.
    algorithm: 2,
    memoryCost: parameter("AUTH_ARGON_MEMORY_KIB", 65536, 19456, 262144),
    timeCost: parameter("AUTH_ARGON_TIME_COST", 3, 2, 10),
    parallelism: parameter("AUTH_ARGON_PARALLELISM", 1, 1, 4),
    outputLen: 32,
  };
}
export async function hashPassword(password: string) {
  const value = passwordSchema.parse(password),
    parameters = passwordParameters();
  return passwordWork(() => hash(value, parameters));
}
let dummyHash: Promise<string> | undefined;
export async function verifyPassword(password: string, encodedHash?: string) {
  // The missing-user path performs the same expensive verifier as an existing account.
  const candidate =
    encodedHash ??
    (await (dummyHash ??= passwordWork(() =>
      hash(randomBytes(32).toString("base64url"), passwordParameters()),
    ).catch((error: unknown) => {
      dummyHash = undefined;
      throw error;
    })));
  return (
    (await passwordWork(() =>
      verify(candidate, password).catch(() => false),
    )) && Boolean(encodedHash)
  );
}
