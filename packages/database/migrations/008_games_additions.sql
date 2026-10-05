CREATE TABLE IF NOT EXISTS casino_loans (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  principal bigint NOT NULL DEFAULT 0 CHECK(principal >= 0 AND principal <= 1000),
  borrowed_at timestamptz,
  last_borrowed_at timestamptz
);
CREATE TABLE IF NOT EXISTS casino_collectible_stock (
  item_id text PRIMARY KEY,
  issued integer NOT NULL DEFAULT 0 CHECK(issued >= 0),
  supply integer NOT NULL CHECK(supply > 0 AND issued <= supply),
  price integer NOT NULL CHECK(price > 0)
);
INSERT INTO casino_collectible_stock(item_id,supply,price) VALUES
 ('velvet-joker',100,200),('moon-chip',50,400),('glass-die',25,800)
ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS casino_collectibles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  item_id text NOT NULL REFERENCES casino_collectible_stock(item_id),
  serial integer NOT NULL CHECK(serial > 0),
  acquired_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(item_id,serial)
);
CREATE INDEX IF NOT EXISTS casino_collectibles_owner ON casino_collectibles(user_id);
CREATE TABLE IF NOT EXISTS casino_marketplace (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  collectible_id uuid NOT NULL REFERENCES casino_collectibles(id) ON DELETE CASCADE,
  seller_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  buyer_id uuid REFERENCES users(id) ON DELETE SET NULL,
  price integer NOT NULL CHECK(price BETWEEN 1 AND 100000),
  status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','sold','cancelled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  settled_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS casino_one_listing ON casino_marketplace(collectible_id) WHERE status='active';
CREATE INDEX IF NOT EXISTS casino_market_active ON casino_marketplace(created_at DESC) WHERE status='active';
