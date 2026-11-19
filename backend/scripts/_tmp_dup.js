// Focused test: duplicate-prevention while an active resignation exists.
require('dotenv').config();
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Resignation = require('../models/Resignation');

const BASE = 'http://localhost:5000/api';
const sign = (u) => jwt.sign({ id: u._id.toString() }, process.env.JWT_SECRET, { expiresIn: '1h' });
const TMP = 'tmp_dup_test@example.test';

async function http(method, path, token, body) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${BASE}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  let data = null;
  try { data = await res.json(); } catch (e) { data = null; }
  return { status: res.status, data };
}

(async () => {
  await mongoose.connect(process.env.MONGO_URI);
  let hr, c1;
  try {
    await User.deleteOne({ email: TMP });
    hr = await User.create({ name: 'Dup Test', email: TMP, password: 'Dup@Test123', role: 'HR', registrationStatus: 'approved', accountStatus: 'active', isActive: true });
    const t = sign(hr);
    const today = new Date().toISOString().slice(0, 10);
    const r1 = await http('POST', '/resignations', t, { submissionDate: today, resignationReason: 'Relocation', submissionKey: 'k1-' + Date.now() });
    console.log('first create:', r1.status, 'status=' + r1.data?.data?.status);
    c1 = r1.data?.data?._id;
    const r2 = await http('POST', '/resignations', t, { submissionDate: today, resignationReason: 'Career Change', submissionKey: 'k2-' + Date.now() });
    console.log('second (active) create:', r2.status, r2.data?.message ? r2.data.message.slice(0, 60) : '');
    console.log('DUPLICATE_BLOCKED:', r2.status === 409);
  } finally {
    try { if (c1) await Resignation.deleteOne({ _id: c1 }); } catch (e) {}
    try { await User.deleteOne({ email: TMP }); } catch (e) {}
    await mongoose.disconnect();
    console.log('DONE');
  }
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
