-- Preserve collaborators' revision snapshots when the editor removes their account.
ALTER TABLE school_revisions ALTER COLUMN editor_id DROP NOT NULL;
ALTER TABLE school_revisions DROP CONSTRAINT school_revisions_editor_id_fkey;
ALTER TABLE school_revisions ADD CONSTRAINT school_revisions_editor_id_fkey FOREIGN KEY(editor_id) REFERENCES users(id) ON DELETE SET NULL;
