const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  parsePaperTrades,
  selectTrades,
  summarizeTrades,
  viewModel,
} = require('./paper-trades.js');

function trade(overrides) {
  return {
    date: '2026-10-27',
    ticker: 'SPY',
    contract: 'SPY 765C 10/30',
    source_type: 'model',
    entry: 1.2,
    exit: 1.5,
    pnl_usd: 30,
    return_pct: 25,
    exit_reason: 'target',
    ...overrides,
  };
}

test('empty track record parses', () => {
  const parsed = parsePaperTrades({ updated_et: null, trades: [] });
  assert.equal(parsed.ok, true);
  assert.equal(parsed.updatedEt, null);
  assert.deepEqual(parsed.trades, []);
});

test('committed file is an empty track record', () => {
  const file = path.join(__dirname, 'data', 'paper-trades.json');
  assert.equal(fs.existsSync(file), true, 'data/paper-trades.json should be committed');
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  const parsed = parsePaperTrades(raw);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.updatedEt, null);
  assert.deepEqual(parsed.trades, []);
});

test('rejects unknown keys so handles and balances cannot render', () => {
  const withHandle = parsePaperTrades({
    updated_et: null,
    trades: [trade({ handle: '@someone' })],
  });
  assert.equal(withHandle.ok, false);
  assert.match(withHandle.error, /handle/);

  const withBalance = parsePaperTrades({
    updated_et: null,
    balance: 1000,
    trades: [],
  });
  assert.equal(withBalance.ok, false);
  assert.match(withBalance.error, /balance/);
});

test('rejects a source type outside the two allowed values', () => {
  const parsed = parsePaperTrades({
    updated_et: '2026-10-28T16:20:00-04:00',
    trades: [trade({ source_type: 'live' })],
  });
  assert.equal(parsed.ok, false);
  assert.match(parsed.error, /source_type/);
});

test('rejects an impossible date, a non-positive entry, and a negative exit', () => {
  assert.equal(parsePaperTrades({ updated_et: null, trades: [trade({ date: '2026-02-31' })] }).ok, false);
  assert.equal(parsePaperTrades({ updated_et: null, trades: [trade({ entry: 0 })] }).ok, false);
  assert.equal(parsePaperTrades({ updated_et: null, trades: [trade({ exit: -0.1 })] }).ok, false);
});

test('rejects an @ handle hiding in a text field', () => {
  const parsed = parsePaperTrades({
    updated_et: null,
    trades: [trade({ exit_reason: 'copied @someone' })],
  });
  assert.equal(parsed.ok, false);
  assert.match(parsed.error, /@/);
});

test('rejects a ticker that is not a symbol', () => {
  assert.equal(parsePaperTrades({ updated_et: null, trades: [trade({ ticker: '@spy' })] }).ok, false);
  assert.equal(parsePaperTrades({ updated_et: null, trades: [trade({ ticker: 'not a ticker' })] }).ok, false);
});

test('names the first missing trade field', () => {
  const broken = trade();
  delete broken.exit_reason;
  const parsed = parsePaperTrades({ updated_et: null, trades: [broken] });
  assert.equal(parsed.ok, false);
  assert.match(parsed.error, /exit_reason/);
});

test('rejects an unreadable updated_et, a non-array, and numeric strings', () => {
  assert.equal(parsePaperTrades({ updated_et: 'yesterday', trades: [] }).ok, false);
  assert.equal(parsePaperTrades({ updated_et: null, trades: {} }).ok, false);
  assert.equal(parsePaperTrades(null).ok, false);
  assert.equal(parsePaperTrades({ updated_et: null, trades: [trade({ pnl_usd: '30' })] }).ok, false);
});

test('summarizes an empty list as zero trades and no rate', () => {
  assert.deepEqual(summarizeTrades([]), {
    count: 0,
    wins: 0,
    losses: 0,
    flats: 0,
    winRate: null,
    totalPnl: 0,
    averageReturn: null,
  });
});

test('counts wins, losses, flats, total P&L, and average return', () => {
  const stats = summarizeTrades([
    trade({ pnl_usd: 50, return_pct: 10 }),
    trade({ pnl_usd: -20, return_pct: -5 }),
    trade({ pnl_usd: 0, return_pct: 0 }),
  ]);
  assert.equal(stats.count, 3);
  assert.equal(stats.wins, 1);
  assert.equal(stats.losses, 1);
  assert.equal(stats.flats, 1);
  assert.ok(Math.abs(stats.winRate - (100 / 3)) < 1e-9);
  assert.equal(stats.totalPnl, 30);
  assert.ok(Math.abs(stats.averageReturn - (5 / 3)) < 1e-9);
});

test('selects newest trades first and filters by source', () => {
  const trades = [
    trade({ date: '2026-10-27', contract: 'older', source_type: 'model' }),
    trade({ date: '2026-10-28', contract: 'morning', source_type: 'trader copy' }),
    trade({ date: '2026-10-28', contract: 'later', source_type: 'model' }),
  ];
  assert.deepEqual(selectTrades(trades, 'all').map((row) => row.contract), ['later', 'morning', 'older']);
  assert.deepEqual(selectTrades(trades, 'trader copy').map((row) => row.contract), ['morning']);
  assert.deepEqual(selectTrades(trades, 'model').map((row) => row.contract), ['later', 'older']);
});

test('view model for an empty file uses dashes and an empty-state message', () => {
  const model = viewModel({ updated_et: null, trades: [] }, 'all');
  assert.equal(model.ok, true);
  assert.equal(model.rows.length, 0);
  assert.equal(model.stats.tradesLabel, '0');
  assert.equal(model.stats.winLossLabel, '0–0');
  assert.equal(model.stats.winRateLabel, '—');
  assert.equal(model.stats.totalPnlLabel, '$0.00');
  assert.equal(model.stats.totalPnlSign, 'flat');
  assert.equal(model.stats.averageReturnLabel, '—');
  assert.equal(model.stats.averageReturnSign, 'flat');
  assert.match(model.emptyMessage, /No closed paper trades yet/);
  assert.equal(model.updatedLabel, 'Waiting for the first after-close update.');
});

test('view model formats a closed trade and follows the filter', () => {
  const data = {
    updated_et: '2026-10-28T16:20:00-04:00',
    trades: [
      trade({
        date: '2026-10-28',
        ticker: 'QQQ',
        contract: 'QQQ 500C 10/30',
        source_type: 'trader copy',
        entry: 2,
        exit: 1.5,
        pnl_usd: -50,
        return_pct: -25,
        exit_reason: 'stop',
      }),
      trade({
        date: '2026-10-27',
        source_type: 'model',
        pnl_usd: 30,
        return_pct: 25,
      }),
    ],
  };
  const model = viewModel(data, 'trader copy');
  assert.equal(model.ok, true);
  assert.equal(model.updatedLabel, 'Updated Oct 28, 2026, 4:20 PM EDT');
  assert.equal(model.rows.length, 1);
  assert.equal(model.rows[0].dateLabel, 'Oct 28, 2026');
  assert.equal(model.rows[0].ticker, 'QQQ');
  assert.equal(model.rows[0].contract, 'QQQ 500C 10/30');
  assert.equal(model.rows[0].sourceLabel, 'Trader copy');
  assert.equal(model.rows[0].entryLabel, '$2.00');
  assert.equal(model.rows[0].exitLabel, '$1.50');
  assert.equal(model.rows[0].pnlLabel, '−$50.00');
  assert.equal(model.rows[0].pnlSign, 'negative');
  assert.equal(model.rows[0].returnLabel, '−25.00%');
  assert.equal(model.rows[0].returnSign, 'negative');
  assert.equal(model.rows[0].exitReason, 'stop');
  assert.equal(model.stats.tradesLabel, '1');
  assert.equal(model.stats.winLossLabel, '0–1');
  assert.equal(model.stats.winRateLabel, '0.0%');
  assert.equal(model.stats.totalPnlLabel, '−$50.00');
  assert.equal(model.stats.totalPnlSign, 'negative');
  assert.equal(model.stats.averageReturnLabel, '−25.00%');
  assert.equal(model.stats.averageReturnSign, 'negative');
  assert.equal(model.emptyMessage, null);
});

test('view model lists newest first and signs a winning row', () => {
  const data = {
    updated_et: '2026-01-15T16:20:00-05:00',
    trades: [
      trade({ date: '2026-10-01', contract: 'older', pnl_usd: 10, return_pct: 5, entry: 2, exit: 2.1 }),
      trade({ date: '2026-10-28', contract: 'newer', pnl_usd: 55, return_pct: 44, entry: 1.25, exit: 1.8 }),
    ],
  };
  const model = viewModel(data, 'all');
  assert.deepEqual(model.rows.map((row) => row.contract), ['newer', 'older']);
  assert.equal(model.rows[0].pnlLabel, '+$55.00');
  assert.equal(model.rows[0].pnlSign, 'positive');
  assert.equal(model.rows[0].returnLabel, '+44.00%');
  assert.equal(model.rows[0].returnSign, 'positive');
  assert.equal(model.rows[0].sourceLabel, 'Model');
  assert.equal(model.rows[0].entryLabel, '$1.25');
  assert.equal(model.rows[0].exitLabel, '$1.80');
  assert.equal(model.stats.winLossLabel, '2–0');
  assert.equal(model.stats.winRateLabel, '100.0%');
  assert.equal(model.stats.totalPnlLabel, '+$65.00');
  assert.equal(model.stats.totalPnlSign, 'positive');
  assert.equal(model.stats.averageReturnLabel, '+24.50%');
  assert.equal(model.updatedLabel, 'Updated Jan 15, 2026, 4:20 PM EST');
});

test('win-loss label mentions flats', () => {
  const model = viewModel({
    updated_et: null,
    trades: [
      trade({ pnl_usd: 10, return_pct: 1 }),
      trade({ pnl_usd: -10, return_pct: -1 }),
      trade({ pnl_usd: 0, return_pct: 0, exit: 1.2 }),
      trade({ pnl_usd: 0, return_pct: 0, exit: 1.2, contract: 'SPY 760C 10/30' }),
    ],
  }, 'all');
  assert.equal(model.stats.winLossLabel, '1–1, 2 flats');
});

test('view model explains an empty filter without pretending the file is empty', () => {
  const model = viewModel({
    updated_et: '2026-10-28T16:20:00-04:00',
    trades: [trade({ source_type: 'model' })],
  }, 'trader copy');
  assert.equal(model.ok, true);
  assert.equal(model.rows.length, 0);
  assert.match(model.emptyMessage, /trader-copy/i);
  assert.equal(model.stats.tradesLabel, '0');
  assert.equal(model.stats.winRateLabel, '—');
  assert.equal(model.stats.averageReturnLabel, '—');
});

test('view model reports a schema error instead of a table', () => {
  const model = viewModel({ trades: [] }, 'all');
  assert.equal(model.ok, false);
  assert.match(model.error, /updated_et/);
});

test('home nav links to the paper trades page', () => {
  const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
  assert.match(html, /href="paper-trades\.html"/);
});

test('paper trades page carries the disclaimer, nav, and data hook', () => {
  const html = fs.readFileSync(path.join(__dirname, 'paper-trades.html'), 'utf8');
  assert.match(html, /name="viewport"/);
  assert.match(html, /src="paper-trades\.js"/);
  assert.match(html, /href="index\.html#tools"/);
  assert.match(html, /entered at the ask/i);
  assert.match(html, /exited at the bid/i);
  assert.match(html, /one contract/i);
  assert.match(html, /not financial advice/i);
  assert.match(html, /past results do not guarantee future results/i);
  assert.match(html, /after the close/i);
  assert.match(html, /overflow-x:\s*auto/);
});

test('README documents the schema and the daily write', () => {
  const readme = fs.readFileSync(path.join(__dirname, 'README.md'), 'utf8');
  for (const field of ['updated_et', 'ticker', 'contract', 'source_type', 'pnl_usd', 'return_pct', 'exit_reason', 'trader copy']) {
    assert.ok(readme.includes(field), `README should mention ${field}`);
  }
  assert.match(readme, /data\/paper-trades\.json/);
  assert.match(readme, /ask/);
  assert.match(readme, /bid/);
  assert.match(readme, /closed/i);
});
