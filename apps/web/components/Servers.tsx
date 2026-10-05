"use client";
import type {
  ServerData,
  MutationResult,
  PartyData,
  FriendsData,
} from "./models";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Plus,
  Hash,
  ArrowUpRight,
  Users,
  Settings,
  Link as LinkIcon,
  Check,
  X,
  Crown,
  Send,
} from "lucide-react";
import { games } from "@tell-aviv/games";
import { ChatRoom } from "./Social";
import { ServerEmojiManager } from "./ChatMedia";
import {
  api,
  Avatar,
  Empty,
  field,
  Heading,
  Notice,
  Panel,
  ResourceState,
  useResource,
  useSession,
} from "./ui";
const permissions = [
  "view_channel",
  "send_messages",
  "attach_files",
  "embed_links",
  "add_reactions",
  "mention_everyone",
  "manage_messages",
  "manage_channels",
  "manage_roles",
  "manage_server",
  "create_invite",
];
export function ServersPage() {
  const { user } = useSession(),
    resource = useResource<ServerData[]>("servers"),
    discovery = useResource<ServerData[]>("servers/discover"),
    [selected, setSelected] = useState<string | null>(null),
    details = useResource<ServerData>(selected ? `servers/${selected}` : null),
    [channel, setChannel] = useState<string | null>(null),
    [tab, setTab] = useState("Yours"),
    [create, setCreate] = useState(false),
    [manage, setManage] = useState(false),
    [error, setError] = useState(""),
    [invite, setInvite] = useState("");
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("id")) setSelected(params.get("id"));
    if (params.get("invite")) setInvite(params.get("invite") || "");
  }, []);
  useEffect(() => {
    if (details.data)
      setChannel((current: string | null) =>
        details.data?.channels.some((room) => room.id === current)
          ? current
          : details.data?.channels[0]?.id || null,
      );
  }, [details.data]);
  async function mutate(path: string, input = {}, method = "POST") {
    setError("");
    try {
      const result = await api<MutationResult>(path, method, input);
      await Promise.all([
        resource.refresh(),
        details.refresh(),
        discovery.refresh(),
      ]);
      return result;
    } catch (e) {
      setError((e as Error).message);
      return null;
    }
  }
  const server = details.data,
    can = (permission: string) => server?.permissions?.includes(permission);
  return (
    <>
      <Heading
        eyebrow="FIND YOUR CORNER"
        title={server ? server.name : "A space of your own."}
        description={
          server
            ? server.description || "Your people. Your conversations."
            : "Small circles, shared interests, and a place to meet."
        }
      >
        <button className="button" onClick={() => setCreate(!create)}>
          <Plus size={17} /> Create a server
        </button>
      </Heading>
      <Notice>{error}</Notice>
      {create && (
        <Panel title="Give your community a home">
          <form
            className="form-grid"
            onSubmit={async (e) => {
              e.preventDefault();
              const form = e.currentTarget;
              const data = new FormData(form);
              const result = await mutate("servers", {
                name: field(form, "name"),
                description: field(form, "description"),
                tags: field(form, "tags")
                  .split(",")
                  .map((v) => v.trim())
                  .filter(Boolean),
                discoverable: data.get("discoverable") === "on",
              });
              if (result) {
                setSelected(result.id ?? result.serverId ?? null);
                setCreate(false);
              }
            }}
          >
            <label>
              Server name
              <input
                name="name"
                maxLength={80}
                required
                placeholder="A name that feels like you"
              />
            </label>
            <label>
              Description
              <input
                name="description"
                maxLength={1000}
                placeholder="What brings you together?"
              />
            </label>
            <label>
              Tags
              <input name="tags" placeholder="games, art, study" />
            </label>
            <label className="checkbox">
              <input name="discoverable" type="checkbox" /> Show in server
              discovery
            </label>
            <button className="button">
              Create your space <ArrowUpRight size={16} />
            </button>
          </form>
        </Panel>
      )}
      <div className="servers-layout">
        <aside className="panel server-list">
          <div className="tabs">
            <button
              className={tab === "Yours" ? "active" : ""}
              onClick={() => setTab("Yours")}
            >
              Yours
            </button>
            <button
              className={tab === "Discover" ? "active" : ""}
              onClick={() => setTab("Discover")}
            >
              Discover
            </button>
          </div>
          <ResourceState
            loading={tab === "Yours" ? resource.loading : discovery.loading}
            error={tab === "Yours" ? resource.error : discovery.error}
            retry={tab === "Yours" ? resource.refresh : discovery.refresh}
          />
          {(tab === "Yours" ? resource.data : discovery.data)?.map((item) => (
            <button
              key={item.id}
              className={`room-item ${selected === item.id ? "active" : ""}`}
              onClick={async () => {
                if (
                  tab === "Discover" &&
                  !resource.data?.some((s) => s.id === item.id)
                ) {
                  const result = await mutate(`servers/${item.id}/join`);
                  if (!result) return;
                }
                setSelected(item.id);
                setManage(false);
              }}
            >
              <Avatar user={{ displayName: item.name, avatar: item.icon }} />
              <span>
                <strong>{item.name}</strong>
                <small>
                  {item.memberCount} member{item.memberCount !== 1 ? "s" : ""}
                </small>
              </span>
              <ArrowUpRight size={15} />
            </button>
          ))}
          {!(tab === "Yours" ? resource.data : discovery.data)?.length && (
            <Empty
              title={
                tab === "Yours"
                  ? "Your first community awaits"
                  : "A fresh neighborhood"
              }
              icon="◈"
            >
              {tab === "Yours"
                ? "Create a server or use an invite below."
                : "Discoverable communities will appear here."}
            </Empty>
          )}
          <form
            className="invite-join"
            onSubmit={async (e) => {
              e.preventDefault();
              const code =
                invite.split("/").pop()?.split("invite=").pop() || invite;
              const result = await mutate(
                `invites/${encodeURIComponent(code)}/join`,
              );
              if (result) {
                setSelected(result.serverId ?? result.id ?? null);
                setInvite("");
              }
            }}
          >
            <label htmlFor="invite-code">Have an invitation?</label>
            <input
              id="invite-code"
              placeholder="Paste invite code"
              value={invite}
              onChange={(e) => setInvite(e.target.value)}
              required
            />
            <button className="button secondary small">
              Join server <ArrowUpRight size={14} />
            </button>
          </form>
        </aside>
        <div className="server-detail">
          <ResourceState
            loading={Boolean(selected) && details.loading}
            error={details.error}
            retry={details.refresh}
          />
          {server ? (
            <>
              <div className="server-bar">
                <div className="channel-tabs">
                  {server.channels.map((item) => (
                    <button
                      className={channel === item.id ? "active" : ""}
                      onClick={() => setChannel(item.id)}
                      key={item.id}
                    >
                      <Hash size={15} /> {item.name}
                    </button>
                  ))}
                </div>
                <button
                  className={`icon-button ${manage ? "selected" : ""}`}
                  aria-label="Server settings and members"
                  onClick={() => setManage(!manage)}
                >
                  <Settings size={18} />
                </button>
              </div>
              {manage && (
                <Panel title="Your community">
                  <ServerEmojiManager
                    serverId={server.id}
                    canManage={!!can("manage_server")}
                  />
                  <div className="member-chips">
                    {server.members.map((member) => (
                      <div className="member-chip" key={member.id}>
                        <Avatar user={member} size="small-avatar" />
                        <Link href={`/profile/${member.id}`}>
                          {member.displayName}
                        </Link>
                        {member.id === server.ownerId && <Crown size={12} />}
                        {can("manage_roles") && (
                          <select
                            aria-label={`Assign role to ${member.displayName}`}
                            defaultValue=""
                            onChange={(e) => {
                              if (e.target.value)
                                void mutate(
                                  `servers/${server.id}/members/${member.id}/roles`,
                                  {
                                    roleIds: [
                                      ...new Set([
                                        ...(member.roleIds ?? []),
                                        e.target.value,
                                      ]),
                                    ],
                                  },
                                );
                            }}
                          >
                            <option value="">Add role</option>
                            {server.roles
                              .filter((role) => !role.isDefault)
                              .map((role) => (
                                <option value={role.id} key={role.id}>
                                  {role.name}
                                </option>
                              ))}
                          </select>
                        )}
                      </div>
                    ))}
                  </div>
                  <div className="tag-row">
                    {server.roles.map((role) => (
                      <span
                        className="pill"
                        style={{ color: role.color }}
                        key={role.id}
                      >
                        {role.name}
                      </span>
                    ))}
                  </div>
                  {can("create_invite") && (
                    <form
                      className="inline-form"
                      onSubmit={async (e) => {
                        e.preventDefault();
                        const form = e.currentTarget;
                        const result = await mutate(
                          `servers/${server.id}/invites`,
                          {
                            ...(field(form, "hours")
                              ? { expiresInHours: Number(field(form, "hours")) }
                              : {}),
                            ...(field(form, "uses")
                              ? { maxUses: Number(field(form, "uses")) }
                              : {}),
                          },
                        );
                        if (result) setInvite(result.code ?? "");
                      }}
                    >
                      <input
                        name="hours"
                        type="number"
                        min="1"
                        max="8760"
                        aria-label="Invite validity hours"
                        placeholder="Expiry hours (optional)"
                      />
                      <input
                        name="uses"
                        type="number"
                        min="1"
                        max="10000"
                        aria-label="Invite maximum uses"
                        placeholder="Max uses (optional)"
                      />
                      <button className="button secondary small">
                        <LinkIcon size={14} /> Make invite
                      </button>
                    </form>
                  )}
                  {invite && (
                    <div className="notice success">
                      Invite code: <code>{invite}</code>
                      <button
                        className="text-button"
                        onClick={() =>
                          navigator.clipboard
                            .writeText(
                              `${window.location.origin}/servers?invite=${invite}`,
                            )
                            .catch(() =>
                              setError(
                                "Could not copy. You can select the invite code above.",
                              ),
                            )
                        }
                      >
                        Copy invite link
                      </button>
                    </div>
                  )}
                  {can("manage_channels") && (
                    <form
                      className="inline-form"
                      onSubmit={async (e) => {
                        e.preventDefault();
                        const form = e.currentTarget;
                        const result = await mutate(
                          `servers/${server.id}/channels`,
                          {
                            name: field(form, "name"),
                            type: field(form, "type"),
                          },
                        );
                        if (result) form.reset();
                      }}
                    >
                      <input
                        name="name"
                        maxLength={80}
                        aria-label="New channel name"
                        placeholder="New channel name"
                        required
                      />
                      <select name="type" aria-label="Channel type">
                        <option value="text">Text channel</option>
                        <option value="announcement">Announcements</option>
                      </select>
                      <button className="button secondary small">
                        <Plus size={14} /> Add channel
                      </button>
                    </form>
                  )}
                  {can("manage_roles") && (
                    <details>
                      <summary>Create a community role</summary>
                      <form
                        className="form-grid"
                        onSubmit={async (e) => {
                          e.preventDefault();
                          const form = e.currentTarget,
                            data = new FormData(form);
                          const result = await mutate(
                            `servers/${server.id}/roles`,
                            {
                              name: field(form, "name"),
                              color: field(form, "color"),
                              position: Number(field(form, "position") || 1),
                              permissions: data.getAll("permissions"),
                            },
                          );
                          if (result) form.reset();
                        }}
                      >
                        <label>
                          Role name
                          <input name="name" required maxLength={60} />
                        </label>
                        <label>
                          Color
                          <input
                            name="color"
                            type="color"
                            defaultValue="#6ad6bb"
                          />
                        </label>
                        <label>
                          Position
                          <input
                            name="position"
                            type="number"
                            defaultValue={1}
                            min={1}
                          />
                        </label>
                        <div className="permission-grid">
                          {permissions.map((permission) => (
                            <label className="checkbox" key={permission}>
                              <input
                                type="checkbox"
                                name="permissions"
                                value={permission}
                                defaultChecked={[
                                  "view_channel",
                                  "send_messages",
                                ].includes(permission)}
                              />
                              {permission.replaceAll("_", " ")}
                            </label>
                          ))}
                        </div>
                        <button className="button secondary small">
                          Create role
                        </button>
                      </form>
                    </details>
                  )}
                  {can("manage_server") && (
                    <details>
                      <summary>Edit community details</summary>
                      <form
                        className="form-grid"
                        onSubmit={(e) => {
                          e.preventDefault();
                          const form = e.currentTarget;
                          void mutate(
                            `servers/${server.id}`,
                            {
                              name: field(form, "name"),
                              description: field(form, "description"),
                              discoverable:
                                new FormData(form).get("discoverable") === "on",
                            },
                            "PATCH",
                          );
                        }}
                      >
                        <label>
                          Name
                          <input
                            name="name"
                            defaultValue={server.name}
                            required
                            maxLength={80}
                          />
                        </label>
                        <label>
                          Description
                          <textarea
                            name="description"
                            defaultValue={server.description}
                            maxLength={1000}
                          />
                        </label>
                        <label className="checkbox">
                          <input
                            type="checkbox"
                            name="discoverable"
                            defaultChecked={server.discoverable}
                          />{" "}
                          Discoverable
                        </label>
                        <button className="button secondary small">
                          Save community
                        </button>
                      </form>
                    </details>
                  )}
                  {server.ownerId !== user.id && (
                    <button
                      className="text-button danger"
                      onClick={async () => {
                        const result = await mutate(
                          `servers/${server.id}/leave`,
                        );
                        if (result) setSelected(null);
                      }}
                    >
                      Leave server
                    </button>
                  )}
                </Panel>
              )}
              {channel ? (
                <ChatRoom
                  key={channel}
                  roomId={channel}
                  title={
                    server.channels.find((item) => item.id === channel)?.name
                  }
                  compact
                />
              ) : (
                <Empty title="No visible channels">
                  Ask a community owner for access.
                </Empty>
              )}
            </>
          ) : (
            !details.loading && (
              <div className="server-welcome">
                <span className="large-symbol">◈</span>
                <h2>Your people deserve a place.</h2>
                <p>
                  Create a space for your friend group, a favorite game,
                  <br />
                  or the next great idea.
                </p>
                <button className="button" onClick={() => setCreate(true)}>
                  Start a community <Plus size={17} />
                </button>
              </div>
            )
          )}
        </div>
      </div>
    </>
  );
}
export function PartyPanel({ close }: { close: () => void }) {
  const { user } = useSession(),
    resource = useResource<PartyData>("parties"),
    friends = useResource<FriendsData>("friends"),
    [error, setError] = useState(""),
    router = useRouter(),
    party = resource.data?.party;
  async function action(name: string, input = {}) {
    setError("");
    try {
      const result = await api<MutationResult>(
        party ? `parties/${party.id}/${name}` : "parties",
        "POST",
        input,
      );
      await resource.refresh();
      if (name === "launch" && result.gameId) {
        close();
        router.push(`/games/${result.gameId}/play`);
      }
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <Panel
      title="Your party"
      action={
        <button
          className="icon-button"
          aria-label="Close party"
          onClick={close}
        >
          <X size={17} />
        </button>
      }
    >
      <ResourceState
        loading={resource.loading}
        error={resource.error}
        retry={resource.refresh}
      />
      <Notice>{error}</Notice>
      {resource.data?.invites?.map((invite) => (
        <div className="notice" key={invite.partyId}>
          {invite.inviterName} invited you.
          <button
            className="button small"
            onClick={async () => {
              try {
                await api(`parties/${invite.partyId}/join`, "POST", {});
                await resource.refresh();
              } catch (e) {
                setError((e as Error).message);
              }
            }}
          >
            Join party
          </button>
        </div>
      ))}
      {party ? (
        <>
          <div className="party-members">
            {party.members.map((member) => (
              <div className="person-row" key={member.id}>
                <Avatar user={member} />
                <span>
                  <strong>
                    {member.displayName}
                    {member.id === party.leaderId && <Crown size={12} />}
                  </strong>
                  <small>
                    {member.ready ? "Ready to play" : "Getting ready"}
                  </small>
                </span>
                {member.ready && <Check size={16} className="accent" />}
                {party.leaderId === user.id && member.id !== user.id && (
                  <details>
                    <summary aria-label={`Manage ${member.displayName}`}>
                      •••
                    </summary>
                    <button
                      className="text-button"
                      onClick={() =>
                        void action("leader", { userId: member.id })
                      }
                    >
                      Make leader
                    </button>
                    <button
                      className="text-button danger"
                      onClick={() => void action("kick", { userId: member.id })}
                    >
                      Remove
                    </button>
                  </details>
                )}
              </div>
            ))}
          </div>
          <select
            aria-label="Party game"
            value={party.gameId || ""}
            disabled={party.leaderId !== user.id}
            onChange={(e) => void action("game", { gameId: e.target.value })}
          >
            <option value="">Choose your next game</option>
            {games
              .filter((game) => game.multiplayer)
              .map((game) => (
                <option value={game.id} key={game.id}>
                  {game.name}
                </option>
              ))}
          </select>
          <form
            className="inline-form"
            onSubmit={(e) => {
              e.preventDefault();
              const id = field(e.currentTarget, "userId");
              if (id) void action("invite", { userId: id });
            }}
          >
            <select name="userId" aria-label="Friend to invite">
              <option value="">Invite a friend</option>
              {friends.data?.friends
                ?.filter(
                  (friend) => !party.members.some((m) => m.id === friend.id),
                )
                .map((friend) => (
                  <option value={friend.id} key={friend.id}>
                    {friend.displayName}
                  </option>
                ))}
            </select>
            <button className="button secondary small">
              <Plus size={14} /> Invite
            </button>
          </form>
          <div className="button-row">
            <button
              className="button"
              onClick={() =>
                void action("ready", {
                  ready: !party.members.find((member) => member.id === user.id)
                    ?.ready,
                })
              }
            >
              <Check size={16} />
              {party.members.find((member) => member.id === user.id)?.ready
                ? "Unready"
                : "Ready up"}
            </button>
            {party.leaderId === user.id && (
              <button
                className="button secondary"
                disabled={!party.gameId}
                onClick={() => void action("launch")}
              >
                Launch game <ArrowUpRight size={15} />
              </button>
            )}
            <button
              className="text-button"
              onClick={() => void action("leave")}
            >
              Leave
            </button>
          </div>
          {party.roomId && (
            <Link
              className="text-link"
              href={`/chat?room=${party.roomId}`}
              onClick={close}
            >
              Open party chat <MessageIcon />
            </Link>
          )}
          <p className="muted small">
            Parties stay together as you move between games. Up to 8 members.
          </p>
        </>
      ) : (
        !resource.loading && (
          <>
            <Empty title="A better kind of group project" icon="✦">
              Get your people together. Ready up. Find your next game.
            </Empty>
            <button
              className="button full-width"
              onClick={() => void action("create")}
            >
              <Users size={16} /> Create a party
            </button>
          </>
        )
      )}
    </Panel>
  );
}
function MessageIcon() {
  return <Send size={13} />;
}
