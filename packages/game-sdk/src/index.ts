import { gameById, type GamePermission } from "../../../games/catalog";
import type { Json } from "@tell-aviv/shared";
export interface GameIdentity {
  id: string;
  username: string;
  displayName: string;
  avatar: string | null;
}
export interface CloudSave<T = Json> {
  data: T | null;
  schemaVersion: number;
  revision: number;
  updatedAt: string | null;
  authoritative: false;
}
export class GameSDK {
  readonly gameId: string;
  private revision: number | undefined;
  constructor(gameId: string) {
    if (!gameById(gameId)) throw new Error("Unknown game");
    this.gameId = gameId;
  }
  private check(permission: GamePermission) {
    if (!gameById(this.gameId)!.permissions.includes(permission))
      throw new Error(`Game permission denied: ${permission}`);
  }
  private async request<T>(
    path: string,
    method = "GET",
    input?: unknown,
  ): Promise<T> {
    const response = await fetch(`/api/games/${this.gameId}/${path}`, {
      method,
      credentials: "same-origin",
      headers:
        input === undefined ? {} : { "Content-Type": "application/json" },
      body: input === undefined ? undefined : JSON.stringify(input),
    });
    const body = (await response.json()) as { data: T; error?: string };
    if (!response.ok || body.error)
      throw new Error(body.error ?? "Game service unavailable");
    return body.data;
  }
  async user(): Promise<GameIdentity> {
    const user = await this.request<GameIdentity>("user");
    return {
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      avatar: user.avatar,
    };
  }
  async load<T = Json>(): Promise<CloudSave<T>> {
    this.check("saves.read");
    const save = await this.request<CloudSave<T>>("save");
    this.revision = save.revision;
    return save;
  }
  async save<T>(data: T, schemaVersion = 1): Promise<CloudSave<T>> {
    this.check("saves.write");
    const save = await this.request<CloudSave<T>>("save", "POST", {
      data,
      schemaVersion,
      ...(this.revision === undefined
        ? {}
        : { expectedRevision: this.revision }),
    });
    this.revision = save.revision;
    return save;
  }
  action<T = unknown>(
    action: string,
    payload: Record<string, unknown> = {},
  ): Promise<{ state: T; result?: unknown }> {
    return this.request("action", "POST", { action, payload });
  }
  leaderboard(): Promise<unknown> {
    this.check("leaderboards.read");
    return this.request("leaderboard");
  }
  presence(status = "playing"): Promise<unknown> {
    this.check("presence.write");
    return this.request("presence", "POST", { status });
  }
  start(): Promise<unknown> {
    return this.request("start", "POST", {});
  }
  end(): Promise<unknown> {
    return this.request("end", "POST", {});
  }
}
