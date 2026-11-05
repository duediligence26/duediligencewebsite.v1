# Due Diligence

Static site for [duediligence.fyi](https://duediligence.fyi). GitHub Pages serves the `main` branch root. There is no build step and no backend. `.nojekyll` keeps Pages from running Jekyll, so files such as `data/paper-trades.json` and `data/cbc-paper-trades.json` are published as committed.

## Paper trades

`paper-trades.html` is the public end-of-day track record of **closed** options paper trades. The page does not call an API. It leads with the MapleStax CBC paper program in [`data/cbc-paper-trades.json`](data/cbc-paper-trades.json), then keeps the earlier program in [`data/paper-trades.json`](data/paper-trades.json). Both files load in the browser (`cache: no-cache`). Summary figures and the tables are computed in the page from those files.

### Earlier program

The earlier program is the X trader-alert paper book. It ended in November 2026. Its section sits below the CBC record and still reads `data/paper-trades.json`.

An empty file is valid and looks like this:

```json
{
  "updated_et": null,
  "trades": []
}
```

With no trades, that section shows zero trades, a 0–0 win–loss line, dashes for win rate and average return, and a short empty-state note. A file that does not match this schema shows an error instead of a table. The committed `data/paper-trades.json` is the closed history of the earlier program, not this empty shape.

### Earlier-program schema

`updated_et` is `null` before the first update, or an ISO 8601 date-time with a timezone (`2026-10-28T16:20:00-04:00` or a `Z` suffix). The page displays that instant in America/New_York.

`trades` is an array of closed trades only. Each object has exactly these keys:

| Field | Type | Meaning |
| --- | --- | --- |
| `date` | string | Exit date in America/New_York, `YYYY-MM-DD`. Must be a real calendar date. |
| `ticker` | string | Underlying symbol, such as `SPY` or `QQQ`. Pattern: `^[A-Z][A-Z0-9.]{0,9}$`. |
| `contract` | string | Human-readable contract, such as `SPY 765C 10/26`. 1–80 characters. |
| `source_type` | string | `trader copy` or `model`. No other value. |
| `entry` | number | Ask paid, premium per share, greater than 0. |
| `exit` | number | Bid received, premium per share, 0 or greater. |
| `pnl_usd` | number | Dollars of profit or loss for **one** contract. |
| `return_pct` | number | Percent return on premium. `25` means 25%, not 0.25. |
| `exit_reason` | string | Short reason, such as `target`, `stop`, or `expiration`. 1–80 characters. |

Numbers are JSON numbers, not strings. Text must not include `@` or line breaks. Unknown keys are rejected, on the root object and on each trade, so a handle, balance, account id, level, or live note cannot render if it is added as its own field.

The page does not recompute `pnl_usd` or `return_pct`. It displays the stored numbers. For a long single-leg equity option, the daily writer should use:

- `pnl_usd = (exit - entry) * 100` (one contract, 100-share multiplier)
- `return_pct = ((exit - entry) / entry) * 100`

Round money to cents before writing. A win is `pnl_usd` that rounds to at least one cent above zero, a loss is at least one cent below zero, and anything that rounds to `$0.00` is a flat. Win rate is wins divided by all trades in the current filter, including flats. Average return is the arithmetic mean of `return_pct`. Stats follow the on-page filter (all, trader copies, or model picks). The table is sorted by `date` descending. Trades that share a date keep file order, with the later array entry shown first.

### Example shape (not a real trade)

This object only shows the shape. Do not commit sample trades into `data/paper-trades.json`.

```json
{
  "date": "2026-10-28",
  "ticker": "SPY",
  "contract": "SPY 765C 10/30",
  "source_type": "model",
  "entry": 1.25,
  "exit": 1.8,
  "pnl_usd": 55,
  "return_pct": 44,
  "exit_reason": "target"
}
```

### How the daily update should write the earlier file

These steps are for the earlier program, `data/paper-trades.json`. The CBC file has its own steps below.

After the U.S. cash close (4:00 p.m. America/New_York), once that session's trades are closed:

1. Build the **full** list of closed paper trades. Replace `trades`. Do not append to yesterday's file. The page does not dedupe, so writing the complete history on every run is what keeps the record from doubling.
2. Include only trades that are fully closed. Leave out open positions, live entries, and anything still working.
3. One contract per row. Entry is the ask. Exit is the bid. `source_type` is exactly `trader copy` or `model`.
4. Set `updated_et` to the time the file is written, as ISO 8601 with an offset.
5. Pretty-print `data/paper-trades.json` with two-space indent and a trailing newline.
6. Commit that file and push to `main`. Pages publishes the commit. The page will pick it up on the next load.

Do not put trader X handles, account numbers, balances, price levels, or live entry notes in the file, including inside `contract` or `exit_reason`. Those fields are public on duediligence.fyi.

A natural identity for a row, if the writer wants to avoid duplicates while assembling the list, is `date` + `contract` + `source_type`. The site does not require an id field.

### CBC paper trades

The top of the page is the MapleStax CBC paper program. CBC is a TradingView indicator that flips long or short on the 10-minute chart. Each signal is paper-traded with a same-day (0DTE) option. SPY is the book. QQQ is added starting November 6, 2026. Two versions run side by side:

- **1 contract.** Stop at −30%, a profit lock, a target at +100%, and an exit when the signal flips the other way.
- **4 contract scale-out.** Sell one contract at +40%, one at +60%, and one at +100%. The last contract trails. After the first sale, the stop moves to breakeven. Whatever is still open is out by 3:40 p.m. Eastern.

Entries use the ask. Exits use the bid. The page is paper only: simulated fills, not real money, and not a broker order.

The committed CBC file starts empty. Do not commit sample trades into it.

```json
{
  "updated_et": null,
  "strategy": "MapleStax CBC 10m",
  "trades": []
}
```

With no file, or with an empty `trades` array, the CBC section says "First CBC trades post after the close." A file that does not match this schema shows an error instead of a table. A missing file does not.

#### Schema

`updated_et` is `null` before the first update, or a New York clock string `YYYY-MM-DD HH:MM ET` such as `2026-11-05 16:30 ET`. This is not ISO 8601. `HH` is 00–23.

`strategy` is `MapleStax CBC 10m`.

`trades` is an array of closed paper trades only. Each object has exactly these keys:

| Field | Type | Meaning |
| --- | --- | --- |
| `date` | string | Session date, `YYYY-MM-DD`. Must be a real calendar date. |
| `symbol` | string | Underlying, such as `SPY` or `QQQ`. Pattern: `^[A-Z][A-Z0-9.]{0,9}$`. |
| `version` | string | `1 contract` or `4 contract`. |
| `direction` | string | `LONG` or `SHORT`. |
| `contract` | string | Human-readable contract, such as `SPY 744C 11/5`. 1–80 characters. |
| `entry_time_et` | string | Entry time, 24-hour `HH:MM` Eastern. |
| `entry` | number | Ask paid, premium per share, greater than 0. |
| `exit_time_et` | string | Exit time, 24-hour `HH:MM` Eastern. |
| `exit` | number | Bid received, premium per share, 0 or greater. For 4 contracts, the average exit price across the legs. |
| `contracts` | number | `1` for the 1-contract version and `4` for the 4-contract version. |
| `pnl_usd` | number | Simulated dollars. One contract for the first version. The combined total for the 4-contract version. |
| `return_pct` | number | Percent return on premium. `-30.1` means −30.1%, not −0.301. |
| `exit_reason` | string | `stop`, `target`, `profit lock`, `flip`, `scale-out`, or `time exit`. |
| `peak_pct` | number or null | Best open return, in the same percent units. `null` when there is no peak. |

Numbers are JSON numbers, not strings. `contracts` is a whole number. Text must not include `@`, a link, or line breaks. Unknown keys are rejected, on the root object and on each trade, so a handle, balance, account id, or signal URL cannot render as its own field.

The page does not recompute `pnl_usd`, `return_pct`, or the 4-contract average exit. It displays the stored numbers. One row is one closed paper trade, not one scale-out leg. For a 1-contract option the writer can use:

- `pnl_usd = (exit - entry) * 100`
- `return_pct = ((exit - entry) / entry) * 100`

Round money to cents before writing. A win is `pnl_usd` that rounds to at least one cent above zero. Win rate is wins divided by the closed trades in that version, including flats. Average return is the arithmetic mean of `return_pct` in that version. Total P&L is the sum of `pnl_usd`. The table is sorted by `date` descending, then `exit_time_et` descending. Trades that share a date and exit time keep file order, with the later array entry shown first.

#### Example shape (not a real trade)

Do not commit this into `data/cbc-paper-trades.json`.

```json
{
  "date": "2026-11-05",
  "symbol": "SPY",
  "version": "1 contract",
  "direction": "LONG",
  "contract": "SPY 744C 11/5",
  "entry_time_et": "11:28",
  "entry": 4.12,
  "exit_time_et": "11:43",
  "exit": 2.88,
  "contracts": 1,
  "pnl_usd": -124.0,
  "return_pct": -30.1,
  "exit_reason": "stop",
  "peak_pct": 12.0
}
```

#### How the daily update should write the CBC file

After the U.S. cash close, once that session's CBC paper trades are closed:

1. Build the **full** list of closed CBC paper trades, both versions. Replace `trades`. Do not append. The page does not dedupe.
2. Include only trades that are fully closed. Leave out open positions.
3. One row per closed version. The 4-contract version is one row: `contracts` is 4, `exit` is the average exit price, and `pnl_usd` is the combined dollars.
4. Keep `strategy` set to `MapleStax CBC 10m`.
5. Set `updated_et` to the write time as `YYYY-MM-DD HH:MM ET`.
6. Pretty-print `data/cbc-paper-trades.json` with two-space indent and a trailing newline.
7. Commit that file and push to `main`.

Do not put account numbers, balances, X handles, or links to signals in the file, including inside `contract`. The file is public on duediligence.fyi.

### Checks

`node --test paper-trades.test.js` checks both schemas, the empty CBC file, sorting, the earlier-program filter, and the summary math.
