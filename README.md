![Next.js](https://img.shields.io/badge/Next.js-14-black)
![TypeScript](https://img.shields.io/badge/TypeScript-5-blue)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-Prisma-blue)
![Redis](https://img.shields.io/badge/Redis-PubSub%20%2B%20BullMQ-red)
![Socket.io](https://img.shields.io/badge/Socket.io-Realtime-black)
![AI](https://img.shields.io/badge/AI-Claude%20%2B%20Gemini-green)
![Razorpay](https://img.shields.io/badge/Razorpay-Payments-0c2451)
![Jitsi](https://img.shields.io/badge/Jitsi-Live%20Video-1d76ba)
![PWA](https://img.shields.io/badge/PWA-Installable-5a0fc8)
![License](https://img.shields.io/badge/License-MIT-yellow)

# 🚀 DivineCode

### Real-Time Algorithmic Training, AI Interviews & a Live Recruiter Marketplace

> A production-grade, full-stack platform that takes a developer from daily DSA practice to rated contests, AI-driven mock interviews, and finally a **paid 1:1 live video interview with a real human recruiter** — all in one place.

---

## 🌐 Live Demo

**Try it now:** https://divine-code-web.vercel.app/

---

## 📖 Overview

DivineCode bridges the gap between traditional competitive-programming platforms and real-world technical hiring. Standard platforms stop at "solve the problem" — DivineCode carries you through the entire interview funnel:

**Practice → Contests & Duels → AI Mock Interviews → Real Recruiter Interviews (live video, paid bookings)**

Along the way it exercises serious engineering: distributed WebSocket infrastructure, queue-based background processing, dual-provider AI routing with automatic failover, cryptographically verified payments, and a transactional email pipeline.

---

## ✨ Core Features

### 🤖 AI Recruiter — 3-Round Mock Interview Engine

A complete AI-driven interview loop that mirrors a real hiring process:

1. **Round 1 — DSA:** live coding with real code execution against test cases
2. **Round 2 — Resume Deep Dive:** upload a resume PDF; it's parsed server-side and the AI grills you on *your* projects and claims
3. **Round 3 — Behavioral:** communication and culture-fit questioning

Ends with a **hiring-committee report** — scores, strengths, weaknesses, and a prep plan — downloadable as a PDF. Includes a **voice-to-voice mode** (Web Speech API) that listens to spoken answers and scores technical accuracy and English fluency.

Under the hood: resilient dual-provider routing between **Anthropic Claude** and **Google Gemini** with automatic fallback on rate limits, plus response caching to cut redundant LLM calls.

### 💼 Real Recruiter Marketplace — Paid Live Video Interviews

Book a paid 1:1 mock interview with a **verified human recruiter**:

- **Two payment paths:** Razorpay Checkout (cards / UPI / netbanking / wallets, instant confirmation) or manual UPI transfer with UTR submission verified by an admin
- Payment integrity enforced by **server-side HMAC signature verification** — no webhooks required
- Platform fee model (15%, minimum ₹49) computed server-side
- On confirmation, a **private live video room** unlocks for both sides, and booking-lifecycle emails go out automatically
- Users can apply to become recruiters; listings go live after admin approval

### 📺 DivineLive — Community Live Streams

Go live camera-on from the Community Hub to discuss contest problems. Anyone online gets notified and can join the room on video. Viewer presence is tracked in real time via Socket.IO rooms, with peak-viewer stats persisted per stream. Live video is powered by the **Jitsi Meet External API** (free public infra, no keys).

### ⚔️ Contests, Duels & Collaborative IDE

- **Rated contests** with live leaderboards, registration-confirmation emails, automated reward distribution, and auto-finalization workers
- **1v1 real-time code duels** over WebSockets
- **Collaborative coding rooms** built on Monaco Editor with live code synchronization across users — kept consistent across server instances via Redis Pub/Sub
- **Codeforces integration** through a backend proxy layer (CORS-free, normalized responses, custom mashup contests)

### 🛡️ AST-Inspired Plagiarism Detection

Heavy analysis is offloaded to BullMQ workers:

```text
Submission → Queue → Worker → Normalization → N-Gram Jaccard Similarity → Verdict
```

Code is normalized (comments stripped, strings/numbers canonicalized, whitespace erased) before structural comparison — so renamed variables, reformatting, and light edits don't evade detection.

### ⚡ In-Browser Judge

Multi-language code execution (C++, C, Python, Java, JavaScript) with public/hidden test cases, verdicts, and AI-generated hints and complexity analysis. Submissions flow through a BullMQ queue so the API event loop never blocks. Bonus: one-click export of public test cases to the **CPH VS Code extension**.

### 📬 Email Pipeline & Notifications

Transactional email (Nodemailer + Gmail) for booking updates, recruiter application decisions, interview debrief reports, and contest registrations — alongside real-time in-app notifications via per-user socket rooms.

### 📱 PWA

Installable progressive web app with a service worker (next-pwa).

---

## 🏗️ System Architecture

```mermaid
graph TD
    Client[Client Browser / PWA]

    Client -->|HTTPS| Web[Next.js Frontend - Vercel]
    Client -->|REST + WebSocket| API[Express + Socket.IO API - Render]
    Client -->|WebRTC| Jitsi[Jitsi Meet - Live Video]

    Web -->|NextAuth Google OAuth| Google[Google OAuth]
    Web -->|Signed JWT bridge| API

    API <--> Redis[(Redis - PubSub + BullMQ)]
    API --> PG[(PostgreSQL - Prisma)]

    Redis --> W1[Judge Worker]
    Redis --> W2[Plagiarism Worker]
    Redis --> W3[Rewards / Finalize Workers]

    API --> Exec[Remote Code Execution]
    API --> AI[Claude + Gemini - fallback routing]
    API --> RZP[Razorpay - HMAC verified]
    API --> Mail[Gmail SMTP - Nodemailer]
```

The Socket.IO layer uses the **Redis adapter**, so rooms and events stay consistent even when the API scales to multiple instances.

---

## 🛠 Tech Stack

| Category | Technologies |
|-----------|-------------|
| Frontend | Next.js 14, React 18, TypeScript, Monaco Editor, Framer Motion, Three.js |
| Backend | Node.js, Express, TypeScript |
| Realtime | Socket.IO + Redis adapter, Yjs / y-webrtc |
| Database | PostgreSQL + Prisma ORM |
| Queues | BullMQ on Redis |
| Auth | NextAuth (Google OAuth) bridged to a JWT-secured API |
| AI | Anthropic Claude + Google Gemini (dual-provider with fallback) |
| Payments | Razorpay + manual UPI with admin UTR verification |
| Live Video | Jitsi Meet External API |
| Email | Nodemailer (Gmail) |
| PWA | next-pwa service worker |
| Deployment | Vercel (web) + Render (API), Docker Compose for local infra |

---

## 🔥 Engineering Highlights

- **Distributed WebSocket infrastructure** — Redis-backed Socket.IO keeps duels, live rooms, collaborative editors, and notifications synchronized across horizontally scaled API nodes.
- **Event-loop protection** — judging, plagiarism analysis, rewards, and contest finalization all run in BullMQ workers, never in request handlers.
- **Resilient AI routing** — every AI feature transparently fails over between Claude and Gemini on rate limits or outages, with caching to control cost.
- **Payment integrity** — Razorpay signatures are verified server-side with HMAC before any booking confirms; the manual-UPI path has a human-in-the-loop UTR verification flow for regions/users without gateway access.
- **Security posture** — per-route rate limiting on AI endpoints, role-based admin moderation, JWT verification middleware, and an env-driven CORS allowlist behind a trusted reverse proxy.

---

## 🎯 Recruiter Test Drive

Reviewing for an internship or SWE role? A five-minute tour:

1. Open the [live app](https://divine-code-web.vercel.app/) and sign in with Google.
2. Solve a practice problem — run code in-browser and ask the AI for a hint.
3. Launch the **AI Recruiter** (`/recruiter`) — every account gets 3 free interview sessions.
4. Browse the **human recruiter marketplace** (`/recruiter/book`) to see the booking + payment flow.
5. Visit the **Community Hub** and peek into a DivineLive room.
6. Start a **duel** or join a collaborative coding room in a second tab to watch the real-time sync.

---

## 📁 Monorepo Layout

```text
divinecode/
├── apps/
│   ├── web/        # Next.js frontend (Vercel)
│   └── api/        # Express + Socket.IO backend (Render)
├── prisma/         # Shared schema — single source of truth
├── infra/          # docker-compose for local Postgres + Redis
└── docs/           # Architecture & implementation notes
```

---

## ⚙️ Local Development Setup

### Prerequisites

Node.js 18+, Docker (or your own PostgreSQL 16 + Redis 7).

### 1. Clone & install

```bash
git clone https://github.com/Rahul-1-eng/DivineCode.git
cd DivineCode
npm install
```

### 2. Start local infrastructure

```bash
docker compose -f infra/docker-compose.local.yml up -d postgres redis
```

### 3. Configure environment

```bash
cp apps/api/.env.example apps/api/.env
```

Fill in the values — the important ones:

```env
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/divinecode?schema=public
REDIS_URL=redis://localhost:6379
NEXTAUTH_SECRET=any-strong-random-string
GEMINI_API_KEY=...          # and/or ANTHROPIC_API_KEY for the AI features
GMAIL_USER=...              # email pipeline (optional locally)
GMAIL_APP_PASSWORD=...
PLATFORM_UPI_ID=...         # recruiter-booking payments (optional locally)
RAZORPAY_KEY_ID=...         # leave empty to run manual-UPI-only
RAZORPAY_KEY_SECRET=...
ENABLE_API_WORKERS=true
```

For the frontend, create `apps/web/.env.local`:

```env
NEXTAUTH_URL=http://localhost:3000
NEXTAUTH_SECRET=same-value-as-the-api
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
```

### 4. Sync the database schema

```bash
npx prisma db push
```

### 5. Run everything

```bash
npm run dev   # API on :4000 + web on :3000, concurrently
```

---

## 🚀 Deployment

- **Frontend** → Vercel (root directory `apps/web`)
- **Backend** → Render (root directory `apps/api`) with managed PostgreSQL and Redis

See [`DEPLOYMENT.md`](./DEPLOYMENT.md) for environment variables and step-by-step instructions.

---

## 🎯 Roadmap

- ☁️ **Cloud media storage** — move community uploads from local disk to S3/Cloudinary
- 👥 **Spectator mode** — watch contests and duels live with event streams and submission tracking
- 🤖 **AI code review assistant** — automated reviews, refactoring suggestions, complexity analysis
- 📊 **Recruiter analytics dashboard** — booking trends, candidate performance history
- 🌍 **More judge languages** — Go, Rust, Kotlin

---

## 📸 Screenshots

> Add screenshots or GIF demonstrations here.

```text
assets/
├── homepage.png
├── ai-interviewer.png
├── recruiter-marketplace.png
├── divinelive-room.png
└── contest-room.png
```

---

## 👨‍💻 Author

# Rahul Kumar Sahoo

**Computer Science & Engineering**
**Indian Institute of Technology Patna**

📧 rahulkumarsahoo1974@gmail.com
🔗 [LinkedIn](https://www.linkedin.com/in/rahul-kumar-sahoo-0bbaa9328)
🏆 [Codeforces](https://codeforces.com/profile/RKS_Rider)

---

## ⭐ Support

If you found this project interesting:

```bash
⭐ Star the repository
🍴 Fork the repository
🚀 Build something amazing
```

---

## 📜 License

This project is licensed under the MIT License. Feel free to use, modify, and distribute it for educational and professional purposes.

---

<div align="center">

### 🙏 Jai Jagannath 🙏

*"May knowledge, perseverance, and humility guide every line of code."*

</div>
