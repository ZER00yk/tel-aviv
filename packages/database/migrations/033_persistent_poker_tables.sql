-- Opt-in persistent private poker; legacy one-hand escrow is unchanged.
CREATE TABLE casino_poker_tables (
 id uuid PRIMARY KEY,
 namespace varchar(100) NOT NULL,
 lobby_code varchar(8) NOT NULL,
 minimum_buy_in integer NOT NULL CHECK(minimum_buy_in BETWEEN 100 AND 10000),
 maximum_buy_in integer NOT NULL CHECK(maximum_buy_in BETWEEN minimum_buy_in AND 10000),
 status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','closed')),
 hand_number integer NOT NULL DEFAULT 0 CHECK(hand_number BETWEEN 0 AND 10000),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 closed_at timestamptz
);
CREATE UNIQUE INDEX casino_poker_active_table_code ON casino_poker_tables(namespace,lobby_code) WHERE status='active';
CREATE TABLE casino_poker_table_seats (
 table_id uuid NOT NULL REFERENCES casino_poker_tables(id) ON DELETE CASCADE,
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 username text NOT NULL,
 stack integer NOT NULL CHECK(stack BETWEEN 0 AND 60000),
 buy_in_total integer NOT NULL DEFAULT 0 CHECK(buy_in_total>=0),
 status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','left')),
 sitting_out boolean NOT NULL DEFAULT false,
 pending_leave boolean NOT NULL DEFAULT false,
 leave_request_id uuid,
 PRIMARY KEY(table_id,user_id)
);
CREATE UNIQUE INDEX casino_poker_one_active_table ON casino_poker_table_seats(user_id) WHERE status='active';
CREATE TABLE casino_poker_table_operations (
 request_id uuid PRIMARY KEY,
 table_id uuid NOT NULL REFERENCES casino_poker_tables(id) ON DELETE CASCADE,
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 digest text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE casino_poker_table_hands (
 match_id uuid PRIMARY KEY,
 table_id uuid NOT NULL REFERENCES casino_poker_tables(id) ON DELETE CASCADE,
 hand_number integer NOT NULL CHECK(hand_number BETWEEN 1 AND 10000),
 status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','settled','refunded')),
 last_revision bigint NOT NULL DEFAULT -1,
 state_digest text NOT NULL DEFAULT '',
 public_summary jsonb NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(public_summary)='object'),
 started_at timestamptz NOT NULL DEFAULT now(),
 settled_at timestamptz,
 UNIQUE(table_id,hand_number)
);
CREATE UNIQUE INDEX casino_poker_table_one_active_hand ON casino_poker_table_hands(table_id) WHERE status='active';
CREATE TABLE casino_poker_table_hand_seats (
 match_id uuid NOT NULL REFERENCES casino_poker_table_hands(match_id) ON DELETE CASCADE,
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 starting_stack integer NOT NULL CHECK(starting_stack BETWEEN 1 AND 60000),
 final_stack integer CHECK(final_stack BETWEEN 0 AND 60000),
 own_cards jsonb NOT NULL CHECK(jsonb_typeof(own_cards)='array' AND jsonb_array_length(own_cards)=2),
 PRIMARY KEY(match_id,user_id)
);
CREATE TABLE casino_poker_table_journal (
 match_id uuid NOT NULL REFERENCES casino_poker_table_hands(match_id) ON DELETE CASCADE,
 revision bigint NOT NULL,
 phase text NOT NULL CHECK(phase IN ('betting','settled','cancelled')),
 financial_state jsonb NOT NULL CHECK(jsonb_typeof(financial_state)='object'),
 action_log jsonb NOT NULL CHECK(jsonb_typeof(action_log)='array'),
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(match_id,revision)
);
CREATE UNIQUE INDEX casino_poker_table_wallet_once ON currency_ledger(user_id,reference_id,reason) WHERE reason IN ('persistent poker buy-in','persistent poker leave','persistent poker close','persistent poker abort refund');
-- Account deletion restores the current hand's starting stacks, preserving
-- already committed earlier hands, then returns surviving fictional balances.
CREATE OR REPLACE FUNCTION casino_abort_deleted_poker_table_player() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE tab record; hand record; seat record; current_balance bigint;
BEGIN
 FOR tab IN SELECT t.* FROM casino_poker_tables t JOIN casino_poker_table_seats s ON s.table_id=t.id WHERE s.user_id=OLD.id AND s.status='active' AND t.status='active' ORDER BY t.id FOR UPDATE OF t LOOP
  FOR hand IN SELECT * FROM casino_poker_table_hands WHERE table_id=tab.id AND status='active' FOR UPDATE LOOP
   UPDATE casino_poker_table_seats s SET stack=h.starting_stack FROM casino_poker_table_hand_seats h WHERE h.match_id=hand.match_id AND h.user_id=s.user_id AND s.table_id=tab.id AND s.status='active';
   UPDATE casino_poker_table_hands SET status='refunded',settled_at=now(),public_summary=jsonb_build_object('reason','A participant account was removed') WHERE match_id=hand.match_id;
  END LOOP;
  FOR seat IN SELECT * FROM casino_poker_table_seats WHERE table_id=tab.id AND status='active' ORDER BY user_id FOR UPDATE LOOP
   IF seat.user_id<>OLD.id AND seat.stack>0 THEN
    UPDATE currency_accounts SET balance=balance+seat.stack WHERE user_id=seat.user_id AND currency='casino-credits' RETURNING balance INTO current_balance;
    IF FOUND THEN INSERT INTO currency_ledger(user_id,currency,amount,balance_after,reason,reference_id) VALUES(seat.user_id,'casino-credits',seat.stack,current_balance,'persistent poker abort refund',tab.id::text); END IF;
   END IF;
   UPDATE casino_poker_table_seats SET stack=0,status='left',pending_leave=false WHERE table_id=tab.id AND user_id=seat.user_id;
  END LOOP;
  UPDATE casino_poker_tables SET status='closed',closed_at=now(),updated_at=now() WHERE id=tab.id;
 END LOOP;
 RETURN OLD;
END $$;
CREATE TRIGGER casino_poker_table_player_erased BEFORE DELETE ON users FOR EACH ROW EXECUTE FUNCTION casino_abort_deleted_poker_table_player();
