"use client";
import { SeasonAdminPanel } from "./Seasons";
import ReportReview from "./creator/ReportReview";
import type { Person, ServerData, AdminStatus, AdminUser } from "./models";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Search, ArrowUpRight, Check, X, Megaphone } from "lucide-react";
import { games } from "@tell-aviv/games";
import { GameCard } from "./HomeGames";
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

export function SearchPage() {
  const [query, setQuery] = useState(""),
    [submitted, setSubmitted] = useState(""),
    [scope, setScope] = useState("People");
  useEffect(() => {
    const value = new URLSearchParams(window.location.search).get("q") || "";
    setQuery(value);
    setSubmitted(value);
  }, []);
  const people = useResource<Person[]>(
      submitted && scope === "People"
        ? `users?q=${encodeURIComponent(submitted)}`
        : null,
    ),
    servers = useResource<ServerData[]>(
      submitted && scope === "Servers"
        ? `servers/discover?q=${encodeURIComponent(submitted)}`
        : null,
    );
  const matchingGames = games.filter((game) =>
    `${game.name} ${game.description} ${game.tags.join(" ")}`
      .toLowerCase()
      .includes(submitted.toLowerCase()),
  );
  return (
    <>
      <Heading
        eyebrow="A LITTLE CURIOSITY"
        title="What are you looking for?"
        description="Find your people, your next game, or a place to belong."
      />
      <Panel>
        <form
          className="inline-form"
          onSubmit={(e) => {
            e.preventDefault();
            setSubmitted(query);
          }}
        >
          <Search size={20} />
          <input
            aria-label="Search"
            placeholder="Search Tell Aviv…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            required
          />
          <button className="button">
            Find it <ArrowUpRight size={16} />
          </button>
        </form>
      </Panel>
      <div className="tabs">
        {["People", "Games", "Servers"].map((value) => (
          <button
            onClick={() => setScope(value)}
            className={scope === value ? "active" : ""}
            key={value}
          >
            {value}
          </button>
        ))}
      </div>
      {!submitted ? (
        <Empty title="Something good is out there" icon="⌕">
          Enter a name, a game, or a shared interest.
        </Empty>
      ) : scope === "People" ? (
        <Panel>
          <ResourceState
            loading={people.loading}
            error={people.error}
            retry={people.refresh}
          />
          {people.data?.length
            ? people.data.map((person) => (
                <Link
                  className="person-row search-result"
                  key={person.id}
                  href={`/profile/${person.id}`}
                >
                  <Avatar user={person} />
                  <span>
                    <strong>{person.displayName}</strong>
                    <small>
                      @{person.username}
                      {person.status ? ` · ${person.status}` : ""}
                    </small>
                  </span>
                  <ArrowUpRight size={17} />
                </Link>
              ))
            : !people.loading && (
                <Empty title="No people found">
                  Try a Tell Aviv username or another spelling.
                </Empty>
              )}
        </Panel>
      ) : scope === "Games" ? (
        <div className="game-grid">
          {matchingGames.map((game) => (
            <GameCard game={game} key={game.id} />
          ))}
          {!matchingGames.length && (
            <Empty title="No games found">
              Try another title, tag, or genre.
            </Empty>
          )}
        </div>
      ) : (
        <Panel>
          <ResourceState
            loading={servers.loading}
            error={servers.error}
            retry={servers.refresh}
          />
          {servers.data?.length
            ? servers.data.map((server) => (
                <Link
                  className="person-row search-result"
                  href={`/servers?id=${server.id}`}
                  key={server.id}
                >
                  <Avatar
                    user={{ displayName: server.name, avatar: server.icon }}
                  />
                  <span>
                    <strong>{server.name}</strong>
                    <small>
                      {server.description || `${server.memberCount} members`}
                    </small>
                  </span>
                  <ArrowUpRight size={17} />
                </Link>
              ))
            : !servers.loading && (
                <Empty title="No communities found">
                  Only discoverable servers appear in search.
                </Empty>
              )}
        </Panel>
      )}
      <p className="muted small search-privacy">
        Private notes, files, and assignments can be searched within Classes,
        where your access is checked.
      </p>
    </>
  );
}
export function AdminPage() {
  const { user } = useSession(),
    status = useResource<AdminStatus>(
      user.role !== "user" ? "admin/status" : null,
    ),
    [accountQuery, setAccountQuery] = useState(""),
    [accountSearch, setAccountSearch] = useState(""),
    users = useResource<AdminUser[]>(
      user.role !== "user"
        ? `admin/users?q=${encodeURIComponent(accountSearch)}`
        : null,
    ),
    [selectedAccount, setSelectedAccount] = useState<AdminUser | null>(null),
    [tab, setTab] = useState("Overview"),
    [error, setError] = useState(""),
    [success, setSuccess] = useState(""),
    [working, setWorking] = useState(false),
    busy = useRef(false),
    audit = useResource<AuditEntry[]>(
      user.role !== "user" && tab === "Audit" ? "admin/audit" : null,
    );
  async function action(path: string, body: unknown): Promise<boolean> {
    if (busy.current) return false;
    busy.current = true;
    setWorking(true);
    setError("");
    setSuccess("");
    try {
      await api(path, "POST", body);
      await Promise.all([status.refresh(), users.refresh()]);
      setSuccess("Saved successfully.");
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      busy.current = false;
      setWorking(false);
    }
  }
  if (user.role === "user")
    return (
      <Empty title="Administrator access required" icon="◈">
        This area is limited to platform administrators.
      </Empty>
    );
  return (
    <>
      <Heading
        eyebrow="KEEP THE SPACE RUNNING"
        title="Platform administration."
        description="Service health, account storage, fictional currency, announcements, and an immutable audit trail."
      />
      <Notice>{error}</Notice>
      <Notice success>{success}</Notice>
      <div className="tabs">
        {[
          "Overview",
          "Announcements",
          "Features",
          "Accounts",
          "Recovery",
          "Audit",
          "Creator reports",
          "Seasons",
        ].map((value) => (
          <button
            onClick={() => setTab(value)}
            className={tab === value ? "active" : ""}
            key={value}
          >
            {value}
          </button>
        ))}
      </div>
      <ResourceState
        loading={status.loading}
        error={status.error}
        retry={status.refresh}
      />
      {tab === "Creator reports" && <ReportReview />}
      {tab === "Seasons" && <SeasonAdminPanel />}
      {tab === "Overview" ? (
        <>
          <div className="status-grid">
            {[
              ["Database", status.data?.database],
              ["Redis", status.data?.redis],
              ["Realtime service", status.data?.operations?.realtime],
              [
                "Realtime connections",
                status.data?.operations?.realtimeMetrics?.activeConnections,
              ],
              [
                "Realtime active users",
                status.data?.operations?.realtimeMetrics?.activeUsers,
              ],
              [
                "Realtime request errors",
                status.data?.operations?.realtimeMetrics?.counters.socketErrors,
              ],
              ["Object storage", status.data?.operations?.storage.status],
              [
                "Pending file cleanup",
                status.data?.operations?.storageOperations?.cleanup.pending,
              ],
              [
                "Repeated cleanup failures",
                status.data?.operations?.storageOperations?.cleanup.retrying,
              ],
              [
                "Recoverable matches",
                status.data?.operations?.recovery?.recoverable_matches,
              ],
              [
                "Missing upload objects",
                status.data?.operations?.storageOperations?.integrity
                  .missing_objects,
              ],
              [
                "Upload size mismatches",
                status.data?.operations?.storageOperations?.integrity
                  .size_mismatches,
              ],
              ["Accounts", status.data?.totals?.users],
              ["Active sessions", status.data?.totals?.sessions],
            ].map(([name, value]) => (
              <div className="panel status-card" key={name}>
                <span className="eyebrow">{name}</span>
                <strong>{value ?? "…"}</strong>
              </div>
            ))}
          </div>
          <Panel title="Verified backups">
            <p>
              {status.data?.operations?.backups?.retention
                ? `Last plaintext retention run: ${time(status.data.operations.backups.retention.at)}; ${status.data.operations.backups.retention.retained} retained, ${status.data.operations.backups.retention.removed} removed, ${status.data.operations.backups.retention.rejected} unverified snapshots excluded.`
                : "No applied retention run has been recorded."}
            </p>
            {status.data?.operations?.backups?.latestBackup ? (
              <p>
                Latest snapshot:{" "}
                {time(status.data.operations.backups.latestBackup.at)} ·{" "}
                {Math.floor(
                  status.data.operations.backups.latestBackup.ageSeconds / 3600,
                )}{" "}
                hours old ·{" "}
                {status.data.operations.backups.latestBackup.uploads} protected
                uploads · checksums verified.
              </p>
            ) : (
              <p>No verified snapshot has been recorded.</p>
            )}
            <p>
              {status.data?.operations?.backups?.encryption
                ? `AES-256-GCM envelope recorded ${time(status.data.operations.backups.encryption.at)}.`
                : "No encrypted envelope has been recorded."}
            </p>
            <p>
              {status.data?.operations?.backups?.destination
                ? `Destination copy checksum verified ${time(status.data.operations.backups.destination.at)}. The operator must confirm that this volume is off host.`
                : "No destination copy has been verified."}
            </p>
            <p>
              {status.data?.operations?.backups?.lastRestoreDrill
                ? `Last isolated restore drill: ${time(status.data.operations.backups.lastRestoreDrill.at)}; ${status.data.operations.backups.lastRestoreDrill.tables} tables and ${status.data.operations.backups.lastRestoreDrill.uploads} uploads verified.`
                : "No isolated restore drill has been recorded."}
            </p>
          </Panel>
          <Panel title="HTTP requests">
            <p>
              Counts and latency for the current web process since{" "}
              {status.data?.operations?.api?.startedAt
                ? time(status.data.operations.api.startedAt)
                : "startup"}
              .
            </p>
            <div style={{ overflowX: "auto" }}>
              <table>
                <thead>
                  <tr>
                    <th>Route</th>
                    <th>Requests</th>
                    <th>Errors</th>
                    <th>Server errors</th>
                    <th>Average ms</th>
                    <th>Maximum ms</th>
                  </tr>
                </thead>
                <tbody>
                  {status.data?.operations?.api?.routes.map((row) => (
                    <tr key={row.route}>
                      <th scope="row">{row.route}</th>
                      <td>{row.requests}</td>
                      <td>{row.errors}</td>
                      <td>{row.serverErrors}</td>
                      <td>{row.averageMs}</td>
                      <td>{row.maxMs}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
          <Panel title="Maintenance workers">
            {status.data?.operations?.maintenance.length ? (
              status.data.operations.maintenance.map((worker) => (
                <article key={worker.name}>
                  <strong>{worker.name}</strong> · last update{" "}
                  {time(worker.updated_at)}
                  <p>
                    {typeof worker.data.status === "string"
                      ? worker.data.status
                      : "Recorded"}
                    {typeof worker.data.lastFailures === "number"
                      ? ` · ${worker.data.lastFailures} failures`
                      : ""}
                  </p>
                </article>
              ))
            ) : (
              <p>No scheduled worker results have been recorded.</p>
            )}
          </Panel>
          <Panel title="Recent client error reports">
            {status.data?.errors?.length ? (
              status.data.errors.map((entry) => (
                <article className="error-report" key={entry.id}>
                  <strong>{entry.component}</strong>
                  <p>{entry.message}</p>
                  <small>{time(entry.created_at)}</small>
                </article>
              ))
            ) : (
              <Empty title="A clear dashboard" icon="✓">
                No client error reports have been recorded.
              </Empty>
            )}
          </Panel>
        </>
      ) : tab === "Announcements" ? (
        <Panel title="Say something to the neighborhood">
          <form
            className="settings-form"
            onSubmit={async (e) => {
              e.preventDefault();
              const form = e.currentTarget;
              await action("admin/announcements", {
                title: field(form, "title"),
                body: field(form, "body"),
              });
            }}
          >
            <label>
              Title
              <input
                name="title"
                maxLength={120}
                required
                placeholder="What’s new?"
              />
            </label>
            <label>
              Announcement
              <textarea name="body" maxLength={5000} required rows={6} />
            </label>
            <button className="button">
              <Megaphone size={16} /> Publish announcement
            </button>
          </form>
        </Panel>
      ) : tab === "Features" ? (
        <Panel title="Feature flags">
          {status.data?.flags?.map((flag) => (
            <div className="feature-flag" key={flag.key}>
              <code>{flag.key}</code>
              <button
                className={`button secondary small ${flag.enabled ? "selected" : ""}`}
                onClick={() =>
                  void action("admin/flags", {
                    key: flag.key,
                    enabled: !flag.enabled,
                  })
                }
              >
                {flag.enabled ? <Check size={14} /> : <X size={14} />}
                {flag.enabled ? "Enabled" : "Disabled"}
              </button>
            </div>
          ))}
          <form
            className="inline-form"
            onSubmit={(e) => {
              e.preventDefault();
              void action("admin/flags", {
                key: field(e.currentTarget, "key"),
                enabled: true,
              });
            }}
          >
            <input
              name="key"
              aria-label="Feature flag name"
              placeholder="feature.name"
              required
              pattern="[a-zA-Z0-9._-]{1,100}"
            />
            <button className="button secondary">Add enabled flag</button>
          </form>
        </Panel>
      ) : tab === "Recovery" ? (
        <RecoveryTools working={working} action={action} />
      ) : tab === "Audit" ? (
        <Panel title="Administrative audit trail">
          <ResourceState
            loading={audit.loading}
            error={audit.error}
            retry={audit.refresh}
          />
          <p className="muted">
            Balance, storage, save, leaderboard, content, account, flag, and
            announcement changes are recorded with the administrator and reason.
            Existing records cannot be edited or deleted by the application.
          </p>
          {audit.data?.map((entry) => (
            <article className="error-report" key={entry.id}>
              <strong>{entry.action}</strong>
              <p>
                @{entry.actor_username}
                {entry.target_username ? ` → @${entry.target_username}` : ""}
              </p>
              <pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
                {JSON.stringify(entry.details, null, 2)}
              </pre>
              <small>{time(entry.created_at)}</small>
            </article>
          ))}
          {audit.data?.length === 0 && (
            <Empty title="No administrative changes yet">
              Changes made here will appear in this trail.
            </Empty>
          )}
        </Panel>
      ) : (
        <Panel title="Account controls">
          <p className="muted">
            Disabling an account revokes its sessions. Type the requested
            confirmation for an emergency disable.
          </p>
          <form
            className="inline-form"
            onSubmit={(event) => {
              event.preventDefault();
              setAccountSearch(accountQuery);
            }}
          >
            <input
              aria-label="Search administrator accounts"
              placeholder="Search name or username"
              value={accountQuery}
              onChange={(event) => setAccountQuery(event.target.value)}
            />
            <button className="button secondary">Search accounts</button>
          </form>
          {selectedAccount && (
            <AccountTools
              account={selectedAccount}
              canChange={
                user.role === "owner" ||
                selectedAccount.role === "user" ||
                selectedAccount.id === user.id
              }
              working={working}
              action={action}
            />
          )}
          <ResourceState
            loading={users.loading}
            error={users.error}
            retry={users.refresh}
          />
          {users.data?.map((account) => (
            <div className="admin-account" key={account.id}>
              <span>
                <strong>{account.display_name}</strong>
                <small>
                  @{account.username} · {account.role} ·{" "}
                  {account.disabled ? "disabled" : "active"}
                </small>
              </span>
              <button
                className="button secondary small"
                onClick={() => setSelectedAccount(account)}
              >
                Storage & currency
              </button>
              {account.id !== user.id &&
                account.role !== "owner" &&
                (account.role !== "admin" || user.role === "owner") && (
                  <form
                    className="inline-form"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void action(`admin/users/${account.id}`, {
                        disabled: !account.disabled,
                        confirmation: field(e.currentTarget, "confirmation"),
                      });
                    }}
                  >
                    <input
                      name="confirmation"
                      aria-label={`Confirmation for ${account.username}`}
                      placeholder={`${account.disabled ? "ENABLE" : "DISABLE"} ${account.username}`}
                      required
                    />
                    <button
                      className={`button secondary small ${!account.disabled ? "danger" : ""}`}
                      disabled={working}
                    >
                      {account.disabled ? "Enable" : "Disable"}
                    </button>
                  </form>
                )}
            </div>
          ))}
        </Panel>
      )}
    </>
  );
}

interface AuditEntry {
  id: string;
  actor_username: string;
  target_username: string | null;
  action: string;
  details: Record<string, unknown>;
  created_at: string;
}
interface AccountDetails extends AdminUser {
  usageBytes: number;
  quotaBytes: number;
  customQuota: boolean;
  balances: { currency: string; balance: number }[];
  ledger: {
    id: string;
    currency: string;
    amount: number;
    balance_after: number;
    reason: string;
    created_at: string;
  }[];
  saves: {
    game_id: string;
    schema_version: number;
    revision: number;
    bytes: number;
    updated_at: string;
  }[];
}
function AccountTools({
  account,
  canChange,
  working,
  action,
}: {
  account: AdminUser;
  canChange: boolean;
  working: boolean;
  action: (path: string, body: unknown) => Promise<boolean>;
}) {
  const details = useResource<AccountDetails>(`admin/users/${account.id}`);
  const [quotaGiB, setQuotaGiB] = useState("2");
  const [currency, setCurrency] = useState("casino-credits");
  const [mode, setMode] = useState("grant");
  const currencyOperation = useRef<{ signature: string; id: string } | null>(
    null,
  );
  useEffect(() => {
    if (details.data) setQuotaGiB(String(details.data.quotaBytes / 1024 ** 3));
  }, [details.data]);
  async function submit(path: string, body: unknown) {
    const saved = await action(path, body);
    if (saved) await details.refresh();
    return saved;
  }
  return (
    <section
      aria-label={`Controls for ${account.username}`}
      className="panel"
      style={{ margin: "1rem 0" }}
    >
      <h3>@{account.username}</h3>
      <ResourceState
        loading={details.loading}
        error={details.error}
        retry={details.refresh}
      />
      {details.data && (
        <>
          <p className="muted">
            Storage: {(details.data.usageBytes / 1024 ** 2).toFixed(1)} MiB of{" "}
            {(details.data.quotaBytes / 1024 ** 3).toFixed(2)} GiB (
            {details.data.customQuota ? "account override" : "platform default"}
            ). School files, trash, and chat uploads share this budget.
          </p>
          <p>
            {["casino-credits", "tell-coins"].map((kind) => (
              <span key={kind} style={{ marginRight: "1rem" }}>
                <strong>{kind}: </strong>
                {(
                  details.data!.balances.find(
                    (balance) => balance.currency === kind,
                  )?.balance ?? 0
                ).toLocaleString()}
              </span>
            ))}
          </p>
          {canChange ? (
            <>
              <form
                className="settings-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  const form = event.currentTarget;
                  void submit(`admin/users/${account.id}/quota`, {
                    quotaBytes:
                      field(form, "default") === "on"
                        ? null
                        : Math.round(Number(quotaGiB) * 1024 ** 3),
                    reason: field(form, "reason"),
                    confirmation: field(form, "confirmation"),
                  });
                }}
              >
                <fieldset disabled={working}>
                  <legend>Storage quota</legend>
                  <label>
                    Quota in GiB
                    <input
                      type="number"
                      value={quotaGiB}
                      onChange={(event) => setQuotaGiB(event.target.value)}
                      min={1 / 1024}
                      max={100}
                      step="any"
                      required
                    />
                  </label>
                  <label className="check-label">
                    <input type="checkbox" name="default" /> Use platform
                    default instead
                  </label>
                  <label>
                    Reason
                    <input
                      name="reason"
                      minLength={5}
                      maxLength={240}
                      required
                      placeholder="Why is this quota changing?"
                    />
                  </label>
                  <label>
                    Type QUOTA {account.username}
                    <input name="confirmation" required autoComplete="off" />
                  </label>
                  <button className="button secondary">
                    Save storage quota
                  </button>
                </fieldset>
              </form>
              <form
                className="settings-form"
                onSubmit={async (event) => {
                  event.preventDefault();
                  const form = event.currentTarget;
                  const body = {
                    currency,
                    mode,
                    amount:
                      mode === "grant" ? Number(field(form, "amount")) : 0,
                    reason: field(form, "reason"),
                    confirmation: field(form, "confirmation"),
                  };
                  const signature = JSON.stringify({
                    target: account.id,
                    ...body,
                  });
                  if (currencyOperation.current?.signature !== signature)
                    currencyOperation.current = {
                      signature,
                      id: crypto.randomUUID(),
                    };
                  if (
                    await submit(`admin/users/${account.id}/currency`, {
                      ...body,
                      operationId: currencyOperation.current.id,
                    })
                  ) {
                    currencyOperation.current = null;
                    clearOperationForm(form);
                  }
                }}
              >
                <fieldset disabled={working || account.disabled}>
                  <legend>Fictional currency</legend>
                  <label>
                    Currency
                    <select
                      value={currency}
                      onChange={(event) => setCurrency(event.target.value)}
                    >
                      <option value="casino-credits">Casino Credits</option>
                      <option value="tell-coins">Tell Coins</option>
                    </select>
                  </label>
                  <label>
                    Operation
                    <select
                      value={mode}
                      onChange={(event) => setMode(event.target.value)}
                    >
                      <option value="grant">Grant test currency</option>
                      <option value="reset">Reset balance to zero</option>
                    </select>
                  </label>
                  {mode === "grant" && (
                    <label>
                      Amount
                      <input
                        name="amount"
                        type="number"
                        min={1}
                        max={1000000}
                        step={1}
                        required
                        defaultValue={100}
                      />
                    </label>
                  )}
                  <p className="muted">
                    A reset affects the selected balance only. Existing loans,
                    collectibles, marketplace listings, reward timers, and
                    history remain. Finish active casino hands before a Credits
                    reset.
                  </p>
                  <label>
                    Reason
                    <input
                      name="reason"
                      minLength={5}
                      maxLength={240}
                      required
                      placeholder="Why is this balance changing?"
                    />
                  </label>
                  <label>
                    Type {mode.toUpperCase()} {currency} {account.username}
                    <input name="confirmation" required autoComplete="off" />
                  </label>
                  <button
                    className={`button secondary ${mode === "reset" ? "danger" : ""}`}
                  >
                    {mode === "reset"
                      ? "Reset balance to zero"
                      : "Grant currency"}
                  </button>
                </fieldset>
              </form>
            </>
          ) : (
            <p className="muted">
              Only the owner can change another administrator account.
            </p>
          )}
          {canChange && (
            <SaveResetTools
              account={account}
              working={working}
              submit={submit}
            />
          )}
          <h4>Recent currency ledger</h4>
          {details.data.ledger.map((entry) => (
            <p className="muted small" key={entry.id}>
              {entry.currency} · {entry.amount > 0 ? "+" : ""}
              {entry.amount} · {entry.reason} · balance{" "}
              {entry.balance_after.toLocaleString()} · {time(entry.created_at)}
            </p>
          ))}
          {!details.data.ledger.length && (
            <p className="muted small">No currency transactions recorded.</p>
          )}
          <h4>Cloud save metadata</h4>
          {details.data.saves.map((save) => (
            <p className="muted small" key={save.game_id}>
              {save.game_id} · schema {save.schema_version} · revision{" "}
              {save.revision} · {save.bytes} bytes · {time(save.updated_at)}
            </p>
          ))}
          {!details.data.saves.length && (
            <p className="muted small">No casual cloud saves recorded.</p>
          )}
        </>
      )}
    </section>
  );
}

function useConfirmedOperation() {
  const operation = useRef<{ signature: string; id: string } | null>(null);
  return {
    id(body: Record<string, unknown>) {
      const signature = JSON.stringify(body);
      if (operation.current?.signature !== signature)
        operation.current = { signature, id: crypto.randomUUID() };
      return operation.current.id;
    },
    complete() {
      operation.current = null;
    },
  };
}
function SaveResetTools({
  account,
  working,
  submit,
}: {
  account: AdminUser;
  working: boolean;
  submit: (path: string, body: unknown) => Promise<boolean>;
}) {
  const choices = games.filter(
    (game) =>
      (!game.ranked || game.id === "ego-trip") &&
      game.permissions.includes("saves.write"),
  );
  const [gameId, setGameId] = useState("ego-trip");
  const operation = useConfirmedOperation();
  return (
    <form
      className="settings-form"
      onSubmit={async (event) => {
        event.preventDefault();
        const form = event.currentTarget;
        const body = {
          gameId,
          reason: field(form, "reason"),
          confirmation: field(form, "confirmation"),
        };
        if (
          await submit(`admin/users/${account.id}/save-reset`, {
            ...body,
            operationId: operation.id({ target: account.id, ...body }),
          })
        ) {
          operation.complete();
          clearOperationForm(form);
        }
      }}
    >
      <fieldset disabled={working}>
        <legend>Reset casual cloud save</legend>
        <label>
          Saved game
          <select
            value={gameId}
            onChange={(event) => setGameId(event.target.value)}
          >
            {choices.map((game) => (
              <option value={game.id} key={game.id}>
                {game.name}
              </option>
            ))}
          </select>
        </label>
        <p className="muted">
          This clears the selected cloud save. Reload the game afterward.
          Authoritative progression, Casino hands, loans, currency, inventory,
          achievements, and ledger history remain. A stale tab with an old save
          revision must reload before saving.
        </p>
        <label>
          Reason
          <input name="reason" minLength={5} maxLength={240} required />
        </label>
        <label>
          Type RESET SAVE {gameId} {account.username}
          <input name="confirmation" required autoComplete="off" />
        </label>
        <button className="button secondary danger">
          Reset selected cloud save
        </button>
      </fieldset>
    </form>
  );
}
interface LeaderboardControls {
  games: { id: string; name: string; categories: string[] }[];
  currentKeys: { all: string; daily: string; weekly: string };
  scopes: {
    gameId: string;
    category: string;
    period: string;
    periodKey: string;
    entries: number;
  }[];
}
function RecoveryTools({
  working,
  action,
}: {
  working: boolean;
  action: (path: string, body: unknown) => Promise<boolean>;
}) {
  const boards = useResource<LeaderboardControls>("admin/leaderboards");
  const [gameId, setGameId] = useState("incremental");
  const [category, setCategory] = useState("default");
  const [period, setPeriod] = useState<"all" | "daily" | "weekly">("all");
  const [periodKey, setPeriodKey] = useState("all");
  const [kind, setKind] = useState("chat-message");
  const [contentId, setContentId] = useState("");
  const leaderboardOperation = useConfirmedOperation();
  const contentOperation = useConfirmedOperation();
  const entries =
    boards.data?.scopes.find(
      (scope) =>
        scope.gameId === gameId &&
        scope.category === category &&
        scope.period === period &&
        scope.periodKey === periodKey,
    )?.entries ?? 0;
  return (
    <>
      <Panel title="Leaderboard recovery">
        <ResourceState
          loading={boards.loading}
          error={boards.error}
          retry={boards.refresh}
        />
        <form
          className="settings-form"
          onSubmit={async (event) => {
            event.preventDefault();
            const form = event.currentTarget;
            const body = {
              gameId,
              category,
              period,
              periodKey,
              reason: field(form, "reason"),
              confirmation: field(form, "confirmation"),
            };
            if (
              await action("admin/leaderboards/reset", {
                ...body,
                operationId: leaderboardOperation.id(body),
              })
            ) {
              leaderboardOperation.complete();
              clearOperationForm(form);
              await boards.refresh();
            }
          }}
        >
          <fieldset disabled={working || !boards.data}>
            <legend>Reset a leaderboard scope</legend>
            <label>
              Ranked game
              <select
                value={gameId}
                onChange={(event) => {
                  setGameId(event.target.value);
                  setCategory("default");
                }}
              >
                {boards.data?.games.map((game) => (
                  <option value={game.id} key={game.id}>
                    {game.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Score category
              <select
                value={category}
                onChange={(event) => setCategory(event.target.value)}
              >
                {boards.data?.games
                  .find((game) => game.id === gameId)
                  ?.categories.map((value) => (
                    <option value={value} key={value}>
                      {value}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              Score period
              <select
                value={period}
                onChange={(event) => {
                  const value = event.target.value as typeof period;
                  setPeriod(value);
                  setPeriodKey(boards.data?.currentKeys[value] ?? "all");
                }}
              >
                <option value="all">All time</option>
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
              </select>
            </label>
            <label>
              UTC period key
              <input
                type={period === "all" ? "text" : "date"}
                value={periodKey}
                onChange={(event) => setPeriodKey(event.target.value)}
                readOnly={period === "all"}
                required
              />
            </label>
            <p className="muted">
              {entries} stored entries in this scope. This removes matching
              stored scores. Game progress and achievements remain, and later
              server scoring can repopulate entries. Weekly keys use Monday in
              UTC.
            </p>
            <label>
              Reason
              <input name="reason" minLength={5} maxLength={240} required />
            </label>
            <label>
              Type RESET LEADERBOARD {gameId} {category} {period} {periodKey}
              <input name="confirmation" required autoComplete="off" />
            </label>
            <button className="button secondary danger">
              Reset leaderboard scope
            </button>
          </fieldset>
        </form>
      </Panel>
      <Panel title="Emergency content removal">
        <p className="muted">
          Remove a known message or an already-public creation by its UUID. This
          tool does not browse private chats, private drafts, or school content.
          Chat messages become deleted tombstones and their attachments are
          queued for storage cleanup. Public creation removal permanently
          deletes its versions and community records.
        </p>
        <form
          className="settings-form"
          onSubmit={async (event) => {
            event.preventDefault();
            const form = event.currentTarget;
            const body = {
              kind,
              id: contentId,
              reason: field(form, "reason"),
              confirmation: field(form, "confirmation"),
            };
            if (
              await action("admin/content/remove", {
                ...body,
                operationId: contentOperation.id(body),
              })
            ) {
              contentOperation.complete();
              clearOperationForm(form);
              setContentId("");
            }
          }}
        >
          <fieldset disabled={working}>
            <legend>Remove identified content</legend>
            <label>
              Content kind
              <select
                value={kind}
                onChange={(event) => setKind(event.target.value)}
              >
                <option value="chat-message">Chat message</option>
                <option value="public-creation">Public creation</option>
              </select>
            </label>
            <label>
              Content UUID
              <input
                value={contentId}
                onChange={(event) => setContentId(event.target.value.trim())}
                pattern="[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}"
                required
                placeholder="00000000-0000-4000-8000-000000000000"
              />
            </label>
            <label>
              Reason
              <input name="reason" minLength={5} maxLength={240} required />
            </label>
            <label>
              Type REMOVE {kind === "chat-message" ? "MESSAGE" : "CREATION"}{" "}
              {contentId || "UUID"}
              <input name="confirmation" required autoComplete="off" />
            </label>
            <button className="button secondary danger">
              Remove identified content
            </button>
          </fieldset>
        </form>
      </Panel>
    </>
  );
}

function clearOperationForm(form: HTMLFormElement) {
  for (const name of ["reason", "confirmation"]) {
    const input = form.elements.namedItem(name);
    if (input instanceof HTMLInputElement) input.value = "";
  }
}
