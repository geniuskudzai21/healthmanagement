-- HealthFlow initial schema
-- Tables: users, patients, visits, queue_entries, appointments, rooms, audit_logs

CREATE TYPE user_role AS ENUM ('reception', 'nurse', 'clinician', 'admin');

-- ---------------------------------------------------------------------------
-- users
-- ---------------------------------------------------------------------------
CREATE TABLE users (
    id            BIGSERIAL PRIMARY KEY,
    role          user_role   NOT NULL,
    full_name     TEXT        NOT NULL,
    email         TEXT        NOT NULL,
    password_hash TEXT        NOT NULL,
    phone         TEXT,
    is_active     BOOLEAN     NOT NULL DEFAULT TRUE,
    last_login_at TIMESTAMPTZ,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_users_email UNIQUE (email),
    CONSTRAINT ck_users_email_format CHECK (position('@' IN email) > 1)
);

CREATE INDEX idx_users_role ON users (role);
CREATE INDEX idx_users_active ON users (is_active) WHERE is_active;

-- ---------------------------------------------------------------------------
-- patients
-- ---------------------------------------------------------------------------
CREATE TABLE patients (
    id            BIGSERIAL PRIMARY KEY,
    mrn           TEXT        NOT NULL,
    first_name    TEXT        NOT NULL,
    last_name     TEXT        NOT NULL,
    date_of_birth DATE        NOT NULL,
    sex           TEXT        NOT NULL,
    phone         TEXT,
    email         TEXT,
    address       TEXT,
    blood_type    TEXT,
    allergies     TEXT        NOT NULL DEFAULT '',
    notes         TEXT,
    is_active     BOOLEAN     NOT NULL DEFAULT TRUE,
    created_by    BIGINT      REFERENCES users (id) ON DELETE SET NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_patients_mrn UNIQUE (mrn),
    CONSTRAINT ck_patients_sex CHECK (sex IN ('female', 'male', 'intersex', 'unknown')),
    CONSTRAINT ck_patients_blood_type CHECK (
        blood_type IS NULL OR blood_type IN ('A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-')
    )
);

CREATE INDEX idx_patients_name ON patients (last_name, first_name);
CREATE INDEX idx_patients_dob ON patients (date_of_birth);
CREATE INDEX idx_patients_active ON patients (is_active) WHERE is_active;

-- ---------------------------------------------------------------------------
-- rooms
-- ---------------------------------------------------------------------------
CREATE TABLE rooms (
    id         BIGSERIAL PRIMARY KEY,
    code       TEXT        NOT NULL,
    name       TEXT        NOT NULL,
    room_type  TEXT        NOT NULL DEFAULT 'consult',
    status     TEXT        NOT NULL DEFAULT 'available',
    floor      TEXT,
    notes      TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_rooms_code UNIQUE (code),
    CONSTRAINT ck_rooms_type CHECK (room_type IN ('consult')),
    CONSTRAINT ck_rooms_status CHECK (status IN ('available', 'occupied', 'maintenance', 'reserved'))
);

CREATE INDEX idx_rooms_status ON rooms (status);
CREATE INDEX idx_rooms_type ON rooms (room_type);

-- ---------------------------------------------------------------------------
-- visits
-- ---------------------------------------------------------------------------
CREATE TABLE visits (
    id             BIGSERIAL PRIMARY KEY,
    patient_id     BIGINT      NOT NULL REFERENCES patients (id) ON DELETE RESTRICT,
    clinician_id   BIGINT      REFERENCES users (id) ON DELETE SET NULL,
    room_id        BIGINT      REFERENCES rooms (id) ON DELETE SET NULL,
    registered_by  BIGINT      REFERENCES users (id) ON DELETE SET NULL,
    appointment_id BIGINT,
    visit_type     TEXT        NOT NULL DEFAULT 'walk-in',
    status         TEXT        NOT NULL DEFAULT 'registered',
    chief_complaint TEXT,
    triage_level   SMALLINT,
    arrived_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    started_at     TIMESTAMPTZ,
    completed_at   TIMESTAMPTZ,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT ck_visits_type CHECK (visit_type IN ('walk-in', 'appointment', 'follow-up')),
    CONSTRAINT ck_visits_status CHECK (
        status IN ('registered', 'waiting', 'in_vitals', 'in_consult', 'completed', 'cancelled', 'no_show')
    ),
    CONSTRAINT ck_visits_triage CHECK (triage_level IS NULL OR triage_level BETWEEN 1 AND 5),
    CONSTRAINT ck_visits_completion_order CHECK (completed_at IS NULL OR started_at IS NULL OR completed_at >= started_at)
);

CREATE INDEX idx_visits_patient ON visits (patient_id);
CREATE INDEX idx_visits_clinician ON visits (clinician_id);
CREATE INDEX idx_visits_room ON visits (room_id);
CREATE INDEX idx_visits_status ON visits (status);
CREATE INDEX idx_visits_arrived_at ON visits (arrived_at DESC);

-- ---------------------------------------------------------------------------
-- queue_entries (one per visit, FIFO by area with triage priority)
-- ---------------------------------------------------------------------------
CREATE TABLE queue_entries (
    id          BIGSERIAL PRIMARY KEY,
    visit_id    BIGINT      NOT NULL REFERENCES visits (id) ON DELETE CASCADE,
    area        TEXT        NOT NULL DEFAULT 'general',
    ticket_no   INTEGER     NOT NULL,
    priority    SMALLINT    NOT NULL DEFAULT 3,
    status      TEXT        NOT NULL DEFAULT 'waiting',
    called_at   TIMESTAMPTZ,
    seated_at   TIMESTAMPTZ,
    finished_at TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_queue_visit UNIQUE (visit_id),
    CONSTRAINT uq_queue_ticket UNIQUE (area, ticket_no),
    CONSTRAINT ck_queue_area CHECK (area IN ('general', 'vitals', 'consult')),
    CONSTRAINT ck_queue_priority CHECK (priority BETWEEN 1 AND 5),
    CONSTRAINT ck_queue_status CHECK (
        status IN ('waiting', 'called', 'in_room', 'done', 'skipped', 'cancelled')
    )
);

-- Primary lookup: next patient for a given area.
CREATE INDEX idx_queue_area_status_order ON queue_entries (area, status, priority, ticket_no);
CREATE INDEX idx_queue_status ON queue_entries (status);

-- ---------------------------------------------------------------------------
-- appointments
-- ---------------------------------------------------------------------------
CREATE TABLE appointments (
    id             BIGSERIAL PRIMARY KEY,
    patient_id     BIGINT      NOT NULL REFERENCES patients (id) ON DELETE CASCADE,
    clinician_id   BIGINT      NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    room_id        BIGINT      REFERENCES rooms (id) ON DELETE SET NULL,
    scheduled_start TIMESTAMPTZ NOT NULL,
    scheduled_end  TIMESTAMPTZ NOT NULL,
    reason         TEXT,
    status         TEXT        NOT NULL DEFAULT 'scheduled',
    notes          TEXT,
    created_by     BIGINT      REFERENCES users (id) ON DELETE SET NULL,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT ck_appointments_window CHECK (scheduled_end > scheduled_start),
    CONSTRAINT ck_appointments_status CHECK (
        status IN ('scheduled', 'checked_in', 'completed', 'cancelled', 'no_show')
    )
);

-- Anti double-booking: the same clinician cannot hold two appointments starting
-- at the same instant, and neither can the same room.
CREATE UNIQUE INDEX uq_appointments_clinician_start
    ON appointments (clinician_id, scheduled_start);
CREATE UNIQUE INDEX uq_appointments_room_start
    ON appointments (room_id, scheduled_start)
    WHERE room_id IS NOT NULL;

CREATE INDEX idx_appointments_start ON appointments (scheduled_start);
CREATE INDEX idx_appointments_clinician_window ON appointments (clinician_id, scheduled_start, scheduled_end);
CREATE INDEX idx_appointments_patient ON appointments (patient_id);
CREATE INDEX idx_appointments_status ON appointments (status);

-- visits.appointment_id -> appointments.id (declared after appointments exists)
ALTER TABLE visits
    ADD CONSTRAINT fk_visits_appointment
    FOREIGN KEY (appointment_id) REFERENCES appointments (id) ON DELETE SET NULL;

CREATE INDEX idx_visits_appointment ON visits (appointment_id);

-- ---------------------------------------------------------------------------
-- audit_logs
-- ---------------------------------------------------------------------------
CREATE TABLE audit_logs (
    id          BIGSERIAL PRIMARY KEY,
    actor_id    BIGINT      REFERENCES users (id) ON DELETE SET NULL,
    action      TEXT        NOT NULL,
    entity      TEXT        NOT NULL,
    entity_id   TEXT,
    before_data JSONB,
    after_data  JSONB,
    ip_address  TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT ck_audit_action CHECK (action IN ('create', 'update', 'delete', 'login', 'enqueue', 'call', 'status_change'))
);

CREATE INDEX idx_audit_actor ON audit_logs (actor_id);
CREATE INDEX idx_audit_entity ON audit_logs (entity, entity_id);
CREATE INDEX idx_audit_created_at ON audit_logs (created_at DESC);

-- ---------------------------------------------------------------------------
-- updated_at maintenance
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_patients_updated_at
    BEFORE UPDATE ON patients
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_rooms_updated_at
    BEFORE UPDATE ON rooms
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_visits_updated_at
    BEFORE UPDATE ON visits
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_queue_entries_updated_at
    BEFORE UPDATE ON queue_entries
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_appointments_updated_at
    BEFORE UPDATE ON appointments
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
