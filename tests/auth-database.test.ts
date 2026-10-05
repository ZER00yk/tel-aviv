import { randomUUID } from "node:crypto";
import { describe, it, expect } from "vitest";
import { db } from "@tell-aviv/database";
import { getSession, handleAuth } from "@tell-aviv/auth";
import { handleSocial } from "../packages/platform/src/social";
import type { User } from "@tell-aviv/shared";

describe.runIf(process.env.RUN_DB_TESTS === "true")(
  "persisted authentication and privacy settings",
  () => {
    it("keeps onboarding and invisible presence as objects through login, profile changes and session lookup", async () => {
      const username = `auth_${randomUUID().slice(0, 8)}`;
      let user: User | undefined;
      try {
        const login = await handleAuth(
          ["auth", "dev"],
          "POST",
          new Request("http://localhost:3000/api/auth/dev"),
          { username },
        );
        expect(login?.status).toBe(200);
        user = ((await login!.json()) as { data: User }).data;
        expect(user.settings).toEqual({ onboardingComplete: true });
        const cookie = login!.headers.get("set-cookie")!.split(";")[0];
        const request = new Request("http://localhost:3000/api/profile", {
          headers: { cookie },
        });
        await handleSocial(
          ["profile"],
          "POST",
          { user, request },
          {
            settings: {
              presence: "invisible",
              privacy: { showActivity: false },
            },
          },
        );
        const persisted = await getSession(request);
        expect(persisted?.settings).toEqual({
          onboardingComplete: true,
          presence: "invisible",
          privacy: { showActivity: false },
        });
        await handleSocial(
          ["profile"],
          "POST",
          { user: persisted!, request },
          { settings: { accessibility: { reducedMotion: true } } },
        );
        const final = await getSession(request);
        expect(final?.settings.privacy).toEqual({ showActivity: false });
        expect(final?.settings.presence).toBe("invisible");
        expect(
          (
            await db`SELECT jsonb_typeof(settings) AS kind FROM users WHERE id=${user.id}`
          )[0].kind,
        ).toBe("object");
      } finally {
        if (user) await db`DELETE FROM users WHERE id=${user.id}`;
      }
    });
  },
);
