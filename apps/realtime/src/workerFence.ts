import type Redis from "ioredis";
import type { TransactionSql } from "postgres";
import { db } from "@tell-aviv/database";
import { GameError } from "./engines";

type RedisCommand = (string | number)[];
const ownershipError = () =>
  new GameError("Realtime ownership was lost; reconnect after recovery");

/** Redis arbitrates leases; PostgreSQL serializes takeover with in-flight commits. */
export class WorkerFence {
  private constructor(
    readonly redis: Redis,
    readonly namespace: string,
    readonly token: string,
    readonly generation: string,
  ) {}
  get leaseKey() {
    return `${this.namespace}:realtime-worker`;
  }
  static async acquire(redis: Redis, namespace: string, token: string) {
    if ((await redis.get(`${namespace}:realtime-worker`)) !== token)
      throw ownershipError();
    const generation = await db.begin(async (sql) => {
      const [row] =
        await sql`INSERT INTO realtime_worker_epochs(namespace,generation,owner_token) VALUES(${namespace},1,${token}) ON CONFLICT(namespace) DO UPDATE SET generation=realtime_worker_epochs.generation+1,owner_token=excluded.owner_token,acquired_at=clock_timestamp() RETURNING generation::text`;
      // Acquisition may have waited for an old committing transaction. A lease
      // which expired during that wait must not become a durable owner.
      if ((await redis.get(`${namespace}:realtime-worker`)) !== token)
        throw ownershipError();
      return String(row.generation);
    });
    return new WorkerFence(redis, namespace, token, generation);
  }
  async assertLease() {
    if ((await this.redis.get(this.leaseKey)) !== this.token)
      throw ownershipError();
  }
  async guardTransaction(sql: TransactionSql) {
    const [row] =
      await sql`SELECT generation::text,owner_token::text FROM realtime_worker_epochs WHERE namespace=${this.namespace} FOR SHARE`;
    if (
      !row ||
      row.generation !== this.generation ||
      row.owner_token !== this.token
    )
      throw ownershipError();
    await this.assertLease();
  }
  /** All cache writes publish atomically, only while this exact lease owns Redis. */
  async write(commands: RedisCommand[]) {
    const result = (await this.redis.eval(
      "if redis.call('get',KEYS[1]) ~= ARGV[1] then return {0} end; local commands=cjson.decode(ARGV[2]); local out={1}; for _,command in ipairs(commands) do out[#out+1]=redis.call(unpack(command)) end; return out",
      1,
      this.leaseKey,
      this.token,
      JSON.stringify(commands),
    )) as unknown[];
    if (result[0] !== 1) throw ownershipError();
    return result.slice(1);
  }
}
