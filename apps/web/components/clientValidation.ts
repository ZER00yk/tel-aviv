import { z } from "zod";

// Configure validation before client schemas are constructed. Zod's automatic
// JIT probe calls Function even when strict CSP blocks it and fallback works.
// Explicitly using its interpreter avoids those blocked dynamic-code attempts.
if (typeof window !== "undefined") z.config({ jitless: true });
