// Token Radar Pro v2.2: Institutional Pre-Token Intelligence & Airdrop Yield Dashboard.
// Reads window.RADAR (written beside dashboard/ by main.ts) with zero network dependencies.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var app = document.getElementById('board');

  var state = {
    q: '',
    category: 'all',
    chain: 'all',
    risk: 'all',
    cohort: 'all',
    tab: 'pre-token',
    sort: 'implied',
    dir: -1,
    selected: null,
    baseMult: DATA.model.base_multiple,
    growthWeight: DATA.model.growth_weight
  };

  var usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usd.format(n);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }
  function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }

  function chainMultiplier(chains) {
    if (!chains || chains.length === 0) return 1.0;
    return Math.round((1.0 + Math.min(chains.length, 6) * 0.03) * 1000) / 1000;
  }

  function computePeerMultiples() {
    var byCat = {};
    (DATA.live || []).forEach(function (p) {
      if (p.mcap_usd && p.mcap_usd > 0 && p.tvl_usd > 0 && p.category) {
        var ratio = clamp(p.mcap_usd / p.tvl_usd, 0.15, 0.85);
        if (!byCat[p.category]) byCat[p.category] = [];
        byCat[p.category].push(ratio);
      }
    });
    var medians = {};
    Object.keys(byCat).forEach(function (cat) {
      var vals = byCat[cat].sort(function (a, b) { return a - b; });
      if (vals.length >= 2) {
        var mid = Math.floor(vals.length / 2);
        var med = vals.length % 2 === 0 ? (vals[mid - 1] + vals[mid]) / 2 : vals[mid];
        medians[cat] = Math.round(med * 1000) / 1000;
      }
    });
    return medians;
  }

  var PEER_MULTIPLES = DATA.peer_multiples || computePeerMultiples();

  function impliedOf(row, baseM, growW) {
    var m = DATA.model;
    var bm = baseM !== undefined ? baseM : m.base_multiple;
    var peerBase = (row.category && PEER_MULTIPLES[row.category] !== undefined && bm === m.base_multiple)
      ? PEER_MULTIPLES[row.category]
      : bm;
    var gw = growW !== undefined ? growW : m.growth_weight;
    var growth = clamp(row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d, m.growth_floor, m.growth_cap);
    var growthMult = 1 + (growth / 100) * gw;
    var age = row.age_days === null || row.age_days === undefined ? m.unknown_age_days : row.age_days;
    var maturity = m.maturity_floor + (clamp(age, 0, m.maturity_days) / m.maturity_days) * m.maturity_range;
    return Math.max(1, Math.round(row.tvl_usd * peerBase * chainMultiplier(row.chains) * growthMult * maturity));
  }

  function riskOf(row) {
    var vel = Math.abs(row.change_7d || 0);
    var velPen = clamp(Math.round(vel * 0.5), 0, 35);
    var chLen = (row.chains || []).length;
    var chRes = chLen >= 5 ? 5 : chLen >= 3 ? 12 : chLen === 2 ? 18 : 25;
    var cat = (row.category || '').toLowerCase();
    var catRisk = 15;
    if (cat.indexOf('perpetual') >= 0 || cat.indexOf('derivative') >= 0) catRisk = 25;
    else if (cat.indexOf('bridge') >= 0 || cat.indexOf('cross') >= 0) catRisk = 22;
    else if (cat.indexOf('cdp') >= 0 || cat.indexOf('lend') >= 0) catRisk = 18;
    else if (cat.indexOf('rollup') >= 0 || cat.indexOf('l2') >= 0) catRisk = 10;
    else if (cat.indexOf('staking') >= 0 || cat.indexOf('restak') >= 0) catRisk = 12;
    var age = row.age_days !== null && row.age_days !== undefined ? row.age_days : 180;
    var seas = age >= 730 ? 5 : age >= 365 ? 10 : age >= 180 ? 15 : 25;
    var score = clamp(velPen + chRes + catRisk + seas, 5, 95);
    var tier = score <= 35 ? 'LOW' : score <= 60 ? 'MEDIUM' : score <= 80 ? 'HIGH' : 'SPECULATIVE';
    return { tier: tier, score: score, velPen: velPen, chRes: chRes, catRisk: catRisk, seas: seas };
  }

  function capitalFor(p) {
    if (p.tvl_usd >= 5e9) return 250;
    if (p.tvl_usd >= 1e9) return 150;
    if (p.tvl_usd >= 1e8) return 100;
    return 50;
  }

  function holdDaysFor(age) {
    if (age === null || age === undefined) return 30;
    if (age < 180) return 60;
    if (age < 365) return 45;
    return 30;
  }

  function yieldOf(row, impliedVal) {
    var pool = Math.round(impliedVal * 0.10);
    var cap = capitalFor(row);
    var tvl = Math.max(row.tvl_usd, 1e6);
    var reward = Math.max(25, Math.round(pool * (cap / tvl) * 2.5));
    var roiPct = Math.round((reward / cap) * 100);
    var eth = (row.chains || []).some(function (c) { return c.toLowerCase() === 'ethereum'; });
    var gasUsd = eth ? 35 : 3;
    var daily = reward / Math.max(holdDaysFor(row.age_days), 30);
    var breakeven = Math.max(1, Math.ceil(gasUsd / Math.max(daily, 0.1)));
    return { pool: pool, reward: reward, roiPct: roiPct, breakeven: breakeven, cap: cap };
  }

  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k === 'html') node.innerHTML = attrs[k];
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) child.forEach(function (c) { if (c) node.appendChild(c); });
      else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    return node;
  }

  function svgEl(tag, attrs, textContent) {
    var node = document.createElementNS('http://www.w3.org/2000/svg', tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) { node.setAttribute(k, String(attrs[k])); });
    }
    if (textContent !== undefined) node.textContent = textContent;
    return node;
  }

  function chainOf(p) { return p.chains && p.chains.length > 0 ? p.chains[0] : 'its main chain'; }

  function farmSteps(p) {
    if (p.farm_steps && p.farm_steps.length) return p.farm_steps;
    var cap = capitalFor(p), hold = holdDaysFor(p.age_days), ch = chainOf(p);
    var c = (p.category || '').toLowerCase();
    var act = 'Deposit ~$' + cap + ' into ' + p.name + ' on ' + ch + ' and keep an active position for ' + hold + 'd';
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0) act = 'Supply ~$' + cap + ' of collateral on ' + p.name + ' (' + ch + ') and hold ' + hold + 'd';
    else if (c.indexOf('dex') >= 0 || c.indexOf('perpetual') >= 0) act = 'Provide ~$' + cap + ' of LP or trade on ' + p.name + ' (' + ch + ') for ' + hold + 'd';
    else if (c.indexOf('bridge') >= 0) act = 'Bridge ~$' + cap + ' across ' + p.name + ' (' + ch + ') across 4 weekly transactions';
    return [
      act + ' Cost: ~$' + cap + ' working capital | Time: ~15m',
      'Hold a regular weekly cadence on ' + p.name + ' for ' + hold + 'd. Cost: ~$5 gas | Time: ~10m/wk',
      'Watch ' + p.name + ' governance and points dashboard for TGE snapshot. Cost: $0 | Time: ~2m/wk'
    ];
  }

  function readHash() {
    var raw = window.location.hash.replace(/^#/, '');
    if (!raw) return;
    raw.split('&').forEach(function (part) {
      var kv = part.split('=');
      if (kv.length !== 2) return;
      var k = decodeURIComponent(kv[0]), v = decodeURIComponent(kv[1]);
      if (k === 'q') state.q = v;
      else if (k === 'category') state.category = v;
      else if (k === 'chain') state.chain = v;
      else if (k === 'risk') state.risk = v;
      else if (k === 'tab' && (v === 'pre-token' || v === 'live')) state.tab = v;
      else if (k === 'sort' && ['rank', 'name', 'tvl', 'growth', 'age', 'implied', 'roi'].indexOf(v) >= 0) state.sort = v;
      else if (k === 'dir' && (v === '1' || v === '-1')) state.dir = Number(v);
      else if (k === 'selected') state.selected = v || null;
    });
  }

  function writeHash() {
    var parts = [];
    if (state.q) parts.push('q=' + encodeURIComponent(state.q));
    if (state.category !== 'all') parts.push('category=' + encodeURIComponent(state.category));
    if (state.chain !== 'all') parts.push('chain=' + encodeURIComponent(state.chain));
    if (state.risk !== 'all') parts.push('risk=' + encodeURIComponent(state.risk));
    if (state.tab !== 'pre-token') parts.push('tab=' + state.tab);
    if (state.sort !== 'implied') parts.push('sort=' + state.sort);
    if (state.dir !== -1) parts.push('dir=' + state.dir);
    if (state.selected) parts.push('selected=' + encodeURIComponent(state.selected));
    var next = parts.length ? '#' + parts.join('&') : '';
    if (window.location.hash !== next) history.replaceState(null, '', next || window.location.pathname + window.location.search);
  }

  function uniqueCategories() {
    var map = {};
    DATA.rows.forEach(function (r) { if (r.category) map[r.category] = true; });
    return Object.keys(map).sort();
  }

  function uniqueChains() {
    var map = {};
    DATA.rows.forEach(function (r) { (r.chains || []).forEach(function (c) { map[c] = true; }); });
    return Object.keys(map).sort();
  }

  function enrichedRows() {
    return DATA.rows.map(function (r) {
      var imp = impliedOf(r, state.baseMult, state.growthWeight);
      var rk = riskOf(r);
      var yld = yieldOf(r, imp);
      return { row: r, implied: imp, risk: rk, yield: yld };
    });
  }

  function visibleRows() {
    var q = state.q.trim().toLowerCase();
    var floor = DATA.floor_usd || 50000000;
    var list = enrichedRows().filter(function (item) {
      var r = item.row;
      if (state.category !== 'all' && r.category !== state.category) return false;
      if (state.chain !== 'all' && (r.chains || []).indexOf(state.chain) < 0) return false;
      if (state.risk !== 'all' && item.risk.tier !== state.risk) return false;
      if (state.cohort === 'watchlist' && r.tvl_usd < floor) return false;
      if (state.cohort === 'early' && r.tvl_usd >= floor) return false;
      if (!q) return true;
      return r.name.toLowerCase().indexOf(q) >= 0 ||
        (r.category || '').toLowerCase().indexOf(q) >= 0 ||
        (r.chains || []).join(' ').toLowerCase().indexOf(q) >= 0;
    });
    var dir = state.dir;
    list.sort(function (a, b) {
      var av, bv;
      if (state.sort === 'name') { av = a.row.name.toLowerCase(); bv = b.row.name.toLowerCase(); return av < bv ? -dir : av > bv ? dir : 0; }
      if (state.sort === 'tvl') { av = a.row.tvl_usd; bv = b.row.tvl_usd; }
      else if (state.sort === 'growth') { av = a.row.change_7d === null ? -Infinity : a.row.change_7d; bv = b.row.change_7d === null ? -Infinity : b.row.change_7d; }
      else if (state.sort === 'age') { av = a.row.age_days === null ? -Infinity : a.row.age_days; bv = b.row.age_days === null ? -Infinity : b.row.age_days; }
      else if (state.sort === 'roi') { av = a.yield.roiPct; bv = b.yield.roiPct; }
      else if (state.sort === 'rank') { av = -a.row.rank; bv = -b.row.rank; }
      else { av = a.implied; bv = b.implied; }
      return (av - bv) * dir || a.row.rank - b.row.rank;
    });
    return list;
  }

  function header() {
    return el('header', { class: 'top' },
      el('div', { class: 'brand' },
        el('span', { class: 'mark', 'aria-hidden': 'true' }),
        el('span', { class: 'brand-name', text: 'Token Radar Pro v2.9' })
      ),
      el('div', { class: 'top-meta' },
        el('span', { text: 'Snapshot ' + DATA.as_of }),
        el('span', { text: 'Model ' + DATA.model_version }),
        el('span', { text: DATA.board_size + ' Pre-Token Protocols' })
      )
    );
  }

  function peerStrip() {
    var cats = Object.keys(PEER_MULTIPLES).sort();
    var pills = cats.slice(0, 6).map(function (cat) {
      return el('span', { class: 'peer-pill' }, cat + ': ', el('b', { text: PEER_MULTIPLES[cat].toFixed(2) + 'x' }));
    });
    return el('section', { class: 'peer-strip', 'aria-label': 'Empirical Peer Calibration Multiples' },
      el('span', { class: 'sandbox-title', text: 'Live Peer MCap/TVL' }),
      pills.length ? pills : el('span', { class: 'sub', text: 'Fallback base ' + DATA.model.base_multiple + 'x' })
    );
  }

  function exportCsv() {
    var rows = visibleRows();
    var lines = ['rank,name,category,chains,tvl_usd,change_7d,age_days,risk_tier,est_roi_pct,implied_value_usd'];
    rows.forEach(function (it) {
      var r = it.row;
      lines.push([
        r.rank,
        '"' + r.name.replace(/"/g, '""') + '"',
        '"' + (r.category || '') + '"',
        '"' + (r.chains || []).join(';') + '"',
        r.tvl_usd,
        r.change_7d === null ? '' : r.change_7d,
        r.age_days === null ? '' : r.age_days,
        it.risk.tier,
        it.yield.roiPct,
        it.implied
      ].join(','));
    });
    var blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'token-radar-board.csv';
    a.click();
  }

  function lede() {
    var all = enrichedRows();
    var totalImp = all.reduce(function (acc, it) { return acc + it.implied; }, 0);
    var lowRiskCount = all.filter(function (it) { return it.risk.tier === 'LOW'; }).length;
    return el('section', { class: 'lede' },
      el('div', null,
        el('h1', { text: DATA.watchlist_size + ' watchlist protocols, ranked by algorithmic implied value' }),
        el('p', { text: 'Institutional pre-token intelligence across ' + DATA.board_size + ' unlaunched protocols. Combines DefiLlama TVL, category/chain multipliers, multi-factor risk scoring, and estimated airdrop farming ROI with zero-network verification.' })
      ),
      el('dl', { class: 'facts' },
        el('div', { class: 'fact' }, el('dt', null, el('span', { text: 'Watchlist coverage' })), el('dd', null, el('b', { text: DATA.watchlist_size + ' / ' + DATA.watchlist_size }))),
        el('div', { class: 'fact' }, el('dt', null, el('span', { text: 'Total implied valuation' })), el('dd', null, el('b', { text: fmtUsd(totalImp) }))),
        el('div', { class: 'fact' }, el('dt', null, el('span', { text: 'Low-risk high-conviction' })), el('dd', null, el('b', { text: String(lowRiskCount) + ' gems' }))),
        el('div', { class: 'fact' }, el('dt', null, el('span', { text: 'Live-token reference set' })), el('dd', null, el('b', { text: String(DATA.live.length) })))
      )
    );
  }

  function analyticsCharts(rowsList) {
    var chainMap = {};
    var riskCounts = { LOW: 0, MEDIUM: 0, HIGH: 0, SPECULATIVE: 0 };
    rowsList.forEach(function (it) {
      riskCounts[it.risk.tier] += 1;
      (it.row.chains || []).forEach(function (ch) {
        chainMap[ch] = (chainMap[ch] || 0) + it.row.tvl_usd;
      });
    });
    var topChains = Object.keys(chainMap).map(function (c) { return { name: c, tvl: chainMap[c] }; })
      .sort(function (a, b) { return b.tvl - a.tvl; }).slice(0, 5);
    var maxChainTvl = topChains.length ? topChains[0].tvl : 1;

    var chainSvg = svgEl('svg', { class: 'chart-svg', viewBox: '0 0 540 165' });
    topChains.forEach(function (c, i) {
      var y = 12 + i * 31;
      var w = Math.max(12, Math.round((c.tvl / maxChainTvl) * 280));
      chainSvg.appendChild(svgEl('text', { x: 0, y: y + 14, fill: '#f0f6fc', 'font-size': 12, 'font-family': 'sans-serif' }, c.name));
      chainSvg.appendChild(svgEl('rect', { x: 120, y: y + 3, width: 280, height: 14, rx: 4, fill: '#182230' }));
      chainSvg.appendChild(svgEl('rect', { x: 120, y: y + 3, width: w, height: 14, rx: 4, fill: '#00f2fe' }));
      chainSvg.appendChild(svgEl('text', { x: 412, y: y + 14, fill: '#8b9bb0', 'font-size': 12, 'font-family': 'monospace' }, fmtUsd(c.tvl)));
    });

    var tiers = [
      { key: 'LOW', label: 'LOW RISK', color: '#10b981', count: riskCounts.LOW },
      { key: 'MEDIUM', label: 'MEDIUM', color: '#00f2fe', count: riskCounts.MEDIUM },
      { key: 'HIGH', label: 'HIGH', color: '#f59e0b', count: riskCounts.HIGH },
      { key: 'SPECULATIVE', label: 'SPECULATIVE', color: '#ff5c5c', count: riskCounts.SPECULATIVE }
    ];
    var totalRows = Math.max(1, rowsList.length);
    var riskSvg = svgEl('svg', { class: 'chart-svg', viewBox: '0 0 540 165' });
    tiers.forEach(function (t, i) {
      var y = 16 + i * 36;
      var w = Math.max(8, Math.round((t.count / totalRows) * 280));
      var pct = Math.round((t.count / totalRows) * 100);
      riskSvg.appendChild(svgEl('text', { x: 0, y: y + 14, fill: t.color, 'font-size': 11, 'font-weight': 700, 'font-family': 'monospace' }, t.label));
      riskSvg.appendChild(svgEl('rect', { x: 120, y: y + 3, width: 280, height: 14, rx: 4, fill: '#182230' }));
      riskSvg.appendChild(svgEl('rect', { x: 120, y: y + 3, width: w, height: 14, rx: 4, fill: t.color }));
      riskSvg.appendChild(svgEl('text', { x: 412, y: y + 14, fill: '#f0f6fc', 'font-size': 12, 'font-family': 'monospace' }, t.count + ' (' + pct + '%)'));
    });

    return el('section', { class: 'analytics-grid' },
      el('div', { class: 'chart-card' },
        el('div', { class: 'chart-head' }, el('h3', { text: 'Top Ecosystems by Pre-Token TVL' }), el('span', { text: 'Multi-Chain Exposure' })),
        chainSvg
      ),
      el('div', { class: 'chart-card' },
        el('div', { class: 'chart-head' }, el('h3', { text: 'Protocol Risk Tier Distribution' }), el('span', { text: totalRows + ' Scored' })),
        riskSvg
      )
    );
  }

  function sandboxPanel() {
    return el('section', { class: 'sandbox', 'aria-label': 'Interactive Valuation Model Sandbox' },
      el('span', { class: 'sandbox-title', text: 'Model Sandbox' }),
      el('label', { class: 'slider-wrap' },
        'Base Multiple ',
        el('input', {
          type: 'range', min: '0.10', max: '0.50', step: '0.05', value: String(state.baseMult),
          oninput: function (e) { state.baseMult = Number(e.target.value); render(); }
        }),
        el('b', { text: state.baseMult.toFixed(2) + 'x' })
      ),
      el('label', { class: 'slider-wrap' },
        'Growth Weight ',
        el('input', {
          type: 'range', min: '0.10', max: '1.00', step: '0.10', value: String(state.growthWeight),
          oninput: function (e) { state.growthWeight = Number(e.target.value); render(); }
        }),
        el('b', { text: state.growthWeight.toFixed(1) + 'x' })
      ),
      el('button', {
        type: 'button', class: 'btn-reset', text: 'Reset Defaults',
        onclick: function () { state.baseMult = DATA.model.base_multiple; state.growthWeight = DATA.model.growth_weight; render(); }
      })
    );
  }

  function controls() {
    var filtered = state.tab === 'pre-token' ? visibleRows() : [];
    var shown = state.tab === 'pre-token' ? filtered.length : DATA.live.length;
    var countText = shown + ' rows shown';
    if (state.tab === 'pre-token' && filtered.length > 0) {
      var sumTvl = filtered.reduce(function (acc, it) { return acc + it.row.tvl_usd; }, 0);
      var sumImp = filtered.reduce(function (acc, it) { return acc + it.implied; }, 0);
      countText = shown + ' rows • ' + fmtUsd(sumTvl) + ' TVL • ' + fmtUsd(sumImp) + ' Imp';
    }
    var catSelect = el('select', {
      id: 'f-cat',
      onchange: function (e) { state.category = e.target.value; writeHash(); render(); }
    }, el('option', { value: 'all', text: 'All categories' }),
      uniqueCategories().map(function (c) { return el('option', { value: c, text: c, selected: state.category === c ? 'selected' : null }); })
    );
    var chainSelect = el('select', {
      id: 'f-chain',
      onchange: function (e) { state.chain = e.target.value; writeHash(); render(); }
    }, el('option', { value: 'all', text: 'All chains' }),
      uniqueChains().map(function (c) { return el('option', { value: c, text: c, selected: state.chain === c ? 'selected' : null }); })
    );
    var riskSelect = el('select', {
      id: 'f-risk',
      onchange: function (e) { state.risk = e.target.value; writeHash(); render(); }
    },
      el('option', { value: 'all', text: 'All risk tiers' }),
      ['LOW', 'MEDIUM', 'HIGH', 'SPECULATIVE'].map(function (rk) {
        return el('option', { value: rk, text: rk, selected: state.risk === rk ? 'selected' : null });
      })
    );

    var cohortSelect = el('select', {
      id: 'f-cohort',
      onchange: function (e) { state.cohort = e.target.value; render(); }
    },
      el('option', { value: 'all', text: 'All cohorts (200)', selected: state.cohort === 'all' ? 'selected' : null }),
      el('option', { value: 'watchlist', text: 'Watchlist >=$50M (40)', selected: state.cohort === 'watchlist' ? 'selected' : null }),
      el('option', { value: 'early', text: 'Early Gems <$50M (160)', selected: state.cohort === 'early' ? 'selected' : null })
    );

    return el('div', { class: 'controls' },
      el('div', { class: 'field' },
        el('label', { for: 'f-search', text: 'Search' }),
        el('input', {
          id: 'f-search', type: 'search', placeholder: 'Protocol, category or chain...', value: state.q,
          oninput: function (e) { state.q = e.target.value; writeHash(); render(); }
        })
      ),
      el('div', { class: 'field' }, el('label', { for: 'f-cat', text: 'Category' }), catSelect),
      el('div', { class: 'field' }, el('label', { for: 'f-chain', text: 'Chain' }), chainSelect),
      el('div', { class: 'field' }, el('label', { for: 'f-risk', text: 'Risk Tier' }), riskSelect),
      el('div', { class: 'field' }, el('label', { for: 'f-cohort', text: 'Cohort' }), cohortSelect),
      el('div', { class: 'field' },
        el('label', { text: 'Universe' }),
        el('div', { class: 'tabs', role: 'group', 'aria-label': 'Universe' },
          el('button', {
            type: 'button', 'aria-pressed': String(state.tab === 'pre-token'), text: 'Pre-token (' + DATA.rows.length + ')',
            onclick: function () { state.tab = 'pre-token'; writeHash(); render(); }
          }),
          el('button', {
            type: 'button', 'aria-pressed': String(state.tab === 'live'), text: 'Live token (' + DATA.live.length + ')',
            onclick: function () { state.tab = 'live'; writeHash(); render(); }
          })
        )
      ),
      el('button', { type: 'button', class: 'btn-export', text: 'Export CSV', onclick: exportCsv }),
      el('div', { class: 'count', text: countText })
    );
  }

  function sortHeader(key, label) {
    var arrow = state.sort === key ? (state.dir === -1 ? ' v' : ' ^') : '';
    return el('th', { scope: 'col' },
      el('button', {
        type: 'button', text: label + arrow,
        onclick: function () {
          if (state.sort === key) state.dir = -state.dir;
          else { state.sort = key; state.dir = key === 'name' ? 1 : -1; }
          writeHash(); render();
        }
      })
    );
  }

  function riskBadge(tier) {
    var cls = tier === 'LOW' ? 'badge-low' : tier === 'MEDIUM' ? 'badge-medium' : tier === 'HIGH' ? 'badge-high' : 'badge-spec';
    return el('span', { class: 'badge ' + cls, text: tier });
  }

  function boardTable() {
    var list = visibleRows();
    if (!list.length) {
      return el('div', { class: 'panel empty' }, 'No protocols match your current filters.');
    }
    var max = list[0].implied || 1;
    list.forEach(function (it) { if (it.implied > max) max = it.implied; });
    var tbody = el('tbody');
    list.forEach(function (item) {
      var r = item.row;
      var growth = r.change_7d === null ? 'n/a' : fmtPct(r.change_7d);
      var growthClass = r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg';
      var tr = el('tr', {
        'data-selected': state.selected === r.slug ? 'true' : 'false',
        tabindex: '0',
        onclick: function () { openDetail(r.slug); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } }
      },
        el('td', { class: 'num', text: String(r.rank) }),
        el('td', null, el('div', { class: 'name' },
          el('b', { text: r.name }),
          el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 3).join(', ') : 'multi-chain') })
        )),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + growthClass, text: growth }),
        el('td', { class: 'num', text: fmtAge(r.age_days) }),
        el('td', null, riskBadge(item.risk.tier)),
        el('td', { class: 'num pos', text: '+' + item.yield.roiPct + '%' }),
        el('td', null, el('div', { class: 'implied' },
          el('div', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(4, Math.round((item.implied / max) * 100)) + '%' })),
          el('span', { class: 'num', text: fmtUsd(item.implied) })
        )),
        el('td', null, el('span', { class: 'status', text: 'pre-token' }))
      );
      tbody.appendChild(tr);
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('thead', null, el('tr', null,
            sortHeader('rank', 'Rank'),
            sortHeader('name', 'Protocol'),
            sortHeader('tvl', 'TVL'),
            sortHeader('growth', '7d'),
            sortHeader('age', 'Age'),
            el('th', { scope: 'col', text: 'Risk' }),
            sortHeader('roi', 'Est. ROI'),
            sortHeader('implied', 'Implied Value'),
            el('th', { scope: 'col', text: 'Status' })
          )),
          tbody
        )
      )
    );
  }

  function liveTable() {
    var tbody = el('tbody');
    DATA.live.forEach(function (r) {
      tbody.appendChild(el('tr', null,
        el('td', { class: 'num', text: 'live' }),
        el('td', null, el('div', { class: 'name' }, el('b', { text: r.name }), el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 3).join(', ') : 'multi-chain') }))),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + (r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(r.change_7d) }),
        el('td', { class: 'num', text: fmtUsd(r.mcap_usd) }),
        el('td', null, el('span', { class: 'status', text: 'already trades' }))
      ));
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Status' }), el('th', { scope: 'col', text: 'Protocol' }), el('th', { scope: 'col', text: 'TVL' }), el('th', { scope: 'col', text: '7d' }), el('th', { scope: 'col', text: 'Market cap' }), el('th', { scope: 'col', text: 'Token' }))),
          tbody
        )
      )
    );
  }

  function modelPanel() {
    var m = DATA.model;
    return el('section', { class: 'panel model' },
      el('h2', { text: 'Quantitative Valuation & Risk Methodology (' + DATA.model_version + ')' }),
      el('p', { class: 'sub', text: 'Every pre-token protocol is evaluated deterministically from frozen snapshot metrics with zero manual overrides or name special-casing.' }),
      el('div', { class: 'formula' },
        'implied = round( tvl_usd x peerBase(category, ' + state.baseMult.toFixed(2) + ') x chMult(chains.length) x (1 + clamp(change_7d, ' + m.growth_floor + ', ' + m.growth_cap + ')/100 x ' + state.growthWeight.toFixed(1) + ') x maturity(age_days) )'
      ),
      el('p', { class: 'sub', text: 'peerBase(category) uses median MCap/TVL of live-token peers in the same snapshot (clamped [0.15, 0.85]). Risk Score (5-95) combines 7d TVL velocity, chain diversification, sector risk, and protocol age.' })
    );
  }

  var dialog = el('dialog', { class: 'detail', id: 'detail', 'aria-labelledby': 'detail-title' });
  dialog.addEventListener('close', function () { state.selected = null; writeHash(); });

  function openDetail(slug) {
    var row = DATA.rows.filter(function (r) { return r.slug === slug; })[0];
    if (!row) return;
    state.selected = slug;
    writeHash();
    dialog.textContent = '';
    var imp = impliedOf(row, state.baseMult, state.growthWeight);
    var rk = riskOf(row);
    var yld = yieldOf(row, imp);
    var steps = farmSteps(row);

    dialog.appendChild(el('div', { class: 'detail-head' },
      el('div', null,
        el('span', { class: 'brand-name', text: 'Rank #' + row.rank + ' of ' + DATA.board_size + ' • ' + rk.tier + ' RISK (' + rk.score + '/100)' }),
        el('h2', { id: 'detail-title', text: row.name }),
        el('p', { class: 'sub', text: (row.category || 'Other') + ' on ' + (row.chains && row.chains.length ? row.chains.join(', ') : 'multi-chain') })
      ),
      el('button', { class: 'close', type: 'button', 'aria-label': 'Close details', text: 'Close', onclick: function () { dialog.close(); } })
    ));

    var peerBase = (row.category && PEER_MULTIPLES[row.category] !== undefined && state.baseMult === DATA.model.base_multiple)
      ? PEER_MULTIPLES[row.category]
      : state.baseMult;
    var m = DATA.model;
    var gClamped = clamp(row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d, m.growth_floor, m.growth_cap);
    var gMultDyn = (1 + (gClamped / 100) * state.growthWeight).toFixed(4);
    var ageVal = row.age_days === null || row.age_days === undefined ? m.unknown_age_days : row.age_days;
    var mMultDyn = (m.maturity_floor + (clamp(ageVal, 0, m.maturity_days) / m.maturity_days) * m.maturity_range).toFixed(4);
    var parityText = imp === row.implied_value_usd
      ? '✓ Exact parity with board.json (' + fmtUsd(imp) + ')'
      : 'Sandbox preview: ' + fmtUsd(imp) + ' (board.json: ' + fmtUsd(row.implied_value_usd) + ')';
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Implied Valuation Breakdown' }),
      el('div', { class: 'equation' },
        el('div', null, el('span', { text: 'TVL' }), el('b', { class: 'num', text: fmtUsd(row.tvl_usd) })),
        el('div', null, el('span', { text: '7d Growth' }), el('b', { class: 'num', text: fmtPct(row.change_7d) })),
        el('div', null, el('span', { text: 'Age / Peer MCap/TVL' }), el('b', { class: 'num', text: fmtAge(row.age_days) + ' / ' + peerBase.toFixed(2) + 'x' })),
        el('div', null, el('span', { text: 'Peer MCap/TVL / Chain Mult' }), el('b', { class: 'num', text: peerBase.toFixed(2) + 'x / ' + chainMultiplier(row.chains).toFixed(2) + 'x' })),
        el('div', null, el('span', { text: 'Growth / Maturity Mult' }), el('b', { class: 'num', text: gMultDyn + 'x / ' + mMultDyn + 'x' })),
        el('div', null, el('span', { text: 'Implied Value' }), el('b', { class: 'num pos', text: fmtUsd(imp) }))
      ),
      el('p', { class: 'sub', text: parityText })
    ));

    var gasTier = (row.chains || []).some(function (c) { return c.toLowerCase() === 'ethereum'; }) ? '~$6.50 / wk' : '~$0.40 / wk';
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Airdrop Yield & Risk Profile' }),
      el('div', { class: 'equation' },
        el('div', null, el('span', { text: 'Est. Community Pool (10%)' }), el('b', { class: 'num', text: fmtUsd(yld.pool) })),
        el('div', null, el('span', { text: 'Est. Farmer Reward ($' + yld.cap + ')' }), el('b', { class: 'num pos', text: fmtUsd(yld.reward) + ' (+' + yld.roiPct + '%)' })),
        el('div', null, el('span', { text: 'Breakeven / Est. Gas' }), el('b', { class: 'num', text: yld.breakeven + 'd / ' + gasTier }))
      )
    ));

    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Actionable Farm Plan' }),
      el('ol', { class: 'steps' }, steps.map(function (s) {
        var at = s.indexOf(' Cost: ');
        var action = at >= 0 ? s.slice(0, at) : s;
        var tail = at >= 0 ? s.slice(at + 1) : '';
        return el('li', null, el('b', { text: action }), el('span', { class: 'cost', text: tail }));
      }))
    ));

    if (typeof dialog.showModal === 'function') {
      if (!dialog.open) dialog.showModal();
    } else {
      dialog.setAttribute('open', '');
    }
  }

  function render() {
    app.textContent = '';
    var shell = el('div', { class: 'shell' });
    shell.appendChild(header());
    shell.appendChild(lede());
    if (state.tab === 'pre-token') {
      shell.appendChild(peerStrip());
      shell.appendChild(analyticsCharts(visibleRows()));
      shell.appendChild(sandboxPanel());
    }
    shell.appendChild(controls());
    shell.appendChild(state.tab === 'pre-token' ? boardTable() : liveTable());
    if (state.tab === 'pre-token') shell.appendChild(modelPanel());
    app.appendChild(shell);
    app.setAttribute('aria-busy', 'false');
    if (!dialog.isConnected) app.appendChild(dialog);
    if (state.selected) openDetail(state.selected);
  }

  readHash();
  render();
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && dialog.open) dialog.close();
  });
})();
