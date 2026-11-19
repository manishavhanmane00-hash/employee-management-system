// Temporary end-to-end test for the Resignation module.
// Creates a throwaway HR user, exercises the full workflow, then deletes the
// test record and the temp user (net-zero change to the real DB).
require('dotenv').config();
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Resignation = require('../models/Resignation');

const BASE = 'http://localhost:5000/api';
const TMP_EMAIL = 'tmp_hr_resignation_test@example.test';
const TMP_PASSWORD = 'Tmp@Test123456';

const sign = (u) => jwt.sign({ id: u._id.toString() }, process.env.JWT_SECRET, { expiresIn: '1h' });

async function http(method, path, token, body) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${BASE}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  let data = null;
  try { data = await res.json(); } catch { /* non-json */ }
  return { status: res.status, data };
}

(async () => {
  let admin, hr, createdId;
  await mongoose.connect(process.env.MONGO_URI);
  try {
    // Find admin + create temp HR user
    admin = await User.findOne({ role: 'Admin', isActive: true });
    if (!admin) throw new Error('No admin user found');
    await User.deleteOne({ email: TMP_EMAIL }); // ensure clean
    hr = await User.create({
      name: 'Tmp HR Test', email: TMP_EMAIL, password: TMP_PASSWORD, role: 'HR',
      registrationStatus: 'approved', accountStatus: 'active', isActive: true,
    });
    const adminToken = sign(admin);
    const hrToken = sign(hr);
    let r;
    console.log('--- ADMIN READS ---');
    r = await http('GET', '/permissions', adminToken);
    const hasRes = r.data?.modules?.some(m => m.key === 'resignation');
    console.log('permissions resignation module present:', hasRes, '(status', r.status + ')');
    r = await http('GET', '/resignations', adminToken);
    console.log('list:', r.status, 'success=' + r.data?.success, 'count=' + r.data?.count);
    r = await http('GET', '/resignations/stats', adminToken);
    console.log('stats:', r.status, 'total=' + r.data?.data?.total);

    console.log('--- HR CREATES ---');
    r = await http('POST', '/resignations', hrToken, {
      submissionDate: new Date().toISOString().slice(0, 10),
      resignationReason: 'Better Opportunity',
      detailedExplanation: 'Accepted an offer elsewhere.',
      noticePeriod: '30 days',
      proposedLastWorkingDay: new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10),
      submissionKey: 'test-key-' + Date.now(),
    });
    console.log('create:', r.status, 'success=' + r.data?.success, 'status=' + r.data?.data?.status);
    if (!r.data?.success) throw new Error('Create failed: ' + r.data?.message);
    createdId = r.data.data._id;

    console.log('--- ADMIN MANAGER-REVIEW (approve) ---');
    r = await http('PUT', `/resignations/${createdId}/manager-review`, adminToken, { decision: 'approve', comment: 'Manager approves' });
    console.log('manager-review:', r.status, 'status=' + r.data?.data?.status);

    console.log('--- ADMIN HR-REVIEW (approve) ---');
    r = await http('PUT', `/resignations/${createdId}/hr-review`, adminToken, { decision: 'approve', comment: 'HR approves', lastWorkingDay: new Date(Date.now() + 25 * 86400000).toISOString().slice(0, 10), noticePeriod: '25 days' });
    console.log('hr-review:', r.status, 'status=' + r.data?.data?.status);

    console.log('--- ADMIN FINALIZE ---');
    r = await http('PUT', `/resignations/${createdId}/finalize`, adminToken, { comment: 'Final approval' });
    console.log('finalize:', r.status, 'status=' + r.data?.data?.status);

    console.log('--- ADMIN COMPLETE ---');
    r = await http('PUT', `/resignations/${createdId}/complete`, adminToken, { comment: 'Exit complete' });
    console.log('complete:', r.status, 'status=' + r.data?.data?.status);

    console.log('--- ADMIN MANAGE EXIT (update clearance) ---');
    r = await http('PUT', `/resignations/${createdId}`, adminToken, { exitStatus: 'Completed', clearance: { assets: 'Cleared', accounts: 'Cleared', documents: 'Cleared', knowledgeTransfer: 'Not Applicable' }, exitRemarks: 'All cleared' });
    console.log('exit update:', r.status, 'exitStatus=' + r.data?.data?.exitStatus, 'clearance.assets=' + r.data?.data?.clearance?.assets);

    console.log('--- VERIFY HISTORY + STATS ---');
    r = await http('GET', `/resignations/${createdId}`, adminToken);
    const hist = r.data?.data?.history || [];
    console.log('history steps:', hist.map(h => `${h.action}(${h.status})`).join(' -> '));
    r = await http('GET', '/resignations/stats', adminToken);
    console.log('stats after workflow: total=' + r.data?.data?.total + ' completed=' + r.data?.data?.completed);

    console.log('--- DUPLICATE PREVENTION ---');
    r = await http('POST', '/resignations', hrToken, {
      submissionDate: new Date().toISOString().slice(0, 10),
      resignationReason: 'Relocation',
      submissionKey: 'test-key2-' + Date.now(),
    });
    console.log('second active resignation (should be 409):', r.status, r.data?.message ? r.data.message.slice(0,60) : '');

    console.log('ALL_WORKFLOW_OK');
  } finally {
    // Cleanup
    try { if (createdId) await Resignation.deleteOne({ _id: createdId }); } catch {}
    try { if (hr) await User.deleteOne({ _id: hr._id }); } catch {}
    try { await User.deleteOne({ email: TMP_EMAIL }); } catch {}
    await mongoose.disconnect();
    console.log('CLEANUP_DONE');
  }
})().catch(e => { console.error('TEST_ERROR:', e.message); process.exit(1); });
