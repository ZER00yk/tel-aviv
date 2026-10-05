try {
  process.loadEnvFile(".env");
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
}
void import("./server")
  .then(({ startRealtime }) => startRealtime())
  .catch((error) => {
    console.error(
      "Realtime startup failed:",
      error instanceof Error ? error.message : "unknown error",
    );
    process.exitCode = 1;
  });
