require('dotenv').config();

const { query, close } = require('../config/db');
const { hashPassword } = require('../utils/password');

const DEFAULTS = {
  email: 'admin@healthflow.local',
  name: 'HealthFlow Admin',
  password: 'ChangeMe123!',
};

const DEFAULT_SERVICES = [
  { code: 'CONS', name: 'Consultation', category: 'consultation', unit_price: 1500.0 },
  { code: 'VITALS', name: 'Vitals check', category: 'consultation', unit_price: 500.0 },
  { code: 'DRUG', name: 'Medication (per item)', category: 'medication', unit_price: 250.0 },
  { code: 'INJ', name: 'Injection', category: 'procedure', unit_price: 1500.0 },
  { code: 'DRESS', name: 'Dressing', category: 'procedure', unit_price: 800.0 },
  { code: 'LAB-G', name: 'Basic labs', category: 'diagnostics', unit_price: 2500.0 },
  { code: 'XRAY', name: 'X-ray', category: 'diagnostics', unit_price: 3500.0 },
  { code: 'ROOM-C', name: 'Consult room fee', category: 'room', unit_price: 500.0 },
];

const DEFAULT_PATIENTS = [
  { mrn: 'MRN1001', first_name: 'Amina', last_name: 'Hassan', phone: '0722100201', email: 'amina@example.com', dob: '1992-04-11', sex: 'female' },
  { mrn: 'MRN1002', first_name: 'Brian', last_name: 'Otieno', phone: '0722100202', email: 'brian@example.com', dob: '1987-09-23', sex: 'male' },
  { mrn: 'MRN1003', first_name: 'Chen', last_name: 'Wei', phone: '0722100203', email: 'chen@example.com', dob: '1995-01-07', sex: 'male' },
  { mrn: 'MRN1004', first_name: 'Dalia', last_name: 'Mwangi', phone: '0722100204', email: 'dalia@example.com', dob: '2001-06-15', sex: 'female' },
  { mrn: 'MRN1005', first_name: 'Elias', last_name: 'Kamau', phone: '0722100205', email: 'elias@example.com', dob: '1979-12-02', sex: 'male' },
  { mrn: 'MRN1006', first_name: 'Fatuma', last_name: 'Ali', phone: '0722100206', email: 'fatuma@example.com', dob: '1990-03-30', sex: 'female' },
  { mrn: 'MRN1007', first_name: 'Grace', last_name: 'Njeri', phone: '0722100207', email: 'grace@example.com', dob: '1983-07-19', sex: 'female' },
  { mrn: 'MRN1008', first_name: 'Hassan', last_name: 'Abdi', phone: '0722100208', email: 'hassan@example.com', dob: '1998-11-05', sex: 'male' },
  { mrn: 'MRN1009', first_name: 'Irene', last_name: 'Ouma', phone: '0722100209', email: 'irene@example.com', dob: '1975-02-27', sex: 'female' },
  { mrn: 'MRN1010', first_name: 'John', last_name: 'Kimani', phone: '0722100210', email: 'john@example.com', dob: '1985-08-08', sex: 'male' },
];

const DEFAULT_STAFF = [
  { role: 'reception', full_name: 'Rita Wanjiru', email: 'rita@healthflow.local' },
  { role: 'nurse', full_name: 'Nurse Peter Mwangi', email: 'peter@healthflow.local' },
  { role: 'clinician', full_name: 'Dr. Sarah Adhiambo', email: 'sarah@healthflow.local' },
  { role: 'clinician', full_name: 'Dr. James Kiprono', email: 'james@healthflow.local' },
];

const DEFAULT_ROOMS = [
  { code: 'VIT-1', name: 'Vitals Room 1', room_type: 'triage', floor: 'Ground' },
  { code: 'CON-1', name: 'Consultation Room 1', room_type: 'consult', floor: 'Ground' },
  { code: 'CON-2', name: 'Consultation Room 2', room_type: 'consult', floor: 'Ground' },
  { code: 'CON-3', name: 'Consultation Room 3', room_type: 'consult', floor: 'First' },
  { code: 'PROC-1', name: 'Procedure Room', room_type: 'procedure', floor: 'First' },
  { code: 'WAIT-1', name: 'Waiting Bay', room_type: 'waiting', floor: 'Ground' },
];

async function seed() {
  const email = (process.env.ADMIN_EMAIL || DEFAULTS.email).trim().toLowerCase();
  const fullName = (process.env.ADMIN_NAME || DEFAULTS.name).trim();
  const password = process.env.ADMIN_PASSWORD || DEFAULTS.password;

  if (!process.env.ADMIN_PASSWORD) {
    console.warn(
      `ADMIN_PASSWORD not set - using default "${DEFAULTS.password}". ` +
        'Change it before deploying.'
    );
  }

  const { rows } = await query(
    `
      INSERT INTO users (role, full_name, email, password_hash)
      VALUES ('admin', $1, $2, $3)
      ON CONFLICT (email) DO UPDATE
        SET role          = EXCLUDED.role,
            full_name     = EXCLUDED.full_name,
            password_hash = EXCLUDED.password_hash,
            is_active     = TRUE
      RETURNING id, role, full_name, email, is_active, created_at
    `,
    [fullName, email, await hashPassword(password)]
  );

  const admin = rows[0];
  console.log(`Admin user ready: ${admin.email} (id=${admin.id}, role=${admin.role})`);

  // Seed default service catalog (idempotent).
  for (const svc of DEFAULT_SERVICES) {
    await query(
      `
        INSERT INTO service_items (code, name, category, unit_price, is_active)
        VALUES ($1, $2, $3, $4, TRUE)
        ON CONFLICT (code) DO UPDATE SET
          name        = EXCLUDED.name,
          category    = EXCLUDED.category,
          unit_price  = EXCLUDED.unit_price,
          is_active   = TRUE
      `,
      [svc.code, svc.name, svc.category, svc.unit_price]
    );
  }
  console.log(`Service catalog seeded: ${DEFAULT_SERVICES.length} items.`);

  // Seed demo staff accounts (reception / nurse / clinicians) - idempotent.
  const staffPassword = await hashPassword(process.env.SEED_PASSWORD || 'ChangeMe123!');
  for (const s of DEFAULT_STAFF) {
    await query(
      `
        INSERT INTO users (role, full_name, email, password_hash)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (email) DO UPDATE SET
          role          = EXCLUDED.role,
          full_name     = EXCLUDED.full_name,
          password_hash = EXCLUDED.password_hash,
          is_active     = TRUE
      `,
      [s.role, s.full_name, s.email, staffPassword]
    );
  }
  console.log(`Demo staff seeded: ${DEFAULT_STAFF.length} accounts (password: ChangeMe123!).`);

  // Seed 10 demo patients - idempotent (skip if MRN already exists).
  for (const p of DEFAULT_PATIENTS) {
    await query(
      `
        INSERT INTO patients (mrn, first_name, last_name, date_of_birth, sex, phone, email)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT (mrn) DO NOTHING
      `,
      [p.mrn, p.first_name, p.last_name, p.dob, p.sex, p.phone, p.email]
    );
  }
  const { rows: patientCount } = await query('SELECT count(*)::int AS total FROM patients');
  console.log(`Demo patients seeded: total ${patientCount[0].total} patients in register.`);

  // Seed demo rooms - idempotent by code; never reset an existing room's status.
  for (const r of DEFAULT_ROOMS) {
    await query(
      `
        INSERT INTO rooms (code, name, room_type, status, floor, notes)
        VALUES ($1, $2, $3, 'available', $4, NULL)
        ON CONFLICT (code) DO UPDATE SET
          name      = EXCLUDED.name,
          room_type = EXCLUDED.room_type,
          floor     = EXCLUDED.floor
      `,
      [r.code, r.name, r.room_type, r.floor]
    );
  }
  const { rows: roomCount } = await query('SELECT count(*)::int AS total FROM rooms');
  console.log(`Demo rooms seeded: total ${roomCount[0].total} rooms.`);

  return admin;
}

seed()
  .then(close)
  .catch(async (err) => {
    console.error('Seed failed:', err.message || err);
    try {
      await close();
    } catch (_) {
      /* pool already closed */
    }
    process.exit(1);
  });
