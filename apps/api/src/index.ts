import './config/env';
import express from 'express';
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

// 🛡️ THE ABSOLUTE CORS INTERCEPTOR 🛡️
// This guarantees Vercel can always talk to Render, even during 502 crashes.
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  } else {
    res.setHeader('Access-Control-Allow-Origin', '*');
  }
  
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, PATCH');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-user-email, x-user-name, x-worker-secret, x-user-id');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  
  // Instantly approve all Preflight requests
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  next();
});

app.use(express.json({ limit: '10mb' }));

const server = http.createServer(app);

// Open WebSocket CORS
const io = new Server(server, { 
  cors: { 
    origin: "*", 
    methods: ['GET', 'POST'], 
    credentials: true 
  } 
});

// --- STATE CONTAINERS ---
const contests = new Map<string, any>();
const submissions: any[] = [];

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
mountV2Routes(app, io);

// Serve Static Uploads
app.use('/uploads', express.static(path.join(process.cwd(), 'public', 'uploads')));

// Health Check
app.get('/', (_req, res) => res.json({ status: 'ok', app: 'DivineCode API V2' }));

// Auth
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