"use client";
import { useState } from "react";
import Link from "next/link";
import { gameById } from "@tell-aviv/games";
import type { User } from "@tell-aviv/shared";
import type {
  CosmeticItem,
  CosmeticSlot,
  InventoryData,
  ProfilePresentation,
  ShowcaseAchievement,
} from "../../../packages/platform/src/inventory";
import {
  api,
  Avatar,
  Empty,
  Notice,
  Panel,
  ResourceState,
  time,
  useResource,
  useSession,
} from "./ui";

// Types-only imports keep database code out of the browser bundle.
type Identity = Pick<User, "id" | "username" | "displayName" | "avatar">;
const styles = `
.inventory-overview{display:flex;align-items:center;gap:22px;flex-wrap:wrap;margin:18px 0}.inventory-overview strong{font-size:1.8rem}.inventory-overview small{display:block}.inventory-preview{display:flex;align-items:center;gap:16px;min-width:220px}.inventory-items{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:16px}.inventory-item{border:1px solid var(--border,#333b43);border-radius:16px;padding:18px;display:flex;flex-direction:column;gap:12px}.inventory-item h3,.inventory-item p{margin:0}.inventory-item p{line-height:1.6}.inventory-item .button{margin-top:auto}.inventory-icon{font-size:2rem}.inventory-actions{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-top:16px}.inventory-earned{display:grid;gap:10px;margin-top:16px}.inventory-achievement{display:flex;align-items:flex-start;gap:12px;padding:14px;border:1px solid var(--border,#333b43);border-radius:12px}.inventory-achievement input{margin-top:5px;accent-color:#8ee8c4}.inventory-achievement strong{display:block}.inventory-achievement p{margin:5px 0;line-height:1.5}.inventory-achievement small{display:block}.inventory-showcase{display:grid;gap:12px}.inventory-cosmetics{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:16px}.inventory-cosmetic{display:inline-flex;align-items:center;gap:7px;padding:6px 11px;border:1px solid currentColor;border-radius:20px;font-size:.85rem}.inventory-avatar-frame{display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;border-radius:50%;line-height:0}.inventory-avatar-frame .avatar{margin:0}.inventory-section{margin:24px 0}.inventory-section h2{margin-bottom:8px}
`;

function FramedAvatar({
  user,
  size,
  frame,
}: {
  user: Identity;
  size?: string;
  frame: CosmeticItem | null;
}) {
  return (
    <span
      className="inventory-avatar-frame"
      style={
        frame
          ? {
              padding: 4,
              border: `2px solid ${frame.color}`,
              boxShadow: `0 0 20px ${frame.color}66`,
            }
          : undefined
      }
    >
      <Avatar user={user} size={size} />
    </span>
  );
}

export function CosmeticAvatar({
  user,
  size = "",
}: {
  user: Identity;
  size?: string;
}) {
  const profile = useResource<ProfilePresentation>(
    `inventory/profile/${user.id}`,
  );
  return (
    <>
      <style>{styles}</style>
      <FramedAvatar
        user={user}
        size={size}
        frame={profile.data?.equipment.frame ?? null}
      />
    </>
  );
}

function IdentityDecorations({
  equipment,
}: {
  equipment: ProfilePresentation["equipment"];
}) {
  return (
    <div className="inventory-cosmetics">
      {[equipment.title, equipment.badge]
        .filter((item): item is CosmeticItem => !!item)
        .map((item) => (
          <span
            className="inventory-cosmetic"
            key={item.id}
            style={{ borderColor: item.color }}
          >
            <span aria-hidden="true" style={{ color: item.color }}>
              {item.icon}
            </span>
            <span>{item.name}</span>
          </span>
        ))}
    </div>
  );
}

function AchievementCard({
  achievement,
}: {
  achievement: ShowcaseAchievement;
}) {
  return (
    <article className="inventory-achievement">
      <span className="inventory-icon" aria-hidden="true">
        {achievement.icon === "star" ? "✦" : achievement.icon}
      </span>
      <div>
        <strong>{achievement.name}</strong>
        <p>{achievement.description}</p>
        <small className="muted">
          {achievement.points} XP · Earned {time(achievement.unlockedAt)}
        </small>
        <Link className="text-link" href={`/games/${achievement.gameId}`}>
          {gameById(achievement.gameId)?.name ?? "View game"}
        </Link>
      </div>
    </article>
  );
}

export function ProfileShowcase({ userId }: { userId: string }) {
  const profile = useResource<ProfilePresentation>(
    `inventory/profile/${userId}`,
  );
  return (
    <Panel title="Achievement showcase">
      <style>{styles}</style>
      <ResourceState
        loading={profile.loading}
        error={profile.error}
        retry={profile.refresh}
      />
      {profile.data && (
        <>
          <IdentityDecorations equipment={profile.data.equipment} />
          {profile.data.showcasePrivate ? (
            <p className="muted">This player's achievements are private.</p>
          ) : profile.data.showcase.length ? (
            <div className="inventory-showcase">
              {profile.data.showcase.map((achievement) => (
                <AchievementCard
                  key={achievement.id}
                  achievement={achievement}
                />
              ))}
            </div>
          ) : (
            <Empty title="No achievements on display yet">
              Earn achievements in games and choose your favorites from
              Inventory settings.
            </Empty>
          )}
        </>
      )}
    </Panel>
  );
}

export function Inventory() {
  const { user, refresh: refreshSession } = useSession();
  const inventory = useResource<InventoryData>("inventory");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [draft, setDraft] = useState<string[] | null>(null);
  const data = inventory.data;
  const selected =
    draft ?? data?.showcase.map((achievement) => achievement.id) ?? [];
  async function mutate(
    path: string,
    input: Record<string, unknown>,
    success: string,
  ) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await api(path, "POST", input);
      await Promise.all([inventory.refresh(), refreshSession()]);
      setMessage(success);
      return true;
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : "Inventory update failed",
      );
      return false;
    } finally {
      setBusy(false);
    }
  }
  function equip(slot: CosmeticSlot, itemId: string | null) {
    void mutate(
      "inventory/equip",
      { slot, itemId },
      itemId ? "Cosmetic equipped." : "Cosmetic removed.",
    );
  }
  return (
    <div>
      <style>{styles}</style>
      <ResourceState
        loading={inventory.loading}
        error={inventory.error}
        retry={inventory.refresh}
      />
      <Notice>{error}</Notice>
      <Notice success>{message}</Notice>
      {data && (
        <>
          <h2>Inventory &amp; TellCoin shop</h2>
          <p className="muted">
            Earn TellCoins through game achievements, then make your identity
            your own. Cosmetics have no gameplay advantage.
          </p>
          <div className="inventory-overview">
            <div>
              <small className="muted">Your TellCoins</small>
              <strong>{data.balance.toLocaleString()}</strong>
            </div>
            <div className="inventory-preview">
              <FramedAvatar
                user={user}
                size="large-avatar"
                frame={data.equipment.frame}
              />
              <div>
                <strong style={{ fontSize: "1rem" }}>{user.displayName}</strong>
                <IdentityDecorations equipment={data.equipment} />
              </div>
            </div>
          </div>
          <section className="inventory-section" aria-label="TellCoin shop">
            <h2>Something for your profile</h2>
            <div className="inventory-items">
              {data.shop.map((item) => (
                <article className="inventory-item" key={item.id}>
                  <span
                    className="inventory-icon"
                    style={{ color: item.color }}
                    aria-hidden="true"
                  >
                    {item.icon}
                  </span>
                  <h3>{item.name}</h3>
                  <p className="muted">{item.description}</p>
                  <small>
                    {item.earnedOnly
                      ? "Earned in game"
                      : `${item.price} TellCoins`}{" "}
                    · {item.kind}
                  </small>
                  {item.owned ? (
                    <button
                      className="button secondary"
                      disabled={busy}
                      onClick={() =>
                        equip(
                          item.kind,
                          data.equipment[item.kind]?.id === item.id
                            ? null
                            : item.id,
                        )
                      }
                    >
                      {data.equipment[item.kind]?.id === item.id
                        ? `Remove ${item.name}`
                        : `Equip ${item.name}`}
                    </button>
                  ) : item.earnedOnly ? (
                    <span className="muted">
                      Complete the ranked gauntlet to unlock.
                    </span>
                  ) : (
                    <button
                      className="button"
                      disabled={busy || data.balance < item.price}
                      onClick={() =>
                        void mutate(
                          "economy/purchase",
                          { itemId: item.id },
                          `${item.name} added to your inventory.`,
                        )
                      }
                    >
                      Buy {item.name} · {item.price} TellCoins
                    </button>
                  )}
                </article>
              ))}
            </div>
          </section>
          <section
            className="inventory-section"
            aria-label="Choose achievement showcase"
          >
            <h2>Your achievement showcase</h2>
            <p className="muted">
              Choose up to five achievements, in the order you select them. Your
              Activity privacy setting also controls whether others can see this
              showcase.
            </p>
            {data.achievements.length ? (
              <div className="inventory-earned">
                {data.achievements.map((achievement) => (
                  <label className="inventory-achievement" key={achievement.id}>
                    <input
                      aria-label={`Showcase ${achievement.name}`}
                      type="checkbox"
                      checked={selected.includes(achievement.id)}
                      disabled={
                        busy ||
                        (!selected.includes(achievement.id) &&
                          selected.length >= 5)
                      }
                      onChange={(event) =>
                        setDraft(
                          event.target.checked
                            ? [...selected, achievement.id]
                            : selected.filter((id) => id !== achievement.id),
                        )
                      }
                    />
                    <span className="inventory-icon" aria-hidden="true">
                      {achievement.icon === "star" ? "✦" : achievement.icon}
                    </span>
                    <span>
                      <strong>{achievement.name}</strong>
                      <span className="muted">{achievement.description}</span>
                      <small className="muted">
                        {achievement.points} XP · {time(achievement.unlockedAt)}
                      </small>
                    </span>
                  </label>
                ))}
              </div>
            ) : (
              <Empty title="Your next achievement is waiting">
                Play games and meet their goals to unlock achievements.
              </Empty>
            )}
            <div className="inventory-actions">
              <span className="muted">{selected.length} / 5 selected</span>
              <button
                className="button"
                disabled={busy}
                onClick={async () => {
                  if (
                    await mutate(
                      "inventory/showcase",
                      { achievementIds: selected },
                      "Achievement showcase saved.",
                    )
                  )
                    setDraft(null);
                }}
              >
                Save showcase
              </button>
              <button
                className="button secondary"
                disabled={busy || selected.length === 0}
                onClick={() => setDraft([])}
              >
                Clear selection
              </button>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
