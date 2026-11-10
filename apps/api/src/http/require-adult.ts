import type { FamilyRole } from '../permissions.js';
import { ApiError } from './errors.js';

export function requireAdult(role: FamilyRole) {
  if (role === 'child') throw new ApiError(403, 'FORBIDDEN', 'Ta czynność jest dostępna tylko dla dorosłych.');
}
