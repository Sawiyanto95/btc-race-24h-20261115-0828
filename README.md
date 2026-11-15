# btc-race bot — deep-dip ladder

A long-only cbBTC trading bot for make.fun's `btc-race-24h-20261115-0828`
(24-hour race on 1-minute cbBTC/USDC bars, $1000 USDC start).

Strategy: buy a real dip and ride the bounce. It buys 60% of its cash when the
close is 3.0% below the highest close of the last 4 hours, scales in at -4.5%
and -6.0%, and exits on a -2% stop, a +4.5% take-profit, or a 1% trailing stop
once 0.5% in profit. Decisions use closes only — no clock, no randomness —
so two runs produce identical orders.

Run: `node main.ts` (Node 22, stdlib only; `vendor/makefun-bars.ts` is the
kit's protocol shim, copied byte-identical).
