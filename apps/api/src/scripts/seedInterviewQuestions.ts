import 'dotenv/config'; 
import { PrismaClient, InterviewTrackType } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding Curated Interview Tracks and Quality Questions...');

  // 1. Wipe old data safely to prevent duplicates
  await prisma.interviewQuestion.deleteMany({});
  await prisma.interviewTrack.deleteMany({});

  // 2. Insert Tracks
  const trackData = [
    { slug: 'dbms', title: 'Database Management', type: InterviewTrackType.DATABASE, description: 'SQL, NoSQL, Indexing, Transactions' },
    { slug: 'networks', title: 'Computer Networks', type: InterviewTrackType.NETWORKS, description: 'TCP/IP, Routing, Protocols' },
    { slug: 'os', title: 'Operating Systems', type: InterviewTrackType.OPERATING_SYSTEM, description: 'Processes, Threads, Memory Management' },
    { slug: 'dsa', title: 'Data Structures & Algorithms', type: InterviewTrackType.DSA, description: 'Graphs, DP, Trees' },
    { slug: 'system-design', title: 'System Design', type: InterviewTrackType.SYSTEM_DESIGN, description: 'Scalability, Distributed Systems' },
    { slug: 'oops', title: 'Object Oriented Programming', type: InterviewTrackType.OOPS, description: 'Inheritance, Polymorphism, Design Patterns' },
    { slug: 'architecture', title: 'Computer Architecture', type: InterviewTrackType.SYSTEM_DESIGN, description: 'MIPS, Pipelines, Assembly' } 
  ];

  for (const t of trackData) {
    await prisma.interviewTrack.create({ data: { ...t, order: trackData.indexOf(t) } });
  }

  const tracks = await prisma.interviewTrack.findMany();
  const getTrackId = (type: InterviewTrackType, slug?: string) => {
      const match = slug ? tracks.find(t => t.slug === slug) : tracks.find(t => t.type === type);
      return match!.id;
  };

  // 3. High-Quality Curated Question Bank
  const curatedQuestions = [
    // --- DATABASE MANAGEMENT ---
    {
      trackId: getTrackId(InterviewTrackType.DATABASE),
      title: 'B+ Tree Data Storage',
      prompt: 'In a standard B+ Tree index used by relational databases, where are the actual data pointers or data records strictly located?',
      options: ['Root node only', 'Internal nodes', 'Leaf nodes only', 'Distributed across all nodes'],
      correctIndices: [2], difficulty: 'Hard', isApproved: true, tags: ['indexing', 'b-tree'], sourceCompany: 'Oracle'
    },
    {
      trackId: getTrackId(InterviewTrackType.DATABASE),
      title: 'ACID Properties',
      prompt: 'In database transactions, the property that ensures a transaction is either completely executed or not executed at all is known as:',
      options: ['Atomicity', 'Consistency', 'Isolation', 'Durability'],
      correctIndices: [0], difficulty: 'Easy', isApproved: true, tags: ['transactions', 'acid']
    },
    {
      trackId: getTrackId(InterviewTrackType.DATABASE),
      title: 'SQL Join Optimization',
      prompt: 'When joining two large tables, which physical join implementation is generally most efficient if both tables are already sorted on the join key?',
      options: ['Nested Loop Join', 'Hash Join', 'Merge Join', 'Cross Join'],
      correctIndices: [2], difficulty: 'Medium', isApproved: true, tags: ['sql', 'query-optimization'], sourceCompany: 'Google'
    },
    {
      trackId: getTrackId(InterviewTrackType.DATABASE),
      title: 'MongoDB Aggregation',
      prompt: 'In MongoDB, which aggregation pipeline stage is functionally equivalent to the SQL "GROUP BY" clause?',
      options: ['$match', '$project', '$group', '$unwind'],
      correctIndices: [2], difficulty: 'Medium', isApproved: true, tags: ['mongodb', 'nosql']
    },

    // --- OPERATING SYSTEMS ---
    {
      trackId: getTrackId(InterviewTrackType.OPERATING_SYSTEM),
      title: 'Coffman Deadlock Conditions',
      prompt: 'Which of the following is NOT one of the four necessary Coffman conditions for a deadlock to occur?',
      options: ['Mutual Exclusion', 'Hold and Wait', 'No Preemption', 'Process Starvation'],
      correctIndices: [3], difficulty: 'Medium', isApproved: true, tags: ['deadlock', 'concurrency']
    },
    {
      trackId: getTrackId(InterviewTrackType.OPERATING_SYSTEM),
      title: 'Concurrency Mechanisms',
      prompt: 'Which synchronization primitive strictly requires the thread releasing the lock to be the same thread that acquired it?',
      options: ['Binary Semaphore', 'Counting Semaphore', 'Mutex', 'Monitor'],
      correctIndices: [2], difficulty: 'Hard', isApproved: true, tags: ['threading', 'mutex'], sourceCompany: 'Microsoft'
    },
    {
      trackId: getTrackId(InterviewTrackType.OPERATING_SYSTEM),
      title: 'Virtual Memory Thrashing',
      prompt: 'Thrashing in an operating system occurs when:',
      options: ['The CPU is too fast for the memory', 'A process spends more time paging than executing', 'Multiple threads attempt to access the same memory location', 'The disk cache is full'],
      correctIndices: [1], difficulty: 'Medium', isApproved: true, tags: ['memory-management', 'paging']
    },

    // --- DATA STRUCTURES & ALGORITHMS ---
    {
      trackId: getTrackId(InterviewTrackType.DSA),
      title: 'Algorithm Complexity',
      prompt: 'What is the worst-case time complexity of finding a specific element in an unbalanced Binary Search Tree (BST)?',
      options: ['O(1)', 'O(log n)', 'O(n log n)', 'O(n)'],
      correctIndices: [3], difficulty: 'Easy', isApproved: true, tags: ['trees', 'complexity']
    },
    {
      trackId: getTrackId(InterviewTrackType.DSA),
      title: 'Kadane\'s Algorithm',
      prompt: 'What problem does Kadane\'s algorithm solve optimally in O(N) time?',
      options: ['Longest Increasing Subsequence', 'Maximum Subarray Sum', 'Shortest Path in a DAG', 'Minimum Spanning Tree'],
      correctIndices: [1], difficulty: 'Medium', isApproved: true, tags: ['dynamic-programming', 'arrays'], sourceCompany: 'Meta'
    },
    {
      trackId: getTrackId(InterviewTrackType.DSA),
      title: 'Graph Traversal',
      prompt: 'If you need to find the shortest path in an unweighted graph, which algorithm should you use?',
      options: ['Depth-First Search (DFS)', 'Breadth-First Search (BFS)', 'Dijkstra\'s Algorithm', 'Kruskal\'s Algorithm'],
      correctIndices: [1], difficulty: 'Easy', isApproved: true, tags: ['graphs', 'bfs']
    },
    {
      trackId: getTrackId(InterviewTrackType.DSA),
      title: 'Sorting Stability',
      prompt: 'Which of the following sorting algorithms is NOT stable by nature?',
      options: ['Merge Sort', 'Insertion Sort', 'Quick Sort', 'Bubble Sort'],
      correctIndices: [2], difficulty: 'Hard', isApproved: true, tags: ['sorting', 'arrays']
    },

    // --- SYSTEM DESIGN ---
    {
      trackId: getTrackId(InterviewTrackType.SYSTEM_DESIGN, 'system-design'),
      title: 'CAP Theorem',
      prompt: 'According to the CAP Theorem, in the presence of a network partition (P), a distributed system must choose between:',
      options: ['Consistency and Availability', 'Latency and Consistency', 'Availability and Durability', 'Consistency and Redundancy'],
      correctIndices: [0], difficulty: 'Medium', isApproved: true, tags: ['distributed-systems', 'cap-theorem']
    },
    {
      trackId: getTrackId(InterviewTrackType.SYSTEM_DESIGN, 'system-design'),
      title: 'Load Balancing',
      prompt: 'Which load balancing algorithm directs traffic to the server with the fewest active connections?',
      options: ['Round Robin', 'IP Hash', 'Least Connections', 'Weighted Round Robin'],
      correctIndices: [2], difficulty: 'Easy', isApproved: true, tags: ['networking', 'scalability']
    },
    {
      trackId: getTrackId(InterviewTrackType.SYSTEM_DESIGN, 'system-design'),
      title: 'Message Queues',
      prompt: 'In Kafka, what guarantees that messages are read in the exact order they were written?',
      options: ['Messages are ordered across the entire topic', 'Messages are ordered only within a specific Partition', 'Messages are ordered per Consumer Group', 'Kafka does not guarantee ordering'],
      correctIndices: [1], difficulty: 'Hard', isApproved: true, tags: ['kafka', 'microservices'], sourceCompany: 'Uber'
    },

    // --- COMPUTER NETWORKS ---
    {
      trackId: getTrackId(InterviewTrackType.NETWORKS),
      title: 'TCP Handshake',
      prompt: 'What is the correct sequence of control flags exchanged during a standard TCP 3-way connection establishment?',
      options: ['SYN, ACK, FIN', 'SYN, SYN-ACK, ACK', 'ACK, SYN, PSH', 'SYN, FIN-ACK, ACK'],
      correctIndices: [1], difficulty: 'Easy', isApproved: true, tags: ['tcp', 'protocols']
    },
    {
      trackId: getTrackId(InterviewTrackType.NETWORKS),
      title: 'Subnet Masking',
      prompt: 'Given a subnet mask of 255.255.255.224, what is the maximum number of usable host IP addresses in that subnet?',
      options: ['30', '32', '62', '64'],
      correctIndices: [0], difficulty: 'Expert', isApproved: true, tags: ['ip-addressing', 'subnet']
    },
    {
      trackId: getTrackId(InterviewTrackType.NETWORKS),
      title: 'OSI Model',
      prompt: 'At which layer of the OSI model does a standard network router primarily operate?',
      options: ['Data Link Layer', 'Network Layer', 'Transport Layer', 'Application Layer'],
      correctIndices: [1], difficulty: 'Easy', isApproved: true, tags: ['osi', 'routing']
    },

    // --- OBJECT ORIENTED PROGRAMMING ---
    {
      trackId: getTrackId(InterviewTrackType.OOPS),
      title: 'Polymorphism',
      prompt: 'Method overriding in Object-Oriented Programming is an example of which type of polymorphism?',
      options: ['Compile-time Polymorphism', 'Run-time Polymorphism', 'Ad-hoc Polymorphism', 'Parametric Polymorphism'],
      correctIndices: [1], difficulty: 'Medium', isApproved: true, tags: ['inheritance', 'methods']
    },
    {
      trackId: getTrackId(InterviewTrackType.OOPS),
      title: 'Design Patterns',
      prompt: 'Which design pattern ensures that a class has only one instance and provides a global point of access to it?',
      options: ['Factory Method', 'Observer', 'Singleton', 'Decorator'],
      correctIndices: [2], difficulty: 'Easy', isApproved: true, tags: ['design-patterns', 'singleton']
    },

    // --- COMPUTER ARCHITECTURE (MIPS) ---
    {
      trackId: getTrackId(InterviewTrackType.SYSTEM_DESIGN, 'architecture'),
      title: 'MIPS Pipeline',
      prompt: 'In a classic 5-stage MIPS pipeline, which hazard is strictly caused by a conditional branch instruction?',
      options: ['Data Hazard', 'Structural Hazard', 'Control Hazard', 'Memory Hazard'],
      correctIndices: [2], difficulty: 'Medium', isApproved: true, tags: ['mips', 'pipeline']
    },
    {
      trackId: getTrackId(InterviewTrackType.SYSTEM_DESIGN, 'architecture'),
      title: 'MIPS Data Alignment',
      prompt: 'When executing a "lw" (load word) instruction in MIPS, the calculated memory address must be a multiple of what value?',
      options: ['1', '2', '4', '8'],
      correctIndices: [2], difficulty: 'Easy', isApproved: true, tags: ['mips', 'memory']
    }
  ];

  console.log('✅ Injecting curated question bank...');
  await prisma.interviewQuestion.createMany({ data: curatedQuestions });

  console.log(`\n🚀 SECURE DEPLOYMENT COMPLETE!`);
  console.log(`🤖 The platform is now seeded with exactly ${curatedQuestions.length} high-quality questions.`);
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });