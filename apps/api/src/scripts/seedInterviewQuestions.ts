/**
 * @file seedInterviewQuestions.ts
 * @author Rahul Kumar Sahoo
 * @description Maintenance utility for the application.
 */

import 'dotenv/config'; 
import { PrismaClient, InterviewTrackType } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding Curated Interview Tracks and Quality Questions (additive — user progress is preserved)...');

  // Upsert tracks by slug; NEVER wipe — deleting questions cascades into
  // InterviewProgress and silently erases every user's mastery history.
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
    await prisma.interviewTrack.upsert({
      where: { slug: t.slug },
      update: { title: t.title, type: t.type, description: t.description },
      create: { ...t, order: trackData.indexOf(t) }
    });
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
    },

    // --- SENIOR / EXPERT LEVEL ADDITIONS ---
    {
      trackId: getTrackId(InterviewTrackType.DATABASE),
      title: 'MVCC Snapshot Visibility',
      prompt: 'In PostgreSQL\'s MVCC, a row version is visible to a transaction when:',
      options: ['It has the highest transaction ID', 'Its inserting transaction committed before the reader\'s snapshot AND it is not deleted by a transaction visible in that snapshot', 'It is the most recently written version on disk', 'The reader holds a shared row lock'],
      correctIndices: [1], difficulty: 'Expert', isApproved: true, tags: ['postgres', 'mvcc', 'isolation'], sourceCompany: 'Stripe'
    },
    {
      trackId: getTrackId(InterviewTrackType.DATABASE),
      title: 'Write Amplification in LSM Trees',
      prompt: 'Compared to B-trees, LSM-tree storage engines (RocksDB, Cassandra) primarily trade what for faster writes?',
      options: ['Read amplification and background compaction cost', 'Durability guarantees', 'Transaction support', 'Index size only'],
      correctIndices: [0], difficulty: 'Expert', isApproved: true, tags: ['lsm', 'storage-engines'], sourceCompany: 'Meta'
    },
    {
      trackId: getTrackId(InterviewTrackType.OPERATING_SYSTEM),
      title: 'False Sharing',
      prompt: 'Two threads on different cores update two DIFFERENT variables that happen to sit in the same cache line. Performance collapses because:',
      options: ['The OS serializes the threads', 'Each write invalidates the other core\'s cache line copy, forcing constant coherence traffic', 'The variables become corrupted', 'Page faults occur on every write'],
      correctIndices: [1], difficulty: 'Expert', isApproved: true, tags: ['cache-coherence', 'concurrency'], sourceCompany: 'Google'
    },
    {
      trackId: getTrackId(InterviewTrackType.OPERATING_SYSTEM),
      title: 'io_uring Advantage',
      prompt: 'Linux io_uring outperforms epoll-based I/O primarily by:',
      options: ['Using faster disks', 'Sharing lock-free submission/completion ring buffers between user and kernel space, reducing syscalls', 'Running I/O in the GPU', 'Bypassing the filesystem'],
      correctIndices: [1], difficulty: 'Expert', isApproved: true, tags: ['linux', 'async-io']
    },
    {
      trackId: getTrackId(InterviewTrackType.DSA),
      title: 'Amortized Union-Find',
      prompt: 'With both path compression AND union by rank, m operations on n elements take:',
      options: ['O(m log n)', 'O(m α(n)) where α is the inverse Ackermann function', 'O(m √n)', 'O(m) exactly'],
      correctIndices: [1], difficulty: 'Expert', isApproved: true, tags: ['union-find', 'amortized-analysis']
    },
    {
      trackId: getTrackId(InterviewTrackType.DSA),
      title: 'Suffix Automaton Size',
      prompt: 'The suffix automaton of a string of length n has at most how many states?',
      options: ['n', '2n - 1', 'n²', 'n log n'],
      correctIndices: [1], difficulty: 'Expert', isApproved: true, tags: ['strings', 'automata'], sourceCompany: 'Codeforces'
    },
    {
      trackId: getTrackId(InterviewTrackType.SYSTEM_DESIGN, 'system-design'),
      title: 'Quorum Arithmetic',
      prompt: 'A Dynamo-style store with replication factor N=5 uses W=3 write quorum. What is the minimum read quorum R that guarantees read-your-writes consistency?',
      options: ['1', '2', '3', '5'],
      correctIndices: [2], difficulty: 'Expert', isApproved: true, tags: ['quorum', 'replication'], sourceCompany: 'Amazon'
    },
    {
      trackId: getTrackId(InterviewTrackType.SYSTEM_DESIGN, 'system-design'),
      title: 'Exactly-Once Semantics',
      prompt: 'In distributed messaging, "exactly-once delivery" in practice is achieved by:',
      options: ['TCP retransmission', 'At-least-once delivery combined with idempotent consumers or deduplication', 'UDP multicast', 'Synchronous replication alone'],
      correctIndices: [1], difficulty: 'Expert', isApproved: true, tags: ['messaging', 'idempotency'], sourceCompany: 'Uber'
    },
    {
      trackId: getTrackId(InterviewTrackType.SYSTEM_DESIGN, 'system-design'),
      title: 'Cache Stampede Defense',
      prompt: 'A hot cache key expires and 10,000 concurrent requests hit the database simultaneously. The standard mitigations are:',
      options: ['Bigger database connection pool', 'Request coalescing (single-flight), probabilistic early expiration, or stale-while-revalidate', 'Longer TTLs everywhere', 'Sharding the cache key'],
      correctIndices: [1], difficulty: 'Expert', isApproved: true, tags: ['caching', 'thundering-herd'], sourceCompany: 'Netflix'
    },
    {
      trackId: getTrackId(InterviewTrackType.NETWORKS),
      title: 'TCP Incast Collapse',
      prompt: 'In datacenter many-to-one fan-in traffic (e.g., a scatter-gather query), throughput suddenly collapses because:',
      options: ['DNS resolution overload', 'Shallow switch buffers overflow causing synchronized packet loss and retransmission timeouts', 'TLS handshakes queue up', 'The NIC overheats'],
      correctIndices: [1], difficulty: 'Expert', isApproved: true, tags: ['datacenter', 'tcp'], sourceCompany: 'Microsoft'
    },
    {
      trackId: getTrackId(InterviewTrackType.NETWORKS),
      title: 'QUIC vs TCP+TLS',
      prompt: 'QUIC (HTTP/3) eliminates head-of-line blocking that persists in HTTP/2 because:',
      options: ['It compresses headers better', 'Independent streams are multiplexed over UDP, so one lost packet only stalls its own stream', 'It uses more connections', 'It disables congestion control'],
      correctIndices: [1], difficulty: 'Hard', isApproved: true, tags: ['quic', 'http3'], sourceCompany: 'Google'
    },
    {
      trackId: getTrackId(InterviewTrackType.OOPS),
      title: 'Liskov Substitution Violation',
      prompt: 'Class Square extends Rectangle, overriding setWidth to also set height. This violates LSP because:',
      options: ['Squares are not rectangles mathematically', 'Code that mutates a Rectangle\'s width expecting the height unchanged breaks when handed a Square', 'Inheritance is always wrong', 'The override is not virtual'],
      correctIndices: [1], difficulty: 'Hard', isApproved: true, tags: ['solid', 'lsp'], sourceCompany: 'Amazon'
    },
    {
      trackId: getTrackId(InterviewTrackType.DSA),
      title: 'Reservoir Sampling',
      prompt: 'To pick a uniformly random element from a stream of unknown length using O(1) memory, you replace the current pick when seeing item i with probability:',
      options: ['1/2', '1/i', '1/n', 'i/n'],
      correctIndices: [1], difficulty: 'Expert', isApproved: true, tags: ['streaming', 'randomized'], sourceCompany: 'Meta'
    }
  ];

  // Insert only questions that don't exist yet (matched by title) so re-runs
  // top up the bank without duplicating or destroying anything.
  const existing = await prisma.interviewQuestion.findMany({ select: { title: true } });
  const known = new Set(existing.map(q => q.title));
  const fresh = curatedQuestions.filter(q => !known.has(q.title));

  if (fresh.length > 0) {
    console.log(`✅ Adding ${fresh.length} new questions (${curatedQuestions.length - fresh.length} already present, skipped)...`);
    await prisma.interviewQuestion.createMany({ data: fresh });
  } else {
    console.log('✅ Question bank already up to date — nothing to add.');
  }

  const total = await prisma.interviewQuestion.count();
  console.log(`\n🚀 DONE. The platform now has ${total} interview questions.`);
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });