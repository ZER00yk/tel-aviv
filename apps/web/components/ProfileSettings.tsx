"use client";
import type {
  ProfileData,
  HistoryEntry,
  ChatRoomData,
  SessionData,
  UiSettings,
} from "./models";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Pencil,
  MessageCircle,
  UserPlus,
  Shield,
  Sparkles,
  Check,
  LogOut,
  Monitor,
  Moon,
  Sun,
} from "lucide-react";
import { gameById, type GameManifest } from "@tell-aviv/games";
import { levelForXp } from "@tell-aviv/shared";
import { GameCard } from "./HomeGames";
import { Inventory, ProfileShowcase, CosmeticAvatar } from "./Inventory";
import { DesktopPermission } from "./live/DesktopPermission";
import { passwordField } from "./auth/NativeAuth";
import { AccountSecurity, type SecurityStatus } from "./auth/AccountSecurity";
import {
  api,
  Avatar,
  Empty,
  field,
  Heading,
  Notice,
  Panel,
  ResourceState,
  time,
  useResource,
  useSession,
} from "./ui";

export function ProfilePage({ id }: { id: string }) {
  const { user } = useSession(),
    profile = useResource<ProfileData>(`users/${id}`),
    own = user.id === id,
    [tab, setTab] = useState("Overview"),
    [error, setError] = useState(""),
    router = useRouter(),
    history = useResource<HistoryEntry[]>(own ? "games/history" : null);
  const data = profile.data;
  async function friend() {
    try {
      await api("friends/request", "POST", { userId: id });
      setError("Friend request sent.");
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function message() {
    try {
      const room = await api<ChatRoomData>("chat/rooms", "POST", {
        userIds: [id],
      });
      router.push(`/chat?room=${room.id}`);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  const records = Array.isArray(history.data)
    ? history.data
    : history.data || [];
  return (
    <>
      <ResourceState
        loading={profile.loading}
        error={profile.error}
        retry={profile.refresh}
      />
      {data && (
        <>
          <div className="profile-header">
            <div
              className="profile-banner"
              style={
                data.banner
                  ? { backgroundImage: `url(${JSON.stringify(data.banner)})` }
                  : undefined
              }
            >
              <span className="profile-banner-text" aria-hidden="true">
                MAKE YOURSELF AT HOME.
              </span>
              <span className="profile-banner-shape" />
            </div>
            <div className="profile-identity">
              <CosmeticAvatar user={data} size="profile-avatar" />
              <div>
                <span className="eyebrow">
                  {own ? "YOUR TELL AVIV IDENTITY" : "PART OF THE NEIGHBORHOOD"}
                </span>
                <h1>{data.displayName}</h1>
                <span className="muted">@{data.username}</span>
              </div>
              <div className="button-row">
                {own ? (
                  <Link href="/settings" className="button secondary">
                    <Pencil size={16} /> Edit profile
                  </Link>
                ) : (
                  <>
                    <button className="button" onClick={() => void message()}>
                      <MessageCircle size={16} /> Message
                    </button>
                    {!data.isFriend && (
                      <button
                        className="button secondary"
                        onClick={() => void friend()}
                      >
                        <UserPlus size={16} /> Add friend
                      </button>
                    )}
                  </>
                )}
              </div>
            </div>
            <div className="profile-badges">
              <span className="pill level-badge">
                ✦ Level {data.level || levelForXp(data.xp)}
              </span>
              {data.role !== "user" && (
                <span className="pill">
                  <Shield size={12} /> {data.role}
                </span>
              )}
              {data.status && (
                <span className="profile-custom-status">{data.status}</span>
              )}
            </div>
          </div>
          <Notice>{error}</Notice>
          <div className="tabs profile-tabs">
            {["Overview", "Games", "Friends", "Activity"].map((value) => (
              <button
                className={tab === value ? "active" : ""}
                onClick={() => setTab(value)}
                key={value}
              >
                {value}
              </button>
            ))}
          </div>
          {tab === "Overview" ? (
            <div className="two-column">
              <Panel title="A little about me">
                {data.bio ? (
                  <p className="profile-bio">{data.bio}</p>
                ) : (
                  <Empty
                    title={
                      own ? "Tell a little of your story" : "A little mystery"
                    }
                    icon="☺"
                  >
                    {own ? (
                      <Link href="/settings" className="text-link">
                        Add a bio in Settings
                      </Link>
                    ) : (
                      "No bio yet."
                    )}
                  </Empty>
                )}
              </Panel>
              <Panel title="Making progress">
                <div className="xp-progress">
                  <span>✦</span>
                  <div>
                    <strong>Level {levelForXp(data.xp)}</strong>
                    <p>{Number(data.xp).toLocaleString()} global XP</p>
                  </div>
                </div>
                <progress
                  aria-label="Progress to next level"
                  max={
                    levelForXp(data.xp) ** 2 * 100 -
                    (levelForXp(data.xp) - 1) ** 2 * 100
                  }
                  value={data.xp - (levelForXp(data.xp) - 1) ** 2 * 100}
                />
                <p className="small muted">
                  Earned through games, achievements, and legitimate platform
                  activity.
                </p>
              </Panel>
              <ProfileShowcase userId={id} />
            </div>
          ) : tab === "Friends" ? (
            <Panel title="Good company">
              {data.friends?.length ? (
                <div className="friend-grid">
                  {data.friends.map((person) => (
                    <Link
                      className="person-row"
                      href={`/profile/${person.id}`}
                      key={person.id}
                    >
                      <Avatar user={person} />
                      <span>
                        <strong>{person.displayName}</strong>
                        <small>@{person.username}</small>
                      </span>
                    </Link>
                  ))}
                </div>
              ) : (
                <Empty title="A quiet corner">
                  No friends shared on this profile.
                </Empty>
              )}
            </Panel>
          ) : tab === "Activity" ? (
            <Panel title="The latest chapter">
              {data.activity?.length ? (
                data.activity.map((activity) => (
                  <Link
                    key={activity.id}
                    className="activity-item"
                    href={activity.link || "#"}
                  >
                    <Sparkles size={20} />
                    <div>
                      <strong>{activity.title}</strong>
                      <small>{time(activity.createdAt)}</small>
                    </div>
                  </Link>
                ))
              ) : (
                <Empty title="More stories to come">
                  Activity appears here when it’s shared.
                </Empty>
              )}
            </Panel>
          ) : (
            <Panel title="Recently played">
              {own ? (
                <>
                  <ResourceState
                    loading={history.loading}
                    error={history.error}
                    retry={history.refresh}
                  />
                  <div className="game-grid">
                    {records
                      .map((record) => gameById(record.gameId))
                      .filter((game): game is GameManifest => Boolean(game))
                      .map((game: GameManifest) => (
                        <GameCard key={game.id} game={game} />
                      ))}
                  </div>
                  {!records.length && (
                    <Empty title="An adventure is waiting" icon="♜">
                      <Link href="/games" className="text-link">
                        Find your first game
                      </Link>
                    </Empty>
                  )}
                </>
              ) : (
                <Empty title="Their next great game is out there">
                  Personal game history is available to its account owner.
                </Empty>
              )}
            </Panel>
          )}
        </>
      )}
    </>
  );
}
export function SettingsPage() {
  const { user, refresh, logout } = useSession(),
    [tab, setTab] = useState("Profile"),
    [error, setError] = useState(""),
    [success, setSuccess] = useState(""),
    [busy, setBusy] = useState(false),
    sessions = useResource<SessionData[]>(
      tab === "Account" ? "auth/sessions" : null,
    ),
    security = useResource<SecurityStatus>(
      tab === "Account" ? "auth/security" : null,
    );
  const settings = user.settings as UiSettings;
  async function save(input: unknown) {
    setBusy(true);
    setError("");
    setSuccess("");
    try {
      await api("profile", "POST", input);
      await refresh();
      setSuccess("Saved. Your space, just the way you like it.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const Save = () => (
    <button className="button" disabled={busy}>
      <Check size={16} />
      {busy ? "Saving…" : "Save changes"}
    </button>
  );
  return (
    <>
      <Heading
        eyebrow="MAKE IT YOURS"
        title="Your space, your settings."
        description="A few small choices. A place that feels like you."
      />
      <div className="settings-layout">
        <nav className="settings-nav" aria-label="Settings sections">
          {[
            "Profile",
            "Appearance",
            "Privacy",
            "Notifications",
            "Games",
            "Inventory",
            "Security",
            "Account",
          ].map((value) => (
            <button
              className={tab === value ? "active" : ""}
              onClick={() => {
                setTab(value);
                setError("");
                setSuccess("");
              }}
              key={value}
            >
              {value}
            </button>
          ))}
        </nav>
        <div>
          <Notice>{error}</Notice>
          <Notice success>{success}</Notice>
          <Panel title={tab}>
            {tab === "Security" ? (
              <AccountSecurity />
            ) : tab === "Inventory" ? (
              <Inventory />
            ) : tab === "Profile" ? (
              <form
                className="settings-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  const form = e.currentTarget;
                  void save({
                    displayName: field(form, "displayName"),
                    bio: field(form, "bio"),
                    status: field(form, "status"),
                    avatar: field(form, "avatar") || null,
                    banner: field(form, "banner") || null,
                  });
                }}
              >
                <div className="profile-edit-preview">
                  <Avatar user={user} size="large-avatar" />
                  <span>
                    <strong>{user.displayName}</strong>
                    <small>@{user.username}</small>
                  </span>
                </div>
                <label>
                  Display name
                  <input
                    name="displayName"
                    defaultValue={user.displayName}
                    required
                    maxLength={60}
                  />
                </label>
                <label>
                  Bio
                  <textarea
                    name="bio"
                    defaultValue={user.bio}
                    maxLength={1000}
                    rows={4}
                    placeholder="A little bit about you…"
                  />
                </label>
                <label>
                  Custom status
                  <input
                    name="status"
                    defaultValue={user.status}
                    maxLength={120}
                    placeholder="What’s on your mind?"
                  />
                </label>
                <label>
                  Avatar image URL
                  <input
                    name="avatar"
                    defaultValue={user.avatar || ""}
                    type="url"
                    placeholder="https://…"
                  />
                </label>
                <label>
                  Banner image URL
                  <input
                    name="banner"
                    defaultValue={user.banner || ""}
                    type="url"
                    placeholder="https://…"
                  />
                </label>
                <p className="small muted">
                  Use a trusted HTTPS image URL. Images remain under your
                  control.
                </p>
                <Save />
              </form>
            ) : tab === "Appearance" ? (
              <form
                className="settings-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  const form = e.currentTarget,
                    data = new FormData(form);
                  void save({
                    settings: {
                      appearance: field(form, "appearance"),
                      presence: field(form, "presence"),
                      accessibility: {
                        reducedMotion: data.get("reducedMotion") === "on",
                        highContrast: data.get("highContrast") === "on",
                        fontScale: Number(field(form, "fontScale")),
                      },
                    },
                  });
                }}
              >
                <fieldset>
                  <legend>Choose your light</legend>
                  <div className="theme-choices">
                    {[
                      { value: "dark", label: "After hours", icon: Moon },
                      { value: "light", label: "Daylight", icon: Sun },
                      { value: "system", label: "Your device", icon: Monitor },
                    ].map(({ value, label, icon: Icon }) => (
                      <label className="theme-choice" key={value}>
                        <input
                          type="radio"
                          name="appearance"
                          value={value}
                          defaultChecked={
                            (settings.appearance || "dark") === value
                          }
                        />
                        <Icon size={24} />
                        <strong>{label}</strong>
                        <small>{value}</small>
                      </label>
                    ))}
                  </div>
                </fieldset>
                <label>
                  Presence
                  <select
                    name="presence"
                    defaultValue={settings.presence || "online"}
                  >
                    <option value="online">Online</option>
                    <option value="idle">Idle</option>
                    <option value="dnd">Do not disturb</option>
                    <option value="invisible">Invisible</option>
                  </select>
                </label>
                <label className="checkbox setting-toggle">
                  <input
                    name="reducedMotion"
                    type="checkbox"
                    defaultChecked={settings.accessibility?.reducedMotion}
                  />
                  <span>
                    <strong>Reduced motion</strong>
                    <small>Keep animations quiet and transitions short.</small>
                  </span>
                </label>
                <label className="checkbox setting-toggle">
                  <input
                    name="highContrast"
                    type="checkbox"
                    defaultChecked={settings.accessibility?.highContrast}
                  />
                  <span>
                    <strong>Higher contrast</strong>
                    <small>
                      Make borders and content easier to distinguish.
                    </small>
                  </span>
                </label>
                <label>
                  Text size
                  <select
                    name="fontScale"
                    defaultValue={settings.accessibility?.fontScale || 1}
                  >
                    <option value="0.9">Compact · 90%</option>
                    <option value="1">Default · 100%</option>
                    <option value="1.15">Comfortable · 115%</option>
                    <option value="1.3">Large · 130%</option>
                  </select>
                </label>
                <Save />
              </form>
            ) : tab === "Privacy" ? (
              <form
                className="settings-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  const form = e.currentTarget,
                    data = new FormData(form);
                  void save({
                    settings: {
                      privacy: {
                        showFriends: data.get("showFriends") === "on",
                        showActivity: data.get("showActivity") === "on",
                        allowFriendRequests:
                          data.get("allowFriendRequests") === "on",
                        allowDMs: field(form, "allowDMs"),
                      },
                    },
                  });
                }}
              >
                <p className="muted">
                  Your private class resources always stay private. These
                  choices control your social profile.
                </p>
                {[
                  {
                    key: "showFriends",
                    label: "Show my friends on my profile",
                  },
                  { key: "showActivity", label: "Share my activity" },
                  {
                    key: "allowFriendRequests",
                    label: "Allow friend requests",
                  },
                ].map((item) => (
                  <label className="checkbox setting-toggle" key={item.key}>
                    <input
                      name={item.key}
                      type="checkbox"
                      defaultChecked={settings.privacy?.[item.key] !== false}
                    />
                    {item.label}
                  </label>
                ))}
                <label>
                  Who can message me?
                  <select
                    name="allowDMs"
                    defaultValue={settings.privacy?.allowDMs || "everyone"}
                  >
                    <option value="everyone">Everyone</option>
                    <option value="friends">Friends only</option>
                    <option value="none">No new direct messages</option>
                  </select>
                </label>
                <Save />
              </form>
            ) : tab === "Notifications" ? (
              <form
                className="settings-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  const data = new FormData(e.currentTarget);
                  void save({
                    settings: {
                      notifications: Object.fromEntries(
                        [
                          "friend_request",
                          "friend_accepted",
                          "dm",
                          "reply",
                          "mention",
                          "reaction",
                          "party_invite",
                          "game_invite",
                          "achievement",
                          "class_share",
                          "desktop_dm",
                          "desktop_mentions",
                          "desktop_invites",
                        ].map((key) => [key, data.get(key) === "on"]),
                      ),
                    },
                  });
                }}
              >
                <p className="muted">
                  Keep the updates you want. Your notification center lives
                  inside Tell Aviv.
                </p>
                <DesktopPermission />
                {[
                  ["friend_request", "Friend requests"],
                  ["friend_accepted", "Friend request accepted"],
                  ["dm", "Direct messages"],
                  ["reply", "Replies to my messages"],
                  ["mention", "Mentions"],
                  ["reaction", "Reactions"],
                  ["party_invite", "Party invitations"],
                  ["game_invite", "Game invitations"],
                  ["achievement", "Achievements"],
                  ["class_share", "Shared class resources"],
                  ["desktop_dm", "Desktop alerts for direct messages"],
                  [
                    "desktop_mentions",
                    "Desktop alerts for mentions and replies",
                  ],
                  [
                    "desktop_invites",
                    "Desktop alerts for party and game invitations",
                  ],
                ].map(([key, label]) => (
                  <label className="checkbox setting-toggle" key={key}>
                    <input
                      name={key}
                      type="checkbox"
                      defaultChecked={settings.notifications?.[key] !== false}
                    />
                    {label}
                  </label>
                ))}
                <Save />
              </form>
            ) : tab === "Games" ? (
              <form
                className="settings-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  const form = e.currentTarget,
                    data = new FormData(form);
                  void save({
                    settings: {
                      games: {
                        volume: Number(field(form, "volume")),
                        music: data.get("music") === "on",
                        effects: data.get("effects") === "on",
                      },
                    },
                  });
                }}
              >
                <label>
                  Master volume
                  <input
                    type="range"
                    name="volume"
                    min={0}
                    max={1}
                    step={0.05}
                    defaultValue={settings.games?.volume ?? 0.7}
                  />
                </label>
                <label className="checkbox setting-toggle">
                  <input
                    name="music"
                    type="checkbox"
                    defaultChecked={settings.games?.music !== false}
                  />{" "}
                  Music
                </label>
                <label className="checkbox setting-toggle">
                  <input
                    name="effects"
                    type="checkbox"
                    defaultChecked={settings.games?.effects !== false}
                  />{" "}
                  Sound effects
                </label>
                <p className="muted">
                  Performance options and controls are available inside each
                  game.
                </p>
                <Save />
              </form>
            ) : (
              <div className="settings-form">
                <form
                  onSubmit={async (e) => {
                    e.preventDefault();
                    setError("");
                    try {
                      await api("auth/username", "POST", {
                        username: field(e.currentTarget, "username"),
                      });
                      await refresh();
                      setSuccess("Your username is updated.");
                    } catch (e) {
                      setError((e as Error).message);
                    }
                  }}
                >
                  <label>
                    Username
                    <input
                      name="username"
                      defaultValue={user.username}
                      required
                      pattern="[a-zA-Z0-9_]{3,24}"
                      minLength={3}
                      maxLength={24}
                    />
                  </label>
                  <p className="muted small">
                    Your internal account identity stays the same.
                  </p>
                  <button className="button secondary">Update username</button>
                </form>
                <div className="section-divider" />
                <h3>Active sessions</h3>
                <ResourceState
                  loading={sessions.loading}
                  error={sessions.error}
                  retry={sessions.refresh}
                />
                {sessions.data?.map((session) => (
                  <div className="session-row" key={session.id}>
                    <Monitor size={18} />
                    <div>
                      <strong>
                        {session.user_agent?.includes("Chrome")
                          ? "Chrome browser"
                          : "Browser session"}
                      </strong>
                      <small>
                        Created {time(session.created_at)} · Expires{" "}
                        {time(session.expires_at)}
                      </small>
                    </div>
                  </div>
                ))}
                <div className="button-row">
                  <button
                    className="button secondary"
                    onClick={() => void logout()}
                  >
                    <LogOut size={16} /> Sign out
                  </button>
                  <button
                    className="button secondary danger"
                    onClick={async () => {
                      try {
                        await api("auth/logout-all", "POST", {});
                        await refresh();
                      } catch (e) {
                        setError((e as Error).message);
                      }
                    }}
                  >
                    Sign out all devices
                  </button>
                </div>
                <div className="section-divider" />
                <h3>Your account data</h3>
                <p className="muted">
                  Download your profile, messages, notes, creations, saves and
                  fictional currency history. Private files are listed with
                  their metadata.
                </p>
                {security.data?.credentialConfigured && (
                  <form
                    onSubmit={async (event) => {
                      event.preventDefault();
                      const form = event.currentTarget;
                      setError("");
                      setSuccess("");
                      setBusy(true);
                      try {
                        await api("auth/reauthenticate", "POST", {
                          password: passwordField(form, "password"),
                        });
                        form.reset();
                        await security.refresh();
                        setSuccess(
                          "Identity confirmed. You can export your account data.",
                        );
                      } catch (error) {
                        setError((error as Error).message);
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    <label>
                      Confirm password for account export
                      <input
                        name="password"
                        type="password"
                        autoComplete="current-password"
                        maxLength={128}
                        required
                      />
                    </label>
                    <button className="button secondary" disabled={busy}>
                      Confirm export access
                    </button>
                  </form>
                )}
                <a
                  className="button secondary"
                  href="/api/account/export"
                  download="tell-aviv-account.json"
                  onClick={(event) => {
                    if (
                      security.data?.credentialConfigured &&
                      !security.data.recentlyAuthenticated
                    ) {
                      event.preventDefault();
                      setError(
                        "Confirm your password above before exporting account data.",
                      );
                    }
                  }}
                >
                  Export account data
                </a>
                {user.role !== "owner" && (
                  <form
                    onSubmit={async (event) => {
                      event.preventDefault();
                      const form = event.currentTarget;
                      setError("");
                      setBusy(true);
                      try {
                        if (security.data?.credentialConfigured) {
                          await api("auth/reauthenticate", "POST", {
                            password: passwordField(form, "password"),
                          });
                        }
                        await api("account/delete", "POST", {
                          confirmation: field(form, "confirmation"),
                        });
                        await refresh();
                      } catch (error) {
                        setError((error as Error).message);
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    <h3>Delete your account</h3>
                    <p className="muted">
                      Permanently remove your account, authored messages,
                      private class files, creations and game progress. Shared
                      server and party leadership passes to another member when
                      possible. This cannot be undone.
                    </p>
                    <label>
                      Type DELETE {user.username} to confirm
                      <input
                        name="confirmation"
                        autoComplete="off"
                        required
                        placeholder={`DELETE ${user.username}`}
                      />
                    </label>
                    {security.data?.credentialConfigured && (
                      <label>
                        Password to delete account
                        <input
                          name="password"
                          type="password"
                          autoComplete="current-password"
                          maxLength={128}
                          required
                        />
                      </label>
                    )}
                    <button className="button secondary danger" disabled={busy}>
                      Permanently delete account
                    </button>
                  </form>
                )}
              </div>
            )}
          </Panel>
        </div>
      </div>
    </>
  );
}
