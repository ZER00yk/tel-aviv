CREATE INDEX creations_public_discovery ON creations(category,updated_at DESC,id) WHERE published=true;
CREATE INDEX creation_comments_user_rate ON creation_comments(user_id,created_at DESC);
