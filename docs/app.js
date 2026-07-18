const DATA_URL = window.DIGEST_DATA_URL || 'data/latest.json';

let allStocks = [];

// The default view: most recently mentioned first. Kept as one object so
// resetView() and first load cannot drift apart.
const DEFAULTS = { view: 'summary', filter: 'all', sortCol: 'last_mention', sortDir: -1 };

let activeView   = DEFAULTS.view;    // 'summary' | 'detail'
let activeFilter = DEFAULTS.filter;
let sortCol      = DEFAULTS.sortCol; // current sort column
let sortDir      = DEFAULTS.sortDir; // -1 = desc, 1 = asc

// ── Load ──────────────────────────────────────────────────────────────────

async function loadDigest() {
  try {
    const res = await fetch(DATA_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    document.getElementById('loading').classList.add('hidden');
    renderMeta(data);
    // Sort recs latest-first within each stock
    allStocks = (data.stocks || []).map(s => ({
      ...s,
      buys:   [...(s.buys   || [])].sort((a, b) => recDate(b).localeCompare(recDate(a))),
      avoids: [...(s.avoids || [])].sort((a, b) => recDate(b).localeCompare(recDate(a))),
    }));
    render();
  } catch (e) {
    document.getElementById('loading').classList.add('hidden');
    document.getElementById('error').classList.remove('hidden');
    console.error(e);
  }
}

function renderMeta(data) {
  const d = new Date(data.generated_at);
  const label = d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  document.getElementById('meta').textContent =
    `Updated ${label} · ${data.video_count} videos · ${data.stock_count} stocks`;
}

// ── Routing ───────────────────────────────────────────────────────────────

function render() {
  if (activeView === 'summary') {
    document.getElementById('summary-view').classList.remove('hidden');
    document.getElementById('detail-view').classList.add('hidden');
    renderSummary(filteredStocks());
  } else {
    document.getElementById('summary-view').classList.add('hidden');
    document.getElementById('detail-view').classList.remove('hidden');
    renderDetail(filteredStocks());
  }
}

function filteredStocks() {
  const query = document.getElementById('search').value.toLowerCase();
  let stocks = sortedStocks();
  if (activeFilter === 'buy')      stocks = stocks.filter(s => s.buy_count > 0);
  if (activeFilter === 'avoid')    stocks = stocks.filter(s => s.buy_count === 0 && s.avoid_count > 0);
  if (activeFilter === 'earnings') stocks = stocks.filter(s => s.market?.earnings_days != null && s.market.earnings_days >= 0 && s.market.earnings_days <= 14);
  if (query) stocks = stocks.filter(s =>
    s.ticker.toLowerCase().includes(query) ||
    s.company_name.toLowerCase().includes(query)
  );
  return stocks;
}

function sortedStocks() {
  return [...allStocks].sort((a, b) => {
    let av, bv;
    switch (sortCol) {
      case 'buy_count':    av = a.buy_count;   bv = b.buy_count;   break;
      case 'avoid_count':  av = a.avoid_count; bv = b.avoid_count; break;
      case 'ticker':       av = a.ticker;      bv = b.ticker;      break;
      case 'last_mention': av = lastMention(a); bv = lastMention(b); break;
      case 'price':        av = a.market?.current_price    ?? null; bv = b.market?.current_price    ?? null; break;
      case 'month_change': av = a.market?.month_change_pct ?? null; bv = b.market?.month_change_pct ?? null; break;
      default:             av = a.buy_count;   bv = b.buy_count;
    }
    // Missing values sort last whichever way the column is pointing, so stocks
    // with no market data don't crowd the top of a price sort.
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    // sortDir -1 means descending, so the larger value must come first: a < b has
    // to return a positive number. This was inverted, which sorted every column
    // backwards from the arrow shown in its header.
    return av < bv ? -sortDir : av > bv ? sortDir : 0;
  });
}

function lastMention(s) {
  const dates = [...(s.buys || []), ...(s.avoids || [])].map(r => r.upload_date || parseDateLabel(r.date_label)).filter(Boolean);
  return dates.length ? dates.sort().reverse()[0] : '';
}

// Every mention for a stock, buys and avoids interleaved, most recent first.
// buys and avoids are each sorted at load time but concatenating two sorted lists
// does not give a sorted list, so anything wanting a true chronological order
// across both must sort here rather than trust the concatenation.
function allMentions(s) {
  return [
    ...(s.buys   || []).map(r => ({ ...r, type: 'buy' })),
    ...(s.avoids || []).map(r => ({ ...r, type: 'avoid' })),
  ].sort((a, b) => recDate(b).localeCompare(recDate(a)));
}

function recDate(r) {
  return r.upload_date || parseDateLabel(r.date_label) || '';
}

// Clicking the title returns to the default view from anywhere: clears the search,
// the filter and any sort, not just the view toggle.
function resetView() {
  activeView   = DEFAULTS.view;
  activeFilter = DEFAULTS.filter;
  sortCol      = DEFAULTS.sortCol;
  sortDir      = DEFAULTS.sortDir;
  document.getElementById('search').value = '';
  document.querySelectorAll('.filter-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.filter === DEFAULTS.filter));
  updateViewButtons();
  render();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function goToDetail(ticker) {
  activeView = 'detail';
  activeFilter = 'all';
  document.getElementById('search').value = ticker;
  updateViewButtons();
  render();
  setTimeout(() => {
    const el = document.getElementById(`card-${ticker}`);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, 50);
}

// ── Summary view ──────────────────────────────────────────────────────────

function renderSummary(stocks) {
  const buys   = stocks.filter(s => s.buy_count > 0);
  const avoids = stocks.filter(s => s.buy_count === 0 && s.avoid_count > 0);
  const mixed  = stocks.filter(s => s.buy_count > 0 && s.avoid_count > 0);

  const container = document.getElementById('summary-view');
  container.innerHTML = `
    ${buys.length   ? `<div class="summary-section"><div class="summary-heading buy-head">▲ Buy recommendations (${buys.length})</div>${summaryTable(buys, 'buy')}</div>` : ''}
    ${avoids.length ? `<div class="summary-section"><div class="summary-heading avoid-head">▼ Avoid only (${avoids.length})</div>${summaryTable(avoids, 'avoid')}</div>` : ''}
    ${mixed.length  ? `<div class="summary-note">* ${mixed.length} stock(s) appear in both sections — creators are split.</div>` : ''}
  `;

  // Attach sort handlers
  container.querySelectorAll('th[data-col]').forEach(th => {
    th.addEventListener('click', () => {
      if (sortCol === th.dataset.col) sortDir *= -1;
      else { sortCol = th.dataset.col; sortDir = -1; }
      render();
    });
  });
}

// Each column owns its own label, sort key and cell renderer. The previous version
// kept labels and sort keys in two arrays matched by position, so the avoid table
// (which has one column fewer) mis-wired every header: clicking "Avoids" sorted by
// buy_count. Keeping the three together makes that class of bug unrepresentable.
function summaryColumns(type) {
  return [
    { label: 'Stock', col: 'ticker', cell: stockCell },
    { label: 'Price', col: 'price', cell: priceCell },
    { label: '1 month', col: 'month_change', cell: monthCell },
    { label: '52w range', cell: rangeCell },
    ...(type === 'buy'
      ? [{ label: 'Buys', col: 'buy_count', cell: s => `<td class="num">${s.buy_count}</td>` }]
      : []),
    { label: 'Avoids', col: 'avoid_count',
      cell: s => `<td class="num ${type === 'buy' && s.avoid_count > 0 ? 'warn' : ''}">${s.avoid_count || '—'}</td>` },
    { label: 'Last mentioned', col: 'last_mention',
      cell: s => `<td class="nowrap">${lastMentionLabel(s)}</td>` },
    { label: 'Creators', cell: creatorsCell },
    { label: 'Timeline', cell: s => `<td class="timeline-cell">${renderMiniTimeline(s)}</td>` },
    { label: '', cell: s => `<td><button class="detail-btn" onclick="goToDetail('${s.ticker}')">Detail ↗</button></td>` },
  ];
}

function stockCell(s) {
  const desc = s.description
    ? `<span class="sum-desc" title="${esc(s.description)}">${esc(s.description)}</span>`
    : '';
  return `<td class="stock-cell">
    <div class="stock-id"><span class="sum-ticker">${s.ticker}</span><span class="sum-company">${esc(s.company_name)}</span></div>
    ${desc}
  </td>`;
}

function priceCell(s) {
  const m = s.market;
  if (!m?.current_price) return '<td class="num-cell">—</td>';
  const cls = m.daily_change_pct >= 0 ? 'up' : 'down';
  return `<td class="num-cell">
    <span class="price-main">${m.currency} ${m.current_price.toFixed(2)}</span>
    <span class="price-sub ${cls}">${pct(m.daily_change_pct)}</span>
  </td>`;
}

function monthCell(s) {
  const v = s.market?.month_change_pct;
  if (v == null) return '<td class="num-cell">—</td>';
  return `<td class="num-cell"><span class="${v >= 0 ? 'up' : 'down'}">${pct(v)}</span></td>`;
}

// 52w high and low, plus where today's price sits between them. The marker is the
// reason this is one column rather than two: the numbers only mean something
// relative to the current price.
function rangeCell(s) {
  const m = s.market;
  if (!m?.week52_low || !m?.week52_high) return '<td class="num-cell">—</td>';
  const span = m.week52_high - m.week52_low;
  const posPct = span > 0
    ? Math.min(100, Math.max(0, ((m.current_price - m.week52_low) / span) * 100))
    : 50;
  const title = `Low ${m.week52_low.toFixed(2)} (${m.week52_low_date || '—'}) · High ${m.week52_high.toFixed(2)} (${m.week52_high_date || '—'})`;
  return `<td class="range-cell" title="${esc(title)}">
    <div class="range-nums"><span>${m.week52_low.toFixed(2)}</span><span>${m.week52_high.toFixed(2)}</span></div>
    <div class="range-bar"><span class="range-marker" style="left:${posPct.toFixed(1)}%"></span></div>
  </td>`;
}

function creatorsCell(s) {
  const creators = [...new Set(allMentions(s).map(r => r.channel))];
  const label = creators.length <= 2
    ? creators.join(', ')
    : `${creators.slice(0, 2).join(', ')} +${creators.length - 2}`;
  return `<td class="creators-cell" title="${esc(creators.join(', '))}">${esc(label)}</td>`;
}

function summaryTable(stocks, type) {
  const columns = summaryColumns(type);

  const rows = stocks.map(s => `<tr>${columns.map(c => c.cell(s)).join('')}</tr>`).join('');

  const thHtml = columns.map(c => {
    if (!c.col) return `<th>${c.label}</th>`;
    const arrow = sortCol === c.col ? (sortDir === -1 ? ' ↓' : ' ↑') : '';
    return `<th data-col="${c.col}">${c.label}${arrow}</th>`;
  }).join('');

  return `
    <div class="table-wrap">
      <table class="summary-table">
        <thead><tr>${thHtml}</tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

function lastMentionLabel(s) {
  const recent = allMentions(s)[0];
  return recent?.date_label || '—';
}

// Dates shown before collapsing. Only 16 of ~190 stocks mention more than this, so
// most timelines show in full; the busiest (18 dates) would otherwise be 700px wide.
const TIMELINE_VISIBLE = 6;
const expandedTimelines = new Set();

function toggleTimeline(ticker) {
  if (expandedTimelines.has(ticker)) expandedTimelines.delete(ticker);
  else expandedTimelines.add(ticker);
  render();
}

function renderMiniTimeline(s) {
  const mentions = allMentions(s); // most recent first
  if (!mentions.length) return '';

  // One point per date, not per mention: two creators on the same day is one
  // moment on the timeline, with both named in the tooltip.
  const byDate = new Map();
  mentions.forEach(r => {
    const d = recDate(r);
    if (!byDate.has(d)) byDate.set(d, []);
    byDate.get(d).push(r);
  });

  const dates    = [...byDate.keys()];
  const expanded = expandedTimelines.has(s.ticker);
  const shown    = expanded ? dates : dates.slice(0, TIMELINE_VISIBLE);
  const hidden   = dates.length - shown.length;

  // Reversed so the timeline reads oldest to newest, left to right.
  const points = [...shown].reverse().map(date => {
    const recs     = byDate.get(date);
    const hasBuy   = recs.some(r => r.type === 'buy');
    const hasAvoid = recs.some(r => r.type === 'avoid');
    const cls      = hasBuy && hasAvoid ? 'dot-mixed' : hasBuy ? 'dot-buy' : 'dot-avoid';
    const tooltip  = recs.map(r => `${r.channel} (${r.type === 'buy' ? 'BUY' : 'AVOID'}) — ${r.date_label}`).join('\n');
    return `<span class="tl-point" title="${esc(tooltip)}">
      <span class="dot ${cls}"></span>
      <span class="tl-date">${shortDate(date)}</span>
    </span>`;
  }).join('');

  let more = '';
  if (hidden > 0) {
    more = `<button class="tl-more" onclick="toggleTimeline('${s.ticker}')" title="Show all ${dates.length} dates">+${hidden} earlier</button>`;
  } else if (expanded && dates.length > TIMELINE_VISIBLE) {
    more = `<button class="tl-more" onclick="toggleTimeline('${s.ticker}')">show less</button>`;
  }

  return `<div class="mini-timeline">${more}${points}</div>`;
}

// ── Detail view ───────────────────────────────────────────────────────────

function renderDetail(stocks) {
  const container = document.getElementById('detail-view');
  if (!stocks.length) {
    container.innerHTML = '<p style="color:var(--muted);padding:40px">No stocks match this filter.</p>';
    return;
  }
  // Sort: most buys first, then most recent, avoid-only at bottom
  const sorted = [...stocks].sort((a, b) => {
    if (a.buy_count !== b.buy_count) return b.buy_count - a.buy_count;
    return lastMention(b).localeCompare(lastMention(a));
  });
  container.innerHTML = sorted.map(renderCard).join('');
}

// ── Card ──────────────────────────────────────────────────────────────────

function renderCard(s) {
  const m = s.market;

  const badges = [];
  if (s.buy_count > 0)   badges.push(`<span class="badge badge-buy">${s.buy_count} BUY</span>`);
  if (s.avoid_count > 0) badges.push(`<span class="badge badge-avoid">${s.avoid_count} AVOID</span>`);
  if (m?.earnings_days != null && m.earnings_days >= 0 && m.earnings_days <= 14)
    badges.push(`<span class="badge badge-earn">EARNINGS in ${m.earnings_days}d</span>`);

  const priceClass = m?.daily_change_pct >= 0 ? 'up' : 'down';
  const monthClass = m?.month_change_pct  >= 0 ? 'up' : 'down';
  const currency   = m?.currency || '';

  const marketRow = m ? `
    <div class="market-row">
      <div class="market-cell"><span class="market-label">Price</span><span class="market-value">${currency} ${m.current_price?.toFixed(2) ?? '—'}</span></div>
      <div class="market-cell"><span class="market-label">Today</span><span class="market-value ${priceClass}">${pct(m.daily_change_pct)}</span></div>
      <div class="market-cell"><span class="market-label">1 month</span><span class="market-value ${monthClass}">${pct(m.month_change_pct)}</span></div>
      <div class="market-cell"><span class="market-label">52w High</span><span class="market-value">${currency} ${m.week52_high?.toFixed(2) ?? '—'}</span></div>
      <div class="market-cell"><span class="market-label">52w Low</span><span class="market-value">${currency} ${m.week52_low?.toFixed(2) ?? '—'}</span></div>
      ${m.earnings_date ? `<div class="market-cell"><span class="market-label">Earnings</span><span class="market-value" style="color:var(--purple)">${m.earnings_date}</span></div>` : ''}
    </div>` : '';

  let sinceRec = '';
  if (s.price_at_first_mention && s.pct_change_since_rec != null) {
    const cls   = s.pct_change_since_rec >= 0 ? 'up' : 'down';
    const arrow = s.pct_change_since_rec >= 0 ? '▲' : '▼';
    sinceRec = `<div class="since-rec"><span class="label">Since first mentioned (${s.first_mention_date}):</span><span class="val ${cls}">${arrow} ${Math.abs(s.pct_change_since_rec)}% from ${currency} ${s.price_at_first_mention}</span></div>`;
  }

  let funds = '';
  if (m && (m.pe_trailing || m.pe_forward || m.revenue_growth != null || m.beta != null)) {
    const items = [];
    if (m.pe_trailing)          items.push(`<div class="fund-item"><span class="fund-label">P/E</span><span class="fund-value">${m.pe_trailing.toFixed(1)}x</span></div>`);
    if (m.pe_forward)           items.push(`<div class="fund-item"><span class="fund-label">Fwd P/E</span><span class="fund-value">${m.pe_forward.toFixed(1)}x</span></div>`);
    if (m.peg_ratio)            items.push(`<div class="fund-item"><span class="fund-label">PEG</span><span class="fund-value">${m.peg_ratio.toFixed(2)}</span></div>`);
    if (m.revenue_growth != null) items.push(`<div class="fund-item"><span class="fund-label">Rev growth</span><span class="fund-value ${m.revenue_growth >= 0 ? 'up' : 'down'}">${pct(m.revenue_growth * 100)}</span></div>`);
    if (m.profit_margins != null) items.push(`<div class="fund-item"><span class="fund-label">Margin</span><span class="fund-value">${pct(m.profit_margins * 100)}</span></div>`);
    if (m.beta != null)         items.push(`<div class="fund-item"><span class="fund-label">Beta</span><span class="fund-value">${m.beta.toFixed(2)}</span></div>`);
    if (m.short_percent != null) items.push(`<div class="fund-item"><span class="fund-label">Short %</span><span class="fund-value ${m.short_percent > 0.15 ? 'warn' : ''}">${pct(m.short_percent * 100)}</span></div>`);
    if (m.dividend_yield)       items.push(`<div class="fund-item"><span class="fund-label">Div yield</span><span class="fund-value">${pct(m.dividend_yield * 100)}</span></div>`);
    funds = `<div class="fundamentals">${items.join('')}</div>`;
  }

  let techs = '';
  if (m && (m.rsi != null || m.ma_signal)) {
    const items = [];
    if (m.rsi != null) {
      const rc = m.rsi_label === 'overbought' ? 'warn' : m.rsi_label === 'oversold' ? 'up' : 'neutral';
      items.push(`<span class="tech-item"><span class="tech-label">RSI: </span><span class="${rc}">${m.rsi} (${m.rsi_label})</span></span>`);
    }
    if (m.ma_signal) {
      const mac   = m.ma_signal === 'golden_cross' ? 'up' : 'down';
      const maLbl = m.ma_signal === 'golden_cross' ? '50d > 200d (bullish)' : '50d < 200d (bearish)';
      items.push(`<span class="tech-item"><span class="tech-label">MA: </span><span class="${mac}">${maLbl}</span></span>`);
    }
    techs = `<div class="technicals">${items.join('<span style="color:var(--border)"> | </span>')}</div>`;
  }

  let analysts = '';
  if (m && (m.analyst_buy != null || m.analyst_target)) {
    const total = (m.analyst_buy || 0) + (m.analyst_hold || 0) + (m.analyst_sell || 0);
    let bar = '';
    if (total > 0) {
      const bw = Math.round((m.analyst_buy / total) * 100);
      const hw = Math.round((m.analyst_hold / total) * 100);
      const sw = 100 - bw - hw;
      bar = `<div class="analyst-bar">
        <div class="seg" style="width:${bw}%;background:var(--green)"></div>
        <div class="seg" style="width:${hw}%;background:var(--amber)"></div>
        <div class="seg" style="width:${sw}%;background:var(--red)"></div>
      </div>
      <span class="analyst-counts">${m.analyst_buy ?? 0} buy · ${m.analyst_hold ?? 0} hold · ${m.analyst_sell ?? 0} sell</span>`;
    }
    const targetHtml = m.analyst_target
      ? `<span class="analyst-target">Target: ${m.currency} ${m.analyst_target} <span class="${m.analyst_upside_pct >= 0 ? 'up' : 'down'}">(${pct(m.analyst_upside_pct)} upside)</span></span>`
      : '';
    analysts = `<div class="analysts">${bar}${targetHtml}</div>`;
  }

  // Buys and avoids interleaved in one chronological run, newest first, rather than
  // grouped into separate sections: the useful question is what was said most
  // recently, not what was said positively. Each item carries its own BUY/AVOID tag
  // to keep the distinction that the removed headings used to carry.
  const mentions = allMentions(s);
  const recsSection = mentions.length ? `
    <div class="recs-section">
      <div class="recs-heading">Mentions, most recent first</div>
      ${renderRecs(mentions)}
    </div>` : '';

  const desc = s.description
    ? `<div class="card-desc">${esc(s.description)}</div>`
    : '';

  return `
    <div class="card" id="card-${s.ticker}">
      <div class="card-header">
        <div class="card-title"><span class="ticker">${s.ticker}</span><span class="company">${esc(s.company_name)}</span></div>
        <div class="badges">${badges.join('')}</div>
      </div>
      ${desc}${marketRow}${sinceRec}${funds}${techs}${analysts}${recsSection}
    </div>`;
}

// recs are the merged buy/avoid list from allMentions(), each tagged with .type.
function renderRecs(recs) {
  if (!recs?.length) return '';
  return recs.map(r => {
    const isBuy = r.type === 'buy';
    const chips = [];
    if (isBuy) {
      if (r.when_to_buy)  chips.push(`<span class="rec-chip entry">Entry: ${esc(r.when_to_buy)}</span>`);
      if (r.target_price) chips.push(`<span class="rec-chip target">Target: ${esc(r.target_price)}</span>`);
    } else {
      if (r.risk) chips.push(`<span class="rec-chip risk">Risk: ${esc(r.risk)}</span>`);
    }
    const caution = r.cautions ? `<div class="rec-caution">⚠ ${esc(r.cautions)}</div>` : '';
    const tag = isBuy
      ? '<span class="rec-tag tag-buy">▲ BUY</span>'
      : '<span class="rec-tag tag-avoid">▼ AVOID</span>';
    return `
      <div class="rec-item rec-${isBuy ? 'buy' : 'avoid'}">
        <div class="rec-meta">
          ${tag}
          <span class="rec-channel">${esc(r.channel)}</span>
          <span class="rec-date">${r.date_label}</span>
          <a class="rec-link" href="${r.url}" target="_blank" rel="noopener">Watch ↗</a>
        </div>
        <div class="rec-body">
          <div class="rec-reason">${esc(r.reason || '')}</div>
          ${chips.length ? `<div class="rec-detail">${chips.join('')}</div>` : ''}
          ${caution}
        </div>
      </div>`;
  }).join('');
}

// ── Helpers ───────────────────────────────────────────────────────────────

const MONTHS = {Jan:'01',Feb:'02',Mar:'03',Apr:'04',May:'05',Jun:'06',Jul:'07',Aug:'08',Sep:'09',Oct:'10',Nov:'11',Dec:'12'};
function parseDateLabel(label) {
  if (!label) return '';
  const [d, m, y] = label.split(' ');
  return `${y}${MONTHS[m] || '00'}${d?.padStart(2,'0')}`;
}

function pct(val, decimals = 1) {
  if (val == null) return '—';
  const sign = val >= 0 ? '+' : '';
  return `${sign}${val.toFixed(decimals)}%`;
}

// Company names and descriptions reach us from Claude via the pipeline, so they are
// model output going straight into innerHTML. Escape before interpolating.
function esc(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// 'YYYYMMDD' -> 'dd/mm'
function shortDate(d) {
  if (!d || d.length !== 8) return '';
  return `${d.slice(6, 8)}/${d.slice(4, 6)}`;
}

function updateViewButtons() {
  document.querySelectorAll('.view-btn').forEach(b => b.classList.toggle('active', b.dataset.view === activeView));
}

// ── Event listeners ───────────────────────────────────────────────────────

const homeLink = document.getElementById('home-link');
homeLink.addEventListener('click', resetView);
homeLink.addEventListener('keydown', e => {
  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); resetView(); }
});

document.querySelectorAll('.view-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    activeView = btn.dataset.view;
    if (activeView === 'detail') {
      document.getElementById('search').value = '';
    }
    updateViewButtons();
    render();
  });
});

document.querySelectorAll('.filter-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    activeFilter = btn.dataset.filter;
    render();
  });
});

document.getElementById('search').addEventListener('input', render);

loadDigest();
