import { randomInt, randomUUID } from "node:crypto";
import { z } from "zod";
import {
  createDefenseState,
  applyDefenseAction,
  tickDefense,
  defenseView,
  DefenseRuleError,
  type DefenseState,
} from "../../../games/tower-defense/authority";
import {
  applyCoopAction,
  createCoopState,
  tickCoop,
  coopView,
  CoopRuleError,
  type CoopState,
} from "../../../games/ego-trip/coop-engine";

import {
  applyBoardGameAction,
  createBoardGame,
  boardGameView,
  type BoardGameState,
} from "../../../games/board-games/host";
import { BoardRuleError } from "../../../games/board-games/checkers";

import {
  createPokerState,
  createPersistentPokerHand,
  pokerBlinds,
  applyPokerAction,
  publicPokerTable,
  tickPokerState,
  PokerRuleError,
  type PokerState,
} from "../../../games/casino/multiplayer-poker";

export const multiplayerGameIds = [
  "connect-four",
  "checkers",
  "chess",
  "poker",
  "trivia",
  "reaction",
  "drawing",
  "social-deduction",
  "ego-trip",
  "tower-defense",
] as const;
export type MultiplayerGameId = (typeof multiplayerGameIds)[number];
export interface Player {
  id: string;
  username: string;
  ready: boolean;
  connected: boolean;
  disconnectedAt?: number;
}
export interface Lobby {
  code: string;
  matchId: string;
  gameId: MultiplayerGameId;
  hostId: string;
  visibility: "public" | "private";
  status: "waiting" | "playing" | "finished";
  players: Player[];
  createdAt: number;
  startedAt?: number;
  state: GameState | null;
  recorded?: boolean;
  coopMode?: "gauntlet" | "campaign";
  recoveryPausedAt?: number;
  queueTicketIds?: string[];
  pokerBuyIn?: number;
  pokerDealerIndex?: number;
  pokerTable?: import("../../../packages/platform/src/casinoPokerTables").PersistentPokerTable;
}
interface Result {
  winners: string[];
  scores: Record<string, number>;
  reason: string;
}
interface BaseState {
  kind: MultiplayerGameId;
  result?: Result;
}
export interface ConnectState extends BaseState {
  kind: "connect-four";
  board: (string | null)[][];
  turn: string;
}
export interface TriviaState extends BaseState {
  kind: "trivia";
  questions: number[];
  round: number;
  deadline: number;
  answers: Record<string, number>;
  scores: Record<string, number>;
  previous?: { correct: number; answers: Record<string, number> };
}
export interface ReactionState extends BaseState {
  kind: "reaction";
  round: number;
  signalAt: number;
  signalNotified: boolean;
  deadline: number;
  reacted: Record<string, number>;
  scores: Record<string, number>;
  previous?: Record<string, number>;
}
export interface Point {
  x: number;
  y: number;
}
export interface Stroke {
  points: Point[];
  color: string;
}
export interface DrawingState extends BaseState {
  kind: "drawing";
  round: number;
  drawerId: string;
  word: string;
  deadline: number;
  scores: Record<string, number>;
  guessed: string[];
  strokes: Stroke[];
  previousWord?: string;
}
interface DeductionPlayer {
  role: "crew" | "hostile";
  alive: boolean;
  x: number;
  y: number;
  tasks: number[];
  completed: number[];
  lastTask: number;
  lastMove: number;
  cooldownUntil: number;
  meetings: number;
}
export interface DeductionState extends BaseState {
  kind: "social-deduction";
  phase: "running" | "meeting";
  players: Record<string, DeductionPlayer>;
  bodies: { id: string; x: number; y: number }[];
  completedTasks: number;
  totalTasks: number;
  sabotageUntil: number | null;
  sabotageCooldown: number;
  meetingUntil: number | null;
  votes: Record<string, string>;
  lastMeeting?: { ejectedId: string | null; votes: Record<string, number> };
  lastTick: number;
}
export type GameState =
  | ConnectState
  | TriviaState
  | ReactionState
  | DrawingState
  | DeductionState
  | CoopState
  | DefenseState
  | BoardGameState
  | PokerState;
export class GameError extends Error {}
function assert(ok: unknown, message: string): asserts ok {
  if (!ok) throw new GameError(message);
}
const tasks = [
  { x: 15, y: 15, label: "Calibrate telescope" },
  { x: 85, y: 15, label: "Sort samples" },
  { x: 85, y: 85, label: "Restore beacon" },
  { x: 15, y: 85, label: "Align solar panels" },
];
export const triviaQuestions = [
  {
    question: "Which planet has the most prominent rings?",
    options: ["Mars", "Saturn", "Venus", "Mercury"],
    correct: 1,
  },
  {
    question: "How many sides does a hexagon have?",
    options: ["5", "7", "8", "6"],
    correct: 3,
  },
  {
    question: "What does a plant absorb from the atmosphere?",
    options: ["Carbon dioxide", "Helium", "Neon", "Hydrogen"],
    correct: 0,
  },
  {
    question: "Which language runs natively in a web browser?",
    options: ["Python", "C", "JavaScript", "Ruby"],
    correct: 2,
  },
  {
    question: "How many minutes are in two hours?",
    options: ["100", "120", "90", "150"],
    correct: 1,
  },
  {
    question: "Which is a prime number?",
    options: ["21", "27", "29", "33"],
    correct: 2,
  },
  {
    question: "Which ocean is the largest?",
    options: ["Pacific", "Indian", "Arctic", "Atlantic"],
    correct: 0,
  },
  {
    question: "What is the chemical symbol for gold?",
    options: ["Ag", "Fe", "Au", "Go"],
    correct: 2,
  },
  {
    question: "How many strings does a standard guitar have?",
    options: ["4", "5", "7", "6"],
    correct: 3,
  },
  {
    question: "Which unit measures electrical resistance?",
    options: ["Watt", "Ohm", "Volt", "Ampere"],
    correct: 1,
  },
];
const words = [
  "telescope",
  "bicycle",
  "pyramid",
  "umbrella",
  "volcano",
  "butterfly",
  "rocket",
  "penguin",
  "guitar",
  "lighthouse",
];
function shuffled<T>(items: T[]) {
  const list = [...items];
  for (let i = list.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}
const scoresFor = (lobby: Lobby) =>
  Object.fromEntries(lobby.players.map((p) => [p.id, 0]));
export function playerLimits(gameId: MultiplayerGameId) {
  return {
    min: gameId === "social-deduction" ? 4 : 2,
    max:
      gameId === "connect-four" || gameId === "checkers" || gameId === "chess"
        ? 2
        : gameId === "ego-trip" || gameId === "tower-defense"
          ? 4
          : gameId === "poker"
            ? 6
            : gameId === "social-deduction"
              ? 12
              : 8,
  };
}
export function createLobby(
  user: { id: string; username: string },
  gameId: MultiplayerGameId,
  visibility: "public" | "private",
  code: string,
  now = Date.now(),
  coopMode: "gauntlet" | "campaign" = "gauntlet",
): Lobby {
  assert(
    !["ego-trip", "poker", "tower-defense"].includes(gameId) ||
      visibility === "private",
    "Ego Trip co-op, live defense and poker rooms are private",
  );
  return {
    code,
    matchId: randomUUID(),
    gameId,
    hostId: user.id,
    visibility,
    status: "waiting",
    players: [
      { id: user.id, username: user.username, ready: false, connected: true },
    ],
    createdAt: now,
    ...(gameId === "ego-trip" ? { coopMode } : {}),
    state: null,
  };
}
export function startGame(lobby: Lobby, now = Date.now()) {
  assert(
    lobby.status === "waiting" || lobby.status === "finished",
    "The match is already running",
  );
  const limits = playerLimits(lobby.gameId);
  const startingPlayers =
    lobby.gameId === "poker" && lobby.pokerTable
      ? lobby.players.filter((p) =>
          lobby.pokerTable!.seats.some(
            (seat) =>
              seat.userId === p.id &&
              seat.stack > 0 &&
              !seat.sittingOut &&
              !seat.pendingLeave,
          ),
        )
      : lobby.players;
  assert(!lobby.pokerTable?.closed, "This poker table is closed");
  assert(
    startingPlayers.length >= limits.min &&
      startingPlayers.length <= limits.max,
    `This game needs ${limits.min}–${limits.max} players`,
  );
  assert(
    startingPlayers.every((p) => p.ready && p.connected),
    "Every player must be connected and ready",
  );
  lobby.matchId = randomUUID();
  lobby.recorded = false;
  lobby.startedAt = now;
  lobby.status = "playing";
  const scores = scoresFor(lobby);
  switch (lobby.gameId) {
    case "tower-defense":
      lobby.state = createDefenseState(
        lobby.players.map((p) => p.id),
        now,
      );
      break;
    case "ego-trip":
      lobby.state = createCoopState(
        lobby.players.map((p) => p.id),
        now,
        lobby.coopMode ?? "gauntlet",
        randomInt(1, 0x7fffffff),
      );
      break;
    case "poker": {
      const previousDealer =
        lobby.state?.kind === "poker"
          ? lobby.state.seats[lobby.state.dealerIndex]?.userId
          : undefined;
      const priorIndex = previousDealer
        ? startingPlayers.findIndex((p) => p.id === previousDealer)
        : -1;
      lobby.pokerDealerIndex = (priorIndex + 1) % startingPlayers.length;
      if (lobby.pokerTable) {
        const table = lobby.pokerTable;
        const handNumber = table.handNumber + 1;
        lobby.state = createPersistentPokerHand(
          startingPlayers.map((p) => ({
            userId: p.id,
            stack: table.seats.find((seat) => seat.userId === p.id)!.stack,
          })),
          {
            id: table.id,
            handNumber,
            minBuyIn: table.minBuyIn,
            maxBuyIn: table.maxBuyIn,
            ...pokerBlinds(handNumber),
            sittingOut: table.seats
              .filter((p) => p.sittingOut)
              .map((p) => p.userId),
            pendingLeave: table.seats
              .filter((p) => p.pendingLeave)
              .map((p) => p.userId),
          },
          lobby.pokerDealerIndex,
          now,
        );
        if (lobby.state.result) finish(lobby, lobby.state.result);
      } else
        lobby.state = createPokerState(
          startingPlayers.map((p) => p.id),
          lobby.pokerBuyIn ?? 100,
          lobby.pokerDealerIndex,
          now,
        );
      break;
    }
    case "checkers":
    case "chess":
      lobby.state = createBoardGame(
        lobby.gameId,
        lobby.players.map((p) => p.id),
      );
      break;
    case "connect-four":
      lobby.state = {
        kind: "connect-four",
        board: Array.from({ length: 6 }, () =>
          Array.from({ length: 7 }, () => null),
        ),
        turn: lobby.players[0].id,
      };
      break;
    case "trivia":
      lobby.state = {
        kind: "trivia",
        questions: shuffled(triviaQuestions.map((_, i) => i)).slice(0, 5),
        round: 0,
        deadline: now + 20_000,
        scores,
        answers: {},
      };
      break;
    case "reaction": {
      const signalAt = now + randomInt(2000, 5000);
      lobby.state = {
        kind: "reaction",
        round: 0,
        signalAt,
        signalNotified: false,
        deadline: signalAt + 2500,
        scores,
        reacted: {},
      };
      break;
    }
    case "drawing":
      lobby.state = {
        kind: "drawing",
        round: 0,
        drawerId: lobby.players[0].id,
        word: words[randomInt(words.length)],
        deadline: now + 60_000,
        scores,
        guessed: [],
        strokes: [],
      };
      break;
    case "social-deduction": {
      const hostile = new Set(
        shuffled(lobby.players.map((p) => p.id)).slice(
          0,
          lobby.players.length >= 8 ? 2 : 1,
        ),
      );
      const players = Object.fromEntries(
        lobby.players.map((p, i) => [
          p.id,
          {
            role: hostile.has(p.id) ? ("hostile" as const) : ("crew" as const),
            alive: true,
            x: 42 + (i % 4) * 5,
            y: 42 + Math.floor(i / 4) * 5,
            tasks: shuffled([0, 1, 2, 3]).slice(0, 3),
            completed: [],
            lastTask: now,
            lastMove: now,
            cooldownUntil: now + 15_000,
            meetings: 0,
          },
        ]),
      );
      lobby.state = {
        kind: "social-deduction",
        phase: "running",
        players,
        bodies: [],
        completedTasks: 0,
        totalTasks: (lobby.players.length - hostile.size) * 3,
        sabotageUntil: null,
        sabotageCooldown: now + 15_000,
        meetingUntil: null,
        votes: {},
        lastTick: now,
      };
      break;
    }
  }
}
function finish(lobby: Lobby, result: Result) {
  if (lobby.state) lobby.state.result = result;
  lobby.status = "finished";
  lobby.players.forEach((p) => {
    p.ready = false;
  });
}
function finishScores(
  lobby: Lobby,
  scores: Record<string, number>,
  reason: string,
) {
  const max = Math.max(...Object.values(scores));
  finish(lobby, {
    winners: Object.keys(scores).filter((id) => scores[id] === max),
    scores,
    reason,
  });
}
function wonConnect(board: (string | null)[][], playerId: string) {
  for (let y = 0; y < 6; y++)
    for (let x = 0; x < 7; x++)
      for (const [dx, dy] of [
        [1, 0],
        [0, 1],
        [1, 1],
        [1, -1],
      ]) {
        if (
          Array.from(
            { length: 4 },
            (_, i) => board[y + i * dy]?.[x + i * dx],
          ).every((v) => v === playerId)
        )
          return true;
      }
  return false;
}
function deductionWin(lobby: Lobby, reason?: string) {
  const state = lobby.state as DeductionState;
  const alive = Object.values(state.players).filter((p) => p.alive);
  const hostiles = alive.filter((p) => p.role === "hostile").length;
  const crew = alive.length - hostiles;
  const winner =
    reason === "Beacon failed"
      ? "hostile"
      : hostiles === 0 || state.completedTasks >= state.totalTasks
        ? "crew"
        : hostiles >= crew
          ? "hostile"
          : null;
  if (winner)
    finish(lobby, {
      winners: Object.entries(state.players)
        .filter(([, p]) => p.role === winner)
        .map(([id]) => id),
      scores: Object.fromEntries(
        Object.entries(state.players).map(([id, p]) => [
          id,
          p.role === winner ? 100 : 0,
        ]),
      ),
      reason:
        reason ??
        (winner === "crew" ? "Expedition secured" : "Hostiles took control"),
    });
}
const baseAction = z.object({ type: z.string().min(1).max(40) }).passthrough();
export function applyGameAction(
  lobby: Lobby,
  userId: string,
  payload: unknown,
  now = Date.now(),
) {
  assert(
    lobby.players.some((p) => p.id === userId),
    "Join this lobby first",
  );
  assert(lobby.status === "playing" && lobby.state, "The match is not running");
  tickGame(lobby, now);
  assert(lobby.status === "playing", "The match ended");
  const input = baseAction.parse(payload);
  const state = lobby.state;
  switch (state.kind) {
    case "tower-defense":
      try {
        applyDefenseAction(state, userId, lobby.hostId, payload, now);
      } catch (error) {
        if (error instanceof DefenseRuleError)
          throw new GameError(error.message);
        throw error;
      }
      break;
    case "ego-trip":
      try {
        applyCoopAction(state, userId, payload, now);
      } catch (error) {
        if (error instanceof CoopRuleError) throw new GameError(error.message);
        throw error;
      }
      break;
    case "poker":
      try {
        applyPokerAction(state, userId, payload, now);
      } catch (error) {
        if (error instanceof PokerRuleError) throw new GameError(error.message);
        throw error;
      }
      if (state.result) finish(lobby, state.result);
      break;
    case "checkers":
    case "chess":
      try {
        applyBoardGameAction(state, userId, payload);
      } catch (error) {
        if (error instanceof BoardRuleError) throw new GameError(error.message);
        throw error;
      }
      if (state.result) finish(lobby, state.result);
      break;
    case "connect-four": {
      const { column } = z
        .object({
          type: z.literal("drop"),
          column: z.number().int().min(0).max(6),
        })
        .parse(input);
      assert(state.turn === userId, "Wait for your turn");
      let row = 5;
      while (row >= 0 && state.board[row][column]) row--;
      assert(row >= 0, "That column is full");
      state.board[row][column] = userId;
      if (wonConnect(state.board, userId))
        finish(lobby, {
          winners: [userId],
          scores: { ...scoresFor(lobby), [userId]: 100 },
          reason: "Four connected",
        });
      else if (state.board.every((r) => r.every(Boolean)))
        finish(lobby, {
          winners: [],
          scores: scoresFor(lobby),
          reason: "Draw",
        });
      else state.turn = lobby.players.find((p) => p.id !== userId)!.id;
      break;
    }
    case "trivia": {
      const { answer } = z
        .object({
          type: z.literal("answer"),
          answer: z.number().int().min(0).max(3),
        })
        .parse(input);
      assert(state.answers[userId] === undefined, "You already answered");
      state.answers[userId] = answer;
      if (answer === triviaQuestions[state.questions[state.round]].correct)
        state.scores[userId] +=
          100 + Math.floor(Math.max(0, state.deadline - now) / 500);
      if (Object.keys(state.answers).length === lobby.players.length)
        state.deadline = now;
      break;
    }
    case "reaction": {
      z.object({ type: z.literal("react") }).parse(input);
      assert(state.reacted[userId] === undefined, "You already reacted");
      const elapsed = now - state.signalAt;
      state.reacted[userId] = elapsed;
      state.scores[userId] +=
        elapsed < 0 ? -50 : Math.max(0, 100 - Math.floor(elapsed / 25));
      if (Object.keys(state.reacted).length === lobby.players.length)
        state.deadline = Math.max(now, state.signalAt);
      break;
    }
    case "drawing": {
      if (input.type === "stroke") {
        const stroke = z
          .object({
            points: z
              .array(
                z.object({
                  x: z.number().min(0).max(600),
                  y: z.number().min(0).max(400),
                }),
              )
              .min(1)
              .max(120),
            color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
          })
          .parse(input);
        assert(userId === state.drawerId, "Only the drawer can draw");
        assert(state.strokes.length < 600, "Canvas stroke limit reached");
        state.strokes.push(stroke);
      } else {
        const { text } = z
          .object({
            type: z.literal("guess"),
            text: z.string().trim().min(1).max(80),
          })
          .parse(input);
        assert(userId !== state.drawerId, "The drawer cannot guess");
        assert(
          !state.guessed.includes(userId),
          "You already guessed correctly",
        );
        if (text.toLocaleLowerCase() === state.word) {
          state.guessed.push(userId);
          state.scores[userId] +=
            100 + Math.floor((state.deadline - now) / 1000);
          state.scores[state.drawerId] += 50;
        }
        if (state.guessed.length === lobby.players.length - 1)
          state.deadline = now;
      }
      break;
    }
    case "social-deduction": {
      const player = state.players[userId];
      assert(
        player?.alive || input.type === "move" || input.type === "task",
        "Eliminated players can only move and finish tasks",
      );
      if (input.type === "vote") {
        const { targetId } = z
          .object({ targetId: z.string().max(40) })
          .parse(input);
        assert(
          state.phase === "meeting",
          "Voting is available during meetings",
        );
        assert(state.votes[userId] === undefined, "You already voted");
        assert(
          targetId === "skip" || state.players[targetId]?.alive,
          "Invalid vote target",
        );
        state.votes[userId] = targetId;
        if (
          Object.keys(state.votes).length ===
          Object.values(state.players).filter((p) => p.alive).length
        )
          state.meetingUntil = now;
        break;
      }
      assert(state.phase === "running", "Actions pause during meetings");
      if (input.type === "move") {
        const { dx, dy } = z
          .object({
            dx: z.number().min(-1).max(1),
            dy: z.number().min(-1).max(1),
          })
          .parse(input);
        assert(now - player.lastMove >= 90, "Movement is too frequent");
        player.lastMove = now;
        const length = Math.max(1, Math.hypot(dx, dy));
        player.x = Math.min(96, Math.max(4, player.x + (dx / length) * 1.5));
        player.y = Math.min(96, Math.max(4, player.y + (dy / length) * 1.5));
      } else if (input.type === "task") {
        const { taskId } = z
          .object({ taskId: z.number().int().min(0).max(3) })
          .parse(input);
        assert(
          player.role === "crew",
          "Hostiles cannot complete expedition tasks",
        );
        assert(
          player.tasks.includes(taskId) && !player.completed.includes(taskId),
          "Task unavailable",
        );
        assert(
          Math.hypot(player.x - tasks[taskId].x, player.y - tasks[taskId].y) <
            12,
          "Move near this task",
        );
        assert(now - player.lastTask >= 2000, "Task is still calibrating");
        player.lastTask = now;
        player.completed.push(taskId);
        state.completedTasks++;
        deductionWin(lobby);
      } else if (input.type === "eliminate") {
        const { targetId } = z
          .object({ targetId: z.string().uuid() })
          .parse(input);
        assert(
          player.role === "hostile",
          "Only hostile roles have that ability",
        );
        assert(now >= player.cooldownUntil, "Ability is cooling down");
        const target = state.players[targetId];
        assert(target?.alive && target.role !== "hostile", "Invalid target");
        assert(
          Math.hypot(player.x - target.x, player.y - target.y) < 10,
          "Target is too far away",
        );
        target.alive = false;
        state.bodies.push({ id: targetId, x: target.x, y: target.y });
        player.cooldownUntil = now + 25_000;
        deductionWin(lobby);
      } else if (input.type === "meeting") {
        const { bodyId } = z
          .object({ bodyId: z.string().uuid().optional() })
          .parse(input);
        assert(!state.sabotageUntil, "Repair the sabotage before meeting");
        if (bodyId) {
          const body = state.bodies.find((b) => b.id === bodyId);
          assert(
            body && Math.hypot(player.x - body.x, player.y - body.y) < 12,
            "Move near a body to report",
          );
        } else {
          assert(player.meetings < 2, "No emergency meetings remain");
          assert(
            Math.hypot(player.x - 50, player.y - 50) < 12,
            "Move to the meeting console",
          );
          player.meetings++;
        }
        state.phase = "meeting";
        state.meetingUntil = now + 25_000;
        state.votes = {};
        state.bodies = [];
      } else if (input.type === "sabotage") {
        assert(player.role === "hostile", "Only hostile roles can sabotage");
        assert(
          !state.sabotageUntil && now >= state.sabotageCooldown,
          "Sabotage is cooling down",
        );
        state.sabotageUntil = now + 30_000;
        state.sabotageCooldown = now + 60_000;
      } else if (input.type === "repair") {
        assert(state.sabotageUntil, "No active sabotage");
        assert(
          Math.hypot(player.x - 50, player.y - 10) < 12,
          "Move to the beacon console",
        );
        state.sabotageUntil = null;
      } else throw new GameError("Unknown action");
      break;
    }
  }
}
export function tickGame(lobby: Lobby, now = Date.now()) {
  if (lobby.status !== "playing" || !lobby.state || lobby.recoveryPausedAt)
    return false;
  const state = lobby.state;
  if (state.kind === "tower-defense") {
    const changed = tickDefense(state, now);
    if (state.result) finish(lobby, state.result);
    return changed;
  }
  if (state.kind === "poker") {
    const changed = tickPokerState(state, now);
    if (state.result) finish(lobby, state.result);
    return changed;
  }
  if (state.kind === "ego-trip") {
    const changed = tickCoop(
      state,
      now,
      lobby.players.filter((p) => p.connected).map((p) => p.id),
    );
    if (state.result) finish(lobby, state.result);
    return changed;
  }
  if (state.kind === "trivia" && now >= state.deadline) {
    state.previous = {
      correct: triviaQuestions[state.questions[state.round]].correct,
      answers: state.answers,
    };
    state.round++;
    if (state.round >= state.questions.length)
      finishScores(lobby, state.scores, "Quiz complete");
    else {
      state.answers = {};
      state.deadline = now + 20_000;
    }
    return true;
  }
  if (state.kind === "reaction" && now >= state.deadline) {
    state.previous = state.reacted;
    state.round++;
    if (state.round >= 5)
      finishScores(lobby, state.scores, "Five rounds complete");
    else {
      state.reacted = {};
      state.signalAt = now + randomInt(2000, 5000);
      state.signalNotified = false;
      state.deadline = state.signalAt + 2500;
    }
    return true;
  }
  if (
    state.kind === "reaction" &&
    now >= state.signalAt &&
    !state.signalNotified
  ) {
    state.signalNotified = true;
    return true;
  }
  if (state.kind === "drawing" && now >= state.deadline) {
    state.previousWord = state.word;
    state.round++;
    if (state.round >= lobby.players.length)
      finishScores(lobby, state.scores, "Every player has drawn");
    else {
      state.drawerId = lobby.players[state.round].id;
      state.word = words[randomInt(words.length)];
      state.guessed = [];
      state.strokes = [];
      state.deadline = now + 60_000;
    }
    return true;
  }
  if (state.kind === "social-deduction") {
    if (state.sabotageUntil && now >= state.sabotageUntil) {
      deductionWin(lobby, "Beacon failed");
      return true;
    }
    if (
      state.phase === "meeting" &&
      state.meetingUntil &&
      now >= state.meetingUntil
    ) {
      const votes: Record<string, number> = {};
      for (const target of Object.values(state.votes))
        votes[target] = (votes[target] ?? 0) + 1;
      const ranking = Object.entries(votes).sort((a, b) => b[1] - a[1]);
      const ejectedId =
        ranking[0] &&
        ranking[0][0] !== "skip" &&
        ranking[0][1] > (ranking[1]?.[1] ?? 0)
          ? ranking[0][0]
          : null;
      if (ejectedId) state.players[ejectedId].alive = false;
      state.lastMeeting = { ejectedId, votes };
      state.phase = "running";
      state.meetingUntil = null;
      state.votes = {};
      Object.values(state.players).forEach((p) => {
        p.cooldownUntil = Math.max(p.cooldownUntil, now + 10_000);
      });
      deductionWin(lobby);
      return true;
    }
  }
  return false;
}

// Construct public views explicitly. Spreading hidden server state would leak roles and answers.
export function lobbyView(lobby: Lobby, viewerId: string, now = Date.now()) {
  assert(
    lobby.players.some((p) => p.id === viewerId),
    "Join this lobby first",
  );
  const s = lobby.state;
  let state: unknown = null;
  if (s?.kind === "poker")
    state =
      s.table || s.seats.some((seat) => seat.userId === viewerId)
        ? publicPokerTable(s, viewerId)
        : null;
  if (s?.kind === "ego-trip") state = coopView(s, viewerId);
  if (s?.kind === "tower-defense") state = defenseView(s);
  if (s?.kind === "checkers" || s?.kind === "chess")
    state = boardGameView(s, viewerId);
  if (s?.kind === "connect-four")
    state = { kind: s.kind, board: s.board, turn: s.turn, result: s.result };
  if (s?.kind === "trivia") {
    const q =
      triviaQuestions[s.questions[Math.min(s.round, s.questions.length - 1)]];
    state = {
      kind: s.kind,
      question: q.question,
      options: q.options,
      round: s.round,
      rounds: 5,
      deadline: s.deadline,
      answered: Object.keys(s.answers),
      yourAnswer: s.answers[viewerId],
      scores: s.scores,
      previous: s.previous,
      result: s.result,
    };
  }
  if (s?.kind === "reaction")
    state = {
      kind: s.kind,
      round: s.round,
      rounds: 5,
      signal: now >= s.signalAt,
      deadline: now >= s.signalAt ? s.deadline : undefined,
      reacted: Object.keys(s.reacted),
      scores: s.scores,
      previous: s.previous,
      result: s.result,
    };
  if (s?.kind === "drawing")
    state = {
      kind: s.kind,
      round: s.round,
      rounds: lobby.players.length,
      drawerId: s.drawerId,
      word: viewerId === s.drawerId ? s.word : undefined,
      wordLength: s.word.length,
      deadline: s.deadline,
      strokes: s.strokes,
      guessed: s.guessed,
      scores: s.scores,
      previousWord: s.previousWord,
      result: s.result,
    };
  if (s?.kind === "social-deduction") {
    const self = s.players[viewerId];
    state = {
      kind: s.kind,
      phase: s.phase,
      players: Object.entries(s.players).map(([id, p]) => ({
        id,
        alive: p.alive,
        x: p.x,
        y: p.y,
      })),
      self: {
        role: self.role,
        alive: self.alive,
        tasks: self.tasks,
        completed: self.completed,
        cooldownUntil: self.cooldownUntil,
        meetings: self.meetings,
      },
      allies:
        self.role === "hostile"
          ? Object.entries(s.players)
              .filter(([, p]) => p.role === "hostile")
              .map(([id]) => id)
          : [],
      tasks,
      bodies: s.bodies,
      completedTasks: s.completedTasks,
      totalTasks: s.totalTasks,
      sabotageUntil: s.sabotageUntil,
      meetingUntil: s.meetingUntil,
      voted: Object.keys(s.votes),
      yourVote: s.votes[viewerId],
      lastMeeting: s.lastMeeting,
      result: s.result,
    };
  }
  return {
    code: lobby.code,
    matchId: lobby.matchId,
    gameId: lobby.gameId,
    coopMode: lobby.coopMode,
    pokerBuyIn: lobby.pokerBuyIn ?? 100,
    pokerTable: lobby.pokerTable
      ? {
          id: lobby.pokerTable.id,
          minBuyIn: lobby.pokerTable.minBuyIn,
          maxBuyIn: lobby.pokerTable.maxBuyIn,
          handNumber: lobby.pokerTable.handNumber,
          closed: !!lobby.pokerTable.closed,
          seats: lobby.pokerTable.seats,
        }
      : undefined,
    recoveryPaused: !!lobby.recoveryPausedAt,
    hostId: lobby.hostId,
    visibility: lobby.visibility,
    status: lobby.status,
    players: lobby.players.map((player) => ({
      id: player.id,
      username: player.username,
      ready: player.ready,
      connected: player.connected,
    })),
    createdAt: lobby.createdAt,
    state,
    serverTime: now,
  };
}

/** Freeze only server timers during an actual recovery outage. Never publish hidden state. */
export function resumeRecoveredLobby(lobby: Lobby, now = Date.now()) {
  if (!lobby.recoveryPausedAt || !lobby.state) return;
  const elapsed = Math.max(0, now - lobby.recoveryPausedAt);
  const s = lobby.state;
  if (lobby.startedAt) lobby.startedAt += elapsed;
  if (s.kind === "ego-trip") {
    s.startedAt += elapsed;
    s.lastTick = now;
    s.intermissionUntil += elapsed;
    if (s.campaign) s.campaign.choiceUntil += elapsed;
    for (const p of Object.values(s.players)) {
      p.input = null;
      p.inputAt = 0;
      if (p.downedUntil) p.downedUntil += elapsed;
    }
  } else if (s.kind === "tower-defense") s.lastTick = now;
  else if (s.kind === "poker") s.deadline += elapsed;
  else if (s.kind === "trivia" || s.kind === "drawing") s.deadline += elapsed;
  else if (s.kind === "reaction") {
    s.signalAt += elapsed;
    s.deadline += elapsed;
  } else if (s.kind === "social-deduction") {
    s.lastTick = now;
    if (s.sabotageUntil) s.sabotageUntil += elapsed;
    if (s.meetingUntil) s.meetingUntil += elapsed;
    s.sabotageCooldown += elapsed;
    for (const p of Object.values(s.players)) {
      p.lastMove = now;
      p.lastTask = now;
      p.cooldownUntil += elapsed;
    }
  }
  delete lobby.recoveryPausedAt;
}
