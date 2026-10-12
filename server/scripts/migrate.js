import 'dotenv/config';
import { createDatabase, migrate } from '../db/database.js';
const database = createDatabase();
if (!database) throw new Error('Set DATABASE_URL securely in the server environment.');
try { await migrate(database); console.log('Database schema version 1 is ready.'); }
finally { await database.close(); }
