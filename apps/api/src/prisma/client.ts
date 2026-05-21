import { PrismaClient } from '@prisma/client';

type PrismaGlobal = typeof globalThis & {
  divineCodePrisma?: PrismaClient;
};

const globalForPrisma = globalThis as PrismaGlobal;

export const prisma =
  globalForPrisma.divineCodePrisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'production' ? ['error'] : ['warn', 'error']
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.divineCodePrisma = prisma;
}
