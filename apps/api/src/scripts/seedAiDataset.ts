import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const realisticDataset = [
  {
    title: "Dynamic Programming: Longest Increasing Subsequence",
    descriptionHtml: "<p>Given an integer array <code>nums</code>, return the length of the longest strictly increasing subsequence.</p><h3>Example:</h3><pre>Input: nums = [10,9,2,5,3,7,101,18]\nOutput: 4\nExplanation: The longest increasing subsequence is [2,3,7,101], therefore the length is 4.</pre>",
    platform: "DIVINECODE",
    tags: ["dp", "arrays", "binary-search"],
    difficulty: "Medium",
    testcases: [
      { input: "[10,9,2,5,3,7,101,18]", expectedOutput: "4", isHidden: false },
      { input: "[7,7,7,7,7,7,7]", expectedOutput: "1", isHidden: true },
      { input: "[0,1,0,3,2,3]", expectedOutput: "4", isHidden: true }
    ]
  },
  {
    title: "Graph Theory: Dijkstra's Network Delay",
    descriptionHtml: "<p>You are given a network of <code>n</code> nodes, labeled from <code>1</code> to <code>n</code>. You are also given <code>times</code>, a list of travel times as directed edges <code>times[i] = (u_i, v_i, w_i)</code>, where <code>w_i</code> is the time it takes for a signal to travel from source to target.</p><p>Return the minimum time it takes for all nodes to receive the signal.</p>",
    platform: "DIVINECODE",
    tags: ["graphs", "shortest-path", "dijkstra", "priority-queue"],
    difficulty: "Hard",
    testcases: [
      { input: "times = [[2,1,1],[2,3,1],[3,4,1]], n = 4, k = 2", expectedOutput: "2", isHidden: false },
      { input: "times = [[1,2,1]], n = 2, k = 1", expectedOutput: "1", isHidden: true }
    ]
  },
  {
    title: "Stack: Valid Parentheses Optimizer",
    descriptionHtml: "<p>Given a string <code>s</code> containing just the characters <code>'('</code>, <code>')'</code>, <code>'{'</code>, <code>'}'</code>, <code>'['</code> and <code>']'</code>, determine if the input string is valid.</p><ul><li>Open brackets must be closed by the same type of brackets.</li><li>Open brackets must be closed in the correct order.</li></ul>",
    platform: "DIVINECODE",
    tags: ["stack", "strings", "parsing"],
    difficulty: "Easy",
    testcases: [
      { input: "()[]{}", expectedOutput: "true", isHidden: false },
      { input: "(]", expectedOutput: "false", isHidden: false },
      { input: "{[()]}", expectedOutput: "true", isHidden: true }
    ]
  },
  {
    title: "Two Pointers: Trapping Rain Water",
    descriptionHtml: "<p>Given <code>n</code> non-negative integers representing an elevation map where the width of each bar is <code>1</code>, compute how much water it can trap after raining.</p>",
    platform: "DIVINECODE",
    tags: ["arrays", "two-pointers", "hard-math"],
    difficulty: "Hard",
    testcases: [
      { input: "[0,1,0,2,1,0,1,3,2,1,2,1]", expectedOutput: "6", isHidden: false },
      { input: "[4,2,0,3,2,5]", expectedOutput: "9", isHidden: true }
    ]
  },
  {
    title: "Trees: Lowest Common Ancestor",
    descriptionHtml: "<p>Given a binary tree, find the lowest common ancestor (LCA) of two given nodes in the tree.</p><p>According to the definition of LCA on Wikipedia: The lowest common ancestor is defined between two nodes p and q as the lowest node in T that has both p and q as descendants.</p>",
    platform: "DIVINECODE",
    tags: ["trees", "dfs", "recursion"],
    difficulty: "Medium",
    testcases: [
      { input: "root = [3,5,1,6,2,0,8,null,null,7,4], p = 5, q = 1", expectedOutput: "3", isHidden: false },
      { input: "root = [3,5,1,6,2,0,8,null,null,7,4], p = 5, q = 4", expectedOutput: "5", isHidden: true }
    ]
  }
];

async function main() {
  console.log('Seeding AI Problem Dataset...');

  // Clear existing dataset to avoid duplicates
  await prisma.aiProblemDataset.deleteMany({});

  for (const prob of realisticDataset) {
    await prisma.aiProblemDataset.create({
      data: {
        title: prob.title,
        descriptionHtml: prob.descriptionHtml,
        platform: prob.platform,
        tags: prob.tags,
        difficulty: prob.difficulty,
        testcases: prob.testcases
      }
    });
  }

  const count = await prisma.aiProblemDataset.count();
  console.log(`✅ Successfully seeded ${count} high-quality problems into the AI Vault.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });