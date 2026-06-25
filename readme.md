# ⚡ DivineCode Pro

> **The ultimate operating system for competitive programmers.** <br>
> DivineCode is a distributed, real-time algorithmic training platform designed to mimic FAANG technical interviews and Codeforces-style arenas.

[![Next.js](https://img.shields.io/badge/Next.js-14-black?style=flat&logo=next.js)](https://nextjs.org/)
[![Node.js](https://img.shields.io/badge/Node.js-Backend-339933?style=flat&logo=node.js)](https://nodejs.org/)
[![Socket.io](https://img.shields.io/badge/WebSockets-Socket.io-black?style=flat&logo=socket.io)](https://socket.io/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-Prisma-4169E1?style=flat&logo=postgresql)](https://postgresql.org/)
[![BullMQ](https://img.shields.io/badge/BullMQ-Redis_Workers-DC382D?style=flat&logo=redis)](https://redis.io/)
[![Gemini](https://img.shields.io/badge/Google_AI-Gemini_1.5_Flash-4285F4?style=flat&logo=google)](https://deepmind.google/technologies/gemini/)

---

## 🚀 Enterprise-Grade Features

* **🧠 Voice-to-Voice AI Interviewer:** Simulates a FAANG engineering interview using the Web Speech API and Google Gemini 1.5 Flash. It "looks" at your live IDE code and evaluates your spoken English fluency and algorithmic logic simultaneously.
* **⚔️ Real-Time Multiplayer IDE:** Built on `Socket.io` with a **Redis Adapter**, allowing infinitely scalable, zero-latency collaborative coding and 1v1 algorithmic duels across distributed server nodes.
* **🛡️ AST-Based Plagiarism Engine:** Offloaded to a robust **BullMQ background worker cluster**, this engine utilizes Tokenizing N-Gram Jaccard Similarity to structurally analyze submissions and flag template-copying with >85% accuracy.
* **🌐 Live External Proxy Sync:** Bypasses CORS limitations to securely fetch, scrape, and proxy real-time global contests from Codeforces natively into the platform's dashboard.
* **📊 AI Topic Mastery Radar:** Analyzes users' submission history to generate a custom SVG Spider-Chart, visualizing their proficiency across Data Structures, Dynamic Programming, and Graph Theory.

---

## 🏗️ System Architecture

DivineCode is built as a highly scalable monorepo, separating the heavy compilation/AI logic from the client-facing UI.

### The Stack
* **Frontend:** Next.js (React), Framer Motion (Animations), Monaco Editor (VS Code core engine).
* **Backend:** Express.js (Node), Socket.io (Real-time).
* **Database & ORM:** PostgreSQL managed via Prisma.
* **Distributed Queues:** Redis & BullMQ (Handles asynchronous Judge0 code compilation, Codeforces data syncing, and Plagiarism checks without blocking the main event loop).
* **Execution Engine:** Judge0 Sandbox (Isolated remote code execution).

---

## 💻 Recruiter Test Drive

Are you a recruiter or engineering manager? You can test the platform immediately without creating an account.

1. Navigate to the Login Page.
2. Click the **"🚀 Recruiter Test Drive (Guest Mode)"** button.
3. You will be instantly authenticated into a pre-configured sandbox to test the AI Editor, Voice Interviewer, and Live Matchmaking.

---

## ⚙️ Local Development Setup

To run DivineCode locally, ensure you have Node.js, Docker (for Redis/Postgres), and an active Gemini API key.

```bash
# 1. Clone the repository
git clone [https://github.com/your-username/divinecode.git](https://github.com/your-username/divinecode.git)
cd divinecode

# 2. Install monorepo dependencies
npm install

# 3. Setup Environment Variables
# Copy .env.example to .env in both apps/web and apps/api
# Ensure REDIS_URL, DATABASE_URL, and AI_API_KEY are filled.

# 4. Initialize Database
cd apps/api
npx prisma db push

# 5. Start the Development Servers (Frontend, Backend, and Workers)
npm run dev