import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';
import { PrismaClient } from '@prisma/client';

// --- Robust Environment Loader ---
const rootEnv = path.resolve(process.cwd(), '.env');
const apiEnv = path.resolve(process.cwd(), 'apps/api/.env');

if (fs.existsSync(rootEnv)) {
    dotenv.config({ path: rootEnv });
    console.log(`✅ Loaded .env from root: ${rootEnv}`);
} else if (fs.existsSync(apiEnv)) {
    dotenv.config({ path: apiEnv });
    console.log(`✅ Loaded .env from apps/api: ${apiEnv}`);
} else {
    console.warn("⚠️ Warning: No .env file found. Ensure DATABASE_URL is set in your environment.");
}

const prisma = new PrismaClient();

const baseProblems = [
  {
    titleTemplate: "Dynamic Programming: {variant}",
    descriptionHtml: "<p>Optimize the given constraint to find the maximum sub-array path length. Use tabulation.</p>",
    tags: ["dp", "arrays", "binary-search"],
    difficulty: ["Medium", "Hard"],
    platform: ["Codeforces", "LeetCode", "AtCoder"]
  },
  {
    titleTemplate: "Graph Theory: {variant}",
    descriptionHtml: "<p>You are given a network of <code>n</code> nodes. Return the minimum time for signals using Dijkstra or BFS.</p>",
    tags: ["graphs", "shortest-path", "dijkstra", "priority-queue"],
    difficulty: ["Hard", "Medium"],
    platform: ["Codeforces", "CodeChef", "HackerRank"]
  },
  {
    titleTemplate: "Stack: {variant} Optimizer",
    descriptionHtml: "<p>Determine if the input string is valid based on closing constraints and string parsers.</p>",
    tags: ["stack", "strings", "parsing"],
    difficulty: ["Easy", "Medium"],
    platform: ["LeetCode", "HackerRank", "DivineCode"]
  }
];

const variants = [
  "Subsequence", "Matrix", "Array", "Pathing", "String", "Number", "Network", "Grid", "Island", "Sequence",
  "Permutation", "Combination", "Cycle", "Forest", "Mountain", "River"
];

async function main() {
  console.log('Clearing existing dataset...');
  await prisma.aiProblemDataset.deleteMany({});

  console.log('Generating 5,000 unique questions...');
  
  const massiveBatch = [];
  let generatedCount = 0;

  for (let i = 1; i <= 5000; i++) {
    const base = baseProblems[i % baseProblems.length];
    const variantName = variants[(i * 3) % variants.length] + ' ' + variants[(i * 7) % variants.length];
    const difficulty = base.difficulty[i % base.difficulty.length];
    const platform = base.platform[i % base.platform.length];

    massiveBatch.push({
      title: base.titleTemplate.replace('{variant}', variantName) + ` #${i}`,
      descriptionHtml: base.descriptionHtml,
      platform: platform,
      tags: base.tags,
      difficulty: difficulty,
      testcases: [
        { input: "[10,9,2,5,3]", expectedOutput: "4", isHidden: false },
        { input: "[7,7,7,7]", expectedOutput: "1", isHidden: true }
      ]
    });
    
    generatedCount++;
    
    if (massiveBatch.length >= 1000) {
      await prisma.aiProblemDataset.createMany({ data: massiveBatch });
      console.log(`Inserted ${generatedCount}/5000 problems...`);
      massiveBatch.length = 0; 
    }
  }

  if (massiveBatch.length > 0) {
    await prisma.aiProblemDataset.createMany({ data: massiveBatch });
  }

  const finalCount = await prisma.aiProblemDataset.count();
  console.log(`✅ Successfully seeded ${finalCount} high-quality problems into the AI Vault.`);
}

main()
  .catch((e) => {
    console.error("Critical failure during seeding:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });