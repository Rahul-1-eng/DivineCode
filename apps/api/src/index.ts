import './config/env';
import express from 'express';
import http from 'http';
import path from 'path';
import { Server } from 'socket.io';
import jwt from 'jsonwebtoken';
import { prisma } from './prisma/client';
import { mountV2Routes } from './routes/v2';
import { startQueueWorkers } from './workers/index';
import { setupDuelSockets } from './modules/duel/duelSocketService';
import { upsertGoogleUser } from './storage';
import { loginUser } from './modules/auth/authService';

const app = express();

const allowedOrigins = [
  process.env.CLIENT_ORIGIN || 'http://localhost:3000',
  'https://your-production-domain.com' 
];

app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  } else {
    res.setHeader('Access-Control-Allow-Origin', allowedOrigins[0]);
  }
  
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, PATCH');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-user-email, x-user-name, x-worker-secret, x-user-id');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  next();
});

app.use(express.json({ limit: '10mb' }));

app.use((req: any, res, next) => {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.split(' ')[1];
    try {
      const decoded: any = jwt.verify(token, process.env.NEXTAUTH_SECRET || '');
      req.user = decoded; 
      if (decoded.email) req.headers['x-user-email'] = decoded.email;
      if (decoded.name) req.headers['x-user-name'] = decoded.name;
    } catch (err) {
      console.warn('Invalid API token rejected.');
    }
  }
  next();
});

const server = http.createServer(app);

const io = new Server(server, { 
  cors: { origin: allowedOrigins, methods: ['GET', 'POST'], credentials: true } 
});

app.set('io', io);

// 👉 ADDED: Personal Notification Rooms
io.on('connection', (socket) => {
  socket.on('join-personal-notifications', (email) => {
    socket.join(`user:${email}`);
  });
});

startQueueWorkers(io);
setupDuelSockets(io);
mountV2Routes(app, io);

app.use('/uploads', express.static(path.join(process.cwd(), 'public', 'uploads')));
app.get('/', (_req, res) => res.json({ status: 'ok', app: 'DivineCode API V2' }));

app.post('/api/auth/google', async (req, res) => { 
  try { const user = await upsertGoogleUser(req.body); res.json({ ok: true, user }); } 
  catch (e) { res.status(400).json({ ok: false, error: 'Auth failed' }); } 
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const result = await loginUser(req.body);
    return res.json(result);
  } catch (err: any) {
    return res.status(401).json({ error: 'Invalid username or password.' });
  }
});

const PORT = Number(process.env.PORT) || 4000;
server.listen(PORT, () => console.log(`🚀 DivineCode API online at ${PORT} (PostgreSQL/Prisma Foundation Active)`));