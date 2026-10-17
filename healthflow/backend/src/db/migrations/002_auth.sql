-- Auth hardening: bcrypt hashes + password rotation detection

ALTER TABLE users ADD COLUMN password_changed_at TIMESTAMPTZ;

-- Speeds up "active clinician" lookups used by room routing and reports.
CREATE INDEX IF NOT EXISTS idx_users_clinicians
    ON users (id)
    WHERE role = 'clinician' AND is_active;
