/**
 * @file interviewMcqs.ts
 * @author Rahul Kumar Sahoo
 * @description Application source for the DivineCode platform.
 */

export type InterviewMcq = {
  id: number;
  rating: number;
  topic: string;
  question: string;
  options: string[];
  correctIndex: number;
  explanation: string;
};

export const interviewMcqs: InterviewMcq[] = [
  { id: 1, rating: 800, topic: 'DBMS', question: 'Which normal form removes partial dependency?', options: ['1NF', '2NF', '3NF', 'BCNF'], correctIndex: 1, explanation: '2NF requires 1NF and removes partial dependency on part of a composite key.' },
  { id: 2, rating: 800, topic: 'Operating Systems', question: 'Which scheduling algorithm can cause starvation?', options: ['Round Robin', 'FCFS', 'Priority scheduling', 'SJF non-preemptive only never can'], correctIndex: 2, explanation: 'Low-priority processes can wait indefinitely in priority scheduling without aging.' },
  { id: 3, rating: 900, topic: 'Networks', question: 'TCP provides which key guarantee?', options: ['Best-effort datagrams', 'Reliable ordered byte stream', 'Broadcast delivery', 'No congestion control'], correctIndex: 1, explanation: 'TCP is connection-oriented and provides reliable ordered byte stream delivery.' },
  { id: 4, rating: 900, topic: 'DSA', question: 'Average time complexity of hash table lookup with good hashing is:', options: ['O(1)', 'O(log n)', 'O(n)', 'O(n log n)'], correctIndex: 0, explanation: 'With low load factor and good distribution, average lookup is constant time.' },
  { id: 5, rating: 1000, topic: 'OOP', question: 'Runtime method dispatch is mainly related to:', options: ['Encapsulation', 'Abstraction', 'Polymorphism', 'Compilation'], correctIndex: 2, explanation: 'Dynamic dispatch is a core mechanism for runtime polymorphism.' },
  { id: 6, rating: 1100, topic: 'DBMS', question: 'Which index type is typically efficient for range queries?', options: ['Hash index', 'B+ tree index', 'Bitmap always', 'No index'], correctIndex: 1, explanation: 'B+ trees keep keys sorted and support efficient range scans.' },
  { id: 7, rating: 1200, topic: 'Operating Systems', question: 'A deadlock requires which condition?', options: ['Preemption', 'Circular wait', 'Always single resource', 'No mutual exclusion'], correctIndex: 1, explanation: 'Circular wait is one of Coffman deadlock conditions.' },
  { id: 8, rating: 1200, topic: 'Computer Architecture', question: 'Cache locality where nearby memory addresses are accessed is called:', options: ['Temporal locality', 'Spatial locality', 'Logical locality', 'Branch locality'], correctIndex: 1, explanation: 'Spatial locality means nearby addresses are likely to be accessed soon.' },
  { id: 9, rating: 1300, topic: 'Algorithms', question: 'Dijkstra fails with:', options: ['Positive edges', 'Zero weight edges', 'Negative weight edges', 'Undirected graphs'], correctIndex: 2, explanation: 'Dijkstra assumes once finalized, a shortest distance cannot later reduce; negative edges break that.' },
  { id: 10, rating: 1400, topic: 'DBMS', question: 'Serializable isolation prevents:', options: ['Only dirty reads', 'Only lost updates', 'All non-serial anomalies by making execution equivalent to serial order', 'Only network errors'], correctIndex: 2, explanation: 'Serializable isolation is the strongest common isolation level.' },
  { id: 11, rating: 1500, topic: 'Networks', question: 'In HTTPS, TLS mainly provides:', options: ['Routing', 'Encryption, integrity, authentication', 'DNS lookup', 'Packet switching'], correctIndex: 1, explanation: 'TLS protects confidentiality and integrity and authenticates endpoints using certificates.' },
  { id: 12, rating: 1600, topic: 'Concurrency', question: 'Compare-and-swap is used to build:', options: ['Only blocking queues', 'Lock-free algorithms', 'SQL indexes', 'DNS caches'], correctIndex: 1, explanation: 'CAS is an atomic primitive used in lock-free synchronization.' },
  { id: 13, rating: 1700, topic: 'System Design', question: 'Consistent hashing primarily helps with:', options: ['Reducing remapping when nodes change', 'Encrypting passwords', 'Sorting logs', 'Avoiding indexes'], correctIndex: 0, explanation: 'Consistent hashing minimizes key movement during shard/node additions and removals.' },
  { id: 14, rating: 1800, topic: 'Distributed Systems', question: 'CAP theorem states that under partition, a system must choose between:', options: ['CPU and RAM', 'Consistency and availability', 'Latency and throughput only', 'SQL and NoSQL'], correctIndex: 1, explanation: 'During a network partition, a distributed system cannot guarantee both consistency and availability.' },
  { id: 15, rating: 1900, topic: 'Compilers', question: 'LR parsers are generally:', options: ['Top-down parsers', 'Bottom-up parsers', 'Regex engines only', 'Garbage collectors'], correctIndex: 1, explanation: 'LR parsing reads left-to-right and constructs a rightmost derivation in reverse, bottom-up.' },
  { id: 16, rating: 2000, topic: 'Algorithms', question: 'Which technique is commonly used for strongly connected components?', options: ['KMP', 'Tarjan/Kosaraju', 'Dijkstra only', 'Binary lifting only'], correctIndex: 1, explanation: 'Tarjan and Kosaraju are standard SCC algorithms.' },
  { id: 17, rating: 2100, topic: 'OS', question: 'Copy-on-write after fork means:', options: ['Pages are copied immediately', 'Pages are shared until one process writes', 'Fork is impossible', 'Only files are copied'], correctIndex: 1, explanation: 'COW delays physical copying until mutation.' },
  { id: 18, rating: 2200, topic: 'System Design', question: 'A write-ahead log is used because:', options: ['It improves CSS loading', 'It records intent before mutation for recovery', 'It avoids all disks', 'It replaces transactions'], correctIndex: 1, explanation: 'WAL persists changes before applying them so systems can recover after crashes.' }
];
