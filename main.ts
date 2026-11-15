// Deep-dip ladder bot for the cbBTC 24h race (long only, $1000 USDC start).
//
// Idea, from backtesting the dev window (which grinds down ~4% with one sharp
// V-shaped crash to ~$62k and a recovery to ~$65.5k): small 1-minute moves are
// mostly noise and a full round trip costs ~26 bps, so fast scalping and EMA
// crosses both lose (the EMA-cross baseline loses $135 on this window). The
// only reliable edge is buying a real dip and riding the bounce. So the bot:
//   - watches the highest close of the last 240 bars (4 hours);
//   - buys 60% of its cash when the close is 3.0% below that high, then
//     scales in with half the remaining cash at -4.5% and the rest at -6.0%
//     (a ladder, so a falling knife costs little and the average entry
//     improves); the 3% first rung fires on five separate dips on the dev
//     window, so the result is not one lucky trade;
//   - exits the whole position on a -2% stop, a +4.5% take-profit, or a 1%
//     trailing stop once the position is 0.5% in profit (the trailing stop
//     is what banks the V-recovery instead of giving it back);
//   - after the ladder is fully built it also banks half at +2% once.
// Everything is decided from closes only: no clock, no randomness, so two
// runs produce identical orders.

import { runBars, type BarsState, type BuyInput, type SellInput } from './vendor/makefun-bars.ts';

const SYMBOL = 'CBBTC';
const LOOKBACK = 240; // bars in the rolling high (4 hours of 1-minute bars)
const DIP1 = 970n; // buy leg 1 at 3.0% below the rolling high (x/1000)
const DIP2 = 955n; // leg 2 at 4.5% below
const DIP3 = 940n; // leg 3 at 6.0% below
const STOP = 980n; // sell all at 2% under cost (x/1000)
const TAKE = 1045n; // sell all at 4.5% over cost
const HALF_TAKE = 1020n; // bank half at 2% over cost, once, after leg 3
const TRAIL_ARM = 1005n; // trailing stop arms at 0.5% over cost (x/1000)
const TRAIL = 990n; // sell all when value falls 1% under its peak (x/1000)
const BUY_SLIPPAGE_BPS = 200; // skip a buy if the next open gaps up >2%
const SELL_SLIPPAGE_BPS = 300; // let a sell fill even if the open gaps down 3%

/** Closes seen so far, oldest first, capped at LOOKBACK. */
const closes: number[] = [];
/** 0 = flat, 1/2/3 = ladder legs bought. */
let stage = 0;
/** Best position value (at closes) seen since the current entry. */
let peakValue = 0n;
/** Whether the half take-profit already fired for this position. */
let tookHalf = false;

function pushClose(close: number): void {
  closes.push(close);
  if (closes.length > LOOKBACK) closes.shift();
}

/** Highest close of the last LOOKBACK bars, or null before LOOKBACK bars. */
function rollingHigh(): number | null {
  if (closes.length < LOOKBACK) return null;
  let hi = closes[0]!;
  for (const c of closes) if (c > hi) hi = c;
  return hi;
}

await runBars({
  onBatch(state: BarsState) {
    const bar = state.latest.get(SYMBOL);
    if (bar === undefined) return [];
    pushClose(Number(bar.c));
    if (state.warmingUp) return [];

    const held = state.positions.get(SYMBOL);
    const orders: (BuyInput | SellInput)[] = [];
    const high = rollingHigh();

    if (held !== undefined) {
      const value = state.value(SYMBOL, held.qty);
      if (value > peakValue) peakValue = value;
      const cost = held.cost;
      // Stop loss, then take profit, then trailing stop, then the one-off half bank.
      if (value * 1000n <= cost * STOP) {
        orders.push({ side: 'sell', symbol: SYMBOL, qty: held.qty, max_slippage_bps: SELL_SLIPPAGE_BPS });
      } else if (value * 1000n >= cost * TAKE) {
        orders.push({ side: 'sell', symbol: SYMBOL, qty: held.qty, max_slippage_bps: SELL_SLIPPAGE_BPS });
      } else if (peakValue * 1000n >= cost * TRAIL_ARM && value * 1000n <= peakValue * TRAIL) {
        orders.push({ side: 'sell', symbol: SYMBOL, qty: held.qty, max_slippage_bps: SELL_SLIPPAGE_BPS });
      } else if (stage === 3 && !tookHalf && value * 1000n >= cost * HALF_TAKE) {
        tookHalf = true;
        orders.push({ side: 'sell', symbol: SYMBOL, qty: held.qty / 2n, max_slippage_bps: SELL_SLIPPAGE_BPS });
      } else if (high !== null) {
        // Still holding: scale in deeper if the dip deepens.
        const close = Number(bar.c);
        if (stage === 1 && close * 1000 <= high * Number(DIP2)) {
          stage = 2;
          const spend = state.cash / 2n;
          if (spend >= BigInt(state.hello.fees.min_notional_quote_units)) {
            orders.push({ side: 'buy', symbol: SYMBOL, notional_quote_units: spend, max_slippage_bps: BUY_SLIPPAGE_BPS });
          }
        } else if (stage === 2 && close * 1000 <= high * Number(DIP3)) {
          stage = 3;
          const spend = state.cash;
          if (spend >= BigInt(state.hello.fees.min_notional_quote_units)) {
            orders.push({ side: 'buy', symbol: SYMBOL, notional_quote_units: spend, max_slippage_bps: BUY_SLIPPAGE_BPS });
          }
        }
      }
      return orders;
    }

    // Flat: first ladder leg on a 3.0% dip from the 4-hour high.
    if (high !== null && Number(bar.c) * 1000 <= high * Number(DIP1)) {
      const spend = (state.cash * 3n) / 5n;
      if (spend >= BigInt(state.hello.fees.min_notional_quote_units)) {
        stage = 1;
        peakValue = 0n;
        tookHalf = false;
        orders.push({ side: 'buy', symbol: SYMBOL, notional_quote_units: spend, max_slippage_bps: BUY_SLIPPAGE_BPS });
      }
    }
    return orders;
  },
});
