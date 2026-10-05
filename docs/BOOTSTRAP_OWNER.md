# First native owner bootstrap

Native registrations always create ordinary user accounts. The web application never makes its first registrant an administrator. An operator with database access can establish the first owner through a host-only tool after creating a native account and confirming its immutable UUID from the authenticated `/api/me` response.

From the repository, with `DATABASE_URL` securely configured:

```sh
node --env-file=.env --import tsx scripts/bootstrap-owner.ts <existing-account-uuid>
```

This previews the target and exact confirmation without changing its role. To apply that reviewed target:

```sh
node --env-file=.env --import tsx scripts/bootstrap-owner.ts <existing-account-uuid> --confirm 'BOOTSTRAP OWNER <same-account-uuid>'
```

Use the real UUID in both positions. The tool requires an active account with native Argon2id credentials, preserves its UUID and owned data, and serializes bootstrap attempts. A different existing owner, including a disabled owner, prevents bootstrap; replacement requires separately authorized administration. Repeating the same successful target leaves its role and audit unchanged. One immutable `owner.bootstrap` audit records the successful first promotion. No default password, recovery token, email value or password hash is printed. There is no HTTP bootstrap endpoint.

Five real-PostgreSQL cases use isolated fixture schemas copied from the current public table contracts. They cover dry-run/confirmation, once-only promotion/audit, competing native accounts, disabled existing-owner protection and missing/disabled/non-native targets. They never modify a real account or remove public audit evidence. This tooling was fixture-tested; no live owner promotion was performed during this continuation.
