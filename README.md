# Due Diligence

Static site for [duediligence.fyi](https://duediligence.fyi). GitHub Pages serves the `main` branch root. There is no build step and no backend. `.nojekyll` keeps Pages from running Jekyll, so files such as `data/paper-trades.json` are published as committed.

## Paper trades

`paper-trades.html` is the public end-of-day track record of **closed** options paper trades. The page loads [`data/paper-trades.json`](data/paper-trades.json) in the browser (`cache: no-cache`) and does not call an API. Summary figures and the table are computed in the page from that file.

The committed file starts empty:

```json
{
  "updated_et": null,
  "trades": []
}
```

With no trades, the page shows zero trades, a 0–0 win–loss line, dashes for win rate and average return, and a short empty-state note. A file that does not match this schema shows an error instead of a table.

### Schema

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

### How the daily update should write the file

After the U.S. cash close (4:00 p.m. America/New_York), once that session's trades are closed:

1. Build the **full** list of closed paper trades. Replace `trades`. Do not append to yesterday's file. The page does not dedupe, so writing the complete history on every run is what keeps the record from doubling.
2. Include only trades that are fully closed. Leave out open positions, live entries, and anything still working.
3. One contract per row. Entry is the ask. Exit is the bid. `source_type` is exactly `trader copy` or `model`.
4. Set `updated_et` to the time the file is written, as ISO 8601 with an offset.
5. Pretty-print `data/paper-trades.json` with two-space indent and a trailing newline.
6. Commit that file and push to `main`. Pages publishes the commit. The page will pick it up on the next load.

Do not put trader X handles, account numbers, balances, price levels, or live entry notes in the file, including inside `contract` or `exit_reason`. Those fields are public on duediligence.fyi.

A natural identity for a row, if the writer wants to avoid duplicates while assembling the list, is `date` + `contract` + `source_type`. The site does not require an id field.

### Checks

`node --test paper-trades.test.js` checks the schema, the empty file, sorting, the filter, and the summary math.
