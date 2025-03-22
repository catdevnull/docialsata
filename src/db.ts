// Note: If you encounter a 'Cannot find module "pg"' error, install its type definitions via
// npm install --save-dev @types/pg
import { Pool } from 'pg';

const pool = new Pool({
  // Configure your PostgreSQL connection details here
  connectionString: process.env.DATABASE_URL || 'postgres://user:password@localhost:5432/twitter_scraper',
});

export default {
  query: (text: string, params?: any[]) => pool.query(text, params),
};
