import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function seedAiBank() {
  console.log('🤖 Initializing AI Avatar Problem Dataset...');

  const aiProblems = [
    {
      title: 'Dynamic Programming: Maximum Subarray',
      descriptionHtml: '<p>Find the contiguous subarray with the largest sum.</p>',
      platform: 'LEETCODE',
      originalUrl: 'https://leetcode.com/problems/maximum-subarray/',
      tags: ['DP', 'Arrays', 'Kadane'],
      difficulty: 'Medium',
      testcases: [
        { input: '[-2,1,-3,4,-1,2,1,-5,4]', expectedOutput: '6' },
        { input: '[1]', expectedOutput: '1' }
      ]
    },
    {
      title: 'Graph Theory: Shortest Routes I',
      descriptionHtml: '<p>Find the shortest paths from Syracuse to all other cities.</p>',
      platform: 'CSES',
      originalUrl: 'https://cses.fi/problemset/task/1671',
      tags: ['Graphs', 'Dijkstra', 'Shortest Path'],
      difficulty: 'Hard',
      testcases: [
        { input: '3 4\n1 2 6\n1 3 2\n3 2 3\n1 3 4', expectedOutput: '0 5 2' }
      ]
    },
    {
      title: 'Codeforces: Watermelon',
      descriptionHtml: '<p>Can you divide the watermelon into two even weights?</p>',
      platform: 'CODEFORCES',
      originalUrl: 'https://codeforces.com/problemset/problem/4/A',
      tags: ['Math', 'Brute Force', 'Implementation'],
      difficulty: 'Easy',
      testcases: [
        { input: '8', expectedOutput: 'YES' },
        { input: '5', expectedOutput: 'NO' }
      ]
    }
  ];

  for (const prob of aiProblems) {
    await prisma.aiProblemDataset.create({
      data: prob
    });
  }

  console.log(`✅ Successfully injected ${aiProblems.length} premium problems into the AI Bank.`);
}

seedAiBank()
  .catch(e => console.error(e))
  .finally(async () => await prisma.$disconnect());