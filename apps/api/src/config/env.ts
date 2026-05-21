import path from 'path';
import dotenv from 'dotenv';

const rootDir = path.resolve(__dirname, '../../../..');
const apiDir = path.resolve(__dirname, '../..');

dotenv.config({ path: path.join(rootDir, '.env') });
dotenv.config({ path: path.join(apiDir, '.env'), override: true });

export function requireEnv(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}
