const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  parsePaperTrades,
  parseCbcPaperTrades,
  selectTrades,
  summarizeTrades,
  viewModel,
  cbcViewModel,
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

test('committed earlier-program file matches the schema', () => {
  const file = path.join(__dirname, 'data', 'paper-trades.json');
  assert.equal(fs.existsSync(file), true, 'data/paper-trades.json should be committed');
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  const parsed = parsePaperTrades(raw);
  assert.equal(parsed.ok, true);
  assert.ok(Array.isArray(parsed.trades));
  assert.ok(parsed.trades.length > 0);
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

function cbcTrade(overrides) {
  const row = {
    date: '2026-11-05',
    symbol: 'SPY',
    version: '1 contract',
    direction: 'LONG',
    contract: 'SPY 744C 11/5',
    entry_time_et: '11:28',
    entry: 4.12,
    exit_time_et: '11:43',
    exit: 2.88,
    contracts: 1,
    pnl_usd: -124,
    return_pct: -30.1,
    exit_reason: 'stop',
    peak_pct: 12,
    ...overrides,
  };
  if (!overrides || !Object.prototype.hasOwnProperty.call(overrides, 'contracts')) {
    row.contracts = row.version === '4 contract' ? 4 : 1;
  }
  return row;
}

function cbcFile(trades, updated) {
  return {
    updated_et: updated === undefined ? null : updated,
    strategy: 'MapleStax CBC 10m',
    trades,
  };
}

test('empty CBC record parses', () => {
  const parsed = parseCbcPaperTrades(cbcFile([]));
  assert.equal(parsed.ok, true);
  assert.equal(parsed.updatedEt, null);
  assert.equal(parsed.strategy, 'MapleStax CBC 10m');
  assert.deepEqual(parsed.trades, []);
});

test('committed CBC file is an empty paper record', () => {
  const file = path.join(__dirname, 'data', 'cbc-paper-trades.json');
  assert.equal(fs.existsSync(file), true, 'data/cbc-paper-trades.json should be committed');
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.deepEqual(raw, {
    updated_et: null,
    strategy: 'MapleStax CBC 10m',
    trades: [],
  });
  const parsed = parseCbcPaperTrades(raw);
  assert.equal(parsed.ok, true);
  assert.deepEqual(parsed.trades, []);
});

test('CBC and earlier schemas are not interchangeable', () => {
  const earlier = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'paper-trades.json'), 'utf8'));
  const cbc = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'cbc-paper-trades.json'), 'utf8'));
  assert.equal(parseCbcPaperTrades(earlier).ok, false);
  assert.equal(parsePaperTrades(cbc).ok, false);
});

test('CBC rejects handles, balances, links, and the earlier timestamp shape', () => {
  const withHandle = parseCbcPaperTrades(cbcFile([cbcTrade({ handle: '@someone' })]));
  assert.equal(withHandle.ok, false);
  assert.match(withHandle.error, /handle/);

  const withAccount = parseCbcPaperTrades({
    updated_et: null,
    strategy: 'MapleStax CBC 10m',
    account: '123456',
    trades: [],
  });
  assert.equal(withAccount.ok, false);
  assert.match(withAccount.error, /account/);

  const withLink = parseCbcPaperTrades(cbcFile([cbcTrade({ contract: 'SPY 744C https://signals.example/a' })]));
  assert.equal(withLink.ok, false);
  assert.match(withLink.error, /link/);

  const iso = parseCbcPaperTrades(cbcFile([], '2026-11-05T16:30:00-05:00'));
  assert.equal(iso.ok, false);
  assert.match(iso.error, /updated_et/);
});

test('CBC rejects a bad version, direction, exit reason, contract count, and peak', () => {
  assert.equal(parseCbcPaperTrades(cbcFile([cbcTrade({ version: '2 contract' })])).ok, false);
  assert.equal(parseCbcPaperTrades(cbcFile([cbcTrade({ direction: 'long' })])).ok, false);
  assert.equal(parseCbcPaperTrades(cbcFile([cbcTrade({ exit_reason: 'expiration' })])).ok, false);
  assert.equal(parseCbcPaperTrades(cbcFile([cbcTrade({ version: '4 contract', contracts: 1 })])).ok, false);
  assert.equal(parseCbcPaperTrades(cbcFile([cbcTrade({ contracts: 4 })])).ok, false);
  assert.equal(parseCbcPaperTrades(cbcFile([cbcTrade({ peak_pct: '12' })])).ok, false);
  assert.equal(parseCbcPaperTrades(cbcFile([cbcTrade({ entry_time_et: '11:28 AM' })])).ok, false);
  const missingPeak = cbcTrade();
  delete missingPeak.peak_pct;
  assert.match(parseCbcPaperTrades(cbcFile([missingPeak])).error, /peak_pct/);
});

test('CBC accepts a null peak and the clock timestamp', () => {
  const parsed = parseCbcPaperTrades(cbcFile([
    cbcTrade({ version: '4 contract', peak_pct: null, exit_reason: 'scale-out' }),
  ], '2026-11-05 16:30 ET'));
  assert.equal(parsed.ok, true);
  assert.equal(parsed.updatedEt, '2026-11-05 16:30 ET');
  assert.equal(parsed.trades[0].contracts, 4);
  assert.equal(parsed.trades[0].peak_pct, null);
});

test('CBC view model for an empty file names the first-trade message', () => {
  const model = cbcViewModel(cbcFile([]));
  assert.equal(model.ok, true);
  assert.equal(model.strategy, 'MapleStax CBC 10m');
  assert.equal(model.updatedLabel, null);
  assert.equal(model.emptyMessage, 'First CBC trades post after the close.');
  assert.equal(model.rows.length, 0);
  for (const side of [model.one, model.four]) {
    assert.equal(side.tradesLabel, '0');
    assert.equal(side.winRateLabel, '—');
    assert.equal(side.totalPnlLabel, '$0.00');
    assert.equal(side.totalPnlSign, 'flat');
    assert.equal(side.averageReturnLabel, '—');
    assert.equal(side.averageReturnSign, 'flat');
  }
});

test('CBC view model splits versions and formats a closed paper trade', () => {
  const model = cbcViewModel(cbcFile([
    cbcTrade(),
    cbcTrade({
      date: '2026-11-04',
      symbol: 'QQQ',
      version: '4 contract',
      direction: 'SHORT',
      contract: 'QQQ 600P 11/4',
      entry_time_et: '09:05',
      entry: 1.5,
      exit_time_et: '15:40',
      exit: 1.2,
      pnl_usd: -120,
      return_pct: -20,
      exit_reason: 'time exit',
      peak_pct: null,
    }),
    cbcTrade({
      version: '4 contract',
      contract: 'SPY 744C 11/5',
      entry_time_et: '10:15',
      entry: 2,
      exit_time_et: '15:20',
      exit: 3.2,
      pnl_usd: 480,
      return_pct: 60,
      exit_reason: 'scale-out',
      peak_pct: 110,
    }),
    cbcTrade({
      version: '4 contract',
      contract: 'SPY 750C 11/5',
      entry_time_et: '12:00',
      entry: 1,
      exit_time_et: '15:20',
      exit: 1,
      pnl_usd: 0,
      return_pct: 0,
      exit_reason: 'flip',
      peak_pct: 0,
    }),
  ], '2026-11-05 16:30 ET'));

  assert.equal(model.ok, true);
  assert.equal(model.updatedLabel, 'Updated Nov 5, 2026, 4:30 PM ET');
  assert.equal(model.emptyMessage, null);
  assert.deepEqual(model.rows.map((row) => row.contract), [
    'SPY 750C 11/5',
    'SPY 744C 11/5',
    'SPY 744C 11/5',
    'QQQ 600P 11/4',
  ]);

  const stopped = model.rows[2];
  assert.equal(stopped.dateLabel, 'Nov 5, 2026');
  assert.equal(stopped.symbol, 'SPY');
  assert.equal(stopped.versionLabel, '1 contract');
  assert.equal(stopped.directionLabel, 'Long');
  assert.equal(stopped.entryTimeLabel, '11:28 AM ET');
  assert.equal(stopped.entryLabel, '$4.12');
  assert.equal(stopped.exitTimeLabel, '11:43 AM ET');
  assert.equal(stopped.exitLabel, '$2.88');
  assert.equal(stopped.contractsLabel, '1');
  assert.equal(stopped.pnlLabel, '−$124.00');
  assert.equal(stopped.pnlSign, 'negative');
  assert.equal(stopped.returnLabel, '−30.10%');
  assert.equal(stopped.returnSign, 'negative');
  assert.equal(stopped.peakLabel, '+12.00%');
  assert.equal(stopped.peakSign, 'positive');
  assert.equal(stopped.exitReasonLabel, 'Stop');

  const scaled = model.rows[1];
  assert.equal(scaled.versionLabel, '4 contract');
  assert.equal(scaled.contractsLabel, '4');
  assert.equal(scaled.exitLabel, '$3.20');
  assert.equal(scaled.pnlLabel, '+$480.00');
  assert.equal(scaled.pnlSign, 'positive');
  assert.equal(scaled.returnLabel, '+60.00%');
  assert.equal(scaled.exitReasonLabel, 'Scale-out');
  assert.equal(scaled.peakLabel, '+110.00%');

  const timed = model.rows[3];
  assert.equal(timed.symbol, 'QQQ');
  assert.equal(timed.directionLabel, 'Short');
  assert.equal(timed.entryTimeLabel, '9:05 AM ET');
  assert.equal(timed.exitTimeLabel, '3:40 PM ET');
  assert.equal(timed.exitReasonLabel, 'Time exit');
  assert.equal(timed.peakLabel, '—');
  assert.equal(timed.peakSign, 'flat');

  assert.equal(model.rows[0].exitTimeLabel, '3:20 PM ET');
  assert.equal(model.rows[0].entryTimeLabel, '12:00 PM ET');
  assert.equal(model.rows[0].exitReasonLabel, 'Flip');
  assert.equal(model.rows[0].peakLabel, '0.00%');

  assert.equal(model.one.tradesLabel, '1');
  assert.equal(model.one.winRateLabel, '0.0%');
  assert.equal(model.one.totalPnlLabel, '−$124.00');
  assert.equal(model.one.totalPnlSign, 'negative');
  assert.equal(model.one.averageReturnLabel, '−30.10%');
  assert.equal(model.one.averageReturnSign, 'negative');

  assert.equal(model.four.tradesLabel, '3');
  assert.equal(model.four.winRateLabel, '33.3%');
  assert.equal(model.four.totalPnlLabel, '+$360.00');
  assert.equal(model.four.totalPnlSign, 'positive');
  assert.equal(model.four.averageReturnLabel, '+13.33%');
  assert.equal(model.four.averageReturnSign, 'positive');
});

test('paper trades page features CBC and keeps the earlier program', () => {
  const html = fs.readFileSync(path.join(__dirname, 'paper-trades.html'), 'utf8');
  assert.match(html, /id="cbc-paper-trades-root"/);
  assert.match(html, /data\/cbc-paper-trades\.json/);
  assert.match(html, /MapleStax CBC/);
  assert.match(html, /First CBC trades post after the close/);
  assert.match(html, /Earlier program: X trader alerts \(ended Nov 2026\)/);
  assert.match(html, /id="paper-trades-root"/);
  assert.match(html, /mountCbc/);
  assert.match(html, /not real money/i);
  assert.match(html, /0DTE/);
  assert.match(html, /3:40/);
  assert.match(html, /profit lock/i);
  assert.match(html, /\+100%/);
  assert.match(html, /\+40%/);
  assert.match(html, /November 6, 2026/);
  assert.match(html, /entered at the ask/i);
  assert.match(html, /exited at the bid/i);
  assert.doesNotMatch(html, /x\.com|twitter\.com|tradingview\.com/i);
});

test('README documents the CBC file beside the earlier schema', () => {
  const readme = fs.readFileSync(path.join(__dirname, 'README.md'), 'utf8');
  assert.match(readme, /data\/cbc-paper-trades\.json/);
  assert.match(readme, /MapleStax CBC 10m/);
  assert.match(readme, /YYYY-MM-DD HH:MM ET/);
  assert.match(readme, /4 contract/);
  assert.match(readme, /peak_pct/);
  assert.match(readme, /First CBC trades post after the close/);
  for (const field of ['symbol', 'direction', 'entry_time_et', 'contracts', 'scale-out']) {
    assert.ok(readme.includes(field), `README should mention ${field}`);
  }
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
