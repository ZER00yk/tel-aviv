# Encrypted backup envelopes and destination copies

The ordinary v2 backup remains a PostgreSQL exported snapshot plus exactly the upload files listed in its SHA-256 manifest. `scripts/backup.ts` and the scheduled worker now record verified snapshot metadata, and can additionally create an authenticated encrypted envelope and a verified destination copy. They never overwrite or delete existing snapshots. A malformed key/destination configuration fails before a new snapshot is created.

The optional envelope uses AES-256-GCM with a random 96-bit nonce and 128-bit authentication tag. The version, algorithm, nonce and creation time form authenticated header data. A streaming framed payload contains the original manifest, dump and uploads; it accepts only fixed dump/manifest names and generated UUID upload names. Duplicate names, traversal, symlinks, unlisted files, size limits and changed source bytes abort completion. Encryption is bounded by an operator API byte limit (256 GiB by default) and does not load the complete backup into memory.

Decryption first streams into a private scratch file and finishes GCM authentication. Only then does it parse members, verify every SHA-256/size and the exact v2 member set, and publish a newly generated snapshot directory. Wrong keys, truncation and altered headers/ciphertext/tags publish nothing and remove their scratch files. Plaintext staging requires disk space approximately equal to the snapshot; a process crash can leave a private `.decrypting-*` directory for deliberate operator cleanup. There is no HTTP encryption, decryption or restore endpoint.

## Operator configuration

| Variable                     | Behavior                                                                                                                                                                                |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `BACKUP_ENCRYPTION_KEY_FILE` | Optional absolute path to a raw, exactly 32-byte key in a regular file with no group/world permission bits. Rejects symlinks and keys inside source, local backup or destination trees. |
| `BACKUP_DESTINATION_PATH`    | Optional separately administered mounted directory. Requires encryption and must be outside the local snapshot tree. Only encrypted envelopes are transferred.                          |

For Compose, explicitly mount the key read-only outside `/data/backups` and `/data/uploads`, mount the destination separately, and pass both variables to the `operations` service; the default recipe does not assume these mounts exist.

Supply the key through your secret manager or create it with a cryptographic random generator under a private operator directory. Keep the key out of source archives, manifests, SQL state and backup destinations. The app records ciphertext checksums and aggregate counts, never the key bytes or key path. Preserve old keys separately when rotating to a new key file: older envelopes still require their original key, and filenames do not embed a key identifier. Encryption leaves the original plaintext snapshot intact; its private filesystem and retention remain operator responsibilities.

Create a fresh backup with optional encryption/destination settings already configured:

```sh
pnpm exec tsx --env-file=.env scripts/backup.ts
```

Encrypt an existing verified v2 snapshot into a separate private output root, or decrypt an envelope into a new root:

```sh
pnpm exec tsx --env-file=.env scripts/backup-envelope.ts encrypt /private/snapshot /private/encrypted
pnpm exec tsx --env-file=.env scripts/backup-envelope.ts decrypt /private/encrypted/tell-aviv-envelope-UUID.tae /private/restore-staging
```

Use the resulting verified directory with the existing empty-database restore or isolated drill. Restore still requires an explicit empty `RESTORE_DATABASE_URL`, a new/empty `RESTORE_UPLOAD_PATH` and `--confirm-restore`; it never chooses the application database by default.

```sh
pnpm exec tsx --env-file=.env scripts/verify-backup.ts /private/restore-staging/tell-aviv-decrypted-UUID
pnpm exec tsx --env-file=.env scripts/restore.ts /private/restore-staging/tell-aviv-decrypted-UUID --confirm-restore
```

The `BackupDestination` interface supports upload and retrieval with a supplied SHA-256. Its filesystem implementation streams to a private temporary file, verifies the checksum, publishes with an exclusive link and rechecks the published file. Existing destination names cannot be overwritten. A mounted off-host volume can implement separation from the application host; merely selecting a second local directory does not prove that separation.

```sh
pnpm exec tsx --env-file=.env scripts/backup-transfer.ts put tell-aviv-envelope-UUID.tae /private/envelope.tae SHA256
pnpm exec tsx --env-file=.env scripts/backup-transfer.ts get tell-aviv-envelope-UUID.tae /private/retrieved.tae SHA256
```

The existing dry-run/default plaintext rotation still verifies owned complete snapshots and keeps the minimum count. Encrypted envelopes and external destination copies are deliberately excluded from that deletion sweep. Configure their retention and versioning with the destination operator, retaining both envelopes and the corresponding protected keys until restore drills succeed. A destination failure is reported as a failed protected-backup task; the completed local snapshot remains available and visible, and the next scheduled attempt retries the configured workflow.

## Status and verification scope

Administrator health now displays the latest checksum-verified snapshot, its age and upload count, the last encrypted envelope, the last verified destination copy and the last successful isolated restore drill and applied plaintext retention counts. These are independently timestamped receipts, so a new local snapshot does not imply that a previous destination copy contains that snapshot. Raw maintenance state is projected to safe status/time/failure metadata; filesystem paths, object keys, private payloads and provider credentials are excluded.

The isolated fixtures cover exact binary/manifest round trips, independent random envelopes, wrong keys, header/ciphertext/tag tampering, truncation, private key boundaries, missing/unlisted uploads, byte limits, symlink/traversal rejection, destination read-back checksums, non-overwrite behavior and concurrent SQL metadata merges. They create only private temporary fixture trees and a uniquely named status row. No real off-host target, external secret manager, remote retention/lifecycle, deployed scheduler or encrypted production restore is claimed verified by these fixtures.
