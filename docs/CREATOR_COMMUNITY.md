# Creator community and shared drafts

A creator may grant up to 25 current accounts viewer or editor access to a project. Viewers can read/play an unpublished draft locally. Editors can save title, description, tags, category and level into a new immutable revision; the creator alone publishes, revokes grants and restores historical versions. Shared projects appear separately from owned projects and public discovery. Every save requires the current `expectedVersion`; concurrent saves serialize on the project and exactly one can commit. Failed saves retain the editor's unsaved work. The explicit **Reload latest revision** control replaces local fields only when selected. This is shared revision editing, not real-time merged editing or collaborative autosave.

Each grant/revocation/edit rechecks the current account and project permission under the same parent lock. Private drafts and version snapshots are withheld from outsiders. Editor/viewer workspace heartbeats show only a bounded current-open indication to project collaborators, suppressed for Invisible or disabled activity sharing; the creator's presence is not inferred. Revocation does not erase already downloaded bytes but immediately prevents subsequent reads/saves. Account deletion cascades grants.

## Community controls

Published levels support follows of their active creator, one current 1–5 difficulty rating per non-owner, and a once-per-account report with a bounded reason/details. Reports do not automatically hide/delete content. Administrators review or dismiss with a required note; retrying the same review is idempotent and creates one immutable audit entry. The admin review UI withholds unpublished titles and all level snapshots. Discovery supports followed creators and trending by distinct attempted accounts during the past seven days, with bounded search, categories and paging.

`completions` now counts distinct retained account IDs across every authored revision. Detail statistics separately show attempts, completed attempts, unique accounts across revisions, unique completions on the current revision, and the percentage of retained attempts completed. Completion percentage is an attempt-based statistic, not a player success probability; discarded/expired/failed attempts remain in its denominator. Account deletion removes that account's attempt/completion data, so these are retained-data totals rather than permanent anonymous lifetime aggregates. Existing cumulative unique play visits remain a separate `plays` value.

Speed rankings accept only completed, validated server attempts, pinned to both the current creation version and `CREATOR_RUNTIME_REVISION="creator-geometry-1"`. They select one best run per active account and rank by fixed simulation ticks, then deaths, returning at most 50 usernames. They never consume a browser score, claimed time, casual/local playtest or historical `legacy` attempt. A verified completion refreshes the detail statistics without restarting the attempt. Future incompatible mechanics must bump the shared runtime revision before accepting comparable ranked attempts.

## Routes

All routes require a signed-in account and normal JSON/Origin checks for mutations.

| Route under `/api/creations`        | Contract                                                                                               |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `GET /`                             | Owned, granted shared projects and bounded public discovery; optional `followed=true`, `sort=trending` |
| `GET /:id`                          | Published, owned or explicitly granted project only                                                    |
| `PATCH /:id`                        | Owner/editor; validated content and `expectedVersion`                                                  |
| `GET /:id/collaborators`            | Creator or explicit collaborator; usernames/permission/privacy-aware presence only                     |
| `POST /:id/collaborators`           | Creator; username and `viewer`/`editor` grant                                                          |
| `DELETE /:id/collaborators/:userId` | Creator revocation                                                                                     |
| `POST /:id/collaborators/presence`  | Explicit collaborator heartbeat; creator is not tracked                                                |
| `POST /:id/rating`                  | Published level; integer rating 1–5, non-owner                                                         |
| `POST /:id/report`                  | Published level; reason and details up to 1,000 characters; account report limits                      |
| `GET /:id/rankings`                 | Current published revision/runtime verified speed standings                                            |
| `GET /creators/:id`                 | Active creator's username, published count and follow metadata                                         |
| `POST /creators/:id/follow`         | Idempotent own follow/unfollow; self-follow denied                                                     |

`GET /api/admin/creator-reports` returns bounded report metadata. `POST /api/admin/creator-reports/:id` requires current administrator authority, `status=reviewed|dismissed`, and a 1–500 character note. Private account exports include own grants/follows/ratings/reports, with no other account's private draft content.

Migration `034_creator_community.sql` is additive and immutable. Eight focused real-PostgreSQL cases cover roles/private data, simultaneous save conflicts, revocation, privacy-aware presence, follows/ratings, concurrent report review/audit, cross-version unique totals/runtime rankings and account deletion. A two-account Chromium case covers sharing/editing, real conflict/reload, revocation and public community controls. Existing authoritative completion/browser checks also pass. Custom assets/thumbnails, Creator multiplayer and merged collaborative autosave remain unimplemented.
