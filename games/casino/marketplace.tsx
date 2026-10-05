"use client";
import { useState } from "react";
export interface TradeCopy {
  id: string;
  itemId: string;
  serial: number;
  listingId?: string | null;
  reservationOfferId?: string | null;
}
interface Edition {
  itemId: string;
  name?: string;
}
export interface TradeOffer {
  id: string;
  senderId: string;
  recipientId: string;
  direction: "incoming" | "outgoing";
  senderUsername: string;
  recipientUsername: string;
  offeredCredits: number;
  requestedCredits: number;
  offeredItems: TradeCopy[];
  requestedItems: { itemId: string; count: number }[];
  status: string;
  expiresAt: string;
}
export interface TradeHistory {
  id: string;
  kind: string;
  senderUsername: string;
  recipientUsername: string;
  offeredCredits: number;
  requestedCredits: number;
  offeredItems: TradeCopy[];
  requestedItems: TradeCopy[];
  createdAt: string;
}
export interface CasinoOffersState {
  offers: TradeOffer[];
  tradeHistory: TradeHistory[];
  escrowCredits: number;
  collectibles: TradeCopy[];
  collectibleShop: Edition[];
  credits: number;
}
type Act = (name: string, payload: Record<string, unknown>) => Promise<unknown>;
const label = (copy: TradeCopy, editions: Edition[]) =>
  `${editions.find((edition) => edition.itemId === copy.itemId)?.name ?? copy.itemId} #${copy.serial}`;
export function MarketplaceOffers({
  state,
  disabled,
  action,
}: {
  state: CasinoOffersState;
  disabled: boolean;
  action: Act;
}) {
  const [username, setUsername] = useState(""),
    [selected, setSelected] = useState<string[]>([]),
    [giveCredits, setGiveCredits] = useState(0),
    [wantCredits, setWantCredits] = useState(0),
    [hours, setHours] = useState(24),
    [wanted, setWanted] = useState<{ itemId: string; count: number }[]>([]);
  const incoming = state.offers.filter(
      (offer) => offer.direction === "incoming",
    ),
    outgoing = state.offers.filter((offer) => offer.direction === "outgoing");
  const copies = state.collectibles.filter(
    (copy) => !copy.listingId && !copy.reservationOfferId,
  );
  const offeredIds = selected.filter((id) =>
    copies.some((copy) => copy.id === id),
  );
  const valid =
    username.trim().length >= 3 &&
    (offeredIds.length > 0 || giveCredits > 0) &&
    [giveCredits, wantCredits].every(
      (credits) =>
        Number.isInteger(credits) && credits >= 0 && credits <= 100000,
    ) &&
    giveCredits <= state.credits &&
    wanted.every(
      (item) => item.itemId && Number.isInteger(item.count) && item.count >= 1,
    ) &&
    wanted.reduce((sum, item) => sum + item.count, 0) <= 5 &&
    new Set(wanted.map((item) => item.itemId)).size === wanted.length;
  const toggle = (id: string) =>
    setSelected((current) =>
      current.includes(id)
        ? current.filter((entry) => entry !== id)
        : current.length < 5
          ? [...current, id]
          : current,
    );
  return (
    <section className="game-card">
      <h3>Offers and barter</h3>
      <p>
        Reserve your numbered copies and offered fictional Credits. The
        recipient chooses matching copies and accepts; both sides settle
        together. Reserved Credits: {state.escrowCredits}.
      </p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (!valid || disabled) return;
          void action("marketplace.offer.create", {
            username: username.trim(),
            copyIds: selected.filter((id) =>
              copies.some((copy) => copy.id === id),
            ),
            offeredCredits: giveCredits,
            requestedCredits: wantCredits,
            requestedItems: wanted,
            expiresInHours: hours,
          }).then((result) => {
            if (result) {
              setSelected([]);
              setGiveCredits(0);
              setWantCredits(0);
              setWanted([]);
            }
          });
        }}
      >
        <label>
          Recipient{" "}
          <input
            aria-label="Trade offer recipient"
            value={username}
            maxLength={24}
            onChange={(event) => setUsername(event.target.value)}
            placeholder="Username"
          />
        </label>
        <fieldset>
          <legend>Your offered copies · up to five</legend>
          {copies.length ? (
            copies.map((copy) => (
              <label key={copy.id} style={{ display: "block" }}>
                <input
                  type="checkbox"
                  checked={selected.includes(copy.id)}
                  onChange={() => toggle(copy.id)}
                />
                {label(copy, state.collectibleShop)}
              </label>
            ))
          ) : (
            <p>
              No unlisted, unreserved copies. You can offer Credits instead.
            </p>
          )}
        </fieldset>
        <div className="game-row">
          <label>
            Offer Credits{" "}
            <input
              aria-label="Offered fictional Credits"
              type="number"
              min={0}
              max={100000}
              value={giveCredits}
              onChange={(event) => setGiveCredits(Number(event.target.value))}
            />
          </label>
          <label>
            Request Credits{" "}
            <input
              aria-label="Requested fictional Credits"
              type="number"
              min={0}
              max={100000}
              value={wantCredits}
              onChange={(event) => setWantCredits(Number(event.target.value))}
            />
          </label>
          <label>
            Expires{" "}
            <select
              aria-label="Trade offer expiration"
              value={hours}
              onChange={(event) => setHours(Number(event.target.value))}
            >
              {[1, 12, 24, 48, 72].map((value) => (
                <option key={value} value={value}>
                  {value} hours
                </option>
              ))}
            </select>
          </label>
        </div>
        <fieldset>
          <legend>
            Request collectible editions · recipient chooses their copies
          </legend>
          {wanted.map((item, index) => (
            <div className="game-row" key={index}>
              <select
                aria-label={`Requested edition ${index + 1}`}
                value={item.itemId}
                onChange={(event) =>
                  setWanted((current) =>
                    current.map((entry, i) =>
                      i === index
                        ? { ...entry, itemId: event.target.value }
                        : entry,
                    ),
                  )
                }
              >
                <option value="">Choose edition</option>
                {state.collectibleShop.map((edition) => (
                  <option key={edition.itemId} value={edition.itemId}>
                    {edition.name ?? edition.itemId}
                  </option>
                ))}
              </select>
              <input
                aria-label={`Requested edition count ${index + 1}`}
                type="number"
                min={1}
                max={5}
                value={item.count}
                onChange={(event) =>
                  setWanted((current) =>
                    current.map((entry, i) =>
                      i === index
                        ? { ...entry, count: Number(event.target.value) }
                        : entry,
                    ),
                  )
                }
              />
              <button
                type="button"
                onClick={() =>
                  setWanted((current) => current.filter((_, i) => i !== index))
                }
              >
                Remove edition
              </button>
            </div>
          ))}
          <button
            type="button"
            disabled={wanted.length >= 5}
            onClick={() =>
              setWanted((current) => [...current, { itemId: "", count: 1 }])
            }
          >
            Add requested edition
          </button>
        </fieldset>
        <button disabled={disabled || !valid} type="submit">
          Send trade offer
        </button>
      </form>
      <h4>Incoming offers</h4>
      {!incoming.length && <p>No incoming offers.</p>}
      {incoming.map((offer) => (
        <Offer
          key={offer.id}
          offer={offer}
          state={state}
          action={action}
          disabled={disabled}
        />
      ))}
      <h4>Outgoing offers</h4>
      {!outgoing.length && <p>No outgoing offers.</p>}
      {outgoing.map((offer) => (
        <Offer
          key={offer.id}
          offer={offer}
          state={state}
          action={action}
          disabled={disabled}
        />
      ))}
      <details>
        <summary>Gift and trade history · {state.tradeHistory.length}</summary>
        {!state.tradeHistory.length && (
          <p>Completed gifts, sales and barter appear here.</p>
        )}
        {state.tradeHistory.map((trade) => (
          <article className="game-card" key={trade.id}>
            <strong>
              {trade.kind} · @{trade.senderUsername} → @
              {trade.recipientUsername}
            </strong>
            <p>
              Sent:{" "}
              {trade.offeredItems
                .map((copy) => label(copy, state.collectibleShop))
                .join(", ") || "no copies"}{" "}
              · {Number(trade.offeredCredits)} Credits. Received:{" "}
              {trade.requestedItems
                .map((copy) => label(copy, state.collectibleShop))
                .join(", ") || "no copies"}{" "}
              · {Number(trade.requestedCredits)} Credits.
            </p>
            <small>{new Date(trade.createdAt).toLocaleString()}</small>
          </article>
        ))}
      </details>
    </section>
  );
}
function Offer({
  offer,
  state,
  disabled,
  action,
}: {
  offer: TradeOffer;
  state: CasinoOffersState;
  disabled: boolean;
  action: Act;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const outgoing = offer.direction === "outgoing",
    expired = new Date(offer.expiresAt).getTime() <= Date.now();
  const eligible = state.collectibles.filter(
    (copy) =>
      !copy.listingId &&
      !copy.reservationOfferId &&
      offer.requestedItems.some((wanted) => wanted.itemId === copy.itemId),
  );
  const valid =
    selected.length ===
      offer.requestedItems.reduce((sum, item) => sum + item.count, 0) &&
    offer.requestedItems.every(
      (item) =>
        selected.filter((id) =>
          eligible.some(
            (copy) => copy.id === id && copy.itemId === item.itemId,
          ),
        ).length === item.count,
    );
  return (
    <article className="game-card">
      <h5>
        Offer {outgoing ? "to" : "from"} @
        {outgoing ? offer.recipientUsername : offer.senderUsername}
      </h5>
      <p>
        Offered:{" "}
        {offer.offeredItems
          .map((copy) => label(copy, state.collectibleShop))
          .join(", ") || "no copies"}{" "}
        · {offer.offeredCredits} Credits.
      </p>
      <p>
        Requested:{" "}
        {offer.requestedItems
          .map(
            (item) =>
              `${state.collectibleShop.find((edition) => edition.itemId === item.itemId)?.name ?? item.itemId} ×${item.count}`,
          )
          .join(", ") || "no copies"}{" "}
        · {offer.requestedCredits} Credits.
      </p>
      <p>
        Status: {offer.status}
        {offer.status === "pending"
          ? ` · expires ${new Date(offer.expiresAt).toLocaleString()}`
          : ""}
      </p>
      {offer.status === "pending" && (
        <>
          {!outgoing && !expired && (
            <>
              <fieldset>
                <legend>Choose your requested copies</legend>
                {eligible.map((copy) => (
                  <label key={copy.id} style={{ display: "block" }}>
                    <input
                      type="checkbox"
                      checked={selected.includes(copy.id)}
                      onChange={() =>
                        setSelected((current) =>
                          current.includes(copy.id)
                            ? current.filter((id) => id !== copy.id)
                            : [...current, copy.id],
                        )
                      }
                    />
                    {label(copy, state.collectibleShop)}
                  </label>
                ))}
              </fieldset>
              <button
                disabled={
                  disabled || !valid || state.credits < offer.requestedCredits
                }
                onClick={() =>
                  void action("marketplace.offer.accept", {
                    offerId: offer.id,
                    copyIds: selected,
                  })
                }
              >
                Accept barter
              </button>
            </>
          )}
          <button
            disabled={disabled}
            onClick={() =>
              void action(
                outgoing
                  ? "marketplace.offer.cancel"
                  : "marketplace.offer.reject",
                { offerId: offer.id },
              )
            }
          >
            {expired
              ? "Release expired offer"
              : outgoing
                ? "Cancel offer"
                : "Reject offer"}
          </button>
        </>
      )}
    </article>
  );
}
