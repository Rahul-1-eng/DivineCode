import '../config/env';
import { prisma } from '../prisma/client';

async function main() {
  const startedAt = Date.now();
  await prisma.$queryRaw`SELECT 1`;
  const elapsedMs = Date.now() - startedAt;
  console.log(`Database connection ok (${elapsedMs}ms)`);
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
