import bcrypt from 'bcryptjs';
import { query, queryOne } from '../config/db';
import { env } from '../config/env';
import type { Pagination, Role } from '../types';
import { conflict, notFound, unprocessable } from '../utils/httpError';
import { logAudit } from './auditService';
import { invalidateUserCache } from '../middleware/auth';

export interface UserInput {
  name: string;
  email: string;
  phone?: string;
  password: string;
  role: Role;
}

export async function listUsers(): Promise<unknown[]> {
  return query(
    `SELECT id, name, email, phone, role, status, created_at, updated_at
     FROM users ORDER BY id`
  );
}

export async function createUser(input: UserInput, userId: number): Promise<unknown> {
  const existing = await queryOne('SELECT id FROM users WHERE email = $1', [input.email]);
  if (existing) throw conflict('A user with this email already exists.', 'DUPLICATE_EMAIL');
  const hash = await bcrypt.hash(input.password, env.bcryptSaltRounds);
  const inserted = await query(
    `INSERT INTO users (name, email, phone, password_hash, role, status)
     VALUES ($1, $2, $3, $4, $5, 'ACTIVE')
     RETURNING id, name, email, phone, role, status, created_at`,
    [input.name, input.email, input.phone ?? null, hash, input.role]
  );
  await logAudit({ userId, action: 'USER_CREATED', entity: 'users', entityId: inserted[0].id, newValue: { email: input.email, role: input.role } });
  return inserted[0];
}

export async function updateUser(
  id: number,
  input: { name?: string; phone?: string; role?: Role; status?: 'ACTIVE' | 'INACTIVE'; password?: string },
  userId: number
): Promise<unknown> {
  const existing = await queryOne<{ id: number; role: Role; email: string }>('SELECT id, role, email FROM users WHERE id = $1', [id]);
  if (!existing) throw notFound('User not found.');

  const passwordHash = input.password ? await bcrypt.hash(input.password, env.bcryptSaltRounds) : null;
  const updated = await query(
    `UPDATE users
     SET name = COALESCE($2, name),
         phone = COALESCE($3, phone),
         role = COALESCE($4, role),
         status = COALESCE($5, status),
         password_hash = COALESCE($6, password_hash)
     WHERE id = $1
     RETURNING id, name, email, phone, role, status, created_at`,
    [id, input.name ?? null, input.phone ?? null, input.role ?? null, input.status ?? null, passwordHash]
  );
  invalidateUserCache(id);
  await logAudit({
    userId,
    action: 'USER_UPDATED',
    entity: 'users',
    entityId: id,
    oldValue: { role: existing.role },
    newValue: { role: input.role, status: input.status },
  });
  return updated[0];
}

export async function deleteUser(id: number, userId: number): Promise<void> {
  if (id === userId) throw unprocessable('You cannot delete your own account.');
  const existing = await queryOne<{ id: number }>('SELECT id FROM users WHERE id = $1', [id]);
  if (!existing) throw notFound('User not found.');
  await query('DELETE FROM users WHERE id = $1', [id]);
  invalidateUserCache(id);
  await logAudit({ userId, action: 'USER_DELETED', entity: 'users', entityId: id });
}

export function userPagination(): Pagination {
  return { page: 1, limit: 100, total: 0, totalPages: 0 };
}