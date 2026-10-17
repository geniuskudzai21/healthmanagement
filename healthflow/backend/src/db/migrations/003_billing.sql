-- Billing: service catalog, invoices, line items and payments.
-- All money is NUMERIC(12,2); invoice totals are recomputed on every mutation.

CREATE TABLE service_items (
    id          BIGSERIAL PRIMARY KEY,
    code        TEXT        NOT NULL,
    name        TEXT        NOT NULL,
    category    TEXT        NOT NULL DEFAULT 'consultation',
    description TEXT,
    unit_price  NUMERIC(12,2) NOT NULL DEFAULT 0,
    is_active   BOOLEAN     NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_service_items_code UNIQUE (code),
    CONSTRAINT ck_service_items_category CHECK (
        category IN ('consultation', 'procedure', 'diagnostics', 'medication', 'room', 'other')
    ),
    CONSTRAINT ck_service_items_price CHECK (unit_price >= 0)
);

CREATE INDEX idx_service_items_active ON service_items (is_active) WHERE is_active;
CREATE INDEX idx_service_items_category ON service_items (category);

-- ---------------------------------------------------------------------------
-- invoices (one per patient bill, optionally tied to a visit)
-- ---------------------------------------------------------------------------
CREATE TABLE invoices (
    id              BIGSERIAL PRIMARY KEY,
    invoice_no      INTEGER     NOT NULL,
    patient_id      BIGINT      NOT NULL REFERENCES patients (id) ON DELETE RESTRICT,
    visit_id        BIGINT      REFERENCES visits (id) ON DELETE SET NULL,
    status          TEXT        NOT NULL DEFAULT 'draft',
    notes           TEXT,
    discount_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
    tax_rate        NUMERIC(5,2)  NOT NULL DEFAULT 0,
    subtotal        NUMERIC(12,2) NOT NULL DEFAULT 0,
    total           NUMERIC(12,2) NOT NULL DEFAULT 0,
    issued_at       TIMESTAMPTZ,
    voided_at       TIMESTAMPTZ,
    created_by      BIGINT      REFERENCES users (id) ON DELETE SET NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_invoices_no UNIQUE (invoice_no),
    CONSTRAINT ck_invoices_status CHECK (status IN ('draft', 'issued', 'partially_paid', 'paid', 'void')),
    CONSTRAINT ck_invoices_amounts CHECK (
        discount_amount >= 0 AND tax_rate >= 0 AND subtotal >= 0 AND total >= 0
    )
);

CREATE INDEX idx_invoices_patient ON invoices (patient_id);
CREATE INDEX idx_invoices_status ON invoices (status);
CREATE INDEX idx_invoices_visit ON invoices (visit_id);
CREATE INDEX idx_invoices_created_at ON invoices (created_at DESC);

-- ---------------------------------------------------------------------------
-- invoice_lines
-- ---------------------------------------------------------------------------
CREATE TABLE invoice_lines (
    id              BIGSERIAL PRIMARY KEY,
    invoice_id      BIGINT      NOT NULL REFERENCES invoices (id) ON DELETE CASCADE,
    service_item_id BIGINT      REFERENCES service_items (id) ON DELETE SET NULL,
    description     TEXT        NOT NULL,
    quantity        NUMERIC(12,2) NOT NULL DEFAULT 1,
    unit_price      NUMERIC(12,2) NOT NULL DEFAULT 0,
    line_total      NUMERIC(12,2) NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT ck_invoice_lines_quantity CHECK (quantity > 0),
    CONSTRAINT ck_invoice_lines_price CHECK (unit_price >= 0)
);

CREATE INDEX idx_invoice_lines_invoice ON invoice_lines (invoice_id);

-- ---------------------------------------------------------------------------
-- payments (voiding keeps the row for audit; void payments never count)
-- ---------------------------------------------------------------------------
CREATE TABLE payments (
    id          BIGSERIAL PRIMARY KEY,
    invoice_id  BIGINT      NOT NULL REFERENCES invoices (id) ON DELETE CASCADE,
    amount      NUMERIC(12,2) NOT NULL,
    method      TEXT        NOT NULL DEFAULT 'cash',
    reference   TEXT,
    notes       TEXT,
    is_void     BOOLEAN     NOT NULL DEFAULT FALSE,
    received_by BIGINT      REFERENCES users (id) ON DELETE SET NULL,
    voided_by   BIGINT      REFERENCES users (id) ON DELETE SET NULL,
    voided_at   TIMESTAMPTZ,
    paid_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT ck_payments_amount CHECK (amount > 0),
    CONSTRAINT ck_payments_method CHECK (
        method IN ('cash', 'card', 'insurance', 'bank_transfer', 'mobile_money', 'other')
    )
);

CREATE INDEX idx_payments_invoice ON payments (invoice_id);
CREATE INDEX idx_payments_paid_at ON payments (paid_at DESC);

-- ---------------------------------------------------------------------------
-- audit: allow a dedicated 'void' action for cancelled invoices/payments
-- ---------------------------------------------------------------------------
ALTER TABLE audit_logs DROP CONSTRAINT ck_audit_action;
ALTER TABLE audit_logs ADD CONSTRAINT ck_audit_action CHECK (
    action IN ('create', 'update', 'delete', 'login', 'enqueue', 'call', 'status_change', 'void')
);

-- ---------------------------------------------------------------------------
-- updated_at maintenance
-- ---------------------------------------------------------------------------
CREATE TRIGGER trg_service_items_updated_at
    BEFORE UPDATE ON service_items
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_invoices_updated_at
    BEFORE UPDATE ON invoices
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
