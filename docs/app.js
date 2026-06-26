// In development: served by python from docs/, data is one level up
// On GitHub Pages: data/ is in the repo root, fetched via raw content URL set at build time
const DATA_URL = window.DIGEST_DATA_URL || 'data/latest.json';

let allStocks = [];
let activeFilter = 'all';

async function loadDigest() {
  try {
    const res = await fetch(DATA_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    document.getElementById('loading').classList.add('hidden');
    renderMeta(data);
    allStocks = data.stocks || [];
    renderStocks(allStocks);
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

function applyFilters() {
  const query = document.getElementById('search').value.toLowerCase();
  let stocks = allStocks;

  if (activeFilter === 'buy')     stocks = stocks.filter(s => s.buy_count > 0);
  if (activeFilter === 'avoid')   stocks = stocks.filter(s => s.buy_count === 0 && s.avoid_count > 0);
  if (activeFilter === 'earnings') stocks = stocks.filter(s => s.market?.earnings_days != null && s.market.earnings_days <= 14 && s.market.earnings_days >= 0);

  if (query) {
    stocks = stocks.filter(s =>
      s.ticker.toLowerCase().includes(query) ||
      s.company_name.toLowerCase().includes(query)
    );
  }

  renderStocks(stocks);
}

function renderStocks(stocks) {
  const container = document.getElementById('stocks');
  if (!stocks.length) {
    container.innerHTML = '<p style="color:var(--muted);padding:40px;grid-column:1/-1">No stocks match this filter.</p>';
    return;
  }
  container.innerHTML = stocks.map(renderCard).join('');
}

function pct(val, decimals = 1) {
  if (val == null) return '—';
  const sign = val >= 0 ? '+' : '';
  return `${sign}${val.toFixed(decimals)}%`;
}

function fmt(val, prefix = '', decimals = 2) {
  if (val == null) return '—';
  return `${prefix}${val.toFixed(decimals)}`;
}

function rsiColour(label) {
  if (label === 'overbought') return 'warn';
  if (label === 'oversold')   return 'up';
  return 'neutral';
}

function renderCard(s) {
  const m = s.market;

  // ── Badges ──
  const badges = [];
  if (s.buy_count > 0)   badges.push(`<span class="badge badge-buy">${s.buy_count} BUY</span>`);
  if (s.avoid_count > 0) badges.push(`<span class="badge badge-avoid">${s.avoid_count} AVOID</span>`);
  if (m?.earnings_days != null && m.earnings_days >= 0 && m.earnings_days <= 14)
    badges.push(`<span class="badge badge-earn">EARNINGS in ${m.earnings_days}d</span>`);

  // ── Price cells ──
  const priceClass = m?.daily_change_pct >= 0 ? 'up' : 'down';
  const monthClass = m?.month_change_pct >= 0 ? 'up' : 'down';
  const currency = m?.currency || '';

  const marketRow = m ? `
    <div class="market-row">
      <div class="market-cell">
        <span class="market-label">Price</span>
        <span class="market-value">${currency} ${m.current_price?.toFixed(2) ?? '—'}</span>
      </div>
      <div class="market-cell">
        <span class="market-label">Today</span>
        <span class="market-value ${priceClass}">${pct(m.daily_change_pct)}</span>
      </div>
      <div class="market-cell">
        <span class="market-label">1 month</span>
        <span class="market-value ${monthClass}">${pct(m.month_change_pct)}</span>
      </div>
      <div class="market-cell">
        <span class="market-label">52w High</span>
        <span class="market-value">${currency} ${m.week52_high?.toFixed(2) ?? '—'}</span>
      </div>
      <div class="market-cell">
        <span class="market-label">52w Low</span>
        <span class="market-value">${currency} ${m.week52_low?.toFixed(2) ?? '—'}</span>
      </div>
      ${m.earnings_date ? `<div class="market-cell">
        <span class="market-label">Earnings</span>
        <span class="market-value" style="color:var(--purple)">${m.earnings_date}</span>
      </div>` : ''}
    </div>` : '';

  // ── Since recommended ──
  let sinceRec = '';
  if (s.price_at_first_mention && s.pct_change_since_rec != null) {
    const cls = s.pct_change_since_rec >= 0 ? 'up' : 'down';
    const arrow = s.pct_change_since_rec >= 0 ? '▲' : '▼';
    sinceRec = `
      <div class="since-rec">
        <span class="label">Since first mentioned (${s.first_mention_date}):</span>
        <span class="val ${cls}">${arrow} ${Math.abs(s.pct_change_since_rec)}% from ${currency} ${s.price_at_first_mention}</span>
      </div>`;
  }

  // ── Fundamentals ──
  let funds = '';
  if (m && (m.pe_trailing || m.pe_forward || m.revenue_growth || m.beta || m.short_percent)) {
    const items = [];
    if (m.pe_trailing)     items.push(`<div class="fund-item"><span class="fund-label">P/E</span><span class="fund-value">${m.pe_trailing.toFixed(1)}x</span></div>`);
    if (m.pe_forward)      items.push(`<div class="fund-item"><span class="fund-label">Fwd P/E</span><span class="fund-value">${m.pe_forward.toFixed(1)}x</span></div>`);
    if (m.peg_ratio)       items.push(`<div class="fund-item"><span class="fund-label">PEG</span><span class="fund-value">${m.peg_ratio.toFixed(2)}</span></div>`);
    if (m.revenue_growth != null) items.push(`<div class="fund-item"><span class="fund-label">Rev growth</span><span class="fund-value ${m.revenue_growth >= 0 ? 'up' : 'down'}">${pct(m.revenue_growth * 100)}</span></div>`);
    if (m.profit_margins != null) items.push(`<div class="fund-item"><span class="fund-label">Margin</span><span class="fund-value">${pct(m.profit_margins * 100)}</span></div>`);
    if (m.beta != null)    items.push(`<div class="fund-item"><span class="fund-label">Beta</span><span class="fund-value">${m.beta.toFixed(2)}</span></div>`);
    if (m.short_percent != null) items.push(`<div class="fund-item"><span class="fund-label">Short %</span><span class="fund-value ${m.short_percent > 0.15 ? 'warn' : ''}">${pct(m.short_percent * 100)}</span></div>`);
    if (m.dividend_yield)  items.push(`<div class="fund-item"><span class="fund-label">Div yield</span><span class="fund-value">${pct(m.dividend_yield * 100)}</span></div>`);
    funds = `<div class="fundamentals">${items.join('')}</div>`;
  }

  // ── Technicals ──
  let techs = '';
  if (m && (m.rsi || m.ma_signal)) {
    const items = [];
    if (m.rsi != null) {
      const rc = rsiColour(m.rsi_label);
      const rsiText = m.rsi_label === 'overbought' ? 'overbought' : m.rsi_label === 'oversold' ? 'oversold' : 'neutral';
      items.push(`<span class="tech-item"><span class="tech-label">RSI: </span><span class="${rc}">${m.rsi} (${rsiText})</span></span>`);
    }
    if (m.ma_signal) {
      const mac = m.ma_signal === 'golden_cross' ? 'up' : 'down';
      const maLabel = m.ma_signal === 'golden_cross' ? '50d > 200d (bullish)' : '50d < 200d (bearish)';
      items.push(`<span class="tech-item"><span class="tech-label">MA: </span><span class="${mac}">${maLabel}</span></span>`);
    }
    techs = `<div class="technicals">${items.join('<span style="color:var(--border)"> | </span>')}</div>`;
  }

  // ── Analyst consensus ──
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

  // ── Recommendations ──
  const buyRecs  = renderRecs(s.buys, 'buy');
  const avoidRecs = renderRecs(s.avoids, 'avoid');

  const buySection = s.buy_count > 0 ? `
    <div class="recs-section">
      <div class="recs-heading buy-head">▲ Buy recommendations</div>
      ${buyRecs}
    </div>` : '';

  const avoidSection = s.avoid_count > 0 ? `
    <div class="recs-section">
      <div class="recs-heading avoid-head">▼ Avoid / concerns</div>
      ${avoidRecs}
    </div>` : '';

  return `
    <div class="card">
      <div class="card-header">
        <div class="card-title">
          <span class="ticker">${s.ticker}</span>
          <span class="company">${s.company_name}</span>
        </div>
        <div class="badges">${badges.join('')}</div>
      </div>
      ${marketRow}
      ${sinceRec}
      ${funds}
      ${techs}
      ${analysts}
      ${buySection}
      ${avoidSection}
    </div>`;
}

function renderRecs(recs, type) {
  if (!recs || !recs.length) return '';
  return recs.map(r => {
    const chips = [];
    if (type === 'buy') {
      if (r.when_to_buy)   chips.push(`<span class="rec-chip entry">Entry: ${r.when_to_buy}</span>`);
      if (r.target_price)  chips.push(`<span class="rec-chip target">Target: ${r.target_price}</span>`);
    } else {
      if (r.risk)          chips.push(`<span class="rec-chip risk">Risk: ${r.risk}</span>`);
    }
    const caution = r.cautions ? `<div class="rec-caution">⚠ ${r.cautions}</div>` : '';
    return `
      <div class="rec-item">
        <div class="rec-meta">
          <span class="rec-channel">${r.channel}</span>
          <span class="rec-date">${r.date_label}</span>
          <a class="rec-link" href="${r.url}" target="_blank" rel="noopener">Watch ↗</a>
        </div>
        <div class="rec-body">
          <div class="rec-reason">${r.reason || ''}</div>
          ${chips.length ? `<div class="rec-detail">${chips.join('')}</div>` : ''}
          ${caution}
        </div>
      </div>`;
  }).join('');
}

// ── Event listeners ──
document.querySelectorAll('.filter-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    activeFilter = btn.dataset.filter;
    applyFilters();
  });
});

document.getElementById('search').addEventListener('input', applyFilters);

loadDigest();
