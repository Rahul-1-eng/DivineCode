/**
 * @file mcq.ts
 * @author Rahul Kumar Sahoo
 * @description Application source for the DivineCode platform.
 */

export const mcqQuestions = [
  // --- Standard Tech MCQs ---
  {
    id: 1,
    question: 'What is the output of console.log(0.1 + 0.2 === 0.3)?',
    options: ['true', 'false', 'undefined', 'error'],
    correctIndex: 1,
    type: 'tech',
    concept: 'floating point precision'
  },
  {
    id: 2,
    question: 'Which data structure is best for checking if a value already exists in O(1) average time?',
    options: ['Array', 'Stack', 'Hash Set', 'Queue'],
    correctIndex: 2,
    type: 'tech',
    concept: 'hashing'
  },
  {
    id: 3,
    question: 'Binary search usually requires the input to be:',
    options: ['random', 'sorted', 'reversed only', 'empty'],
    correctIndex: 1,
    type: 'tech',
    concept: 'binary search precondition'
  },
  
  // --- Logical & Reasoning Games (Daily Rotation Pool) ---
  {
    id: 4,
    question: "Rahul and Saksham are ordering from BiteGo. Rahul orders a pizza every 4 days, and Saksham orders a burger every 6 days. If they both order today, in how many days will they both order on the same day again?",
    options: ["10 days", "12 days", "24 days", "2 days"],
    correctIndex: 1,
    type: "logical",
    concept: "LCM & Number Theory"
  },
  {
    id: 5,
    question: "Biraj Sir is grading 5 papers: A, B, C, D, and E. A is graded before C but after D. E is graded immediately after B. If D is the second paper graded, which paper is graded last?",
    options: ["A", "C", "E", "Cannot be determined"],
    correctIndex: 1,
    type: "logical",
    concept: "Sequencing & Deductive Logic"
  },
  {
    id: 6,
    question: "During a Codefest contest, RKS_Rider solves 3 problems in 45 minutes. At this steady rate, how long will it take to solve 8 problems of similar difficulty?",
    options: ["100 minutes", "110 minutes", "120 minutes", "130 minutes"],
    correctIndex: 2,
    type: "logical",
    concept: "Rates & Ratios"
  },
  {
    id: 7,
    question: "A multi-cycle MIPS processor takes 5 cycles for an ALU instruction and 4 cycles for a branch. If a specific program executes 10 ALU instructions and 5 branches, what is the total number of cycles consumed?",
    options: ["50", "60", "70", "80"],
    correctIndex: 2,
    type: "logical",
    concept: "Architecture Timing"
  },
  {
    id: 8,
    question: "In preparation for the International Mathematical Olympiad (IMO), a student solves 5 combinatorics problems every day. If the IMO is exactly 6 weeks away, how many combinatorics problems will they solve in total?",
    options: ["150", "180", "210", "240"],
    correctIndex: 2,
    type: "logical",
    concept: "Arithmetic Projections"
  },
  {
    id: 9,
    question: "In the real-time collaborative Kanban board 'SyncTask', 3 users simultaneously move the same ticket to different columns. If the Firebase backend resolves conflicts by the latest timestamp, and User A's packet arrives at 10:01:05, User B at 10:01:04, and User C at 10:01:06, whose column will the ticket finally reside in?",
    options: ["User A", "User B", "User C", "The server crashes"],
    correctIndex: 2,
    type: "logical",
    concept: "Concurrency & Event Sourcing"
  },
  {
    id: 10,
    question: "If all C++ programmers know Python, and some Python programmers know Next.js, which of the following MUST be true?",
    options: ["All C++ programmers know Next.js", "Some C++ programmers know Next.js", "Some Next.js programmers know Python", "No Next.js programmers know C++"],
    correctIndex: 2,
    type: "logical",
    concept: "Syllogism"
  },
  {
    id: 11,
    question: "A server farm has 3 load balancers, each routing to 4 app servers, each connecting to 2 database replicas. If exactly one database replica fails, what is the maximum number of end-to-end request paths that remain available?",
    options: ["12", "24", "18", "20"],
    correctIndex: 0,
    type: "logical",
    concept: "Combinatorial Path Counting"
  },
  {
    id: 12,
    question: "In a single-elimination coding tournament with 128 participants, how many total matches are played to crown one champion?",
    options: ["64", "127", "128", "255"],
    correctIndex: 1,
    type: "logical",
    concept: "Invariant Thinking (every match eliminates exactly one)"
  },
  {
    id: 13,
    question: "You have two ropes; each takes exactly 60 minutes to burn but burns unevenly. What is the shortest time you can measure exactly 45 minutes by burning them?",
    options: ["Impossible", "45 minutes using both ropes", "75 minutes", "90 minutes"],
    correctIndex: 1,
    type: "logical",
    concept: "Classic Interview Puzzle (rope burning)"
  },
  {
    id: 14,
    question: "A hash table doubles its capacity when the load factor hits 0.75. Starting at capacity 16, after inserting 100 elements (no deletions), what is its capacity?",
    options: ["128", "256", "64", "512"],
    correctIndex: 1,
    type: "logical",
    concept: "Amortized Growth Simulation"
  },
  {
    id: 15,
    question: "Three microservices log timestamps with clock skews of +2s, -1s and +4s from true time. Service A logs an event at 10:00:05 (its clock, skew +2s). Service C (skew +4s) logs a reaction to it. What is the earliest TRUE time Service C could have logged?",
    options: ["10:00:03", "10:00:07", "10:00:05", "10:00:01"],
    correctIndex: 0,
    type: "logical",
    concept: "Distributed Clocks & Skew Reasoning"
  },
  {
    id: 16,
    question: "In a Git repo, commit C is on both branches X and Y. X has 3 commits after C, Y has 2 commits after C. A merge of Y into X (no conflicts, non-fast-forward) produces how many parents on the merge commit?",
    options: ["1", "2", "3", "5"],
    correctIndex: 1,
    type: "logical",
    concept: "DAG Structure Reasoning"
  },
  {
    id: 17,
    question: "You flip a fair coin repeatedly. What is the expected number of flips to see two heads in a row (HH)?",
    options: ["4", "6", "8", "3"],
    correctIndex: 1,
    type: "logical",
    concept: "Expected Value & Markov Chains"
  },
  {
    id: 18,
    question: "A rate limiter allows 10 requests per rolling 60-second window. A client sends 10 requests at t=0s and wants to send 5 more as early as possible. At what time can ALL 5 be accepted at once?",
    options: ["t=30s", "t=60s", "t=61s", "Never in one burst"],
    correctIndex: 1,
    type: "logical",
    concept: "Sliding Window Reasoning"
  },
  {
    id: 19,
    question: "25 horses, 5 per race, no stopwatch. What is the minimum number of races needed to find the 3 fastest horses?",
    options: ["5", "6", "7", "8"],
    correctIndex: 2,
    type: "logical",
    concept: "Classic Optimization Puzzle"
  },
  {
    id: 20,
    question: "An array of 1,000,001 integers contains every number from 1 to 1,000,000 exactly once, plus one duplicate. Using O(1) extra space, the fastest way to find the duplicate is:",
    options: ["Sort and scan — O(n log n)", "Sum the array and subtract n(n+1)/2 — O(n)", "Nested loops — O(n²)", "Binary search on value ranges — O(n log n)"],
    correctIndex: 1,
    type: "logical",
    concept: "Arithmetic Invariants"
  },
  {
    id: 21,
    question: "B+ tree of order 100 storing 1 billion keys: roughly how many disk reads does a point lookup need (root cached in RAM)?",
    options: ["~30", "~4", "~100", "~10"],
    correctIndex: 1,
    type: "tech",
    concept: "log₁₀₀(10⁹) ≈ 4.5 — index depth intuition"
  },
  {
    id: 22,
    question: "A CPU-bound task takes 100s single-threaded; 90% of it parallelizes perfectly. Per Amdahl's law, the best possible time on unlimited cores is:",
    options: ["0s", "10s", "1s", "50s"],
    correctIndex: 1,
    type: "tech",
    concept: "Amdahl's Law"
  },
  {
    id: 23,
    question: "Two transactions both read balance=100, each adds 50, and both write 150. The anomaly that serializable isolation would have prevented is:",
    options: ["Dirty read", "Phantom read", "Lost update", "Write skew"],
    correctIndex: 2,
    type: "tech",
    concept: "Transaction Anomalies"
  },
  {
    id: 24,
    question: "A Bloom filter reports 'present'. What do you actually know?",
    options: ["The element was definitely inserted", "The element might have been inserted", "The element was inserted exactly once", "Nothing at all"],
    correctIndex: 1,
    type: "tech",
    concept: "Probabilistic Data Structures"
  }
];