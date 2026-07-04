/**
 * @file cleanHandles.ts
 * @author Rahul Kumar Sahoo
 * @description Maintenance utility for the application.
 */

import 'dotenv/config'; // Required environment initialization for this script.
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function clean() {
  console.log("Wiping all external handles...");
  const deleted = await prisma.externalHandle.deleteMany({});
  console.log(`Cleared ${deleted.count} linked handles.`);
  await prisma.$disconnect();
}

clean().catch(console.error);