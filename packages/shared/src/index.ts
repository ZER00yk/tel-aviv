export type Json =
  null | boolean | number | string | Json[] | { [key: string]: Json };
export interface User {
  id: string;
  username: string;
  displayName: string;
  avatar: string | null;
  banner: string | null;
  bio: string;
  status: string;
  xp: number;
  role: "user" | "admin" | "owner";
  settings: Record<string, Json>;
}
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export function fail(status: number, message: string): never {
  throw new ApiError(status, message);
}
export interface ApiContext {
  user: User;
  request: Request;
}
export type ApiHandler = (
  path: string[],
  method: string,
  context: ApiContext,
  input: Record<string, unknown>,
) => Promise<unknown | undefined>;
export const usernamePattern = /^[a-zA-Z0-9_]{3,24}$/;
export function levelForXp(xp: number) {
  return 1 + Math.floor(Math.sqrt(Math.max(0, xp) / 100));
}
