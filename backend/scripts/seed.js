/**
 * Secure initial admin seed script.
 *
 * Usage:
 *   1. Copy .env.example to .env and set a unique SEED_ADMIN_* password
 *   2. Run: npm run seed
 *
 * This creates the first administrator account with a hashed password.
 * It never promotes an existing non-admin account or prints credentials.
 */
require('dotenv').config();
const mongoose = require('mongoose');
const connectDB = require('../config/db');
const User = require('../models/User');
const SystemSetup = require('../models/SystemSetup');
const Department = require('../models/Department');

const seed = async () => {
  await connectDB();

  const email = (process.env.SEED_ADMIN_EMAIL || '').toLowerCase().trim();
  const password = process.env.SEED_ADMIN_PASSWORD || '';
  const name = process.env.SEED_ADMIN_NAME || '';

  console.log('\n=== EMS Seed Script ===\n');

  if (await User.exists({ $or: [{ role: 'Admin' }, { isInitialAdmin: true }] })) {
    console.log('✔  An Admin account already exists; no account changes made.');
    const admin = await User.findOne({ $or: [{ role: 'Admin' }, { isInitialAdmin: true }] }).select('_id').lean();
    if (admin) {
      await SystemSetup.updateOne(
        { _id: 'initial-admin' },
        { $setOnInsert: { completedAt: new Date(), initialAdminId: admin._id, method: 'cli_seed' } },
        { upsert: true },
      );
    }
  } else {
    if (!email || !password || !name || password.length < 12) {
      throw new Error('Set SEED_ADMIN_EMAIL, SEED_ADMIN_NAME, and a unique SEED_ADMIN_PASSWORD of at least 12 characters in backend/.env.');
    }
    const existing = await User.findOne({ email });
    if (existing) {
      throw new Error('SEED_ADMIN_EMAIL already belongs to an account. The seed script will not promote it.');
    }
    await User.create({
      name,
      email,
      password,
      role: 'Admin',
      isInitialAdmin: true,
      registrationStatus: 'approved',
      accountStatus: 'active',
      onboardingStatus: 'completed',
      personalInfoApprovalStatus: 'approved',
      documentVerificationStatus: 'verified',
      isActive: true,
    });
    const admin = await User.findOne({ email }).select('_id').lean();
    await SystemSetup.updateOne(
      { _id: 'initial-admin' },
      { $setOnInsert: { completedAt: new Date(), initialAdminId: admin._id, method: 'cli_seed' } },
      { upsert: true },
    );
    console.log('✔  Created the initial Admin account.');
  }

  // 2. Seed default departments (skip any that already exist)
  const defaultDepartments = [
    { name: 'Engineering',     code: 'ENG', description: 'Software development and infrastructure' },
    { name: 'Human Resources', code: 'HR',  description: 'Talent acquisition, employee relations, and HR policies' },
    { name: 'Marketing',       code: 'MKT', description: 'Brand management, campaigns, and digital marketing' },
    { name: 'Sales',           code: 'SAL', description: 'Revenue generation and client relationships' },
    { name: 'Finance',         code: 'FIN', description: 'Financial planning, accounting, and auditing' },
    { name: 'Operations',      code: 'OPS', description: 'Day-to-day operations and process management' },
    { name: 'Design',          code: 'DSG', description: 'UI/UX and graphic design' },
    { name: 'Legal',           code: 'LGL', description: 'Legal compliance and corporate governance' },
  ];

  let deptCount = 0;
  for (const d of defaultDepartments) {
    const exists = await Department.findOne({ name: d.name });
    if (!exists) {
      await Department.create(d);
      deptCount++;
    }
  }
  if (deptCount) {
    console.log(`✔  Seeded ${deptCount} default department(s).`);
  } else {
    console.log('✔  Default departments already present.');
  }

  console.log('\n=== Seed complete ===\n');
  await mongoose.connection.close();
  process.exit(0);
};

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
