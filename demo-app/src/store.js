// In-memory data store for Meridian AMS.
// State is intentionally ephemeral: every process start is a fresh environment,
// which is what lets Atlas provision a clean instance per run.

const DAY_MS = 24 * 60 * 60 * 1000;

// Regressions Atlas is expected to catch. Injected via ATLAS_BUG (comma-separated).
const injectedBugs = new Set(
  (process.env.ATLAS_BUG || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
);

function hasBug(name) {
  return injectedBugs.has(name);
}

const state = {
  clients: [],
  policies: [],
  transactions: [],
  receipts: [],
  activities: [],
  nextId: 1000,
};

function nextId() {
  return state.nextId++;
}

function reset() {
  state.clients = [];
  state.policies = [];
  state.transactions = [];
  state.receipts = [];
  state.activities = [];
  state.nextId = 1000;
}

function today() {
  return new Date();
}

function isoDate(d) {
  return d.toISOString().slice(0, 10);
}

function addDays(dateStr, days) {
  return isoDate(new Date(new Date(dateStr).getTime() + days * DAY_MS));
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

// --- Activities (the Epic-style workflow backbone) ---

function logActivity(clientId, code, description) {
  const activity = {
    id: nextId(),
    clientId,
    code, // NACC, NPOL, ENDT, RENW, INVC, RCPT, CANC
    description,
    status: 'Open',
    owner: 'CSR1',
    createdAt: new Date().toISOString(),
    closedAt: null,
  };
  state.activities.push(activity);
  return activity;
}

function closeActivity(id) {
  const a = state.activities.find((x) => x.id === id);
  if (a && a.status === 'Open') {
    a.status = 'Closed';
    a.closedAt = new Date().toISOString();
  }
  return a;
}

// --- Clients ---

function createClient({ name, type, contactName, email, phone }) {
  const client = {
    id: nextId(),
    name,
    type: type || 'Commercial',
    contactName: contactName || '',
    email: email || '',
    phone: phone || '',
    createdAt: new Date().toISOString(),
  };
  state.clients.push(client);
  logActivity(client.id, 'NACC', `New client account created: ${name}`);
  return client;
}

function getClient(id) {
  return state.clients.find((c) => c.id === Number(id));
}

function clientBalance(clientId) {
  const invoiced = state.transactions
    .filter((t) => t.clientId === clientId)
    .reduce((sum, t) => sum + t.amount, 0);
  const received = state.receipts
    .filter((r) => r.clientId === clientId)
    .reduce((sum, r) => sum + r.amount, 0);
  if (hasBug('stale-balance')) {
    // BUG: receipts are ignored when computing the displayed balance
    return round2(invoiced);
  }
  return round2(invoiced - received);
}

// --- Policies ---

function createPolicy({ clientId, lineOfBusiness, carrier, premium, effectiveDate, billingMode }) {
  const lobCode = (lineOfBusiness || 'GEN').slice(0, 4).toUpperCase().replace(/\s/g, '');
  const policy = {
    id: nextId(),
    clientId: Number(clientId),
    lineOfBusiness,
    carrier,
    policyNumber: `MER-${lobCode}-${state.nextId}`,
    premium: round2(Number(premium)),
    effectiveDate,
    expirationDate: addDays(effectiveDate, 365),
    status: 'In Force',
    billingMode: billingMode || 'Agency Bill',
    invoiced: false,
  };
  state.policies.push(policy);
  logActivity(policy.clientId, 'NPOL', `New ${lineOfBusiness} policy ${policy.policyNumber} with ${carrier}`);
  return policy;
}

function getPolicy(id) {
  return state.policies.find((p) => p.id === Number(id));
}

// --- Transactions (invoices) ---

function addTransaction(policy, code, description, amount) {
  const txn = {
    id: nextId(),
    clientId: policy.clientId,
    policyId: policy.id,
    policyNumber: policy.policyNumber,
    code, // NEWB, RENB, ENDT, CANC, FEE
    description,
    amount: round2(amount),
    date: isoDate(today()),
  };
  state.transactions.push(txn);
  return txn;
}

function invoiceNewBusiness(policy) {
  if (policy.invoiced) {
    return { error: 'Policy has already been invoiced for this term.' };
  }
  const txn = addTransaction(policy, 'NEWB', `New business premium — ${policy.policyNumber}`, policy.premium);
  policy.invoiced = true;
  logActivity(policy.clientId, 'INVC', `Invoice generated for ${policy.policyNumber}: $${txn.amount.toFixed(2)}`);
  return { txn };
}

// Endorsement: mid-term premium change, billed pro-rata for the REMAINING days of the term.
function endorsePolicy(policy, premiumChange, description) {
  const change = round2(Number(premiumChange));
  const termDays = Math.round((new Date(policy.expirationDate) - new Date(policy.effectiveDate)) / DAY_MS);
  const elapsedDays = Math.min(
    termDays,
    Math.max(0, Math.round((today() - new Date(policy.effectiveDate)) / DAY_MS))
  );

  const prorationFactor = elapsedDays / termDays;
  const prorated = round2(change * prorationFactor);

  policy.premium = round2(policy.premium + change);
  const txn = addTransaction(
    policy,
    'ENDT',
    `Endorsement — ${description || 'premium change'} (${change >= 0 ? '+' : ''}$${change.toFixed(2)} annualized, pro-rated)`,
    prorated
  );
  if (!hasBug('missing-activity')) {
    // BUG (when enabled): endorsement silently skips the workflow activity
    logActivity(policy.clientId, 'ENDT', `Endorsement processed on ${policy.policyNumber}: billed $${prorated.toFixed(2)}`);
  }
  return { txn };
}

function renewPolicy(policy) {
  policy.effectiveDate = policy.expirationDate;
  policy.expirationDate = addDays(policy.effectiveDate, 365);
  policy.status = 'In Force';
  const txn = addTransaction(policy, 'RENB', `Renewal premium — ${policy.policyNumber}`, policy.premium);
  logActivity(policy.clientId, 'RENW', `Policy ${policy.policyNumber} renewed through ${policy.expirationDate}`);
  return { txn };
}

function cancelPolicy(policy) {
  policy.status = 'Cancelled';
  logActivity(policy.clientId, 'CANC', `Policy ${policy.policyNumber} cancelled`);
}

// --- Receipts ---

function recordReceipt({ clientId, amount, method }) {
  const receipt = {
    id: nextId(),
    clientId: Number(clientId),
    amount: round2(Number(amount)),
    method: method || 'Check',
    date: isoDate(today()),
  };
  state.receipts.push(receipt);
  logActivity(receipt.clientId, 'RCPT', `Receipt recorded: $${receipt.amount.toFixed(2)} (${receipt.method})`);
  return receipt;
}

// --- Seeding ---

function seed(payload) {
  reset();
  for (const c of payload.clients || []) {
    const client = createClient(c);
    for (const p of c.policies || []) {
      const policy = createPolicy({ ...p, clientId: client.id });
      if (p.invoice) invoiceNewBusiness(policy);
    }
  }
  return summary();
}

function summary() {
  return {
    clients: state.clients.length,
    policies: state.policies.length,
    transactions: state.transactions.length,
    receipts: state.receipts.length,
    activities: state.activities.length,
    injectedBugs: [...injectedBugs],
  };
}

module.exports = {
  state,
  reset,
  seed,
  summary,
  createClient,
  getClient,
  clientBalance,
  createPolicy,
  getPolicy,
  invoiceNewBusiness,
  endorsePolicy,
  renewPolicy,
  cancelPolicy,
  recordReceipt,
  logActivity,
  closeActivity,
  isoDate,
  today,
};
