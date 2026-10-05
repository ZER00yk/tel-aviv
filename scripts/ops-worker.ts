import { closeDatabase } from "@tell-aviv/database";
import { operationsPass } from "./ops/worker";
const apply = process.argv.includes("--apply"),
  loop = process.argv.includes("--loop");
if (process.argv.includes("--apply") && process.argv.includes("--dry-run"))
  throw Error("Choose --apply or --dry-run");
const interval = Number(process.env.OPS_INTERVAL_SECONDS ?? 60);
if (!Number.isFinite(interval) || interval < 10 || interval > 3600)
  throw Error("OPS_INTERVAL_SECONDS must be 10–3600");
let stopping = false;
process.on("SIGTERM", () => {
  stopping = true;
});
process.on("SIGINT", () => {
  stopping = true;
});
try {
  do {
    const report = await operationsPass({
      apply,
      backupEnabled: process.env.BACKUP_ENABLED === "true",
      backupEveryHours: Number(process.env.BACKUP_EVERY_HOURS ?? 24),
      retainDays: Number(process.env.BACKUP_RETAIN_DAYS ?? 14),
      minKeep: Number(process.env.BACKUP_MIN_KEEP ?? 7),
    });
    console.log(JSON.stringify({ time: new Date().toISOString(), ...report }));
    if (report.failures && !loop) process.exitCode = 1;
    if (!loop || stopping) break;
    // Short waits let signals stop the service promptly, even with a long configured interval.
    for (let elapsed = 0; elapsed < interval && !stopping; elapsed++)
      await new Promise((resolve) => setTimeout(resolve, 1000));
  } while (!stopping);
} finally {
  await closeDatabase();
}
