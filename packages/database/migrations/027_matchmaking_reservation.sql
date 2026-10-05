ALTER TABLE matchmaking_tickets
  ADD COLUMN party_queued boolean NOT NULL DEFAULT false,
  ADD COLUMN member_count integer NOT NULL DEFAULT 1 CHECK(member_count BETWEEN 1 AND 12);
UPDATE matchmaking_tickets t SET
  member_count=greatest(1,(SELECT count(*)::integer FROM matchmaking_members m WHERE m.ticket_id=t.id)),
  party_queued=t.party_id IS NOT NULL OR (SELECT count(*) FROM matchmaking_members m WHERE m.ticket_id=t.id)>1;
