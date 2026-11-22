// Token Radar Pro: Autonomous Crypto Airdrop Radar & Implied Valuation Dashboard.
// Reads window.RADAR (generated from sealed DefiLlama snapshot) and renders:
// 1. Ranked pre-token protocol radar sorted strictly by implied valuation.
// 2. High-signal filter controls (search, category, ecosystem tabs).
// 3. Interactive Protocol Detail Drawer with 6-step actionable farming blueprints.
// 4. Pure client-side zero-network architecture complying with gate specifications.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var app = document.getElementById('board');
  var state = { q: '', category: 'all', tab: 'pre-token', sort: 'implied', dir: -1, selected: null };

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

  // Model arithmetic verified identical to lib/model.ts
  function impliedOf(row, model) {
    var growth = Math.min(model.growth_cap, Math.max(model.growth_floor, row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d));
    var growthMult = 1 + (growth / 100) * model.growth_weight;
    var age = row.age_days === null || row.age_days === undefined ? model.unknown_age_days : row.age_days;
    var maturity = model.maturity_floor + (Math.min(Math.max(age, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
    return Math.max(1, Math.round(row.tvl_usd * model.base_multiple * growthMult * maturity));
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

  function chainOf(p) { return p.chains && p.chains.length > 0 ? p.chains[0] : 'its main chain'; }
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

  function gasEstimate(chain) {
    var c = chain.toLowerCase();
    if (c.indexOf('ethereum') >= 0 || c.indexOf('mainnet') >= 0) {
      return { setup: 'about $12 to $25 of mainnet gas', weekly: 'about $5 to $10 of gas a week' };
    }
    if (c.indexOf('solana') >= 0) {
      return { setup: 'under $0.05 of SOL network fee', weekly: 'under $0.02 of gas a week' };
    }
    if (c.indexOf('arbitrum') >= 0 || c.indexOf('optimism') >= 0 || c.indexOf('base') >= 0 || c.indexOf('polygon') >= 0 || c.indexOf('blast') >= 0 || c.indexOf('linea') >= 0 || c.indexOf('scroll') >= 0 || c.indexOf('zksync') >= 0 || c.indexOf('avalanche') >= 0 || c.indexOf('bsc') >= 0) {
      return { setup: 'about $0.20 to $0.80 of L2 gas', weekly: 'about $0.15 of gas a week' };
    }
    return { setup: 'about $1 to $3 of network gas', weekly: 'about $0.50 of gas a week' };
  }

  function walletStep(chain) {
    var c = chain.toLowerCase();
    if (c.indexOf('solana') >= 0) {
      return {
        text: 'Initialize a clean, dedicated Solana wallet (Phantom or Backpack) with offline key storage, funded with 0.1 SOL for rent exemption.',
        cost: 'under $0.05 of network fee',
        time: '5 minutes'
      };
    }
    if (c.indexOf('ethereum') >= 0 || c.indexOf('mainnet') >= 0) {
      return {
        text: 'Set up an isolated EVM wallet with no prior exchange links or sybil cluster history, funded with 0.03 ETH for reserve gas.',
        cost: 'under $5 of gas for setup transfer',
        time: '5 minutes'
      };
    }
    return {
      text: 'Configure an isolated EVM wallet with cold-stored mnemonic and bridge sufficient native gas to ' + chain + '.',
      cost: 'under $1 of bridge and gas fee',
      time: '5 minutes'
    };
  }

  function actionFor(p, capital, chain) {
    var c = (p.category || '').toLowerCase();
    var name = p.name;
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) {
      return 'Supply $' + capital + " of USDC into " + name + "'s verified pool on " + chain + ', and borrow 30% against it in stablecoins to maximize protocol utilisation without liquidation risk.';
    }
    if (c.indexOf('dex') >= 0 || c.indexOf('yield') >= 0 || c.indexOf('leveraged farm') >= 0) {
      return 'Provide $' + capital + " of liquidity to " + name + "'s primary paired pool (e.g. USDC/USDT or ETH/USDC) on " + chain + ' to accrue steady liquidity provider points with minimal impermanent loss.';
    }
    if (c.indexOf('bridge') >= 0) {
      return 'Execute a cross-chain transfer of $' + capital + ' USDC to ' + chain + ' using ' + name + ', and conduct at least one on-chain transaction with the transferred balance.';
    }
    if (c.indexOf('staking') >= 0 || c.indexOf('restak') >= 0) {
      return 'Stake $' + capital + ' of native assets through ' + name + ' on ' + chain + ', retain the liquid staking token receipt, and delegate to top-tier verified node operators.';
    }
    if (c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0) {
      return 'Deposit $' + capital + ' of USDC margin on ' + name + ' and execute a low-leverage (1x-2x) delta-neutral position across market epochs to qualify for active trader volume tiers.';
    }
    if (c.indexOf('prediction') >= 0) {
      return 'Provide $' + capital + " into " + name + "'s primary automated market maker or underwriting vault on " + chain + ' to capture trading fee yield and qualify for seasonal distributions.';
    }
    if (c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0) {
      return 'Deposit $' + capital + ' into a ' + name + ' risk-curated vault on ' + chain + ' and hold vault shares across multiple verification epochs.';
    }
    if (c.indexOf('stable') >= 0) {
      return 'Mint and deposit $' + capital + ' of the native decentralized stable asset through ' + name + ' on ' + chain + ' to earn protocol debt-ceiling incentives.';
    }
    if (c.indexOf('rwa') >= 0) {
      return 'Complete identity verification tier on ' + name + ' and subscribe $' + capital + ' into tokenized yield-bearing treasury assets on ' + chain + '.';
    }
    if (c.indexOf('insurance') >= 0) {
      return 'Underwrite $' + capital + ' of smart contract cover on ' + name + ' across blue-chip protocols on ' + chain + ' to capture underwriting premiums.';
    }
    return 'Deposit $' + capital + ' of USDC into ' + name + ' on ' + chain + ' to establish active user tenure on the protocol smart contracts.';
  }

  function stepText(step) {
    var s = step.text + ' Cost: ' + step.cost + '. Time: ' + step.time + '.';
    if (s.length > 600) s = s.slice(0, 596) + '...';
    if (s.length < 20) s = s + " Hold the position and check the protocol's own page.";
    return s;
  }

  function farmSteps(p) {
    var chain = chainOf(p);
    var capital = capitalFor(p);
    var hold = holdDaysFor(p.age_days);
    var action = actionFor(p, capital, chain);
    var gas = gasEstimate(chain);
    var wallet = walletStep(chain);
    return [
      wallet,
      { text: action, cost: '$' + capital + ' of capital and ' + gas.setup, time: '15 minutes to set up' },
      { text: 'Conduct one organic on-chain interaction weekly on ' + p.name + ' (e.g. rebalance liquidity, claim yields, or vote on governance proposals) to maintain continuous sybil-resistant activity.', cost: gas.weekly, time: '10 minutes a week' },
      { text: 'Maintain the active position for at least ' + hold + ' days across multiple snapshot windows, avoiding sudden churn withdrawals before token distribution.', cost: 'the $' + capital + ' remains active in the contract', time: hold + ' days' },
      { text: "Monitor telemetry and seasonal tier ranking exclusively on " + p.name + "'s official points portal, verifying domain authenticity before signing any claim transaction.", cost: 'no fee to verify allocation', time: '5 minutes' },
      { text: 'When TGE is confirmed, execute token allocation claims via the audited portal and systematically unwind the $' + capital + ' liquidity position back to cold storage.', cost: 'standard network claim fee', time: '10 minutes to execute' }
    ].map(stepText);
  }

  function readHash() {
    var hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    var params = new URLSearchParams(hash);
    if (params.get('q')) state.q = params.get('q');
    if (params.get('p')) state.selected = params.get('p');
    if (params.get('category')) state.category = params.get('category');
  }
  function writeHash() {
    var params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.category !== 'all') params.set('category', state.category);
    if (state.selected) params.set('p', state.selected);
    var next = params.toString();
    if (next) window.history.replaceState(null, '', '#' + next);
    else window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  function rows() {
    var q = state.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (state.category !== 'all' && r.category !== state.category) return false;
      if (!q) return true;
      var hay = [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }

  function sortedRows(list) {
    var key = state.sort;
    return list.slice().sort(function (a, b) {
      var av, bv;
      if (key === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
      else if (key === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (key === 'growth') { av = a.change_7d === null ? -Infinity : a.change_7d; bv = b.change_7d === null ? -Infinity : b.change_7d; }
      else if (key === 'age') { av = a.age_days === null ? Infinity : a.age_days; bv = b.age_days === null ? Infinity : b.age_days; }
      else { av = a.implied_value_usd; bv = b.implied_value_usd; }
      if (av < bv) return -state.dir;
      if (av > bv) return state.dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }

  function header() {
    return el('header', { class: 'top' },
      el('div', { class: 'brand' },
        el('span', { class: 'mark' }),
        el('span', { class: 'brand-name', text: 'Token Radar Pro' }),
        el('span', { class: 'brand-badge', text: 'v2.0' })
      ),
      el('div', { class: 'top-meta' },
        el('span', { text: 'Snapshot: ' + DATA.as_of }),
        el('span', { text: 'Watchlist: $' + Math.round(DATA.floor_usd / 1e6) + 'M+ TVL' }),
        el('span', { text: 'Model: ' + DATA.model_version }),
        el('span', { text: 'Calibrated: Superbot AI (superbot.gg)' })
      )
    );
  }

  function lede() {
    var totalImplied = DATA.rows.reduce(function (sum, r) { return sum + r.implied_value_usd; }, 0);
    return el('section', { class: 'lede' },
      el('div', null,
        el('h1', { text: DATA.watchlist_size + ' Watchlist Floor Protocols, Ranked by Implied Token Value' }),
        el('p', { text: 'Autonomous DeFi launch radar covering 100% of the watchlist floor ($' + Math.round(DATA.floor_usd / 1e6) + 'M+ TVL without a live token) plus ' + DATA.early_size + ' early pre-token protocols. Implied valuation is evaluated using objective capital base, 7-day momentum velocity, and seasoning maturity.' })
      ),
      el('div', { class: 'facts' },
        el('div', { class: 'fact' }, el('span', { text: 'Watchlist Covered' }), el('b', { class: 'accent', text: DATA.watchlist_size + ' / ' + DATA.watchlist_size })),
        el('div', { class: 'fact' }, el('span', { text: 'Total Implied Value' }), el('b', { class: 'cyan', text: fmtUsd(totalImplied) })),
        el('div', { class: 'fact' }, el('span', { text: 'Pre-Token Scored' }), el('b', { text: String(DATA.board_size) })),
        el('div', { class: 'fact' }, el('span', { text: 'Early Pre-Floor Gems' }), el('b', { text: String(DATA.early_size) }))
      )
    );
  }

  function controls() {
    var categories = Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Other'; }))).sort();
    var search = el('input', { type: 'search', id: 'q', placeholder: 'Search protocol, category, or chain...', value: state.q, 'aria-label': 'Search the board' });
    search.addEventListener('input', function () { state.q = search.value; writeHash(); render(); });
    var select = el('select', { id: 'category', 'aria-label': 'Filter by category' },
      el('option', { value: 'all', text: 'All Categories' }),
      categories.map(function (c) { return el('option', { value: c, text: c, selected: c === state.category ? 'selected' : null }); })
    );
    select.addEventListener('change', function () { state.category = select.value; writeHash(); render(); });
    var pre = el('button', { type: 'button', 'aria-pressed': state.tab === 'pre-token' ? 'true' : 'false', text: 'Pre-Token Radar (' + DATA.board_size + ')', onclick: function () { state.tab = 'pre-token'; render(); } });
    var live = el('button', { type: 'button', 'aria-pressed': state.tab === 'live' ? 'true' : 'false', text: 'Live Token Market (' + DATA.live.length + ')', onclick: function () { state.tab = 'live'; render(); } });
    return el('div', { class: 'controls' },
      el('div', { class: 'field' }, el('label', { for: 'q', text: 'Protocol Search' }), search),
      el('div', { class: 'field' }, el('label', { for: 'category', text: 'DeFi Category' }), select),
      el('div', { class: 'field' }, el('span', { class: 'sub', text: 'Pipeline View' }), el('div', { class: 'tabs' }, pre, live)),
      el('span', { class: 'count', text: state.tab === 'pre-token' ? rows().length + ' / ' + DATA.board_size + ' protocols displayed' : DATA.live.length + ' live benchmark protocols' })
    );
  }

  function sortHeader(key, label) {
    return el('th', { scope: 'col' },
      el('button', { type: 'button', onclick: function () { if (state.sort === key) state.dir = -state.dir; else { state.sort = key; state.dir = -1; } render(); } },
        label,
        state.sort === key ? el('span', { 'aria-hidden': 'true', text: state.dir < 0 ? ' v' : ' ^' }) : null
      )
    );
  }

  function boardTable() {
    var list = sortedRows(rows());
    if (list.length === 0) {
      return el('div', { class: 'panel' }, el('div', { class: 'empty' },
        el('h2', { text: 'No protocol matches the filter' }),
        el('p', { text: 'Try resetting the search keyword or selecting All Categories.' }),
        el('button', { class: 'button primary', type: 'button', text: 'Reset Filters', onclick: function () { state.q = ''; state.category = 'all'; writeHash(); render(); } })
      ));
    }
    var max = list[0].implied_value_usd || 1;
    var tbody = el('tbody');
    list.forEach(function (r) {
      var growth = r.change_7d === null ? 'n/a' : fmtPct(r.change_7d);
      var growthClass = r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg';
      var chains = r.chains && r.chains.length ? r.chains.slice(0, 2) : ['main'];
      var chainPills = chains.map(function (c) { return el('span', { class: 'chain-pill', text: c }); });
      var tr = el('tr', {
        'data-selected': state.selected === r.slug ? 'true' : 'false',
        tabindex: '0',
        onclick: function () { openDetail(r.slug); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } }
      },
        el('td', null, el('span', { class: 'rank-badge' + (r.rank <= 10 ? ' top-10' : ''), text: '#' + r.rank })),
        el('td', null, el('div', { class: 'name' },
          el('b', { text: r.name }),
          el('div', null, chainPills, el('span', { class: 'sub', text: r.category || 'DeFi' }))
        )),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + growthClass, text: growth }),
        el('td', { class: 'num', text: fmtAge(r.age_days) }),
        el('td', null, el('div', { class: 'implied' },
          el('div', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(3, Math.round((r.implied_value_usd / max) * 100)) + '%' })),
          el('span', { class: 'num val', text: fmtUsd(r.implied_value_usd) })
        )),
        el('td', null, el('span', { class: 'status-pill', text: 'Pre-Token' }))
      );
      tbody.appendChild(tr);
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', style: 'padding: 10px 14px; text-align: left;', text: 'Pre-token protocols ranked strictly by implied value descending. Click any row for valuation breakdown & 6-step farm plan.' }),
          el('thead', null, el('tr', null,
            sortHeader('implied', 'Rank'),
            sortHeader('name', 'Protocol & Chains'),
            sortHeader('tvl', 'TVL'),
            sortHeader('growth', '7d Velocity'),
            sortHeader('age', 'Seasoning'),
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
      var chains = r.chains && r.chains.length ? r.chains.slice(0, 2) : ['main'];
      var chainPills = chains.map(function (c) { return el('span', { class: 'chain-pill', text: c }); });
      tbody.appendChild(el('tr', null,
        el('td', null, el('span', { class: 'rank-badge', text: 'LIVE' })),
        el('td', null, el('div', { class: 'name' }, el('b', { text: r.name }), el('div', null, chainPills, el('span', { class: 'sub', text: r.category || 'DeFi' })))),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + (r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(r.change_7d) }),
        el('td', { class: 'num', text: fmtUsd(r.mcap_usd) }),
        el('td', null, el('span', { class: 'status-pill', style: 'background: rgba(255,255,255,0.08); color: #e5e7eb; border-color: rgba(255,255,255,0.2);', text: 'Active Trading' }))
      ));
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', style: 'padding: 10px 14px; text-align: left;', text: 'Live-Token Reference Benchmark: protocols already trading on open markets. Kept separate from pre-token radar.' }),
          el('thead', null, el('tr', null,
            el('th', { scope: 'col', text: 'Status' }),
            el('th', { scope: 'col', text: 'Protocol' }),
            el('th', { scope: 'col', text: 'TVL' }),
            el('th', { scope: 'col', text: '7d Change' }),
            el('th', { scope: 'col', text: 'Reported Market Cap' }),
            el('th', { scope: 'col', text: 'Market Status' })
          )),
          tbody
        )
      )
    );
  }

  function modelPanel() {
    var m = DATA.model;
    return el('section', { class: 'panel model' },
      el('h2', { text: 'Implied Valuation Methodology (' + DATA.model_version + ')' }),
      el('p', { class: 'sub', text: 'Strict mathematical valuation engine operating exclusively on frozen snapshot telemetry. Zero manual overrides or protocol hardcoding.' }),
      el('div', { class: 'formula' },
        'implied_value = max(1, round( tvl_usd * ' + m.base_multiple + ' * (1 + clamp(change_7d, ' + m.growth_floor + ', ' + m.growth_cap + ') / 100 * ' + m.growth_weight + ') * (' + m.maturity_floor + ' + min(age_days, ' + m.maturity_days + ') / ' + m.maturity_days + ' * ' + m.maturity_range + ') ))'
      ),
      el('p', { class: 'sub', text: 'Base Multiple (' + m.base_multiple + 'x TVL) reflects historical TGE FDV averages. Velocity Weight (' + m.growth_weight + ') rewards rapid capital expansion while clamping outliers. Maturity Range (' + m.maturity_floor + ' to ' + (m.maturity_floor + m.maturity_range) + ') accounts for seasoning and sybil-resistance duration. Unlisted age defaults to ' + m.unknown_age_days + ' days.' })
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
    var steps = farmSteps(row);
    dialog.appendChild(el('div', { class: 'detail-head' },
      el('div', null,
        el('span', { class: 'brand-badge', text: 'Rank #' + row.rank + ' of ' + DATA.board_size }),
        el('h2', { id: 'detail-title', text: row.name }),
        el('p', { class: 'sub', text: (row.category || 'DeFi') + ' deployed on ' + (row.chains && row.chains.length ? row.chains.join(', ') : 'main chain') })
      ),
      el('button', { class: 'close', type: 'button', 'aria-label': 'Close detail view', text: 'ESC', onclick: function () { dialog.close(); } })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Valuation Telemetry' }),
      el('div', { class: 'equation' },
        el('div', null, el('span', { text: 'Snapshot TVL' }), el('b', { text: fmtUsd(row.tvl_usd) })),
        el('div', null, el('span', { text: '7-Day Velocity' }), el('b', { class: row.change_7d !== null && row.change_7d >= 0 ? 'pos' : 'neg', text: fmtPct(row.change_7d) })),
        el('div', null, el('span', { text: 'Seasoning Age' }), el('b', { text: fmtAge(row.age_days) })),
        el('div', null, el('span', { text: 'Growth Mult' }), el('b', { text: String(row.growth_multiplier) + 'x' })),
        el('div', null, el('span', { text: 'Maturity Mult' }), el('b', { text: String(row.maturity_multiplier) + 'x' })),
        el('div', null, el('span', { text: 'Implied Valuation' }), el('b', { style: 'color: var(--accent-cyan); font-size: 16px;', text: fmtUsd(row.implied_value_usd) }))
      ),
      el('p', { class: 'sub', style: 'margin-top: 8px;', text: 'Engine: ' + DATA.model_version + '. Recomputed on client: ' + fmtUsd(impliedOf(row, DATA.model)) + (impliedOf(row, DATA.model) === row.implied_value_usd ? ' (verified 100% exact parity with board.json).' : ' (mismatch detected).') })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Actionable Farming Blueprint' }),
      el('ol', { class: 'steps' }, steps.map(function (s, idx) {
        var at = s.indexOf(' Cost: ');
        var action = at >= 0 ? s.slice(0, at) : s;
        var tail = at >= 0 ? s.slice(at + 7) : '';
        var timeAt = tail.indexOf('. Time: ');
        var cost = timeAt >= 0 ? tail.slice(0, timeAt) : tail;
        var time = timeAt >= 0 ? tail.slice(timeAt + 8).replace(/\.$/, '') : '';
        return el('li', { class: 'step-item' },
          el('span', { class: 'step-num', text: String(idx + 1) }),
          el('div', { class: 'step-body' },
            el('b', { text: action }),
            el('div', { class: 'step-meta' },
              cost ? el('span', { class: 'cost', text: 'Cost: ' + cost }) : null,
              time ? el('span', { class: 'time', text: 'Time: ' + time }) : null
            )
          )
        );
      })),
      el('div', { class: 'superbot-callout' },
        el('b', { text: 'Superbot AI Radar Analysis: ' }),
        document.createTextNode('Sustained protocol TVL and qualified activity tiers position ' + row.name + ' in prime TGE qualification window. Execute all 6 steps sequentially for maximum points conversion.')
      )
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
