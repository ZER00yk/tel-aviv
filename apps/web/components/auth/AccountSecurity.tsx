"use client";
import { useState, type FormEvent } from "react";
import { Monitor, LogOut } from "lucide-react";
import {
  api,
  field,
  Notice,
  ResourceState,
  time,
  useResource,
  useSession,
} from "../ui";
import { NewPasswordFields, passwordField } from "./NativeAuth";

export interface SecurityStatus {
  credentialConfigured: boolean;
  email: string | null;
  emailVerified: boolean;
  emailDeliveryConfigured: boolean;
  developmentBootstrap: boolean;
  recentlyAuthenticated: boolean;
  recoveryCodesRemaining: number;
  events: { id: string; kind: string; created_at: string }[];
}
interface SecuritySession {
  id: string;
  user_agent: string;
  created_at: string;
  expires_at: string;
  current: boolean;
}

export function AccountSecurity() {
  const { refresh, logout } = useSession(),
    security = useResource<SecurityStatus>("auth/security"),
    sessions = useResource<SecuritySession[]>("auth/sessions"),
    [error, setError] = useState(""),
    [success, setSuccess] = useState(""),
    [busy, setBusy] = useState(false),
    [codes, setCodes] = useState<string[]>([]);
  async function update(action: () => Promise<void>, message: string) {
    setError("");
    setSuccess("");
    setBusy(true);
    try {
      await action();
      await Promise.all([security.refresh(), sessions.refresh()]);
      setSuccess(message);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function password(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget,
      newPassword = passwordField(form, "newPassword"),
      passwordConfirmation = passwordField(form, "passwordConfirmation");
    if (newPassword !== passwordConfirmation) {
      setError("The passwords do not match.");
      return;
    }
    const bootstrap = security.data?.developmentBootstrap;
    await update(
      async () => {
        if (!bootstrap) {
          await api("auth/reauthenticate", "POST", {
            password: passwordField(form, "currentPassword"),
          });
        }
        await api(
          bootstrap ? "auth/password/bootstrap" : "auth/password",
          "POST",
          {
            ...(bootstrap
              ? {}
              : {
                  currentPassword: passwordField(form, "currentPassword"),
                  revokeOtherSessions:
                    new FormData(form).get("revokeOtherSessions") === "on",
                }),
            newPassword,
            passwordConfirmation,
          },
        );
        form.reset();
        setCodes([]);
        await refresh();
      },
      bootstrap
        ? "Your account now has a password. Use native sign-in from now on."
        : "Password changed. Old passwords and recovery credentials no longer work.",
    );
  }
  return (
    <div className="settings-form account-security">
      <h3>Account Security</h3>
      <ResourceState
        loading={security.loading}
        error={security.error}
        retry={security.refresh}
      />
      <Notice>{error}</Notice>
      <Notice success>{success}</Notice>
      {security.data && (
        <>
          <p className="muted">
            Your email stays private:{" "}
            {security.data.email || "No private email saved"}.{" "}
            {security.data.email
              ? security.data.emailVerified
                ? "Address verified. "
                : "Address not verified. "
              : ""}
            {security.data.emailDeliveryConfigured
              ? "Email recovery delivery is configured."
              : "Email recovery delivery is not configured. Keep recovery codes somewhere safe."}
          </p>
          {security.data.developmentBootstrap ||
          security.data.credentialConfigured ? (
            <form onSubmit={password} aria-label="Change account password">
              <h3>
                {security.data.developmentBootstrap
                  ? "Set your first password"
                  : "Change password"}
              </h3>
              {security.data.developmentBootstrap ? (
                <p className="muted">
                  This existing development account keeps its ID, saves and
                  friendships. Setting a password disables development sign-in
                  for this account.
                </p>
              ) : (
                <>
                  <label htmlFor="security-current-password">
                    Current password
                  </label>
                  <input
                    id="security-current-password"
                    name="currentPassword"
                    type="password"
                    autoComplete="current-password"
                    maxLength={128}
                    required
                  />
                </>
              )}
              <NewPasswordFields prefix="security" />
              {!security.data.developmentBootstrap && (
                <label className="checkbox">
                  <input
                    name="revokeOtherSessions"
                    type="checkbox"
                    defaultChecked
                  />
                  Sign out other sessions after changing password
                </label>
              )}
              <button className="button" disabled={busy}>
                {security.data.developmentBootstrap
                  ? "Set account password"
                  : "Change password"}
              </button>
            </form>
          ) : (
            <p className="muted">
              This account has no native password. Ask the administrator about a
              safe migration; no shared default password is assigned.
            </p>
          )}
          {security.data.credentialConfigured && (
            <>
              <div className="section-divider" />
              <form
                aria-label="Change private recovery email"
                onSubmit={async (event) => {
                  event.preventDefault();
                  const form = event.currentTarget;
                  await update(async () => {
                    await api("auth/reauthenticate", "POST", {
                      password: passwordField(form, "password"),
                    });
                    await api("auth/email", "POST", {
                      email: field(form, "email") || null,
                    });
                    form.reset();
                    setCodes([]);
                  }, "Private email updated. Existing recovery credentials were invalidated.");
                }}
              >
                <h3>Private recovery email</h3>
                <p className="muted">
                  Saving an email does not verify delivery. An empty address
                  removes it; email changes invalidate existing recovery
                  credentials.
                </p>
                <label htmlFor="security-email">
                  Private recovery email (optional)
                </label>
                <input
                  id="security-email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  maxLength={254}
                  defaultValue={security.data.email || ""}
                />
                <label htmlFor="security-email-password">
                  Password to change email
                </label>
                <input
                  id="security-email-password"
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  maxLength={128}
                  required
                />
                <button className="button secondary" disabled={busy}>
                  Save private email
                </button>
              </form>
              {security.data.email &&
                !security.data.emailVerified &&
                security.data.emailDeliveryConfigured && (
                  <form
                    aria-label="Request private email verification"
                    onSubmit={async (event) => {
                      event.preventDefault();
                      const form = event.currentTarget;
                      await update(async () => {
                        await api("auth/reauthenticate", "POST", {
                          password: passwordField(form, "password"),
                        });
                        await api("auth/email/send-verification", "POST", {});
                        form.reset();
                      }, "Email verification requested. Check your private inbox.");
                    }}
                  >
                    <label htmlFor="security-verification-password">
                      Password to request email verification
                    </label>
                    <input
                      id="security-verification-password"
                      name="password"
                      type="password"
                      autoComplete="current-password"
                      maxLength={128}
                      required
                    />
                    <button className="button secondary" disabled={busy}>
                      Send email verification
                    </button>
                  </form>
                )}
              <div className="section-divider" />
              <form
                aria-label="Confirm sensitive account access"
                onSubmit={async (event) => {
                  event.preventDefault();
                  const form = event.currentTarget;
                  await update(async () => {
                    await api("auth/reauthenticate", "POST", {
                      password: passwordField(form, "password"),
                    });
                    form.reset();
                  }, "Identity confirmed. Sensitive account actions are available for a short time.");
                }}
              >
                <h3>Confirm your identity</h3>
                <p className="muted">
                  {security.data.recentlyAuthenticated
                    ? "Your recent authentication is still valid."
                    : "Confirm your password before exporting data or changing sensitive account settings."}
                </p>
                <label htmlFor="security-reauth-password">
                  Password for sensitive actions
                </label>
                <input
                  id="security-reauth-password"
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  maxLength={128}
                  required
                />
                <button className="button secondary" disabled={busy}>
                  Confirm identity
                </button>
              </form>
              <div className="section-divider" />
              <form
                aria-label="Generate account recovery codes"
                onSubmit={async (event) => {
                  event.preventDefault();
                  const form = event.currentTarget;
                  await update(async () => {
                    await api("auth/reauthenticate", "POST", {
                      password: passwordField(form, "password"),
                    });
                    const result = await api<{ codes: string[] }>(
                      "auth/recovery-codes/regenerate",
                      "POST",
                      { password: passwordField(form, "password") },
                    );
                    setCodes(result.codes);
                    form.reset();
                  }, "New recovery codes generated. Previous codes no longer work.");
                }}
              >
                <h3>Recovery codes</h3>
                <p className="muted">
                  {security.data.recoveryCodesRemaining} unused codes. Each code
                  resets your password once. New codes invalidate the previous
                  set. Store them privately; Tell Aviv cannot show them again.
                </p>
                <label htmlFor="codes-password">
                  Password to generate recovery codes
                </label>
                <input
                  id="codes-password"
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  maxLength={128}
                  required
                />
                <button className="button secondary" disabled={busy}>
                  Generate recovery codes
                </button>
              </form>
              {codes.length > 0 && (
                <section className="panel" aria-label="New recovery codes">
                  <p>
                    Save these codes now. They are shown only during this visit.
                  </p>
                  <ul>
                    {codes.map((code) => (
                      <li key={code}>
                        <code>{code}</code>
                      </li>
                    ))}
                  </ul>
                  <button
                    type="button"
                    className="button secondary"
                    onClick={() => setCodes([])}
                  >
                    I saved my codes
                  </button>
                </section>
              )}
            </>
          )}
        </>
      )}
      <div className="section-divider" />
      <h3>Sessions and devices</h3>
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
              {session.user_agent.includes("Chrome")
                ? "Chrome browser"
                : "Browser session"}
              {session.current ? " · This session" : ""}
            </strong>
            <small>
              Created {time(session.created_at)} · Expires{" "}
              {time(session.expires_at)}
            </small>
          </div>
          {!session.current && (
            <button
              type="button"
              className="button secondary"
              disabled={busy}
              aria-label={`Revoke session ${session.id}`}
              onClick={() =>
                void update(async () => {
                  await api("auth/sessions/revoke", "POST", {
                    sessionId: session.id,
                  });
                }, "Session revoked.")
              }
            >
              Revoke
            </button>
          )}
        </div>
      ))}
      <div className="button-row">
        <button
          type="button"
          className="button secondary"
          disabled={busy}
          onClick={() =>
            void update(async () => {
              await api("auth/logout-others", "POST", {});
            }, "Other sessions signed out.")
          }
        >
          Sign out other devices
        </button>
        <button
          type="button"
          className="button secondary"
          disabled={busy}
          onClick={() => void logout()}
        >
          <LogOut size={16} />
          Sign out
        </button>
        <button
          type="button"
          className="button secondary danger"
          disabled={busy}
          onClick={() =>
            void update(async () => {
              await api("auth/logout-all", "POST", {});
              await refresh();
            }, "All sessions signed out.")
          }
        >
          Sign out all devices
        </button>
      </div>
      {security.data && (
        <>
          <div className="section-divider" />
          <h3>Recent security events</h3>
          {security.data.events.length ? (
            <ul>
              {security.data.events.map((event) => (
                <li key={event.id}>
                  {event.kind.replaceAll("_", " ")} · {time(event.created_at)}
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">No recent security events.</p>
          )}
        </>
      )}
    </div>
  );
}
