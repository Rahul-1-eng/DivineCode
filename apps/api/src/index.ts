/**
 * @file index.ts
 * @author Rahul Kumar Sahoo
 * @description Entry point for the DivineCode API server, including auth, CORS, and socket bootstrap.
 */
import './config/env';
import express, { Request, Response, NextFunction } from 'express';
import http from 'http';
import path from 'path';
import { Server } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import Redis from 'ioredis';
import jwt from 'jsonwebtoken';
import rateLimit from 'express-rate-limit';
import { prisma } from './prisma/client';
import { mountV2Routes } from './routes/v2';
import { startQueueWorkers } from './workers/index';
import { setupDuelSockets } from './modules/duel/duelSocketService';
import { upsertGoogleUser } from './storage';
import { loginUser } from './modules/auth/authService';

declare global {
  namespace Express {
    interface Request {
      user?: jwt.JwtPayload | string;
    }
  }
}

const app = express();

const defaultOrigins = [
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'https://divine-code-web.vercel.app',
  'https://divinecode-xbfb.onrender.com'
];

const allowedOrigins = Array.from(new Set([
  ...(process.env.CLIENT_ORIGIN ? [process.env.CLIENT_ORIGIN] : []),
  ...(process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',').map((value) => value.trim()).filter(Boolean) : []),
  ...defaultOrigins
]));

const aiLimiter = rateLimit({
  windowMs: 60 * 1000, 
  max: 15, 
  message: { error: 'Too many AI requests from this IP, please try again after a minute.' },
  standardHeaders: true,
  legacyHeaders: false,
});

app.use((req: Request, res: Response, next: NextFunction) => {
  console.log(`📡 [${req.method}] ${req.url} - Origin: ${req.headers.origin}`);
  const origin = req.headers.origin;
  if (origin && allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  } else if (!origin) {
    res.setHeader('Access-Control-Allow-Origin', allowedOrigins[0]);
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

app.use((req: Request, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.split(' ')[1];
    try {
      const signingSecret = process.env.NEXTAUTH_SECRET || 'divinecode-local-dev-secret';
      const decoded = jwt.verify(token, signingSecret) as jwt.JwtPayload;
      req.user = decoded; 
      req.headers['x-user-email'] = decoded.email;
      // ...
    } catch (err) {
      console.error('❌ [AUTH] Token verification failed:', err);
    }
  }
  next();
});

app.use('/api/v2/ai', aiLimiter);
app.use('/api/v2/interview/*/mock', aiLimiter);

const server = http.createServer(app);

const io = new Server(server, { 
  cors: { origin: allowedOrigins, methods: ['GET', 'POST'], credentials: true } 
});

const pubClient = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');
const subClient = pubClient.duplicate();
io.adapter(createAdapter(pubClient, subClient));

app.set('io', io);

// Enhanced WebSocket Pipeline for Multiplayer Coding Rooms
io.on('connection', (socket) => {
  
  // Account Notifications Room
  socket.on('join-personal-notifications', (email: string) => {
    socket.join(`user:${email}`);
  });

  // Collaborative Coding Workspace Room
  socket.on('join-workspace', (problemId: string) => {
    socket.join(`workspace:${problemId}`);
  });

  // Broadcast code updates to all peers in the room except the sender
  socket.on('local-code-update', (data: { roomId: string; code: string }) => {
    socket.to(`workspace:${data.roomId}`).emit('remote-code-update', data.code);
  });
  
});

startQueueWorkers(io);
setupDuelSockets(io);
mountV2Routes(app, io);

app.use('/uploads', express.static(path.join(process.cwd(), 'public', 'uploads')));
app.get('/', (_req: Request, res: Response) => res.json({ status: 'ok', app: 'DivineCode API V2' }));

app.post('/api/auth/google', async (req: Request, res: Response) => { 
  try { 
    const user = await upsertGoogleUser(req.body); 
    res.json({ ok: true, user }); 
  } catch (e) { 
    res.status(400).json({ ok: false, error: 'Auth failed' }); 
  } 
});

app.post('/api/auth/login', async (req: Request, res: Response) => {
  try {
    const result = await loginUser(req.body);
    return res.json(result);
  } catch (err: unknown) {
    return res.status(401).json({ error: 'Invalid username or password.' });
  }
});

const PORT = Number(process.env.PORT) || 4000;
server.listen(PORT, () => console.log(`🚀 DivineCode API online at ${PORT} (Redis-Synced Distributed Sockets Enabled)`));