import './config/env';
import express from 'express';
import cors from 'cors';
import http from 'http';
import path from 'path';
import { Server } from 'socket.io';
import { connectDB } from './db';
import { mountV2Routes } from './routes/v2';
import { startQueueWorkers } from './workers/index';
import { setupDuelSockets } from './modules/duel/duelSocketService';
import { setupContestSockets } from './modules/contests/contestSocketService';
import { 
    loadContestDocuments, 
    loadSubmissionDocuments, 
    upsertGoogleUser 
} from './storage';

const app = express();
const allowedOrigins = (process.env.CLIENT_ORIGIN || 'http://localhost:3000,https://divine-code-web.vercel.app')
  .split(',').map(o => o.trim().replace(/\/$/, ""));

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) callback(null, true);
    else callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-user-email', 'x-user-name', 'x-worker-secret']
}));

app.use(express.json({ limit: '5mb' }));

const server = http.createServer(app);
const io = new Server(server, { 
  cors: { origin: allowedOrigins, methods: ['GET', 'POST'], credentials: true } 
});

// --- STATE CONTAINERS (Kept for legacy compat) ---
const contests = new Map<string, any>();
const submissions: any[] = [];

// --- UTILS & HELPERS ---
function id(prefix: string) { return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`; }
function slugHandle(name: string) { return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || `member_${Math.random().toString(36).slice(2, 6)}`; }
function parseMember(input: any) { 
    const raw = typeof input === 'string' ? { name: input } : input || {}; 
    const name = String(raw.name || raw.handle || raw.codeforcesHandle || raw.email || '').trim();
    return { id: String(raw.id || id('member')), name, email: String(raw.email || '').trim(), handle: slugHandle(name), codeforcesHandle: String(raw.codeforcesHandle || raw.handle || name).trim(), team: String(raw.team || 'Individuals').trim() || 'Individuals' }; 
}

// Fixed build error by defining this locally
async function restoreFromMongo() { 
  try { 
    const restoredContests = await loadContestDocuments(); 
    const restoredSubmissions = await loadSubmissionDocuments(); 
    contests.clear(); 
    submissions.splice(0, submissions.length, ...restoredSubmissions); 
    console.log(`Mongo restore complete: ${restoredContests.length} contest(s), ${submissions.length} submission(s).`); 
  } catch (error) { 
    console.error('Mongo restore failed:', error instanceof Error ? error.message : error); 
  } 
}

// --- MODULE INITIALIZATION ---
startQueueWorkers(io);
setupDuelSockets(io);
setupContestSockets(io);

// --- ROUTES ---
// 1. Mount Modular V2 Routes (Handles AI, Uploads, Contests)
mountV2Routes(app, io);

// 2. Serve Static Uploads
app.use('/uploads', express.static(path.join(process.cwd(), 'public', 'uploads')));

// 3. Health Check
app.get('/', (_req, res) => res.json({ status: 'ok', app: 'DivineCode API V2' }));

// 4. Auth
app.post('/api/auth/google', async (req, res) => { 
  try { const user = await upsertGoogleUser(req.body); res.json({ ok: true, user }); } 
  catch (e) { res.status(400).json({ ok: false, error: 'Auth failed' }); } 
});

// --- STARTUP ---
void connectDB().then(() => {
    console.log('Database Connected');
    return restoreFromMongo(); 
}).catch(console.error);

const PORT = Number(process.env.PORT) || 4000;
server.listen(PORT, () => console.log(`🚀 DivineCode API online at ${PORT}`));