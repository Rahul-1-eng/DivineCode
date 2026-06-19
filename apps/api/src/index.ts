import './config/env';
import express from 'express';
import http from 'http';
import path from 'path';
import { Server } from 'socket.io';
import jwt from 'jsonwebtoken';
import { connectDB } from './db';
import { mountV2Routes } from './routes/v2';
import { startQueueWorkers } from './workers/index';
import { setupDuelSockets } from './modules/duel/duelSocketService';
import { setupContestSockets } from './modules/contests/contestSocketService';
// Mongo Cleanup: Stripped loadContestDocuments and loadSubmissionDocuments
import { upsertGoogleUser } from './storage';

const app = express();

// 🛡️ THE ABSOLUTE CORS INTERCEPTOR 🛡️
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  } else {
    res.setHeader('Access-Control-Allow-Origin', '*');
  }
  
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, PATCH');
  // Explicitly allow the Authorization header
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-user-email, x-user-name, x-worker-secret, x-user-id');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  next();
});

app.use(express.json({ limit: '10mb' }));

// 🛡️ SECURITY FIX: JWT VERIFICATION MIDDLEWARE 🛡️
// Intercepts the Bearer token minted by Next.js and securely decodes it
app.use((req: any, res, next) => {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.split(' ')[1];
    try {
      // Must match the NEXTAUTH_SECRET on the frontend
      const decoded = jwt.verify(token, process.env.NEXTAUTH_SECRET || '');
      req.user = decoded; // Attach verified payload { id, email, name }
    } catch (err) {
      console.warn('Invalid or expired API token rejected.');
    }
  }
  next();
});

const server = http.createServer(app);

// Open WebSocket CORS
const io = new Server(server, { 
  cors: { 
    origin: "*", 
    methods: ['GET', 'POST'], 
    credentials: true 
  } 
});

// Mongo Cleanup: Removed the Maps, arrays, and restoreFromMongo() function entirely.

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
    console.log('Database Connected. Booting engine...');
}).catch(console.error);

const PORT = Number(process.env.PORT) || 4000;
server.listen(PORT, () => console.log(`🚀 DivineCode API online at ${PORT}`));