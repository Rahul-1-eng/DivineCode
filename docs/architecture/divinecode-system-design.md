# DivineCode System Design

For the production V2 foundation, see:

- [Level 4 V2 Blueprint](./level4-v2-blueprint.md)
- [Phase 1 Foundation Plan](../implementation/phase-1-foundation.md)

## Vision

A unified competitive programming intelligence platform that synchronizes real contests, tracks real performance, and provides AI-powered guidance.

## Major Services

### 1. User Service
Handles:
- authentication
- linked coding handles
- profile analytics

### 2. Rating Engine
Computes Divine Rating from:
- Codeforces
- LeetCode
- AtCoder
- CodeChef
- activity
- consistency

### 3. Recommendation Engine
Provides adaptive questions based on:
- weaknesses
- rating
- recent mistakes
- topic mastery

### 4. Contest Sync Engine
Tracks:
- live submissions
- accepted attempts
- penalties
- rank movement
- contest timelines

### 5. AI Doubt Engine
Supports:
- OCR
- image parsing
- bug detection
- code reasoning
- WA explanation

### 6. Judge Engine
Handles:
- custom execution
- testcase generation
- stress testing
- hack testcase generation

## Suggested Stack

Frontend:
- Next.js
- Tailwind
- TypeScript

Backend:
- NestJS
- PostgreSQL
- Redis
- Socket.IO

Infrastructure:
- Docker sandboxing
- BullMQ queues
- S3 storage

AI:
- OCR pipeline
- embeddings
- code reasoning
- RAG editorials
