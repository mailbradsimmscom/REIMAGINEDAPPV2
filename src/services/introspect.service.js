import { listPublicTables } from '../repositories/introspect.repository.js';

export async function getPublicTables() {
  const tables = await listPublicTables();
  return { schema: 'public', tables };
}

export default { getPublicTables };


