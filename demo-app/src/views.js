// Server-rendered views for Meridian AMS. Plain HTML with accessible labels —
// the same affordances a real AMS gives its users are what let QA agents drive it.

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const money = (n) => {
  const v = Number(n);
  const sign = v < 0 ? '-' : '';
  return `${sign}$${Math.abs(v).toFixed(2)}`;
};

function layout(title, content, activeNav = '') {
  const nav = [
    ['/', 'Home Base'],
    ['/clients', 'Accounts'],
    ['/activities', 'Activities'],
  ];
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} — Meridian AMS</title>
<link rel="stylesheet" href="/styles.css">
</head>
<body>
<div class="app">
  <aside class="sidebar">
    <div class="brand">Meridian<span>AMS</span></div>
    <nav aria-label="Main navigation">
      ${nav
        .map(
          ([href, label]) =>
            `<a href="${href}" class="${activeNav === href ? 'active' : ''}">${label}</a>`
        )
        .join('\n')}
    </nav>
    <div class="sidebar-footer">Agency: Roossin &amp; Co.<br>Database: ATLAS-RUN</div>
  </aside>
  <main class="main">
    ${content}
  </main>
</div>
</body>
</html>`;
}

function flash(req) {
  const msg = req.query.msg;
  const err = req.query.err;
  let html = '';
  if (msg) html += `<div class="flash flash-ok" role="status">${esc(msg)}</div>`;
  if (err) html += `<div class="flash flash-err" role="alert">${esc(err)}</div>`;
  return html;
}

function dashboard(req, store) {
  const s = store.state;
  const openActivities = s.activities.filter((a) => a.status === 'Open');
  const soon = store.isoDate(new Date(store.today().getTime() + 90 * 24 * 3600 * 1000));
  const renewalsDue = s.policies.filter((p) => p.status === 'In Force' && p.expirationDate <= soon);
  const totalReceivable = s.clients.reduce((sum, c) => sum + store.clientBalance(c.id), 0);

  return layout(
    'Home Base',
    `
    ${flash(req)}
    <h1>Home Base</h1>
    <div class="stat-row">
      <div class="stat"><div class="stat-value">${s.clients.length}</div><div class="stat-label">Client accounts</div></div>
      <div class="stat"><div class="stat-value">${s.policies.filter((p) => p.status === 'In Force').length}</div><div class="stat-label">Policies in force</div></div>
      <div class="stat"><div class="stat-value">${openActivities.length}</div><div class="stat-label">Open activities</div></div>
      <div class="stat"><div class="stat-value">${money(totalReceivable)}</div><div class="stat-label">Accounts receivable</div></div>
    </div>

    <h2>Renewals Manager <span class="muted">(next 90 days)</span></h2>
    ${
      renewalsDue.length === 0
        ? '<p class="muted">No policies expiring in the next 90 days.</p>'
        : `<table><thead><tr><th>Policy</th><th>Client</th><th>Line</th><th>Expires</th><th>Premium</th><th></th></tr></thead><tbody>` +
          renewalsDue
            .map((p) => {
              const c = store.getClient(p.clientId);
              return `<tr>
                <td><a href="/policies/${p.id}">${esc(p.policyNumber)}</a></td>
                <td><a href="/clients/${c.id}">${esc(c.name)}</a></td>
                <td>${esc(p.lineOfBusiness)}</td>
                <td>${esc(p.expirationDate)}</td>
                <td>${money(p.premium)}</td>
                <td><form method="post" action="/policies/${p.id}/renew"><button type="submit">Renew</button></form></td>
              </tr>`;
            })
            .join('') +
          `</tbody></table>`
    }
    `,
    '/'
  );
}

function clientsList(req, store) {
  const q = (req.query.q || '').toLowerCase();
  const clients = store.state.clients.filter((c) => !q || c.name.toLowerCase().includes(q));
  return layout(
    'Accounts',
    `
    ${flash(req)}
    <div class="page-head">
      <h1>Accounts</h1>
      <a class="button" href="/clients/new">Add Client</a>
    </div>
    <form method="get" action="/clients" class="search">
      <label for="q">Search clients</label>
      <input id="q" name="q" type="search" value="${esc(req.query.q || '')}" placeholder="Client name…">
      <button type="submit">Locate</button>
    </form>
    <table>
      <thead><tr><th>Client</th><th>Type</th><th>Contact</th><th>Policies</th><th>Balance</th></tr></thead>
      <tbody>
      ${clients
        .map((c) => {
          const policyCount = store.state.policies.filter((p) => p.clientId === c.id).length;
          return `<tr>
            <td><a href="/clients/${c.id}">${esc(c.name)}</a></td>
            <td>${esc(c.type)}</td>
            <td>${esc(c.contactName)}</td>
            <td>${policyCount}</td>
            <td>${money(store.clientBalance(c.id))}</td>
          </tr>`;
        })
        .join('')}
      </tbody>
    </table>
    ${clients.length === 0 ? '<p class="muted">No clients found.</p>' : ''}
    `,
    '/clients'
  );
}

function clientNew(req) {
  return layout(
    'Add Client',
    `
    <h1>Add Client Account</h1>
    <form method="post" action="/clients" class="form-card">
      <div class="field">
        <label for="name">Client name</label>
        <input id="name" name="name" required>
      </div>
      <div class="field">
        <label for="type">Account type</label>
        <select id="type" name="type">
          <option>Commercial</option>
          <option>Personal</option>
        </select>
      </div>
      <div class="field">
        <label for="contactName">Primary contact</label>
        <input id="contactName" name="contactName">
      </div>
      <div class="field">
        <label for="email">Email</label>
        <input id="email" name="email" type="email">
      </div>
      <div class="field">
        <label for="phone">Phone</label>
        <input id="phone" name="phone">
      </div>
      <button type="submit">Create Client</button>
    </form>
    `,
    '/clients'
  );
}

function clientDetail(req, store, client) {
  const policies = store.state.policies.filter((p) => p.clientId === client.id);
  const txns = store.state.transactions.filter((t) => t.clientId === client.id);
  const receipts = store.state.receipts.filter((r) => r.clientId === client.id);
  const activities = store.state.activities
    .filter((a) => a.clientId === client.id)
    .slice()
    .reverse();
  const balance = store.clientBalance(client.id);

  return layout(
    client.name,
    `
    ${flash(req)}
    <div class="page-head">
      <h1>${esc(client.name)}</h1>
      <span class="badge">${esc(client.type)}</span>
    </div>
    <p class="muted">Contact: ${esc(client.contactName || '—')} · ${esc(client.email || '—')} · ${esc(client.phone || '—')}</p>

    <div class="stat-row">
      <div class="stat"><div class="stat-value" data-testid="client-balance">${money(balance)}</div><div class="stat-label">Account balance</div></div>
      <div class="stat"><div class="stat-value">${policies.filter((p) => p.status === 'In Force').length}</div><div class="stat-label">Policies in force</div></div>
    </div>

    <div class="page-head">
      <h2>Policies</h2>
      <a class="button" href="/clients/${client.id}/policies/new">Add Policy</a>
    </div>
    <table>
      <thead><tr><th>Policy #</th><th>Line of business</th><th>Carrier</th><th>Term</th><th>Annual premium</th><th>Billing</th><th>Status</th></tr></thead>
      <tbody>
      ${policies
        .map(
          (p) => `<tr>
          <td><a href="/policies/${p.id}">${esc(p.policyNumber)}</a></td>
          <td>${esc(p.lineOfBusiness)}</td>
          <td>${esc(p.carrier)}</td>
          <td>${esc(p.effectiveDate)} → ${esc(p.expirationDate)}</td>
          <td>${money(p.premium)}</td>
          <td>${esc(p.billingMode)}</td>
          <td><span class="badge badge-${p.status === 'In Force' ? 'ok' : 'warn'}">${esc(p.status)}</span></td>
        </tr>`
        )
        .join('')}
      </tbody>
    </table>
    ${policies.length === 0 ? '<p class="muted">No policies yet.</p>' : ''}

    <h2>Transactions</h2>
    <table>
      <thead><tr><th>Date</th><th>Code</th><th>Policy</th><th>Description</th><th class="num">Amount</th></tr></thead>
      <tbody>
      ${txns
        .map(
          (t) => `<tr>
          <td>${esc(t.date)}</td>
          <td><span class="badge">${esc(t.code)}</span></td>
          <td>${esc(t.policyNumber)}</td>
          <td>${esc(t.description)}</td>
          <td class="num">${money(t.amount)}</td>
        </tr>`
        )
        .join('')}
      ${receipts
        .map(
          (r) => `<tr>
          <td>${esc(r.date)}</td>
          <td><span class="badge">RCPT</span></td>
          <td>—</td>
          <td>Receipt (${esc(r.method)})</td>
          <td class="num">(${money(r.amount)})</td>
        </tr>`
        )
        .join('')}
      </tbody>
    </table>
    ${txns.length + receipts.length === 0 ? '<p class="muted">No transactions yet.</p>' : ''}

    <h2>Record Receipt</h2>
    <form method="post" action="/clients/${client.id}/receipts" class="form-inline">
      <div class="field">
        <label for="amount">Receipt amount</label>
        <input id="amount" name="amount" type="number" step="0.01" min="0.01" required>
      </div>
      <div class="field">
        <label for="method">Payment method</label>
        <select id="method" name="method"><option>Check</option><option>ACH</option><option>Card</option></select>
      </div>
      <button type="submit">Record Receipt</button>
    </form>

    <h2>Activities</h2>
    <table>
      <thead><tr><th>Opened</th><th>Code</th><th>Description</th><th>Owner</th><th>Status</th><th></th></tr></thead>
      <tbody>
      ${activities
        .map(
          (a) => `<tr>
          <td>${esc(a.createdAt.slice(0, 10))}</td>
          <td><span class="badge">${esc(a.code)}</span></td>
          <td>${esc(a.description)}</td>
          <td>${esc(a.owner)}</td>
          <td><span class="badge badge-${a.status === 'Open' ? 'warn' : 'ok'}">${esc(a.status)}</span></td>
          <td>${
            a.status === 'Open'
              ? `<form method="post" action="/activities/${a.id}/close"><button type="submit" class="button-small">Close</button></form>`
              : ''
          }</td>
        </tr>`
        )
        .join('')}
      </tbody>
    </table>
    `,
    '/clients'
  );
}

function policyNew(req, client) {
  const todayStr = new Date().toISOString().slice(0, 10);
  return layout(
    'Add Policy',
    `
    <h1>Add Policy — ${esc(client.name)}</h1>
    <form method="post" action="/clients/${client.id}/policies" class="form-card">
      <div class="field">
        <label for="lineOfBusiness">Line of business</label>
        <select id="lineOfBusiness" name="lineOfBusiness">
          <option>Commercial Auto</option>
          <option>General Liability</option>
          <option>Property</option>
          <option>Workers Compensation</option>
          <option>Umbrella</option>
        </select>
      </div>
      <div class="field">
        <label for="carrier">Carrier</label>
        <select id="carrier" name="carrier">
          <option>Hartline Mutual</option>
          <option>Crestview Insurance</option>
          <option>Pacific Standard</option>
          <option>Ironbridge Specialty</option>
        </select>
      </div>
      <div class="field">
        <label for="premium">Annual premium ($)</label>
        <input id="premium" name="premium" type="number" step="0.01" min="1" required>
      </div>
      <div class="field">
        <label for="effectiveDate">Effective date</label>
        <input id="effectiveDate" name="effectiveDate" type="date" value="${todayStr}" required>
      </div>
      <div class="field">
        <label for="billingMode">Billing mode</label>
        <select id="billingMode" name="billingMode">
          <option>Agency Bill</option>
          <option>Direct Bill</option>
        </select>
      </div>
      <button type="submit">Create Policy</button>
    </form>
    `,
    '/clients'
  );
}

function policyDetail(req, store, policy) {
  const client = store.getClient(policy.clientId);
  const txns = store.state.transactions.filter((t) => t.policyId === policy.id);
  return layout(
    policy.policyNumber,
    `
    ${flash(req)}
    <div class="page-head">
      <h1>${esc(policy.policyNumber)}</h1>
      <span class="badge badge-${policy.status === 'In Force' ? 'ok' : 'warn'}">${esc(policy.status)}</span>
    </div>
    <p class="muted">Client: <a href="/clients/${client.id}">${esc(client.name)}</a></p>

    <dl class="detail-grid">
      <div><dt>Line of business</dt><dd>${esc(policy.lineOfBusiness)}</dd></div>
      <div><dt>Carrier</dt><dd>${esc(policy.carrier)}</dd></div>
      <div><dt>Annual premium</dt><dd data-testid="policy-premium">${money(policy.premium)}</dd></div>
      <div><dt>Effective date</dt><dd data-testid="policy-effective">${esc(policy.effectiveDate)}</dd></div>
      <div><dt>Expiration date</dt><dd data-testid="policy-expiration">${esc(policy.expirationDate)}</dd></div>
      <div><dt>Billing mode</dt><dd>${esc(policy.billingMode)}</dd></div>
    </dl>

    <h2>Policy transactions</h2>
    <table>
      <thead><tr><th>Date</th><th>Code</th><th>Description</th><th class="num">Amount</th></tr></thead>
      <tbody>
      ${txns
        .map(
          (t) => `<tr>
          <td>${esc(t.date)}</td>
          <td><span class="badge">${esc(t.code)}</span></td>
          <td>${esc(t.description)}</td>
          <td class="num">${money(t.amount)}</td>
        </tr>`
        )
        .join('')}
      </tbody>
    </table>
    ${txns.length === 0 ? '<p class="muted">No transactions on this policy.</p>' : ''}

    ${
      policy.status === 'In Force'
        ? `
    <div class="action-grid">
      <section class="form-card">
        <h2>Generate Invoice</h2>
        <p class="muted">Bills the full annual premium as new business (NEWB).</p>
        <form method="post" action="/policies/${policy.id}/invoice">
          <button type="submit">Generate Invoice</button>
        </form>
      </section>

      <section class="form-card">
        <h2>Process Endorsement</h2>
        <p class="muted">Mid-term premium change. Billed pro-rata over the remaining days of the term.</p>
        <form method="post" action="/policies/${policy.id}/endorse">
          <div class="field">
            <label for="premiumChange">Annualized premium change ($)</label>
            <input id="premiumChange" name="premiumChange" type="number" step="0.01" required>
          </div>
          <div class="field">
            <label for="description">Endorsement description</label>
            <input id="description" name="description" placeholder="e.g. Added 2019 Freightliner">
          </div>
          <button type="submit">Process Endorsement</button>
        </form>
      </section>

      <section class="form-card">
        <h2>Renew / Cancel</h2>
        <form method="post" action="/policies/${policy.id}/renew" class="stack">
          <button type="submit">Renew Policy (1-year term)</button>
        </form>
        <form method="post" action="/policies/${policy.id}/cancel" class="stack">
          <button type="submit" class="button-danger">Cancel Policy</button>
        </form>
      </section>
    </div>`
        : ''
    }
    `,
    '/clients'
  );
}

function activitiesList(req, store) {
  const activities = store.state.activities.slice().reverse();
  return layout(
    'Activities',
    `
    ${flash(req)}
    <h1>Activities</h1>
    <table>
      <thead><tr><th>Opened</th><th>Client</th><th>Code</th><th>Description</th><th>Owner</th><th>Status</th><th></th></tr></thead>
      <tbody>
      ${activities
        .map((a) => {
          const c = store.getClient(a.clientId);
          return `<tr>
          <td>${esc(a.createdAt.slice(0, 10))}</td>
          <td><a href="/clients/${c.id}">${esc(c.name)}</a></td>
          <td><span class="badge">${esc(a.code)}</span></td>
          <td>${esc(a.description)}</td>
          <td>${esc(a.owner)}</td>
          <td><span class="badge badge-${a.status === 'Open' ? 'warn' : 'ok'}">${esc(a.status)}</span></td>
          <td>${
            a.status === 'Open'
              ? `<form method="post" action="/activities/${a.id}/close"><button type="submit" class="button-small">Close</button></form>`
              : ''
          }</td>
        </tr>`;
        })
        .join('')}
      </tbody>
    </table>
    ${activities.length === 0 ? '<p class="muted">No activities.</p>' : ''}
    `,
    '/activities'
  );
}

module.exports = { dashboard, clientsList, clientNew, clientDetail, policyNew, policyDetail, activitiesList };
