import 'dotenv/config'; // 👉 ADDED: Forces the script to load your .env file
import { PrismaClient, InterviewTrackType } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding Interview Tracks and Questions...');

  const trackData = [
    { slug: 'dbms', title: 'Database Management', type: InterviewTrackType.DATABASE, description: 'SQL, NoSQL, Indexing, Transactions' },
    { slug: 'networks', title: 'Computer Networks', type: InterviewTrackType.NETWORKS, description: 'TCP/IP, Routing, Protocols' },
    { slug: 'os', title: 'Operating Systems', type: InterviewTrackType.OPERATING_SYSTEM, description: 'Processes, Threads, Memory Management' },
    { slug: 'dsa', title: 'Data Structures & Algorithms', type: InterviewTrackType.DSA, description: 'Graphs, DP, Trees' },
    { slug: 'system-design', title: 'System Design', type: InterviewTrackType.SYSTEM_DESIGN, description: 'Scalability, Distributed Systems' },
    { slug: 'oops', title: 'Object Oriented Programming', type: InterviewTrackType.OOPS, description: 'Inheritance, Polymorphism, Design Patterns' }
  ];

  for (const t of trackData) {
    await prisma.interviewTrack.upsert({
      where: { slug: t.slug },
      update: {},
      create: { slug: t.slug, title: t.title, type: t.type, description: t.description }
    });
  }

  const tracks = await prisma.interviewTrack.findMany();
  const getTrackId = (type: InterviewTrackType) => tracks.find(t => t.type === type)!.id;

  const questions = [
    {
      trackId: getTrackId(InterviewTrackType.DATABASE),
      title: 'B+ Tree Data Storage',
      prompt: 'In a standard B+ Tree index used by relational databases, where are the actual data pointers or data records strictly located?',
      options: ['Root node only', 'Internal nodes', 'Leaf nodes only', 'Distributed across all nodes'],
      correctIndex: 2,
      difficultyLabel: '1400',
    },
    {
      trackId: getTrackId(InterviewTrackType.NETWORKS),
      title: 'TCP Handshake',
      prompt: 'What is the correct sequence of control flags exchanged during a standard TCP 3-way connection establishment?',
      options: ['SYN, ACK, FIN', 'SYN, SYN-ACK, ACK', 'ACK, SYN, PSH', 'SYN, FIN-ACK, ACK'],
      correctIndex: 1,
      difficultyLabel: '800',
    },
    {
      trackId: getTrackId(InterviewTrackType.OPERATING_SYSTEM),
      title: 'Coffman Deadlock Conditions',
      prompt: 'Which of the following is NOT one of the four necessary Coffman conditions for a deadlock to occur?',
      options: ['Mutual Exclusion', 'Hold and Wait', 'No Preemption', 'Process Starvation'],
      correctIndex: 3,
      difficultyLabel: '1200',
    },
    {
      trackId: getTrackId(InterviewTrackType.OPERATING_SYSTEM),
      title: 'Concurrency Mechanisms',
      prompt: 'Which synchronization primitive strictly requires the thread releasing the lock to be the same thread that acquired it?',
      options: ['Binary Semaphore', 'Counting Semaphore', 'Mutex', 'Monitor'],
      correctIndex: 2,
      difficultyLabel: '1500',
    },
    {
      trackId: getTrackId(InterviewTrackType.SYSTEM_DESIGN),
      title: 'CAP Theorem',
      prompt: 'According to the CAP Theorem, in the presence of a network partition (P), a distributed system must choose between:',
      options: ['Consistency and Availability', 'Latency and Consistency', 'Availability and Durability', 'Consistency and Redundancy'],
      correctIndex: 0,
      difficultyLabel: '1200',
    },
    {
      trackId: getTrackId(InterviewTrackType.DSA),
      title: 'Algorithm Complexity',
      prompt: 'What is the worst-case time complexity of finding a specific element in an unbalanced Binary Search Tree (BST)?',
      options: ['O(1)', 'O(log n)', 'O(n log n)', 'O(n)'],
      correctIndex: 3,
      difficultyLabel: '800',
    },
    {
      trackId: getTrackId(InterviewTrackType.OOPS),
      title: 'Polymorphism',
      prompt: 'Method overriding in Object-Oriented Programming is an example of which type of polymorphism?',
      options: ['Compile-time Polymorphism', 'Run-time Polymorphism', 'Ad-hoc Polymorphism', 'Parametric Polymorphism'],
      correctIndex: 1,
      difficultyLabel: '1000',
    },
    {
      trackId: getTrackId(InterviewTrackType.DATABASE),
      title: 'ACID Properties',
      prompt: 'In database transactions, the property that ensures a transaction is either completely executed or not executed at all is known as:',
      options: ['Atomicity', 'Consistency', 'Isolation', 'Durability'],
      correctIndex: 0,
      difficultyLabel: '800',
    },
    {
      trackId: getTrackId(InterviewTrackType.NETWORKS),
      title: 'Subnet Masking',
      prompt: 'Given a subnet mask of 255.255.255.224, what is the maximum number of usable host IP addresses in that subnet?',
      options: ['30', '32', '62', '64'],
      correctIndex: 0,
      difficultyLabel: '1800',
    }
  ];

  for (const q of questions) {
    await prisma.interviewQuestion.create({
      data: {
        ...q,
        isApproved: true,
      }
    });
  }

  console.log('✅ Added 9 Interview Questions to the database.');
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });