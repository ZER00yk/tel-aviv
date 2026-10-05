import { GameRuleError } from "./rules";
export const BUSINESS_DEFS = {
  kiosk: { name: "Corner kiosk", cost: 150, baseRevenue: 0.3, basePrice: 5 },
  cafe: { name: "Midnight cafe", cost: 700, baseRevenue: 1.2, basePrice: 12 },
  factory: {
    name: "Oddity factory",
    cost: 3000,
    baseRevenue: 5,
    basePrice: 30,
  },
  studio: { name: "Dream studio", cost: 12000, baseRevenue: 20, basePrice: 80 },
} as const;
export type BusinessKind = keyof typeof BUSINESS_DEFS;
export interface Business {
  id: string;
  kind: BusinessKind;
  level: number;
  workers: number;
  price: number;
}
export interface TycoonState {
  cash: number;
  businesses: Business[];
  research: number;
  reputation: number;
  totalEarned: number;
  lastTick: number;
  offlineSeconds: number;
  lastOperate: number;
  market: number;
  nextId: number;
}
export function newTycoon(now: number): TycoonState {
  return {
    cash: 500,
    businesses: [],
    research: 0,
    reputation: 1,
    totalEarned: 0,
    lastTick: now,
    offlineSeconds: 0,
    lastOperate: 0,
    market: 1,
    nextId: 1,
  };
}
export function businessIncome(business: Business, state: TycoonState) {
  const def = BUSINESS_DEFS[business.kind];
  const ratio = business.price / def.basePrice;
  const demand = Math.max(0.03, Math.min(1.6, 2 - ratio)) * state.market;
  return Math.max(
    0,
    def.baseRevenue *
      business.level *
      (1 + business.workers * 0.35) *
      ratio *
      demand *
      (1 + state.research * 0.15) *
      (1 + state.reputation * 0.015) -
      business.workers * 0.02,
  );
}
export function advanceTycoon(state: TycoonState, now: number) {
  const seconds = Math.min(
    8 * 3600,
    Math.max(0, (now - state.lastTick) / 1000),
  );
  state.market = 1 + Math.sin(Math.floor(now / 3600000) * 0.72) * 0.25;
  state.offlineSeconds = seconds;
  state.lastTick = Math.max(state.lastTick, now);
  const income =
    state.businesses.reduce(
      (sum, b) => sum + (b.workers ? businessIncome(b, state) : 0),
      0,
    ) * seconds;
  state.cash = Math.min(1e15, state.cash + income);
  state.totalEarned = Math.min(1e15, state.totalEarned + income);
  return state;
}
export function actTycoon(
  state: TycoonState,
  action: string,
  payload: Record<string, unknown>,
  now: number,
) {
  advanceTycoon(state, now);
  const spend = (amount: number) => {
    if (!Number.isFinite(amount) || amount < 0 || state.cash < amount)
      throw new GameRuleError("Not enough cash.");
    state.cash -= amount;
  };
  const business = () => {
    const b = state.businesses.find(
      (candidate) => candidate.id === payload.businessId,
    );
    if (!b) throw new GameRuleError("Business not found.");
    return b;
  };
  switch (action) {
    case "state":
      break;
    case "open": {
      const kind = payload.kind as BusinessKind;
      if (!Object.hasOwn(BUSINESS_DEFS, kind))
        throw new GameRuleError("Unknown industry.");
      if (state.businesses.length >= 20)
        throw new GameRuleError("Your empire supports twenty businesses.");
      if (kind === "studio" && state.research < 2)
        throw new GameRuleError(
          "Research two improvements to unlock the dream industry.",
        );
      spend(
        BUSINESS_DEFS[kind].cost *
          (1 + state.businesses.filter((b) => b.kind === kind).length * 0.5),
      );
      state.businesses.push({
        id: String(state.nextId++),
        kind,
        level: 1,
        workers: 0,
        price: BUSINESS_DEFS[kind].basePrice,
      });
      state.reputation++;
      break;
    }
    case "hire": {
      const b = business();
      if (b.workers >= 25)
        throw new GameRuleError("This business has a full staff.");
      spend(50 * Math.pow(1.3, b.workers) * b.level);
      b.workers++;
      break;
    }
    case "upgrade": {
      const b = business();
      spend(BUSINESS_DEFS[b.kind].cost * 0.6 * Math.pow(1.7, b.level));
      b.level++;
      state.reputation++;
      break;
    }
    case "price": {
      const b = business();
      const price = Number(payload.price);
      if (
        !Number.isFinite(price) ||
        price < 1 ||
        price > BUSINESS_DEFS[b.kind].basePrice * 3
      )
        throw new GameRuleError("Price must be within the market range.");
      b.price = price;
      break;
    }
    case "research":
      spend(500 * Math.pow(2.2, state.research));
      state.research++;
      break;
    case "operate": {
      const b = business();
      if (now - state.lastOperate < 1000)
        throw new GameRuleError("Operations recover once per second.");
      state.lastOperate = now;
      const income = businessIncome(b, state) * 15;
      state.cash += income;
      state.totalEarned += income;
      break;
    }
    default:
      throw new GameRuleError("Unknown tycoon action.");
  }
  return state;
}
