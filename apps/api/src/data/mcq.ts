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
  }
];