CREATE TABLE IF NOT EXISTS casino_trade_offers (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 sender_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 recipient_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 offered_credits bigint NOT NULL DEFAULT 0 CHECK(offered_credits BETWEEN 0 AND 100000),
 requested_credits bigint NOT NULL DEFAULT 0 CHECK(requested_credits BETWEEN 0 AND 100000),
 requested_items jsonb NOT NULL DEFAULT '[]'::jsonb CHECK(jsonb_typeof(requested_items)='array' AND jsonb_array_length(requested_items)<=5),
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','accepted','rejected','cancelled','expired')),
 created_at timestamptz NOT NULL DEFAULT now(),
 expires_at timestamptz NOT NULL DEFAULT now()+interval '24 hours',
 settled_at timestamptz,
 CHECK(sender_id<>recipient_id), CHECK(expires_at>created_at)
);
CREATE INDEX IF NOT EXISTS casino_offers_incoming ON casino_trade_offers(recipient_id,created_at DESC);
CREATE INDEX IF NOT EXISTS casino_offers_outgoing ON casino_trade_offers(sender_id,created_at DESC);
CREATE TABLE IF NOT EXISTS casino_offer_items (
 offer_id uuid NOT NULL REFERENCES casino_trade_offers(id) ON DELETE CASCADE,
 collectible_id uuid REFERENCES casino_collectibles(id) ON DELETE SET NULL,
 item_id text NOT NULL,
 serial integer NOT NULL,
 PRIMARY KEY(offer_id,item_id,serial)
);
CREATE TABLE IF NOT EXISTS casino_collectible_reservations (
 collectible_id uuid PRIMARY KEY REFERENCES casino_collectibles(id) ON DELETE CASCADE,
 offer_id uuid NOT NULL REFERENCES casino_trade_offers(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS casino_offer_reservations ON casino_collectible_reservations(offer_id);
CREATE TABLE IF NOT EXISTS casino_market_operations (
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 operation_id uuid NOT NULL,
 action text NOT NULL,
 payload_digest text NOT NULL,
 result jsonb NOT NULL CHECK(jsonb_typeof(result)='object'),
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(user_id,operation_id)
);
CREATE TABLE IF NOT EXISTS casino_trade_history (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 kind text NOT NULL CHECK(kind IN ('gift','marketplace','barter')),
 reference_id uuid NOT NULL UNIQUE,
 sender_id uuid REFERENCES users(id) ON DELETE SET NULL,
 recipient_id uuid REFERENCES users(id) ON DELETE SET NULL,
 sender_username text NOT NULL,
 recipient_username text NOT NULL,
 offered_credits bigint NOT NULL DEFAULT 0,
 requested_credits bigint NOT NULL DEFAULT 0,
 offered_items jsonb NOT NULL DEFAULT '[]'::jsonb,
 requested_items jsonb NOT NULL DEFAULT '[]'::jsonb,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS casino_trade_history_sender ON casino_trade_history(sender_id,created_at DESC);
CREATE INDEX IF NOT EXISTS casino_trade_history_recipient ON casino_trade_history(recipient_id,created_at DESC);
-- Deleting a recipient must not destroy another account's reserved Credits.
-- This also protects maintenance/manual account deletion outside the HTTP handler.
CREATE OR REPLACE FUNCTION casino_refund_deleted_recipient() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE trade record; current_balance bigint;
BEGIN
 FOR trade IN SELECT * FROM casino_trade_offers WHERE recipient_id=OLD.id AND status='pending' ORDER BY id FOR UPDATE LOOP
  IF trade.offered_credits>0 THEN
   UPDATE currency_accounts SET balance=balance+trade.offered_credits WHERE user_id=trade.sender_id AND currency='casino-credits' RETURNING balance INTO current_balance;
   IF FOUND THEN
    INSERT INTO currency_ledger(user_id,currency,amount,balance_after,reason,reference_id) VALUES(trade.sender_id,'casino-credits',trade.offered_credits,current_balance,'offer escrow refund: recipient removed',trade.id::text);
   END IF;
  END IF;
  UPDATE casino_trade_offers SET status='cancelled',settled_at=now() WHERE id=trade.id;
  DELETE FROM casino_collectible_reservations WHERE offer_id=trade.id;
 END LOOP;
 RETURN OLD;
END $$;
DROP TRIGGER IF EXISTS casino_recipient_refund ON users;
CREATE TRIGGER casino_recipient_refund BEFORE DELETE ON users FOR EACH ROW EXECUTE FUNCTION casino_refund_deleted_recipient();
