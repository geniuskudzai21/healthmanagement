const router = require('express').Router();
const c = require('../controllers/billing.controller');
const { requireRole } = require('../middleware/auth');

const READ_ROLES = ['reception', 'clinician', 'admin'];
const BILLING_ROLES = ['reception', 'admin'];

// Service catalog: read for billing roles, write for admin only.
router.get('/service-items', requireRole(...READ_ROLES), c.listServiceItems);
router.post('/service-items', requireRole('admin'), c.createServiceItem);
router.patch('/service-items/:id', requireRole('admin'), c.updateServiceItem);

// Invoices and their lines.
router.get('/invoices', requireRole(...READ_ROLES), c.listInvoices);
router.get('/invoices/:id', requireRole(...READ_ROLES), c.getInvoice);
router.post('/invoices', requireRole(...BILLING_ROLES), c.createInvoice);
router.patch('/invoices/:id', requireRole(...BILLING_ROLES), c.updateInvoice);
router.delete('/invoices/:id', requireRole('admin'), c.removeInvoice);
router.post('/invoices/:id/lines', requireRole(...BILLING_ROLES), c.addLine);
router.patch('/invoices/:id/lines/:lineId', requireRole(...BILLING_ROLES), c.updateLine);
router.delete('/invoices/:id/lines/:lineId', requireRole(...BILLING_ROLES), c.removeLine);
router.post('/invoices/:id/issue', requireRole(...BILLING_ROLES), c.issueInvoice);
router.post('/invoices/:id/void', requireRole('admin'), c.voidInvoice);

// Payments.
router.get('/payments', requireRole(...READ_ROLES), c.listPayments);
router.post('/invoices/:id/payments', requireRole(...BILLING_ROLES), c.addPayment);
router.post('/payments/:paymentId/void', requireRole('admin'), c.voidPayment);

// Period summary for the billing dashboard.
router.get('/summary', requireRole(...READ_ROLES), c.summary);

module.exports = router;
