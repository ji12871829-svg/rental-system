// validationSchemas.js — zod schemas for every request body, all in one place.
// The API boundary rejects anything not shaped exactly like this (§7).
const { z } = require('zod');

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const passwordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters.')
  .regex(/\d/, 'Password must contain at least one number.');

// ---- Auth ----
const loginSchema = z.object({
  email: z.string().email().max(255),
  password: z.string().min(1).max(255),
});

// ---- Units ----
const unitCreateSchema = z.object({
  unitNumber: z.string().trim().min(1).max(20),
  floor: z.string().trim().max(20).nullish(),
  bedrooms: z.coerce.number().int().min(0).max(50).default(1),
  bathrooms: z.coerce.number().int().min(0).max(50).default(1),
  squareFeet: z.coerce.number().int().min(0).nullish(),
  baseRent: z.coerce.number().min(0).max(99999999),
  notes: z.string().max(2000).nullish(),
});

// PATCH: same fields, none required, and status is updatable here too.
const unitUpdateSchema = unitCreateSchema
  .partial()
  .extend({ status: z.enum(['vacant', 'occupied', 'maintenance']).optional() });

// ---- Tenants ----
const tenantBase = {
  firstName: z.string().trim().min(1).max(100),
  lastName: z.string().trim().min(1).max(100),
  email: z.string().trim().email().max(255),
  phone: z.string().trim().min(3).max(30),
  nationalId: z.string().trim().max(50).nullish(),
  emergencyContactName: z.string().trim().max(150).nullish(),
  emergencyContactPhone: z.string().trim().max(30).nullish(),
};
const tenantCreateSchema = z.object(tenantBase);
const tenantUpdateSchema = z.object(tenantBase).partial();

// ---- Leases ----
const leaseCreateSchema = z
  .object({
    unitId: z.coerce.number().int().positive(),
    tenantId: z.coerce.number().int().positive(),
    startDate: z.string().regex(DATE_RE, 'startDate must be YYYY-MM-DD'),
    endDate: z.string().regex(DATE_RE, 'endDate must be YYYY-MM-DD'),
    monthlyRent: z.coerce.number().min(0).max(99999999),
    depositAmount: z.coerce.number().min(0).max(99999999).default(0),
  });

const leaseUpdateSchema = z
  .object({
    endDate: z.string().regex(DATE_RE, 'endDate must be YYYY-MM-DD').optional(),
    monthlyRent: z.coerce.number().min(0).max(99999999).optional(),
    status: z.enum(['active', 'expired', 'terminated']).optional(),
  })
  .refine((b) => Object.keys(b).length > 0, { message: 'At least one field is required.' });

// ---- Payments ----
const paymentCreateSchema = z.object({
  leaseId: z.coerce.number().int().positive(),
  amount: z.coerce.number().positive('Amount must be greater than 0.').max(99999999),
  paymentDate: z.string().regex(DATE_RE, 'paymentDate must be YYYY-MM-DD'),
  paymentMethod: z.enum(['cash', 'mpesa', 'bank_transfer', 'card', 'other']),
  referenceNumber: z.string().trim().max(100).nullish(),
  notes: z.string().max(2000).nullish(),
});

// ---- Users (admin management) ----
const userCreateSchema = z.object({
  email: z.string().trim().email().max(255),
  password: passwordSchema, // min 8 chars + ≥1 number — same policy as the login page claims
  fullName: z.string().trim().min(1).max(150),
  role: z.enum(['admin', 'manager']).default('manager'),
});

const userUpdateSchema = z
  .object({
    fullName: z.string().trim().min(1).max(150).optional(),
    role: z.enum(['admin', 'manager']).optional(),
    password: passwordSchema.optional(),
    isActive: z.boolean().optional(),
  })
  .refine((b) => Object.keys(b).length > 0, { message: 'At least one field is required.' });

// ---- Maintenance ----
const maintenanceCreateSchema = z.object({
  unitId: z.coerce.number().int().positive(),
  tenantId: z.coerce.number().int().positive().nullish(),
  description: z.string().trim().min(1).max(2000),
  priority: z.enum(['low', 'medium', 'high', 'urgent']).default('medium'),
});

const maintenanceUpdateSchema = z
  .object({
    status: z.enum(['open', 'in_progress', 'resolved', 'cancelled']).optional(),
    priority: z.enum(['low', 'medium', 'high', 'urgent']).optional(),
    assignedVendor: z.string().trim().max(150).nullish(),
    cost: z.coerce.number().min(0).max(99999999).nullish(),
  })
  .refine((b) => Object.keys(b).length > 0, { message: 'At least one field is required.' });

module.exports = {
  loginSchema,
  unitCreateSchema,
  unitUpdateSchema,
  tenantCreateSchema,
  tenantUpdateSchema,
  leaseCreateSchema,
  leaseUpdateSchema,
  paymentCreateSchema,
  maintenanceCreateSchema,
  maintenanceUpdateSchema,
  userCreateSchema,
  userUpdateSchema,
  passwordSchema,
};
