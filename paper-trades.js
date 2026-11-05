(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }
  root.PaperTrades = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var ROOT_KEYS = { updated_et: true, trades: true };
  var TRADE_KEYS = ['date', 'ticker', 'contract', 'source_type', 'entry', 'exit', 'pnl_usd', 'return_pct', 'exit_reason'];
  var TRADE_KEY_SET = {};
  for (var i = 0; i < TRADE_KEYS.length; i++) TRADE_KEY_SET[TRADE_KEYS[i]] = true;
  var CBC_ROOT_KEYS = { updated_et: true, strategy: true, trades: true };
  var CBC_TRADE_KEYS = ['date', 'symbol', 'version', 'direction', 'contract', 'entry_time_et', 'entry', 'exit_time_et', 'exit', 'contracts', 'pnl_usd', 'return_pct', 'exit_reason', 'peak_pct'];
  var CBC_TRADE_KEY_SET = {};
  for (var c = 0; c < CBC_TRADE_KEYS.length; c++) CBC_TRADE_KEY_SET[CBC_TRADE_KEYS[c]] = true;
  var CBC_EXIT_REASONS = {
    'stop': 'Stop',
    'target': 'Target',
    'profit lock': 'Profit lock',
    'flip': 'Flip',
    'scale-out': 'Scale-out',
    'time exit': 'Time exit'
  };
  var CBC_EMPTY_MESSAGE = 'First CBC trades post after the close.';
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var usd = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });

  function fail(error) {
    return { ok: false, error: error };
  }

  function isObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  }

  function isRealDate(value) {
    var match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (!match) return false;
    var year = Number(match[1]);
    var month = Number(match[2]);
    var day = Number(match[3]);
    var utc = new Date(Date.UTC(year, month - 1, day));
    return utc.getUTCFullYear() === year && utc.getUTCMonth() === month - 1 && utc.getUTCDate() === day;
  }

  function parseUpdated(value) {
    if (value === null) return { ok: true, updatedEt: null };
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) {
      return fail('updated_et must be null or an ISO 8601 date-time.');
    }
    if (!isRealDate(value.slice(0, 10)) || Number.isNaN(new Date(value).getTime())) {
      return fail('updated_et must be null or an ISO 8601 date-time.');
    }
    return { ok: true, updatedEt: value };
  }

  function parseTrade(value, index) {
    var label = 'trades[' + index + ']';
    if (!isObject(value)) return fail(label + ' must be an object.');
    var keys = Object.keys(value);
    for (var k = 0; k < keys.length; k++) {
      if (!TRADE_KEY_SET[keys[k]]) return fail(label + ' has unknown field "' + keys[k] + '".');
    }
    for (var r = 0; r < TRADE_KEYS.length; r++) {
      if (!Object.prototype.hasOwnProperty.call(value, TRADE_KEYS[r])) {
        return fail(label + ' missing ' + TRADE_KEYS[r] + '.');
      }
    }
    if (!isRealDate(value.date)) return fail(label + '.date must be a real YYYY-MM-DD date.');
    if (typeof value.ticker !== 'string' || !/^[A-Z][A-Z0-9.]{0,9}$/.test(value.ticker)) {
      return fail(label + '.ticker must be a symbol such as SPY.');
    }
    var contract = parsePlainText(value.contract, label + '.contract', 80);
    if (!contract.ok) return contract;
    if (value.source_type !== 'trader copy' && value.source_type !== 'model') {
      return fail(label + '.source_type must be "trader copy" or "model".');
    }
    var entry = parseNumber(value.entry, label + '.entry');
    if (!entry.ok) return entry;
    if (!(entry.value > 0)) return fail(label + '.entry must be a number greater than 0.');
    var exit = parseNumber(value.exit, label + '.exit');
    if (!exit.ok) return exit;
    if (exit.value < 0) return fail(label + '.exit must be a number zero or greater.');
    var pnl = parseNumber(value.pnl_usd, label + '.pnl_usd');
    if (!pnl.ok) return pnl;
    var ret = parseNumber(value.return_pct, label + '.return_pct');
    if (!ret.ok) return ret;
    var reason = parsePlainText(value.exit_reason, label + '.exit_reason', 80);
    if (!reason.ok) return reason;
    return {
      ok: true,
      trade: {
        date: value.date,
        ticker: value.ticker,
        contract: contract.value,
        source_type: value.source_type,
        entry: entry.value,
        exit: exit.value,
        pnl_usd: pnl.value,
        return_pct: ret.value,
        exit_reason: reason.value
      }
    };
  }

  function parsePlainText(value, label, max) {
    if (typeof value !== 'string' || value.length === 0 || value.trim() !== value) {
      return fail(label + ' must be a non-empty string.');
    }
    if (value.length > max) return fail(label + ' is too long.');
    if (/[\u0000-\u001F]/.test(value)) return fail(label + ' cannot include line breaks.');
    if (value.indexOf('@') !== -1) return fail(label + ' cannot include @.');
    return { ok: true, value: value };
  }

  function parseNumber(value, label) {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      return fail(label + ' must be a finite number.');
    }
    return { ok: true, value: value };
  }

  function parsePaperTrades(data) {
    if (!isObject(data)) return fail('Paper trades data must be an object.');
    var keys = Object.keys(data);
    for (var k = 0; k < keys.length; k++) {
      if (!ROOT_KEYS[keys[k]]) return fail('Unknown field "' + keys[k] + '".');
    }
    if (!Object.prototype.hasOwnProperty.call(data, 'updated_et')) return fail('Missing updated_et.');
    var updated = parseUpdated(data.updated_et);
    if (!updated.ok) return updated;
    if (!Object.prototype.hasOwnProperty.call(data, 'trades')) return fail('Missing trades.');
    if (!Array.isArray(data.trades)) return fail('trades must be an array.');
    var trades = [];
    for (var i = 0; i < data.trades.length; i++) {
      var parsed = parseTrade(data.trades[i], i);
      if (!parsed.ok) return parsed;
      trades.push(parsed.trade);
    }
    return { ok: true, updatedEt: updated.updatedEt, trades: trades };
  }

  function parseCbcUpdated(value) {
    if (value === null) return { ok: true, updatedEt: null };
    var match = /^(\d{4}-\d{2}-\d{2}) ([01]\d|2[0-3]):[0-5]\d ET$/.exec(value);
    if (!match || !isRealDate(match[1])) {
      return fail('updated_et must be null or "YYYY-MM-DD HH:MM ET".');
    }
    return { ok: true, updatedEt: value };
  }

  function parseCbcText(value, label, max) {
    var parsed = parsePlainText(value, label, max);
    if (!parsed.ok) return parsed;
    if (/https?:\/\/|www\./i.test(parsed.value)) return fail(label + ' cannot include a link.');
    return parsed;
  }

  function parseCbcClock(value, label) {
    if (typeof value !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) {
      return fail(label + ' must be a 24-hour HH:MM time.');
    }
    return { ok: true, value: value };
  }

  function parseCbcTrade(value, index) {
    var label = 'trades[' + index + ']';
    if (!isObject(value)) return fail(label + ' must be an object.');
    var keys = Object.keys(value);
    for (var k = 0; k < keys.length; k++) {
      if (!CBC_TRADE_KEY_SET[keys[k]]) return fail(label + ' has unknown field "' + keys[k] + '".');
    }
    for (var r = 0; r < CBC_TRADE_KEYS.length; r++) {
      if (!Object.prototype.hasOwnProperty.call(value, CBC_TRADE_KEYS[r])) {
        return fail(label + ' missing ' + CBC_TRADE_KEYS[r] + '.');
      }
    }
    if (!isRealDate(value.date)) return fail(label + '.date must be a real YYYY-MM-DD date.');
    if (typeof value.symbol !== 'string' || !/^[A-Z][A-Z0-9.]{0,9}$/.test(value.symbol)) {
      return fail(label + '.symbol must be a symbol such as SPY.');
    }
    if (value.version !== '1 contract' && value.version !== '4 contract') {
      return fail(label + '.version must be "1 contract" or "4 contract".');
    }
    if (value.direction !== 'LONG' && value.direction !== 'SHORT') {
      return fail(label + '.direction must be "LONG" or "SHORT".');
    }
    var contract = parseCbcText(value.contract, label + '.contract', 80);
    if (!contract.ok) return contract;
    var entryTime = parseCbcClock(value.entry_time_et, label + '.entry_time_et');
    if (!entryTime.ok) return entryTime;
    var entry = parseNumber(value.entry, label + '.entry');
    if (!entry.ok) return entry;
    if (!(entry.value > 0)) return fail(label + '.entry must be a number greater than 0.');
    var exitTime = parseCbcClock(value.exit_time_et, label + '.exit_time_et');
    if (!exitTime.ok) return exitTime;
    var exit = parseNumber(value.exit, label + '.exit');
    if (!exit.ok) return exit;
    if (exit.value < 0) return fail(label + '.exit must be a number zero or greater.');
    if (typeof value.contracts !== 'number' || !Number.isInteger(value.contracts)) {
      return fail(label + '.contracts must be a whole number.');
    }
    if (value.version === '1 contract' && value.contracts !== 1) {
      return fail(label + '.contracts must be 1 for the 1 contract version.');
    }
    if (value.version === '4 contract' && value.contracts !== 4) {
      return fail(label + '.contracts must be 4 for the 4 contract version.');
    }
    var pnl = parseNumber(value.pnl_usd, label + '.pnl_usd');
    if (!pnl.ok) return pnl;
    var ret = parseNumber(value.return_pct, label + '.return_pct');
    if (!ret.ok) return ret;
    if (typeof value.exit_reason !== 'string' || !Object.prototype.hasOwnProperty.call(CBC_EXIT_REASONS, value.exit_reason)) {
      return fail(label + '.exit_reason must be stop, target, profit lock, flip, scale-out, or time exit.');
    }
    var peak = null;
    if (value.peak_pct !== null) {
      var parsedPeak = parseNumber(value.peak_pct, label + '.peak_pct');
      if (!parsedPeak.ok) return parsedPeak;
      peak = parsedPeak.value;
    }
    return {
      ok: true,
      trade: {
        date: value.date,
        symbol: value.symbol,
        version: value.version,
        direction: value.direction,
        contract: contract.value,
        entry_time_et: entryTime.value,
        entry: entry.value,
        exit_time_et: exitTime.value,
        exit: exit.value,
        contracts: value.contracts,
        pnl_usd: pnl.value,
        return_pct: ret.value,
        exit_reason: value.exit_reason,
        peak_pct: peak
      }
    };
  }

  function parseCbcPaperTrades(data) {
    if (!isObject(data)) return fail('CBC paper trades data must be an object.');
    var keys = Object.keys(data);
    for (var k = 0; k < keys.length; k++) {
      if (!CBC_ROOT_KEYS[keys[k]]) return fail('Unknown field "' + keys[k] + '".');
    }
    if (!Object.prototype.hasOwnProperty.call(data, 'updated_et')) return fail('Missing updated_et.');
    var updated = parseCbcUpdated(data.updated_et);
    if (!updated.ok) return updated;
    if (!Object.prototype.hasOwnProperty.call(data, 'strategy')) return fail('Missing strategy.');
    var strategy = parseCbcText(data.strategy, 'strategy', 80);
    if (!strategy.ok) return strategy;
    if (!Object.prototype.hasOwnProperty.call(data, 'trades')) return fail('Missing trades.');
    if (!Array.isArray(data.trades)) return fail('trades must be an array.');
    var trades = [];
    for (var i = 0; i < data.trades.length; i++) {
      var parsed = parseCbcTrade(data.trades[i], i);
      if (!parsed.ok) return parsed;
      trades.push(parsed.trade);
    }
    return { ok: true, updatedEt: updated.updatedEt, strategy: strategy.value, trades: trades };
  }

  function selectTrades(trades, filter) {
    var filtered = filter === 'all' ? trades : trades.filter(function (trade) {
      return trade.source_type === filter;
    });
    return filtered.map(function (trade, index) {
      return { trade: trade, index: index };
    }).sort(function (a, b) {
      if (a.trade.date !== b.trade.date) return a.trade.date < b.trade.date ? 1 : -1;
      return b.index - a.index;
    }).map(function (item) {
      return item.trade;
    });
  }

  function summarizeTrades(trades) {
    var wins = 0;
    var losses = 0;
    var flats = 0;
    var pnlCents = 0;
    var returnSum = 0;
    for (var i = 0; i < trades.length; i++) {
      var pnl = Math.round(trades[i].pnl_usd * 100);
      pnlCents += pnl;
      returnSum += trades[i].return_pct;
      if (pnl > 0) wins += 1;
      else if (pnl < 0) losses += 1;
      else flats += 1;
    }
    var count = trades.length;
    return {
      count: count,
      wins: wins,
      losses: losses,
      flats: flats,
      winRate: count === 0 ? null : (wins / count) * 100,
      totalPnl: pnlCents / 100,
      averageReturn: count === 0 ? null : returnSum / count
    };
  }

  function formatTradeDate(iso) {
    var parts = iso.split('-');
    return MONTHS[Number(parts[1]) - 1] + ' ' + Number(parts[2]) + ', ' + parts[0];
  }

  function formatUpdatedEt(value) {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      timeZoneName: 'short'
    }).format(new Date(value));
  }

  function formatPlainUsd(amount) {
    return usd.format(amount);
  }

  function formatSignedUsd(amount) {
    var cents = Math.round(amount * 100);
    var body = usd.format(Math.abs(cents) / 100);
    if (cents > 0) return { label: '+' + body, sign: 'positive' };
    if (cents < 0) return { label: '−' + body, sign: 'negative' };
    return { label: body, sign: 'flat' };
  }

  function formatReturnPct(amount) {
    var scaled = Math.round(amount * 100) / 100;
    var text = Math.abs(scaled).toFixed(2) + '%';
    if (scaled > 0) return { label: '+' + text, sign: 'positive' };
    if (scaled < 0) return { label: '−' + text, sign: 'negative' };
    return { label: text, sign: 'flat' };
  }

  function formatWinLoss(stats) {
    var label = stats.wins + '–' + stats.losses;
    if (stats.flats === 1) label += ', 1 flat';
    else if (stats.flats > 1) label += ', ' + stats.flats + ' flats';
    return label;
  }

  function formatStats(stats) {
    var pnl = formatSignedUsd(stats.totalPnl);
    var average = stats.averageReturn === null
      ? { label: '—', sign: 'flat' }
      : formatReturnPct(stats.averageReturn);
    return {
      tradesLabel: String(stats.count),
      winLossLabel: formatWinLoss(stats),
      winRateLabel: stats.winRate === null ? '—' : stats.winRate.toFixed(1) + '%',
      totalPnlLabel: pnl.label,
      totalPnlSign: pnl.sign,
      averageReturnLabel: average.label,
      averageReturnSign: average.sign
    };
  }

  function sourceLabel(source) {
    if (source === 'trader copy') return 'Trader copy';
    return 'Model';
  }

  function formatRow(trade) {
    var pnl = formatSignedUsd(trade.pnl_usd);
    var ret = formatReturnPct(trade.return_pct);
    return {
      dateLabel: formatTradeDate(trade.date),
      ticker: trade.ticker,
      contract: trade.contract,
      sourceLabel: sourceLabel(trade.source_type),
      entryLabel: formatPlainUsd(trade.entry),
      exitLabel: formatPlainUsd(trade.exit),
      pnlLabel: pnl.label,
      pnlSign: pnl.sign,
      returnLabel: ret.label,
      returnSign: ret.sign,
      exitReason: trade.exit_reason
    };
  }

  function formatClockEt(hhmm) {
    var hour = Number(hhmm.slice(0, 2));
    var minute = hhmm.slice(3, 5);
    var suffix = hour >= 12 ? 'PM' : 'AM';
    var hour12 = hour % 12;
    if (hour12 === 0) hour12 = 12;
    return hour12 + ':' + minute + ' ' + suffix + ' ET';
  }

  function formatCbcUpdated(value) {
    var match = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}:\d{2}) ET$/.exec(value);
    return formatTradeDate(match[1] + '-' + match[2] + '-' + match[3]) + ', ' + formatClockEt(match[4]);
  }

  function formatPeak(value) {
    if (value === null) return { label: '—', sign: 'flat' };
    return formatReturnPct(value);
  }

  function formatVersionStats(trades) {
    var formatted = formatStats(summarizeTrades(trades));
    return {
      tradesLabel: formatted.tradesLabel,
      winRateLabel: formatted.winRateLabel,
      totalPnlLabel: formatted.totalPnlLabel,
      totalPnlSign: formatted.totalPnlSign,
      averageReturnLabel: formatted.averageReturnLabel,
      averageReturnSign: formatted.averageReturnSign
    };
  }

  function selectCbcTrades(trades) {
    return trades.map(function (trade, index) {
      return { trade: trade, index: index };
    }).sort(function (a, b) {
      if (a.trade.date !== b.trade.date) return a.trade.date < b.trade.date ? 1 : -1;
      if (a.trade.exit_time_et !== b.trade.exit_time_et) {
        return a.trade.exit_time_et < b.trade.exit_time_et ? 1 : -1;
      }
      return b.index - a.index;
    }).map(function (item) {
      return item.trade;
    });
  }

  function formatCbcRow(trade) {
    var pnl = formatSignedUsd(trade.pnl_usd);
    var ret = formatReturnPct(trade.return_pct);
    var peak = formatPeak(trade.peak_pct);
    return {
      dateLabel: formatTradeDate(trade.date),
      symbol: trade.symbol,
      versionLabel: trade.version,
      directionLabel: trade.direction === 'LONG' ? 'Long' : 'Short',
      contract: trade.contract,
      entryTimeLabel: formatClockEt(trade.entry_time_et),
      entryLabel: formatPlainUsd(trade.entry),
      exitTimeLabel: formatClockEt(trade.exit_time_et),
      exitLabel: formatPlainUsd(trade.exit),
      contractsLabel: String(trade.contracts),
      pnlLabel: pnl.label,
      pnlSign: pnl.sign,
      returnLabel: ret.label,
      returnSign: ret.sign,
      peakLabel: peak.label,
      peakSign: peak.sign,
      exitReasonLabel: CBC_EXIT_REASONS[trade.exit_reason]
    };
  }

  function emptyMessage(parsedCount, filter) {
    if (parsedCount === 0) {
      return 'No closed paper trades yet. They show up here after the close, once a trade is done.';
    }
    if (filter === 'trader copy') return 'No closed trader-copy trades in this track record.';
    return 'No closed model trades in this track record.';
  }

  function viewModel(data, filter) {
    var parsed = parsePaperTrades(data);
    if (!parsed.ok) return parsed;
    if (filter !== 'all' && filter !== 'trader copy' && filter !== 'model') {
      return fail('Unknown filter.');
    }
    var rows = selectTrades(parsed.trades, filter);
    return {
      ok: true,
      updatedLabel: parsed.updatedEt
        ? 'Updated ' + formatUpdatedEt(parsed.updatedEt)
        : 'Waiting for the first after-close update.',
      scopeLabel: filter === 'all'
        ? 'All closed trades'
        : filter === 'trader copy'
          ? 'Trader copies only'
          : 'Model picks only',
      emptyMessage: rows.length === 0 ? emptyMessage(parsed.trades.length, filter) : null,
      stats: formatStats(summarizeTrades(rows)),
      rows: rows.map(formatRow)
    };
  }

  function cbcViewModel(data) {
    var parsed = parseCbcPaperTrades(data);
    if (!parsed.ok) return parsed;
    var ordered = selectCbcTrades(parsed.trades);
    var one = [];
    var four = [];
    for (var i = 0; i < ordered.length; i++) {
      if (ordered[i].version === '1 contract') one.push(ordered[i]);
      else four.push(ordered[i]);
    }
    return {
      ok: true,
      strategy: parsed.strategy,
      updatedLabel: parsed.updatedEt ? 'Updated ' + formatCbcUpdated(parsed.updatedEt) : null,
      emptyMessage: ordered.length === 0 ? CBC_EMPTY_MESSAGE : null,
      one: formatVersionStats(one),
      four: formatVersionStats(four),
      rows: ordered.map(formatCbcRow)
    };
  }

  function setText(root, id, text) {
    var node = root.querySelector('#' + id);
    if (node) node.textContent = text;
  }

  function render(root, model) {
    var updated = root.querySelector('#pt-updated');
    var error = root.querySelector('#pt-error');
    var stats = root.querySelector('#pt-stats');
    var scope = root.querySelector('#pt-scope');
    var empty = root.querySelector('#pt-empty');
    var tableWrap = root.querySelector('#pt-table-wrap');
    var filters = root.querySelector('#pt-filters');
    var tbody = root.querySelector('#pt-rows');

    if (!model.ok) {
      if (updated) updated.hidden = true;
      if (filters) filters.hidden = true;
      if (stats) stats.hidden = true;
      if (scope) scope.hidden = true;
      if (empty) empty.hidden = true;
      if (tableWrap) tableWrap.hidden = true;
      if (error) {
        error.hidden = false;
        error.textContent = 'This track record could not be read. ' + model.error;
      }
      return;
    }

    if (error) error.hidden = true;
    if (filters) filters.hidden = false;
    if (updated) {
      updated.hidden = false;
      updated.textContent = model.updatedLabel;
    }
    if (scope) {
      scope.hidden = false;
      scope.textContent = model.scopeLabel;
    }
    if (stats) {
      stats.hidden = false;
      setText(stats, 'pt-trades', model.stats.tradesLabel);
      setText(stats, 'pt-winloss', model.stats.winLossLabel);
      setText(stats, 'pt-winrate', model.stats.winRateLabel);
      paintSigned(stats, 'pt-pnl', model.stats.totalPnlLabel, model.stats.totalPnlSign);
      paintSigned(stats, 'pt-avg', model.stats.averageReturnLabel, model.stats.averageReturnSign);
    }
    if (!tbody || !tableWrap || !empty) return;
    tbody.replaceChildren();
    if (model.rows.length === 0) {
      empty.hidden = false;
      empty.textContent = model.emptyMessage;
      tableWrap.hidden = true;
      return;
    }
    empty.hidden = true;
    tableWrap.hidden = false;
    for (var i = 0; i < model.rows.length; i++) tbody.appendChild(rowElement(model.rows[i]));
  }

  function paintSigned(root, id, text, sign) {
    var node = root.querySelector('#' + id);
    if (!node) return;
    node.textContent = text;
    node.className = 'pt-' + sign;
  }

  function cell(text, className) {
    var td = document.createElement('td');
    td.textContent = text;
    if (className) td.className = className;
    return td;
  }

  function rowElement(row) {
    var tr = document.createElement('tr');
    tr.appendChild(cell(row.dateLabel, ''));
    tr.appendChild(cell(row.ticker, 'pt-ticker'));
    tr.appendChild(cell(row.contract, ''));
    tr.appendChild(cell(row.sourceLabel, ''));
    tr.appendChild(cell(row.entryLabel, 'pt-num'));
    tr.appendChild(cell(row.exitLabel, 'pt-num'));
    tr.appendChild(cell(row.pnlLabel, 'pt-num pt-' + row.pnlSign));
    tr.appendChild(cell(row.returnLabel, 'pt-num pt-' + row.returnSign));
    tr.appendChild(cell(row.exitReason, ''));
    return tr;
  }

  function paintVersion(root, prefix, stats) {
    setText(root, prefix + '-trades', stats.tradesLabel);
    setText(root, prefix + '-winrate', stats.winRateLabel);
    paintSigned(root, prefix + '-pnl', stats.totalPnlLabel, stats.totalPnlSign);
    paintSigned(root, prefix + '-avg', stats.averageReturnLabel, stats.averageReturnSign);
  }

  function priceCell(amount, time) {
    var td = document.createElement('td');
    td.className = 'pt-num';
    td.appendChild(document.createTextNode(amount));
    var sub = document.createElement('span');
    sub.className = 'pt-sub';
    sub.textContent = time;
    td.appendChild(sub);
    return td;
  }

  function cbcRowElement(row) {
    var tr = document.createElement('tr');
    tr.appendChild(cell(row.dateLabel, ''));
    tr.appendChild(cell(row.symbol, 'pt-ticker'));
    tr.appendChild(cell(row.versionLabel, ''));
    tr.appendChild(cell(row.directionLabel, ''));
    tr.appendChild(cell(row.contract, ''));
    tr.appendChild(priceCell(row.entryLabel, row.entryTimeLabel));
    tr.appendChild(priceCell(row.exitLabel, row.exitTimeLabel));
    tr.appendChild(cell(row.contractsLabel, 'pt-num'));
    tr.appendChild(cell(row.pnlLabel, 'pt-num pt-' + row.pnlSign));
    tr.appendChild(cell(row.returnLabel, 'pt-num pt-' + row.returnSign));
    tr.appendChild(cell(row.peakLabel, 'pt-num pt-' + row.peakSign));
    tr.appendChild(cell(row.exitReasonLabel, ''));
    return tr;
  }

  function renderCbc(root, model) {
    var updated = root.querySelector('#cbc-updated');
    var strategy = root.querySelector('#cbc-strategy');
    var error = root.querySelector('#cbc-error');
    var stats = root.querySelector('#cbc-stats');
    var empty = root.querySelector('#cbc-empty');
    var tableWrap = root.querySelector('#cbc-table-wrap');
    var tbody = root.querySelector('#cbc-rows');

    if (!model.ok) {
      if (updated) updated.hidden = true;
      if (strategy) strategy.hidden = true;
      if (stats) stats.hidden = true;
      if (empty) empty.hidden = true;
      if (tableWrap) tableWrap.hidden = true;
      if (error) {
        error.hidden = false;
        error.textContent = 'This CBC paper record could not be read. ' + model.error;
      }
      return;
    }

    if (error) error.hidden = true;
    if (strategy) {
      strategy.hidden = false;
      strategy.textContent = model.strategy;
    }
    if (updated) {
      if (model.updatedLabel) {
        updated.hidden = false;
        updated.textContent = model.updatedLabel;
      } else {
        updated.hidden = true;
      }
    }
    if (stats) {
      stats.hidden = false;
      paintVersion(stats, 'cbc-1', model.one);
      paintVersion(stats, 'cbc-4', model.four);
    }
    if (!tbody || !tableWrap || !empty) return;
    tbody.replaceChildren();
    if (model.rows.length === 0) {
      empty.hidden = false;
      empty.textContent = model.emptyMessage;
      tableWrap.hidden = true;
      return;
    }
    empty.hidden = true;
    tableWrap.hidden = false;
    for (var i = 0; i < model.rows.length; i++) tbody.appendChild(cbcRowElement(model.rows[i]));
  }

  function mount(root) {
    var filter = 'all';
    fetch('data/paper-trades.json', { cache: 'no-cache' })
      .then(function (response) {
        if (!response.ok) throw new Error('status ' + response.status);
        return response.json();
      })
      .then(function (data) {
        var buttons = root.querySelectorAll('[data-filter]');
        for (var i = 0; i < buttons.length; i++) {
          buttons[i].addEventListener('click', function (event) {
            filter = event.currentTarget.getAttribute('data-filter');
            for (var j = 0; j < buttons.length; j++) {
              buttons[j].setAttribute('aria-pressed', buttons[j] === event.currentTarget ? 'true' : 'false');
            }
            render(root, viewModel(data, filter));
          });
        }
        render(root, viewModel(data, filter));
      })
      .catch(function () {
        render(root, { ok: false, error: 'The paper trades file could not be loaded.' });
      });
  }

  function mountCbc(root) {
    if (!root) return;
    fetch('data/cbc-paper-trades.json', { cache: 'no-cache' })
      .then(function (response) {
        if (response.status === 404) return { missing: true };
        if (!response.ok) throw new Error('status ' + response.status);
        return response.json().then(function (data) {
          return { missing: false, data: data };
        });
      })
      .then(function (result) {
        if (result.missing) {
          renderCbc(root, cbcViewModel({
            updated_et: null,
            strategy: 'MapleStax CBC 10m',
            trades: []
          }));
          return;
        }
        renderCbc(root, cbcViewModel(result.data));
      })
      .catch(function () {
        renderCbc(root, { ok: false, error: 'The CBC paper trades file could not be loaded.' });
      });
  }

  return {
    parsePaperTrades: parsePaperTrades,
    parseCbcPaperTrades: parseCbcPaperTrades,
    selectTrades: selectTrades,
    summarizeTrades: summarizeTrades,
    viewModel: viewModel,
    cbcViewModel: cbcViewModel,
    mount: mount,
    mountCbc: mountCbc
  };
});
