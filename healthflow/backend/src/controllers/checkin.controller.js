const checkinService = require('../services/checkin.service');
const { validateBody, EMAIL_PATTERN } = require('../middleware/validate');

const SEX = ['female', 'male', 'intersex', 'unknown'];
const VISIT_TYPES = ['walk-in', 'appointment', 'follow-up'];

exports.checkIn = [
  validateBody({
    patient_id: { type: 'integer' },
    mrn: { type: 'string', maxLength: 40 },
    first_name: { type: 'string', maxLength: 100 },
    last_name: { type: 'string', maxLength: 100 },
    date_of_birth: { type: 'date' },
    sex: { type: 'string', enum: SEX, default: 'unknown' },
    phone: { type: 'string', maxLength: 40 },
    email: { type: 'string', pattern: EMAIL_PATTERN, patternMessage: 'must be a valid email' },
    chief_complaint: { type: 'string', maxLength: 1000 },
    triage_level: { type: 'integer', min: 1, max: 5 },
    clinician_id: { type: 'integer' },
    area: { type: 'string', enum: ['general', 'vitals', 'consult'], default: 'general' },
    visit_type: { type: 'string', enum: VISIT_TYPES, default: 'walk-in' },
  }),
  async (req, res, next) => {
    try {
      res.status(201).json(await checkinService.checkIn(req.valid, res.locals.ctx));
    } catch (err) {
      next(err);
    }
  },
];
