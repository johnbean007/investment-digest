const DATA_URL = window.DIGEST_DATA_URL || 'data/latest.json';

let allStocks = [];
let activeView   = 'summary';   // 'summary' | 'detail'
let activeFilter = 'all';
let sortCol      = 'buy_count'; // current sort column
let sortDir      = -1;          // -1 = desc, 1 = asc

// ── Load ──────────────────────────────────────────────────────────────────

async function loadDigest() {
  try {
    const res = await fetch(DATA_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    document.getElementById('loading').classList.add('hidden');
    renderMeta(data);
    // Sort recs latest-first within each stock
    const recDate = r => r.upload_date || parseDateLabel(r.date_label);
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
      default:             av = a.buy_count;   bv = b.buy_count;
    }
    if (av == null) return 1;
    if (bv == null) return -1;
    return av < bv ? sortDir : av > bv ? -sortDir : 0;
  });
}

function lastMention(s) {
  const dates = [...(s.buys || []), ...(s.avoids || [])].map(r => r.upload_date || parseDateLabel(r.date_label)).filter(Boolean);
  return dates.length ? dates.sort().reverse()[0] : '';
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

function summaryTable(stocks, type) {
  const cols = type === 'buy'
    ? ['ticker','buy_count','avoid_count','last_mention','ticker']
    : ['ticker','avoid_count','last_mention','ticker'];

  const headers = type === 'buy'
    ? ['Stock','Buys','Avoids','Last mentioned','Creators','Timeline','']
    : ['Stock','Avoids','Last mentioned','Creators','Timeline',''];

  const rows = stocks.map(s => {
    const allRecs = [...(s.buys || []), ...(s.avoids || [])].sort((a,b) => b.upload_date?.localeCompare(a.upload_date));
    const creators = [...new Set(allRecs.map(r => r.channel))];
    const creatorStr = creators.length <= 2
      ? creators.join(', ')
      : `${creators.slice(0,2).join(', ')} +${creators.length - 2}`;

    const timeline = renderMiniTimeline(s);
    const price = s.market ? `${s.market.currency} ${s.market.current_price?.toFixed(2)}` : '—';
    const pctChange = s.pct_change_since_rec != null
      ? `<span class="${s.pct_change_since_rec >= 0 ? 'up' : 'down'}">${pct(s.pct_change_since_rec)}</span>`
      : '—';

    const buyCols = type === 'buy' ? `<td class="num">${s.buy_count}</td><td class="num ${s.avoid_count > 0 ? 'warn' : ''}">${s.avoid_count || '—'}</td>` : '';
    const avoidCol = type === 'avoid' ? `<td class="num">${s.avoid_count}</td>` : '';

    return `
      <tr>
        <td><span class="sum-ticker">${s.ticker}</span><span class="sum-company">${s.company_name}</span></td>
        ${buyCols}${avoidCol}
        <td>${lastMentionLabel(s)}</td>
        <td class="creators-cell" title="${creators.join(', ')}">${creatorStr}</td>
        <td class="timeline-cell">${timeline}</td>
        <td><button class="detail-btn" onclick="goToDetail('${s.ticker}')">Detail ↗</button></td>
      </tr>`;
  }).join('');

  const thHtml = headers.map((h, i) => {
    const colMap = ['ticker','buy_count','avoid_count','last_mention'];
    const col = colMap[i];
    const arrow = col && sortCol === col ? (sortDir === -1 ? ' ↓' : ' ↑') : '';
    return col ? `<th data-col="${col}">${h}${arrow}</th>` : `<th>${h}</th>`;
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
  const dates = [...(s.buys || []), ...(s.avoids || [])].map(r => r.date_label).filter(Boolean);
  if (!dates.length) return '—';
  return dates[0]; // already sorted latest-first
}

function renderMiniTimeline(s) {
  const allRecs = [...(s.buys || []).map(r => ({...r, type:'buy'})), ...(s.avoids || []).map(r => ({...r, type:'avoid'}))];
  if (!allRecs.length) return '';

  // Group by date
  const byDate = {};
  allRecs.forEach(r => {
    const d = r.upload_date || parseDateLabel(r.date_label) || '';
    if (!byDate[d]) byDate[d] = [];
    byDate[d].push(r);
  });

  const sorted = Object.keys(byDate).sort();
  const dots = sorted.map(date => {
    const recs = byDate[date];
    const hasBuy   = recs.some(r => r.type === 'buy');
    const hasAvoid = recs.some(r => r.type === 'avoid');
    const cls = hasBuy && hasAvoid ? 'dot-mixed' : hasBuy ? 'dot-buy' : 'dot-avoid';
    const tooltip = recs.map(r => `${r.channel} (${r.type === 'buy' ? 'BUY' : 'AVOID'}) — ${r.date_label}`).join('\n');
    return `<span class="dot ${cls}" title="${tooltip}"></span>`;
  }).join('');

  return `<div class="mini-timeline">${dots}</div>`;
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

  const buySection = s.buy_count > 0 ? `
    <div class="recs-section">
      <div class="recs-heading buy-head">▲ Buy recommendations</div>
      ${renderRecs(s.buys, 'buy')}
    </div>` : '';

  const avoidSection = s.avoid_count > 0 ? `
    <div class="recs-section">
      <div class="recs-heading avoid-head">▼ Avoid / concerns</div>
      ${renderRecs(s.avoids, 'avoid')}
    </div>` : '';

  return `
    <div class="card" id="card-${s.ticker}">
      <div class="card-header">
        <div class="card-title"><span class="ticker">${s.ticker}</span><span class="company">${s.company_name}</span></div>
        <div class="badges">${badges.join('')}</div>
      </div>
      ${marketRow}${sinceRec}${funds}${techs}${analysts}${buySection}${avoidSection}
    </div>`;
}

function renderRecs(recs, type) {
  if (!recs?.length) return '';
  // Already sorted latest-first at load time
  return recs.map(r => {
    const chips = [];
    if (type === 'buy') {
      if (r.when_to_buy)  chips.push(`<span class="rec-chip entry">Entry: ${r.when_to_buy}</span>`);
      if (r.target_price) chips.push(`<span class="rec-chip target">Target: ${r.target_price}</span>`);
    } else {
      if (r.risk) chips.push(`<span class="rec-chip risk">Risk: ${r.risk}</span>`);
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

function updateViewButtons() {
  document.querySelectorAll('.view-btn').forEach(b => b.classList.toggle('active', b.dataset.view === activeView));
}

// ── Event listeners ───────────────────────────────────────────────────────

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
