import { init } from '@paralleldrive/cuid2';

/** Fixed-length cuid2 IDs. Stored as varchar(24). */
export const createId = init({ length: 24 });
