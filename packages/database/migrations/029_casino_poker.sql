CREATE TABLE IF NOT EXISTS casino_poker_hands (
 match_id uuid PRIMARY KEY,
 namespace varchar(100) NOT NULL,
 lobby_code varchar(8) NOT NULL,
 buy_in integer NOT NULL CHECK(buy_in BETWEEN 100 AND 10000),
 status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','settled','refunded')),
 last_revision integer NOT NULL DEFAULT -1,
 state_digest text NOT NULL DEFAULT '',
 public_summary jsonb NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(public_summary)='object'),
 started_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 settled_at timestamptz
);
CREATE TABLE IF NOT EXISTS casino_poker_escrows (
 match_id uuid NOT NULL REFERENCES casino_poker_hands(match_id) ON DELETE CASCADE,
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 username text NOT NULL,
 amount integer NOT NULL CHECK(amount BETWEEN 100 AND 10000),
 payout integer CHECK(payout BETWEEN 0 AND 60000),
 status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','settled','refunded')),
 own_cards jsonb NOT NULL DEFAULT '[]'::jsonb CHECK(jsonb_typeof(own_cards)='array' AND jsonb_array_length(own_cards)<=2),
 PRIMARY KEY(match_id,user_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS casino_poker_one_active_hand ON casino_poker_escrows(user_id) WHERE status='active';
CREATE TABLE IF NOT EXISTS casino_poker_chip_journal (
 match_id uuid NOT NULL REFERENCES casino_poker_hands(match_id) ON DELETE CASCADE,
 revision integer NOT NULL,
 phase text NOT NULL,
 financial_state jsonb NOT NULL CHECK(jsonb_typeof(financial_state)='object'),
 action_log jsonb NOT NULL CHECK(jsonb_typeof(action_log)='array'),
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(match_id,revision)
);
CREATE UNIQUE INDEX IF NOT EXISTS casino_poker_wallet_once ON currency_ledger(user_id,reference_id,reason) WHERE reason IN ('multiplayer poker buy-in','multiplayer poker cash-out','multiplayer poker abort refund');
-- Financial escrow survives checkpoint invalidation; erasing one participant
-- returns the original buy-ins to the remaining participants before cascading.
CREATE OR REPLACE FUNCTION casino_abort_deleted_poker_player() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE hand record; seat record; current_balance bigint;
BEGIN
 FOR hand IN SELECT h.* FROM casino_poker_hands h JOIN casino_poker_escrows e ON e.match_id=h.match_id WHERE e.user_id=OLD.id AND h.status='active' ORDER BY h.match_id FOR UPDATE OF h LOOP
  FOR seat IN SELECT * FROM casino_poker_escrows WHERE match_id=hand.match_id AND status='active' ORDER BY user_id FOR UPDATE LOOP
   IF seat.user_id<>OLD.id THEN
    UPDATE currency_accounts SET balance=balance+seat.amount WHERE user_id=seat.user_id AND currency='casino-credits' RETURNING balance INTO current_balance;
    IF FOUND THEN INSERT INTO currency_ledger(user_id,currency,amount,balance_after,reason,reference_id) VALUES(seat.user_id,'casino-credits',seat.amount,current_balance,'multiplayer poker abort refund',hand.match_id::text); END IF;
   END IF;
   UPDATE casino_poker_escrows SET status='refunded',payout=amount WHERE match_id=hand.match_id AND user_id=seat.user_id;
  END LOOP;
  UPDATE casino_poker_hands SET status='refunded',settled_at=now(),public_summary=jsonb_build_object('reason','A participant account was removed') WHERE match_id=hand.match_id;
 END LOOP;
 RETURN OLD;
END $$;
DROP TRIGGER IF EXISTS casino_poker_player_erased ON users;
CREATE TRIGGER casino_poker_player_erased BEFORE DELETE ON users FOR EACH ROW EXECUTE FUNCTION casino_abort_deleted_poker_player();
