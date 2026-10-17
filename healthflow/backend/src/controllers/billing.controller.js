const billingService = require('../services/billing.service');
const { validateBody, validateQuery } = require('../middleware/validate');

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/* ------------------------------------------------------------- catalog ---- */

const itemListSchema = {
  q: { type: 'string', maxLength: 100 },
  category: { type: 'string', enum: billingService.CATEGORIES },
  active: { type: 'boolean' },
  limit: { type: 'integer', min: 1, max: 500, default: 200 },
  offset: { type: 'integer', min: 0, default: 0 },
};

const itemCreateSchema = {
  code: { type: 'string', required: true, maxLength: 40 },
  name: { type: 'string', required: true, maxLength: 120 },
  category: { type: 'string', enum: billingService.CATEGORIES, default: 'consultation' },
  description: { type: 'string', maxLength: 500 },
  unit_price: { type: 'number', min: 0, max: 1000000, default: 0 },
  is_active: { type: 'boolean', default: true },
};

// Strip defaults so a partial update never overwrites omitted fields.
const itemUpdateSchema = Object.fromEntries(
  Object.entries(itemCreateSchema).map(([key, rule]) => [key, { ...rule, required: false, default: undefined }])
);

exports.listServiceItems = [
  validateQuery(itemListSchema),
  async (req, res, next) => {
    try {
      res.json(await billingService.listServiceItems(req.validQuery));
    } catch (err) {
      next(err);
    }
  },
];

exports.createServiceItem = [
  validateBody(itemCreateSchema),
  async (req, res, next) => {
    try {
      res.status(201).json(await billingService.createServiceItem(req.valid, res.locals.ctx));
    } catch (err) {
      next(err);
    }
  },
];

exports.updateServiceItem = [
  validateBody(itemUpdateSchema),
  async (req, res, next) => {
    try {
      res.json(await billingService.updateServiceItem(req.params.id, req.valid, res.locals.ctx));
    } catch (err) {
      next(err);
    }
  },
];

/* ------------------------------------------------------------ invoices ---- */

const invoiceListSchema = {
  q: { type: 'string', maxLength: 100 },
  status: { type: 'string', enum: billingService.INVOICE_STATUSES },
  patient_id: { type: 'integer' },
  from: { type: 'string', pattern: DATE_PATTERN, patternMessage: 'must be YYYY-MM-DD' },
  to: { type: 'string', pattern: DATE_PATTERN, patternMessage: 'must be YYYY-MM-DD' },
  limit: { type: 'integer', min: 1, max: 200, default: 50 },
  offset: { type: 'integer', min: 0, default: 0 },
};

const invoiceCreateSchema = {
  patient_id: { type: 'integer', required: true },
  visit_id: { type: 'integer' },
  notes: { type: 'string', maxLength: 2000 },
  discount_amount: { type: 'number', min: 0, max: 1000000, default: 0 },
  tax_rate: { type: 'number', min: 0, max: 100, default: 0 },
};

const invoiceUpdateSchema = {
  notes: { type: 'string', maxLength: 2000 },
  discount_amount: { type: 'number', min: 0, max: 1000000 },
  tax_rate: { type: 'number', min: 0, max: 100 },
};

const lineSchema = {
  service_item_id: { type: 'integer' },
  description: { type: 'string', maxLength: 500 },
  quantity: { type: 'number', min: 0.01, max: 100000, default: 1 },
  unit_price: { type: 'number', min: 0, max: 1000000 },
};

const lineUpdateSchema = {
  description: { type: 'string', maxLength: 500 },
  quantity: { type: 'number', min: 0.01, max: 100000 },
  unit_price: { type: 'number', min: 0, max: 1000000 },
};

const paymentSchema = {
  amount: { type: 'number', required: true, min: 0.01, max: 10000000 },
  method: { type: 'string', enum: billingService.PAYMENT_METHODS, default: 'cash' },
  reference: { type: 'string', maxLength: 120 },
  notes: { type: 'string', maxLength: 500 },
};

exports.listInvoices = [
  validateQuery(invoiceListSchema),
  async (req, res, next) => {
    try {
      res.json(await billingService.listInvoices(req.validQuery));
    } catch (err) {
      next(err);
    }
  },
];

exports.getInvoice = async (req, res, next) => {
  try {
    res.json(await billingService.getById(req.params.id));
  } catch (err) {
    next(err);
  }
};

exports.createInvoice = [
  validateBody(invoiceCreateSchema),
  async (req, res, next) => {
    try {
      res.status(201).json(await billingService.createInvoice(req.valid, res.locals.ctx));
    } catch (err) {
      next(err);
    }
  },
];

exports.updateInvoice = [
  validateBody(invoiceUpdateSchema),
  async (req, res, next) => {
    try {
      res.json(await billingService.updateInvoice(req.params.id, req.valid, res.locals.ctx));
    } catch (err) {
      next(err);
    }
  },
];

exports.removeInvoice = async (req, res, next) => {
  try {
    res.json(await billingService.removeInvoice(req.params.id, res.locals.ctx));
  } catch (err) {
    next(err);
  }
};

exports.addLine = [
  validateBody(lineSchema),
  async (req, res, next) => {
    try {
      res.status(201).json(await billingService.addLine(req.params.id, req.valid, res.locals.ctx));
    } catch (err) {
      next(err);
    }
  },
];

exports.updateLine = [
  validateBody(lineUpdateSchema),
  async (req, res, next) => {
    try {
      res.json(await billingService.updateLine(req.params.id, req.params.lineId, req.valid, res.locals.ctx));
    } catch (err) {
      next(err);
    }
  },
];

exports.removeLine = async (req, res, next) => {
  try {
    res.json(await billingService.removeLine(req.params.id, req.params.lineId, res.locals.ctx));
  } catch (err) {
    next(err);
  }
};

exports.issueInvoice = async (req, res, next) => {
  try {
    res.json(await billingService.issue(req.params.id, res.locals.ctx));
  } catch (err) {
    next(err);
  }
};

exports.voidInvoice = async (req, res, next) => {
  try {
    res.json(await billingService.voidInvoice(req.params.id, res.locals.ctx));
  } catch (err) {
    next(err);
  }
};

/* ------------------------------------------------------------- payments ---- */

const paymentListSchema = {
  invoice_id: { type: 'integer' },
  method: { type: 'string', enum: billingService.PAYMENT_METHODS },
  from: { type: 'string', pattern: DATE_PATTERN, patternMessage: 'must be YYYY-MM-DD' },
  to: { type: 'string', pattern: DATE_PATTERN, patternMessage: 'must be YYYY-MM-DD' },
  limit: { type: 'integer', min: 1, max: 200, default: 100 },
  offset: { type: 'integer', min: 0, default: 0 },
};

exports.listPayments = [
  validateQuery(paymentListSchema),
  async (req, res, next) => {
    try {
      res.json(await billingService.listPayments(req.validQuery));
    } catch (err) {
      next(err);
    }
  },
];

exports.addPayment = [
  validateBody(paymentSchema),
  async (req, res, next) => {
    try {
      res.status(201).json(await billingService.addPayment(req.params.id, req.valid, res.locals.ctx));
    } catch (err) {
      next(err);
    }
  },
];

exports.voidPayment = async (req, res, next) => {
  try {
    res.json(await billingService.voidPayment(req.params.paymentId, res.locals.ctx));
  } catch (err) {
    next(err);
  }
};

/* -------------------------------------------------------------- summary ---- */

exports.summary = [
  validateQuery({
    from: { type: 'string', pattern: DATE_PATTERN, patternMessage: 'must be YYYY-MM-DD' },
    to: { type: 'string', pattern: DATE_PATTERN, patternMessage: 'must be YYYY-MM-DD' },
  }),
  async (req, res, next) => {
    try {
      res.json(await billingService.summary(req.validQuery));
    } catch (err) {
      next(err);
    }
  },
];
