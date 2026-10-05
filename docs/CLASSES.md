# Private Classes workspace

Classes is an authenticated school workspace. School rows never appear in game, profile, public search, chat or server payloads. Each class belongs to its creator. Resources are private unless their owner explicitly grants an existing user view or edit access. Folder grants cover the folder subtree. Sharing a note does not grant access to other files linked from it; every download independently checks the file's permissions.

## Working workflows

- Create, rename and recolor classes. Permanently delete a class only after typing `DELETE` followed by its current name. Deletion removes its private resources and sharing grants; upload keys enter a transactional cleanup outbox. Create nested folders; move resources between folders. The backend validates same-class membership and prevents folder cycles, including concurrent moves.
- Native Markdown notes support formatting tools, text editing, safe preview, headings, bold, italic, underline, semantic numbered/unordered lists, checkboxes, links, aligned tables, quotes, code and horizontal rules. KaTeX renders inline `$…$` and display `$$` math, including fractions, roots, matrices and scientific notation. Its untrusted mode prevents executable links/HTML; expansions, expression count and preview length are bounded. Existing Markdown remains source text. Ctrl/⌘ B/I/U formats selections, Ctrl/⌘ S saves and Ctrl/⌘ Shift P previews. Insert uploaded images through the note toolbar. Changes autosave after a pause, queue newer edits during a save, and attempt to flush on leaving the editor. Explicit save retries failed requests. Saved notes retain revision metadata and allow restoring prior versions.
- Create assignments with descriptions, work notes, due dates, status, priority, links and protected file attachments. The private planner filters open, upcoming, overdue, missing and completed work, sorts by deadline/priority/title and groups across classes and folders. Missing means past its deadline with work not started; overdue includes missing and in-progress work. Completion/deadline changes retain history. Dates are persisted in UTC and displayed locally. Trash and its descendants stay out of the planner.
- Edit flashcard decks (front/back/tags/optional uploaded image), flip cards, move forward/backward and select random cards. Switch to scheduled study for a private due queue and server-scheduled Again/Hard/Good/Easy reviews. All-card study remains available even when nothing is due.
- Edit quizzes with multiple choice, multi-select, true/false and short answer questions. Multi-select grading requires exactly the answer set, irrespective of order. Attempts randomize presentation while retaining original grading indices. Server grading normalizes short-answer case and whitespace, stores score and immutable question/answer breakdowns and allows retry. Your history preserves the quiz version and old questions after the quiz is edited. The quiz owner sees aggregate attempt/learner/average and current-version question-accuracy counts; other learners' individual answers and identities remain private. Shared viewers do not receive answer keys before submission; edit grantees can edit answer keys.
- Search only owned or explicitly shared school resources. Share/revoke individual resources using usernames and view/edit grants.
- Trash resources; only owners can restore, permanently remove them or change sharing. Folder trash hides descendants. Permanent folder deletion queues contained files for retryable physical cleanup. An explicit periodic worker removes resources after 30 days in trash, including descendants of expired folders; recent or restored trash is preserved.

## API

All JSON routes use the ordinary session, same-origin mutation checks, input validation and response envelope. Identity comes from the session.

| Route                                          | Behavior                                                                             |
| ---------------------------------------------- | ------------------------------------------------------------------------------------ |
| GET/POST `/api/classes`                        | Workspace overview / create class                                                    |
| GET `/api/classes/assignments`                 | Owned, non-trashed assignment planner, class and folder labels                       |
| POST `/api/classes/reminders`                  | Generate this account's due/overdue/study reminders with transactional deduplication |
| GET/PATCH/DELETE `/api/classes/:id`            | Owner's resources and trash / rename or recolor / typed-confirmation class deletion  |
| POST `/api/classes/:id/resources`              | Create native resource                                                               |
| GET `/api/classes/search?q=`                   | Permission-filtered private search                                                   |
| GET/PATCH/DELETE `/api/classes/resources/:id`  | Read / version-checked edit / trash                                                  |
| POST `…/:id/restore`                           | Owner restores trash                                                                 |
| DELETE `…/:id/permanent`                       | Owner permanently deletes                                                            |
| GET `…/:id/revisions`                          | Native note revision metadata                                                        |
| POST `…/:id/restore-revision`                  | Restore revision as a new version                                                    |
| POST/DELETE `…/:id/share[/userId]`             | Owner grants/revokes access                                                          |
| POST `…/:id/attempt`; GET `…/:id/attempts`     | Quiz grading / own score history                                                     |
| GET `…/:id/analytics`                          | Quiz owner aggregate analytics; no individual learner answers or IDs                 |
| GET `…/:id/history`                            | Assignment completion and deadline history, with ordinary resource permissions       |
| GET `…/:id/study`; POST `…/:id/study/review`   | Own due queue / token- and version-checked grade                                     |
| GET `…/:id/study/stats`; GET `…/study/history` | Own deck/per-card statistics and newest-first review events                          |
| POST `/api/classes/files/upload`               | Multipart `file`, `classId`, optional `parentId`                                     |
| GET `/api/classes/files/:resourceId`           | Authenticated attachment download                                                    |

Edits require `expectedVersion`; competing edits return 409 rather than silently overwriting. Reload a conflicting resource before editing again.

## Private storage

`STORAGE_PROVIDER=local` is the default. `STORAGE_LOCAL_PATH` defaults to `/workspace/tell-aviv-data/uploads`, outside the executable checkout. `APP_ROOT` can explicitly name the checkout; otherwise the provider locates the workspace root from its working directory. Upload keys are generated UUIDs, files have private permissions, path traversal and symlink-file reads are rejected. No storage key or raw public URL appears in file API payloads.

The default file limit is 20 MiB (`MAX_FILE_BYTES`, with `MAX_UPLOAD_BYTES` as a compatibility alias). The default per-user quota is 2 GiB (`STORAGE_QUOTA_BYTES`), with administrator overrides. School files, trash and chat uploads share one quota and reservation lock. File extension, MIME, size and content signatures are checked; Office ZIP containers must contain their expected document parts and cannot carry VBA projects. Allowed formats: PDF, DOCX, PPTX, XLSX, CSV, TXT, PNG, JPG/JPEG, WEBP, GIF, MP3, WAV, WebM and MP4/M4A. HTML, SVG and executable uploads are excluded. Downloads set `nosniff`, attachment disposition and private/no-store caching.

Optional S3-compatible storage uses `STORAGE_PROVIDER=s3`, `S3_ENDPOINT` (HTTPS), `S3_BUCKET`, `S3_REGION`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` and optional `S3_SESSION_TOKEN`. Standard AWS credential variable names are accepted as fallback. Requests use SigV4; redirects and failed TLS verification are not bypassed. S3 was implemented but not exercised against a live service in this pass.

## Private scheduled study

Spaced repetition stores each learner's progress separately from deck content. A deck owner or another recipient cannot read someone else's review counts, due dates or tokens. View permission to the current deck is required on every queue read and review, including inherited folder grants. Revoking sharing blocks both operations. Progress is included only in that learner's account export, and resource/account deletion cascades its schedule rows.

Card identity fingerprints the front, back and uploaded-image reference, with an occurrence counter for identical duplicates. Reordering and tag-only changes preserve progress. Changing learning content gives that card a new schedule; removed-card schedules are discarded on that learner's next study operation. Cards begin due immediately. The bounded scheduling heuristic uses Again at one minute, Hard initially ten minutes, Good initially one day and Easy initially four days, then grows successful intervals up to one year. This is a simple scheduling heuristic, not a claim of SM-2 or optimal recall prediction.

Every accepted review also writes a chronological private event in the same transaction. Events snapshot the reviewed question/answer and retain the rating, next interval and due date, including after deck edits. History reads are paginated by timestamp and UUID, optionally filtered by card key. Statistics count Good/Easy responses as successful self-reports; mastery means three consecutive non-Again reviews with an interval of at least seven days. A card can be edited directly from scheduled review when the learner has edit permission. Front/back/image changes reset that card's schedule while keeping past events; all-card mode supports question/answer/tag search and deck statistics.

Assignment reminders cover owned work due within 24 hours or overdue; flashcard reminders cover the learner's initialized, currently accessible due schedules. Notification claims and inbox insertion commit together, using the assignment deadline or UTC review day as the deduplication cycle. Concurrent worker/UI runs do not duplicate them. Completed, trashed, revoked and disabled-account content is excluded; `settings.notifications.school=false` disables future delivery. Events target only the recipient's private notification room. Check reminders in Classes triggers delivery for the current account; a trusted operations worker can call `generateSchoolReminders(userId)` for scheduled delivery. No email, push or public school activity is generated.

A due queue contains at most 20 cards at once, with a count of all due cards and a next-due date. Grades accept only a server-issued card key, expiring review token, current review version and rating. They never accept client timestamps, intervals, review counts or learner identities. Single-use tokens, due-time checks and row locks reject stale/double grades. The UI requires revealing the answer before showing active rating controls; the server cannot prove whether a learner actually recalled it. Reviews award no public achievements, XP or currency.

## Retention and file cleanup

Schedule `pnpm exec tsx --env-file=.env scripts/school-trash-cleanup.ts` in a trusted operations scheduler. Each run purges at most 500 expired trash roots and attempts up to 500 storage cleanup jobs. It is not exposed as a user-callable global purge endpoint and has not been run against all users during tests. Metadata deletion and outbox insertion commit together; physical storage failure does not leave a class half deleted and queued keys remain retryable. Deleted trash still occupies physical storage until the worker succeeds.

Restoration, uploads, folder moves and deletion serialize through a class lock. Retention rechecks expiration after taking the lock, so a completed restoration is preserved. Class and subtree deletion never transfer private data to recipients. The worker may delete current descendants of an expired folder even if those descendants do not have their own deletion timestamps.

## Exact remaining work

The Markdown preview remains a bounded safe renderer rather than a complete CommonMark engine; deeply nested lists and nested inline formatting are limited. No in-browser Office/PDF editing, DOC/PPT/XLS legacy binaries, user/friend/server group grants or public publishing of school work is implemented. There is no calendar UI, adaptive recall model, email/push reminder delivery or teacher access to individual private learner answers. Study intervals remain a simple heuristic. Native revision/review retention is currently unbounded, malware scanning needs an operational service, and autosave cannot guarantee delivery if the browser/network disappears before the request finishes.

Validation: `tests/classes-models.test.ts` exercises strict schemas, no executable fields, safe links and grading. `tests/storage.test.ts` covers file validation, signatures, private local round-trips and key traversal rejection. `tests/flashcard-study.test.ts` covers fingerprint stability and bounded intervals; the isolated real-database `tests/flashcard-study-database.test.ts` covers permissions, per-learner privacy, schedule injection, replay/concurrency, edits, expiry and revocation. `tests/e2e/flashcard-study.spec.ts` verifies primary review and persisted due state in the browser. The real-database `tests/classes-retention.test.ts` covers ownership, typed-confirmation rollback, scoped retention, file outbox insertion, restoration races and flashcard image permissions. `tests/e2e/class-management.spec.ts` covers browser rename and confirmed deletion. End-to-end session/permission checks are covered by the main integration validation.
