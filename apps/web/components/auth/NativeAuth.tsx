"use client";
import { useEffect, useState, type FormEvent } from "react";
import type { User } from "@tell-aviv/shared";
import { api, field, Notice } from "../ui";

type Mode = "login" | "register" | "forgot" | "reset" | "code" | "verify";

// Password whitespace is significant; the platform's general field helper trims.
export function passwordField(form: HTMLFormElement, name: string) {
  return String(new FormData(form).get(name) || "");
}

export function NewPasswordFields({ prefix = "auth" }: { prefix?: string }) {
  return (
    <>
      <label htmlFor={`${prefix}-password`}>New password</label>
      <input
        id={`${prefix}-password`}
        name="newPassword"
        type="password"
        autoComplete="new-password"
        minLength={12}
        maxLength={128}
        aria-describedby={`${prefix}-policy`}
        required
      />
      <p className="small muted" id={`${prefix}-policy`}>
        Use 12–128 characters. A long, unique passphrase is a good choice.
      </p>
      <label htmlFor={`${prefix}-confirmation`}>Confirm new password</label>
      <input
        id={`${prefix}-confirmation`}
        name="passwordConfirmation"
        type="password"
        autoComplete="new-password"
        minLength={12}
        maxLength={128}
        required
      />
    </>
  );
}

export function NativeAuth({
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
  const [mode, setMode] = useState<Mode>(
      resetToken ? "reset" : verifyEmailToken ? "verify" : "login",
    ),
    [error, setError] = useState(""),
    [success, setSuccess] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    if (resetToken) setMode("reset");
  }, [resetToken]);
  useEffect(() => {
    if (verifyEmailToken) setMode("verify");
  }, [verifyEmailToken]);
  function changeMode(next: Mode) {
    setError("");
    setSuccess("");
    setMode(next);
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    setError("");
    setSuccess("");
    const username = field(form, "username"),
      password = passwordField(form, "password"),
      newPassword = passwordField(form, "newPassword"),
      passwordConfirmation = passwordField(form, "passwordConfirmation");
    if (
      mode !== "login" &&
      mode !== "forgot" &&
      mode !== "verify" &&
      newPassword !== passwordConfirmation
    ) {
      setError("The passwords do not match.");
      return;
    }
    setBusy(true);
    try {
      if (mode === "login" || mode === "register") {
        const user = await api<User>(
          `auth/${mode}`,
          "POST",
          mode === "login"
            ? { username, password }
            : {
                username,
                password: newPassword,
                passwordConfirmation,
                ...(field(form, "email")
                  ? { email: field(form, "email") }
                  : {}),
              },
        );
        form.reset();
        onLogin(user);
      } else if (mode === "verify") {
        await api("auth/email/verify", "POST", { token: verifyEmailToken });
        setSuccess("Your private email address has been verified.");
      } else if (mode === "forgot") {
        await api("auth/forgot-password", "POST", { username });
        form.reset();
        setSuccess(
          "If this account has a verified private email address and email delivery is configured, a reset link will be sent. You can also use a saved recovery code.",
        );
      } else {
        await api(
          mode === "reset"
            ? "auth/reset-password"
            : "auth/recovery-codes/reset",
          "POST",
          mode === "reset"
            ? {
                token: resetToken || field(form, "token"),
                newPassword,
                passwordConfirmation,
              }
            : {
                username,
                code: field(form, "code"),
                newPassword,
                passwordConfirmation,
              },
        );
        form.reset();
        setMode("login");
        setSuccess(
          "Your password has been reset. Sign in with your new password.",
        );
        onRecoveryComplete?.();
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="native-auth">
      <div className="tabs" aria-label="Account access">
        <button
          type="button"
          className={mode === "login" ? "active" : ""}
          onClick={() => changeMode("login")}
          disabled={busy}
        >
          Sign in
        </button>
        <button
          type="button"
          className={mode === "register" ? "active" : ""}
          onClick={() => changeMode("register")}
          disabled={busy}
        >
          Create account
        </button>
      </div>
      <h3>
        {mode === "login"
          ? "Sign in to your account"
          : mode === "register"
            ? "Create your Tell Aviv account"
            : mode === "forgot"
              ? "Recover your account"
              : mode === "reset"
                ? "Set a new password"
                : mode === "verify"
                  ? "Verify your private email"
                  : "Use a recovery code"}
      </h3>
      <form
        className="settings-form"
        onSubmit={submit}
        key={mode}
        aria-label={`${mode} account form`}
      >
        {mode !== "reset" && mode !== "verify" && (
          <>
            <label htmlFor="native-username">Username</label>
            <input
              id="native-username"
              name="username"
              autoComplete="username"
              minLength={3}
              maxLength={24}
              pattern="[a-zA-Z0-9_]{3,24}"
              required
              autoCapitalize="none"
              spellCheck={false}
            />
          </>
        )}
        {mode === "register" && (
          <>
            <p className="small muted">
              3–24 letters, numbers or underscores. Usernames are stored in
              lowercase.
            </p>
            <label htmlFor="native-email">Private email (optional)</label>
            <input
              id="native-email"
              name="email"
              type="email"
              autoComplete="email"
              maxLength={254}
            />
            <p className="small muted">
              Your email is never shown on your public profile. Recovery by
              email requires a verified address and configured email delivery.
            </p>
          </>
        )}
        {mode === "login" && (
          <>
            <label htmlFor="native-password">Password</label>
            <input
              id="native-password"
              name="password"
              type="password"
              autoComplete="current-password"
              maxLength={128}
              required
            />
          </>
        )}
        {mode === "reset" && !resetToken && (
          <>
            <label htmlFor="reset-token">Reset token</label>
            <input
              id="reset-token"
              name="token"
              autoComplete="off"
              maxLength={128}
              required
            />
          </>
        )}
        {mode === "code" && (
          <>
            <label htmlFor="recovery-code">Recovery code</label>
            <input
              id="recovery-code"
              name="code"
              autoComplete="off"
              maxLength={128}
              required
              spellCheck={false}
            />
          </>
        )}
        {(mode === "register" || mode === "reset" || mode === "code") && (
          <NewPasswordFields prefix="native" />
        )}
        <Notice>{error}</Notice>
        <Notice success>{success}</Notice>
        <button
          className="button"
          disabled={busy || (mode === "verify" && Boolean(success))}
        >
          {busy
            ? "Please wait…"
            : mode === "login"
              ? "Sign in to Tell Aviv"
              : mode === "register"
                ? "Create Tell Aviv account"
                : mode === "forgot"
                  ? "Request reset link"
                  : mode === "verify"
                    ? "Verify email"
                    : "Reset password"}
        </button>
      </form>
      {mode === "verify" && success && (
        <button
          type="button"
          className="button secondary"
          onClick={onVerificationComplete}
        >
          Return to Tell Aviv
        </button>
      )}
      <div className="button-row">
        <button
          type="button"
          className="text-link"
          disabled={busy}
          onClick={() => changeMode("forgot")}
        >
          Forgot password?
        </button>
        <button
          type="button"
          className="text-link"
          disabled={busy}
          onClick={() => changeMode("code")}
        >
          Use recovery code
        </button>
      </div>
    </div>
  );
}
