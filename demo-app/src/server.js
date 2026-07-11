const express = require('express');
const path = require('path');
const store = require('./store');
const views = require('./views');

const app = express();
const PORT = process.env.PORT || 8300;

app.use(express.urlencoded({ extended: false }));
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

const redirect = (res, to, msg) => res.redirect(msg ? `${to}?msg=${encodeURIComponent(msg)}` : to);

// --- Pages ---

app.get('/', (req, res) => res.send(views.dashboard(req, store)));

app.get('/clients', (req, res) => res.send(views.clientsList(req, store)));
app.get('/clients/new', (req, res) => res.send(views.clientNew(req)));
app.post('/clients', (req, res) => {
  const client = store.createClient(req.body);
  redirect(res, `/clients/${client.id}`, `Client "${client.name}" created`);
});
app.get('/clients/:id', (req, res) => {
  const client = store.getClient(req.params.id);
  if (!client) return res.status(404).send('Client not found');
  res.send(views.clientDetail(req, store, client));
});

app.get('/clients/:id/policies/new', (req, res) => {
  const client = store.getClient(req.params.id);
  if (!client) return res.status(404).send('Client not found');
  res.send(views.policyNew(req, client));
});
app.post('/clients/:id/policies', (req, res) => {
  const client = store.getClient(req.params.id);
  if (!client) return res.status(404).send('Client not found');
  const policy = store.createPolicy({ ...req.body, clientId: client.id });
  redirect(res, `/policies/${policy.id}`, `Policy ${policy.policyNumber} created`);
});

app.get('/policies/:id', (req, res) => {
  const policy = store.getPolicy(req.params.id);
  if (!policy) return res.status(404).send('Policy not found');
  res.send(views.policyDetail(req, store, policy));
});
app.post('/policies/:id/invoice', (req, res) => {
  const policy = store.getPolicy(req.params.id);
  if (!policy) return res.status(404).send('Policy not found');
  const { error, txn } = store.invoiceNewBusiness(policy);
  if (error) return res.redirect(`/policies/${policy.id}?err=${encodeURIComponent(error)}`);
  redirect(res, `/policies/${policy.id}`, `Invoice generated: $${txn.amount.toFixed(2)}`);
});
app.post('/policies/:id/endorse', (req, res) => {
  const policy = store.getPolicy(req.params.id);
  if (!policy) return res.status(404).send('Policy not found');
  const { txn } = store.endorsePolicy(policy, req.body.premiumChange, req.body.description);
  redirect(res, `/policies/${policy.id}`, `Endorsement processed: billed $${txn.amount.toFixed(2)}`);
});
app.post('/policies/:id/renew', (req, res) => {
  const policy = store.getPolicy(req.params.id);
  if (!policy) return res.status(404).send('Policy not found');
  const { txn } = store.renewPolicy(policy);
  redirect(res, `/policies/${policy.id}`, `Policy renewed — renewal premium billed: $${txn.amount.toFixed(2)}`);
});
app.post('/policies/:id/cancel', (req, res) => {
  const policy = store.getPolicy(req.params.id);
  if (!policy) return res.status(404).send('Policy not found');
  store.cancelPolicy(policy);
  redirect(res, `/policies/${policy.id}`, 'Policy cancelled');
});

app.post('/clients/:id/receipts', (req, res) => {
  const client = store.getClient(req.params.id);
  if (!client) return res.status(404).send('Client not found');
  const receipt = store.recordReceipt({ clientId: client.id, ...req.body });
  redirect(res, `/clients/${client.id}`, `Receipt recorded: $${receipt.amount.toFixed(2)}`);
});

app.get('/activities', (req, res) => res.send(views.activitiesList(req, store)));
app.post('/activities/:id/close', (req, res) => {
  const a = store.closeActivity(Number(req.params.id));
  redirect(res, req.get('referer') || '/activities', a ? 'Activity closed' : 'Activity not found');
});

// --- Atlas provisioning API ---

app.get('/api/health', (req, res) => res.json({ ok: true, app: 'meridian-ams', ...store.summary() }));
app.post('/api/reset', (req, res) => {
  store.reset();
  res.json(store.summary());
});
app.post('/api/seed', (req, res) => {
  res.json(store.seed(req.body || {}));
});

app.listen(PORT, () => {
  console.log(`Meridian AMS listening on http://localhost:${PORT}`);
  const bugs = (process.env.ATLAS_BUG || '').trim();
  if (bugs) console.log(`⚠ Injected bugs active: ${bugs}`);
});
