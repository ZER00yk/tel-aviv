CREATE TABLE matchmaking_tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  namespace text NOT NULL,
  leader_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  party_id uuid REFERENCES parties(id) ON DELETE SET NULL,
  game_id text NOT NULL,
  region text NOT NULL CHECK(region IN ('global','americas','europe','asia-pacific')),
  mode text NOT NULL CHECK(mode='casual'),
  coop_mode text NOT NULL CHECK(coop_mode IN ('gauntlet','campaign')),
  status text NOT NULL DEFAULT 'waiting' CHECK(status IN ('waiting','matching','matched','playing','completed','cancelled','expired','failed')),
  lobby_code text,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  matched_at timestamptz,
  ready_deadline timestamptz,
  closed_at timestamptz,
  UNIQUE(id,namespace)
);
CREATE INDEX matchmaking_waiting ON matchmaking_tickets(namespace,status,game_id,region,mode,coop_mode,created_at);
CREATE INDEX matchmaking_lobby ON matchmaking_tickets(namespace,lobby_code) WHERE lobby_code IS NOT NULL;
CREATE TABLE matchmaking_members (
  ticket_id uuid NOT NULL,
  namespace text NOT NULL,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  active boolean NOT NULL DEFAULT true,
  joined_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(ticket_id,user_id),
  FOREIGN KEY(ticket_id,namespace) REFERENCES matchmaking_tickets(id,namespace) ON DELETE CASCADE
);
CREATE UNIQUE INDEX matchmaking_one_active ON matchmaking_members(namespace,user_id) WHERE active;
CREATE INDEX matchmaking_member_history ON matchmaking_members(namespace,user_id,joined_at DESC);
