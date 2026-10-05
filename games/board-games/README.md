# Board game collection

The existing Four in a Row now shares one host with American checkers and chess. A board selector opens local pass-and-play or a shallow local opponent, or creates an authenticated two-player room through the same lobby/readiness/recovery protocol. The catalog identity and original Four in a Row saves remain compatible.

## Rules

Four in a Row retains legal drops, horizontal/vertical/diagonal wins and its win/block local tactician.

American checkers uses twelve men per side on an eight-by-eight board. Captures are mandatory; a multi-jump continues with the same piece. Men move and capture forward, kings move one diagonal step or jump in either direction, and reaching the promotion row ends that turn. Losing all legal moves loses the game. Three repeated complete positions or forty quiet king moves per side produce a draw. Its bounded local opponent prefers captures, promotion and avoiding immediate replies.

Chess uses `chess.js` 1.4 rules for king safety, legal castling, en passant, promotion/underpromotion, checkmate, stalemate, insufficient material, repetition and the fifty-move rule. A promotion selector supports queen, rook, bishop or knight. Its local opponent uses shallow material evaluation with a small time/node budget; it is deliberately weak. It is not an engine-analysis feature.

Click a piece and a highlighted destination. Keyboard arrows move grid focus and Enter/Space selects a square. Labels identify every square and piece. Checkers' forced chain and chess check status are visible. Chess move history uses SAN. Mobile boards fit the viewport. Pausing local play or controls does not pause an opponent's network turn.

## Shared authoritative host

`host.ts` defines the variant registry and common create/action/public-view contract. Realtime integrates `chess` and `checkers` alongside the legacy `connect-four` ID, while catalog availability maps all three to `board-games`. Neither variant duplicates matchmaking, account authorization, Redis locks, SQL snapshots, readiness, host ownership or result recording.

The browser submits only `board:move` with bounded square names and optional legal promotion, or a resign/draw/decline command. The server checks membership, turn order and the rules. Draw agreements require two different players. The browser cannot submit a score or final result. Authoritative outcomes record once through the existing multiplayer tables, with no platform currency or ranked award.

Checkers saves a bounded structured position. Chess saves an initial FEN, validated coordinate move history and its current FEN; reconstruction replays the moves to retain repetition and castling/en-passant history rather than treating every turn as a new position. Per-player views provide legal destinations for the current player only. The existing durable lobby snapshots restore matches after process/Redis loss. Reopening the board play page actively recovers membership and selects the room's variant.

## Verification and remaining scope

Ten host/rule tests cover forced multi-jumps, promotion, kings, captures, repetition, forged fields, wrong turns, castling through check, en passant, underpromotion, checkmate, JSON checkpoint reconstruction, draw agreements, resignations and the common lobby outcome pipeline. Existing Four in a Row tests stay passing. An authenticated wire case plays a chess checkmate and forced checkers capture and verifies results are recorded once. Two-account Chromium cases exercise both games, shared pieces/results and a checkers reload.

Local chess/checkers positions are not cloud-saved; legacy Four in a Row win counters remain its own casual statistics. Clocks, analysis/undo, stronger AI, spectator UI, chess tournaments and dedicated ranked board seasons are not implemented. Chess caps games at 512 plies to keep reconstruction bounded. There is no correspondence scheduling or new-player mid-game joining.
