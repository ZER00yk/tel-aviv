"use client";
import "./clientValidation";
import { useEffect, useState, lazy, Suspense } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Home,
  MessageCircle,
  Gamepad2,
  Sparkles,
  BookOpen,
  Users,
  Radio,
  Bell,
  UserRound,
  Settings,
  Search,
  Menu,
  X,
  ArrowUpRight,
  LogOut,
  Shield,
  Plus,
} from "lucide-react";
import type { User } from "@tell-aviv/shared";
import type { UiSettings } from "./models";
import {
  getGameSocket,
  resetGameSocket,
} from "../../../packages/game-runtime/src/socket";
import { api, Avatar, field, Loading, Notice, SessionContext } from "./ui";
import { HomePage, GamesPage, GameDetail } from "./HomeGames";
import { FriendsPage, ChatPage, NotificationsPage } from "./Social";
import { LiveServices } from "./live/LiveServices";
import { ServersPage, PartyPanel } from "./Servers";
import { ProfilePage, SettingsPage } from "./ProfileSettings";
import { SearchPage, AdminPage } from "./AdminSearch";
import { NativeAuth } from "./auth/NativeAuth";
const Classes = lazy(() => import("./Classes"));
const Creator = lazy(() => import("./Creator"));
const GamePlayer = lazy(() => import("../../../games/GamePlayer"));
const destinations = [
  { path: "/", label: "Home", icon: Home },
  { path: "/chat", label: "Chat", icon: MessageCircle },
  { path: "/games", label: "Games", icon: Gamepad2 },
  { path: "/create", label: "Create", icon: Sparkles },
  { path: "/classes", label: "Classes", icon: BookOpen },
  { path: "/friends", label: "Friends", icon: Users },
  { path: "/servers", label: "Servers", icon: Radio },
  { path: "/notifications", label: "Notifications", icon: Bell },
  { path: "/profile", label: "Profile", icon: UserRound },
];
function Brand() {
  return (
    <Link href="/" className="brand" aria-label="Tell Aviv home">
      <span className="brand-mark">
        <i />
        <i />
        <i />
      </span>
      <span>
        tell<span className="brand-aviv">aviv</span>
        <small>YOUR SHARED SPACE</small>
      </span>
    </Link>
  );
}
function PublicDocument({ type }: { type: "privacy" | "terms" }) {
  return (
    <main className="public-document">
      <Brand />
      <h1>{type === "privacy" ? "Privacy" : "Terms of use"}</h1>
      {type === "privacy" ? (
        <>
          <p>
            Your Tell Aviv account uses a private password and a secure session
            cookie to keep you signed in. Your username is your public identity;
            a stable internal account ID preserves ownership when it changes.
            Optional email addresses are private. Passwords and recovery codes
            are stored as hashes, never as readable account data.
          </p>
          <p>
            Messages, game saves, and shared creations are stored to provide the
            platform. Private class documents and resources are available only
            to authorized members; they do not appear on public profiles.
          </p>
          <p>
            Profile visibility, friend requests, direct messages, and
            notifications can be controlled in Settings. Owners can disable
            accounts for emergency administration. Never share private school or
            personal information in public chat.
          </p>
        </>
      ) : (
        <>
          <p>
            Tell Aviv is a place to play, create, study, and connect. Respect
            other users, only upload content you may share, and do not attempt
            to access other people’s private materials or manipulate platform
            economies.
          </p>
          <p>
            All casino credits are fictional. They have no monetary value,
            cannot be purchased with real money, and cannot be redeemed or
            cashed out.
          </p>
          <p>
            You retain ownership of your original creations. Publishing a
            creation makes it available to other signed-in users. Feature
            availability and game balance may change during development.
          </p>
        </>
      )}
      <Link href="/" className="button">
        Back to Tell Aviv
      </Link>
    </main>
  );
}
function Login({
  onLogin,
  resetToken,
  verifyEmailToken,
  onRecoveryComplete,
  onVerificationComplete,
}: {
  onLogin: (user: User) => void;
  resetToken?: string;
  verifyEmailToken?: string;
  onRecoveryComplete?: () => void;
  onVerificationComplete?: () => void;
}) {
  const [status, setStatus] = useState<{
      developmentLogin: boolean;
    } | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    api<typeof status>("auth/status")
      .then(setStatus)
      .catch((e) => setError(e.message));
  }, []);
  async function developmentLogin(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      onLogin(
        await api<User>("auth/dev", "POST", {
          username: field(event.currentTarget, "username"),
        }),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="login-page">
      <div className="login-top">
        <Brand />
        <span className="pill">Made for your people</span>
      </div>
      <div className="login-layout">
        <section className="login-story">
          <p className="eyebrow">GOOD COMPANY. GREAT POSSIBILITIES.</p>
          <h1>
            A little play.
            <br />A lot of <em>connection.</em>
          </h1>
          <p>
            Your games, your friends, your next big idea.
            <br />
            One shared space to make it happen.
          </p>
          <div className="login-art" aria-hidden="true">
            <div className="orbit orbit-a" />
            <div className="orbit orbit-b" />
            <span className="art-center">
              ta<span>✦</span>
            </span>
            <span className="art-tag tag-game">
              <Gamepad2 /> GAME ON
            </span>
            <span className="art-tag tag-create">
              <Sparkles /> MAKE SOMETHING
            </span>
            <span className="art-tag tag-study">
              <BookOpen /> FIGURE IT OUT
            </span>
          </div>
          <div className="login-bottom">
            <span>01 SOCIAL</span>
            <span>02 GAMES</span>
            <span>03 CREATE</span>
            <span>04 CLASSES</span>
          </div>
        </section>
        <section className="login-card">
          <span className="eyebrow">WELCOME TO TELL AVIV</span>
          <h2>
            Your people are
            <br />a sign-in away.
          </h2>
          <p className="muted">
            Sign in with your Tell Aviv username and password.
            <br />
            No real name needed.
          </p>
          <NativeAuth
            onLogin={onLogin}
            resetToken={resetToken}
            verifyEmailToken={verifyEmailToken}
            onRecoveryComplete={onRecoveryComplete}
            onVerificationComplete={onVerificationComplete}
          />
          {!status && !error && <Loading />}
          {status?.developmentLogin && (
            <div className="dev-login">
              <span className="pill">Development environment</span>
              <p>Use a local development account to try the platform.</p>
              <form onSubmit={developmentLogin}>
                <label htmlFor="dev-username">Development username</label>
                <input
                  id="dev-username"
                  name="username"
                  autoComplete="username"
                  placeholder="Choose a username"
                  minLength={3}
                  maxLength={24}
                  pattern="[a-zA-Z0-9_]{3,24}"
                  required
                />
                <button className="button secondary" disabled={busy}>
                  {busy ? "Signing in…" : "Development sign-in"}{" "}
                  <ArrowUpRight size={16} />
                </button>
              </form>
            </div>
          )}
          <Notice>{error}</Notice>
          <p className="login-legal">
            By continuing, you agree to our <Link href="/terms">Terms</Link> and{" "}
            <Link href="/privacy">Privacy Policy</Link>.
          </p>
        </section>
      </div>
      <footer className="public-footer">
        A place to belong. A place to build.
        <span>© {new Date().getFullYear()} Tell Aviv</span>
      </footer>
    </main>
  );
}
function Onboarding({ onComplete }: { onComplete: () => Promise<void> }) {
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <main className="onboarding">
      <Brand />
      <section className="panel">
        <span className="eyebrow">MAKE IT YOURS</span>
        <h1>What should we call you?</h1>
        <p className="muted">
          This is your Tell Aviv identity. You can change it later.
        </p>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            try {
              await api("auth/username", "POST", {
                username: field(e.currentTarget, "username"),
              });
              await onComplete();
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <label htmlFor="new-username">Username</label>
          <input
            id="new-username"
            name="username"
            autoFocus
            minLength={3}
            maxLength={24}
            pattern="[a-zA-Z0-9_]{3,24}"
            placeholder="Your unique username"
            required
          />
          <p className="small muted">3–24 letters, numbers, or underscores.</p>
          <Notice>{error}</Notice>
          <button className="button" disabled={busy}>
            {busy ? "Saving…" : "Enter your space"} <ArrowUpRight size={16} />
          </button>
        </form>
      </section>
    </main>
  );
}
export default function Platform() {
  const pathname = usePathname(),
    router = useRouter();
  const [user, setUser] = useState<User | null>(null),
    [loading, setLoading] = useState(true),
    [menu, setMenu] = useState(false),
    [party, setParty] = useState(false),
    [resetToken, setResetToken] = useState(""),
    [verifyEmailToken, setVerifyEmailToken] = useState(""),
    [focus, setFocus] = useState(false),
    [error, setError] = useState("");
  async function refresh() {
    try {
      setUser(await api<User>("me"));
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }
  async function logout() {
    try {
      await api("auth/logout", "POST", {});
      setUser(null);
      router.push("/");
    } catch (e) {
      setError((e as Error).message);
    }
  }
  useEffect(() => {
    function consumeRecoveryLink() {
      const url = new URL(window.location.href);
      // Fragments stay out of HTTP/referrers. The persistent app shell must also
      // consume a link opened on its current document, without a full reload.
      const fragment = new URLSearchParams(url.hash.slice(1));
      const token =
        fragment.get("resetToken") || url.searchParams.get("resetToken");
      const emailToken =
        fragment.get("verifyEmailToken") ||
        url.searchParams.get("verifyEmailToken");
      if (emailToken && !token) {
        setResetToken("");
        setVerifyEmailToken(emailToken);
      }
      if (token) {
        setVerifyEmailToken("");
        setResetToken(token);
      }
      if (token || emailToken) {
        url.searchParams.delete("resetToken");
        url.searchParams.delete("verifyEmailToken");
        if (fragment.has("resetToken") || fragment.has("verifyEmailToken")) {
          fragment.delete("resetToken");
          fragment.delete("verifyEmailToken");
          url.hash = fragment.toString();
        }
        window.history.replaceState(
          window.history.state,
          "",
          `${url.pathname}${url.search}${url.hash}`,
        );
      }
    }
    window.addEventListener("hashchange", consumeRecoveryLink);
    window.addEventListener("popstate", consumeRecoveryLink);
    consumeRecoveryLink();
    void refresh();
    return () => {
      window.removeEventListener("hashchange", consumeRecoveryLink);
      window.removeEventListener("popstate", consumeRecoveryLink);
    };
  }, []);
  useEffect(() => {
    if (!user?.id) return;
    getGameSocket();
    return () => resetGameSocket();
  }, [user?.id]);
  useEffect(() => {
    setMenu(false);
  }, [pathname]);
  useEffect(() => {
    setFocus(Boolean(user?.settings.focusMode));
  }, [user?.settings.focusMode]);
  async function toggleFocus() {
    const next = !focus;
    setFocus(next);
    try {
      await api("profile", "POST", { settings: { focusMode: next } });
      await refresh();
    } catch (error) {
      setFocus(!next);
      setError((error as Error).message);
    }
  }
  useEffect(() => {
    const appearance = user?.settings.appearance || "dark";
    document.documentElement.dataset.theme = String(appearance);
    const accessibility = user?.settings.accessibility as
      | { reducedMotion?: boolean; highContrast?: boolean; fontScale?: number }
      | undefined;
    document.documentElement.dataset.reducedMotion = String(
      Boolean(accessibility?.reducedMotion),
    );
    document.documentElement.dataset.contrast = String(
      Boolean(accessibility?.highContrast),
    );
    document.documentElement.style.fontSize = `${(accessibility?.fontScale || 1) * 16}px`;
    if (typeof user?.settings.accent === "string")
      document.documentElement.style.setProperty(
        "--accent",
        user.settings.accent,
      );
  }, [user]);
  if (pathname === "/privacy" || pathname === "/terms")
    return <PublicDocument type={pathname.slice(1) as "privacy" | "terms"} />;
  if (loading)
    return (
      <main className="initial-loading">
        <Brand />
        <Loading />
      </main>
    );
  if (!user || resetToken || verifyEmailToken)
    return (
      <Login
        onLogin={(next) => {
          setResetToken("");
          setVerifyEmailToken("");
          setUser(next);
        }}
        resetToken={resetToken}
        verifyEmailToken={verifyEmailToken}
        onVerificationComplete={() => setVerifyEmailToken("")}
        onRecoveryComplete={() => {
          setResetToken("");
          setUser(null);
        }}
      />
    );
  if (user.settings.onboardingComplete === false)
    return <Onboarding onComplete={refresh} />;
  const parts = pathname.split("/").filter(Boolean),
    section = parts[0] || "home",
    playing = section === "games" && parts[2] === "play";
  let content: React.ReactNode;
  switch (section) {
    case "home":
      content = <HomePage />;
      break;
    case "games":
      content = parts[1] ? (
        playing ? (
          <Suspense fallback={<Loading />}>
            <GamePlayer
              gameId={parts[1]}
              preferences={{
                ...(user.settings as UiSettings).games,
                reducedMotion: (user.settings as UiSettings).accessibility
                  ?.reducedMotion,
              }}
            />
          </Suspense>
        ) : (
          <GameDetail id={parts[1]} />
        )
      ) : (
        <GamesPage />
      );
      break;
    case "chat":
      content = <ChatPage />;
      break;
    case "friends":
      content = <FriendsPage />;
      break;
    case "servers":
      content = <ServersPage />;
      break;
    case "notifications":
      content = <NotificationsPage />;
      break;
    case "profile":
      content = <ProfilePage id={parts[1] || user.id} />;
      break;
    case "settings":
      content = <SettingsPage />;
      break;
    case "classes":
      content = (
        <Suspense fallback={<Loading />}>
          <Classes />
        </Suspense>
      );
      break;
    case "create":
      content = (
        <Suspense fallback={<Loading />}>
          <Creator />
        </Suspense>
      );
      break;
    case "search":
      content = <SearchPage />;
      break;
    case "admin":
      content = <AdminPage />;
      break;
    default:
      content = (
        <div className="empty">
          <h1>This page has wandered off.</h1>
          <Link className="button" href="/">
            Back home
          </Link>
        </div>
      );
  }
  return (
    <SessionContext.Provider key={user.id} value={{ user, refresh, logout }}>
      <LiveServices />
      <div className={`app-shell ${focus || playing ? "focus-mode" : ""}`}>
        <a className="skip-link" href="#main">
          Skip to content
        </a>
        {menu && (
          <button
            className="mobile-overlay"
            onClick={() => setMenu(false)}
            aria-label="Close navigation"
          />
        )}
        <aside className={`sidebar ${menu ? "is-open" : ""}`}>
          <Brand />
          <div className="workspace-label">
            <span className="status-dot" /> YOUR SPACE{" "}
            <span className="tiny-spark">✦</span>
          </div>
          <nav aria-label="Main navigation">
            {destinations.map(({ path, label, icon: Icon }) => (
              <Link
                key={path}
                href={path}
                aria-current={
                  pathname === path ||
                  (path !== "/" && pathname.startsWith(`${path}/`))
                    ? "page"
                    : undefined
                }
                className={
                  pathname === path ||
                  (path !== "/" && pathname.startsWith(`${path}/`))
                    ? "nav-item active"
                    : "nav-item"
                }
              >
                <Icon size={19} />
                <span>{label}</span>
                {label === "Games" && <span className="nav-tag">PLAY</span>}
              </Link>
            ))}
          </nav>
          <div className="sidebar-bottom">
            <button className="party-shortcut" onClick={() => setParty(!party)}>
              <span className="party-symbol">
                <Users size={17} />
              </span>
              <span>
                Better together<small>Open your party</small>
              </span>
              <Plus size={16} />
            </button>
            {user.role !== "user" && (
              <Link className="nav-item" href="/admin">
                <Shield size={18} /> Administration
              </Link>
            )}
            <Link className="account-chip" href="/profile">
              <Avatar user={user} />
              <span>
                <strong>{user.displayName}</strong>
                <small>@{user.username}</small>
              </span>
              <Settings
                size={16}
                onClick={(e) => {
                  e.preventDefault();
                  router.push("/settings");
                }}
              />
            </Link>
          </div>
        </aside>
        <div className="app-main">
          <header className="topbar">
            <button
              className="icon-button mobile-menu"
              onClick={() => setMenu(true)}
              aria-label="Open navigation"
            >
              <Menu size={20} />
            </button>
            {(focus || playing) && (
              <Link
                className="button subtle small"
                href={focus ? "/classes" : "/games"}
              >
                {focus ? "← Classes" : "← Games"}
              </Link>
            )}
            <form
              className="global-search"
              onSubmit={(e) => {
                e.preventDefault();
                router.push(
                  `/search?q=${encodeURIComponent(field(e.currentTarget, "q"))}`,
                );
              }}
            >
              <Search size={17} />
              <input
                name="q"
                aria-label="Search Tell Aviv"
                placeholder="Find something good…"
              />
              <kbd>↵</kbd>
            </form>
            <div className="topbar-actions">
              {!focus && (
                <button
                  className="topbar-party"
                  onClick={() => setParty(!party)}
                >
                  <Users size={17} /> Party
                </button>
              )}
              <Link
                href="/notifications"
                className="icon-button"
                aria-label="Notifications"
              >
                <Bell size={19} />
              </Link>
              <button
                className="icon-button"
                onClick={() => void toggleFocus()}
                aria-label={focus ? "Exit focus mode" : "Focus mode"}
                title="Focus mode"
              >
                {focus ? <Menu size={18} /> : <X size={18} />}
              </button>
              <Link
                href="/settings"
                className="topbar-avatar"
                aria-label="Settings"
              >
                <Avatar user={user} size="small-avatar" />
              </Link>
            </div>
          </header>
          {party && (
            <div className="party-overlay">
              <PartyPanel close={() => setParty(false)} />
            </div>
          )}
          <main
            id="main"
            className={`page-content ${playing ? "game-content" : ""}`}
          >
            <Notice>{error}</Notice>
            {content}
          </main>
          <footer className="app-footer">
            <span>MAKE YOURSELF AT HOME.</span>
            <div>
              <Link href="/privacy">Privacy</Link>
              <Link href="/terms">Terms</Link>
              <button onClick={() => void logout()}>
                <LogOut size={13} /> Sign out
              </button>
            </div>
          </footer>
        </div>
      </div>
    </SessionContext.Provider>
  );
}
