import { Server, Socket } from 'socket.io';
import { prisma } from '../../prisma/client';

type Player = { id: string; name: string; socket: Socket; score: number; attempts: number };
type QueuedPlayer = Player & { queuedAt: number; rating: number };
type DuelState = {
  roomId: string;
  players: Player[];
  questions: any[];
  currentQuestionIndex: number;
  finished: boolean;
};

export function setupDuelSockets(io: Server) {
  let matchmakingQueue: QueuedPlayer[] = [];
  const customWaitingRooms = new Map<string, { host: Player, customQuestionIds?: string[] }>(); 
  const activeRooms = new Map<string, DuelState>();

  // Active Elo Matchmaking Engine Loop (Runs every 2 seconds)
  setInterval(async () => {
    if (matchmakingQueue.length < 2) return;

    const now = Date.now();
    matchmakingQueue.sort((a, b) => a.queuedAt - b.queuedAt);

    for (let i = 0; i < matchmakingQueue.length; i++) {
      const p1 = matchmakingQueue[i];
      if (!p1) continue;

      const waitTimeSecs = (now - p1.queuedAt) / 1000;
      const acceptableDelta = Math.max(100, waitTimeSecs * 50);

      for (let j = i + 1; j < matchmakingQueue.length; j++) {
        const p2 = matchmakingQueue[j];
        if (!p2) continue;

        const ratingDelta = Math.abs(p1.rating - p2.rating);
        
        if (ratingDelta <= acceptableDelta) {
          matchmakingQueue.splice(j, 1);
          matchmakingQueue.splice(i, 1);
          i--; 
          
          await initializeMatch(p1, p2);
          break;
        }
      }
    }
  }, 2000);

  const emitState = (roomId: string) => {
    const state = activeRooms.get(roomId);
    if (!state) return;

    const currentQ = state.questions[state.currentQuestionIndex];
    const safePlayers = state.players.map(p => ({ id: p.id, name: p.name, score: p.score, attempts: p.attempts }));

    io.to(roomId).emit('duel:state', {
      roomId: state.roomId,
      players: safePlayers,
      question: state.finished ? null : {
        id: currentQ.id,
        number: state.currentQuestionIndex + 1,
        total: state.questions.length,
        concept: currentQ.track?.title || 'General',
        question: currentQ.prompt,
        options: currentQ.options
      },
      finished: state.finished
    });
  };

  async function initializeMatch(p1: Player, p2: Player, customQuestionIds?: string[]) {
    const roomId = `duel_${Date.now()}`;
    p1.socket.join(roomId);
    p2.socket.join(roomId);

    try {
      let selectedQuestions: any[] = [];
      if (customQuestionIds && customQuestionIds.length > 0) {
        const dbQuestions = await prisma.interviewQuestion.findMany({
          where: { id: { in: customQuestionIds } },
          include: { track: true }
        });
        selectedQuestions = customQuestionIds.map(id => dbQuestions.find(q => q.id === id)).filter(Boolean);
      } else {
        const dbQuestions = await prisma.interviewQuestion.findMany({ where: { isApproved: true }, include: { track: true } });
        selectedQuestions = dbQuestions.sort(() => 0.5 - Math.random()).slice(0, 7); 
      }

      if (selectedQuestions.length === 0) throw new Error("No questions available");

      selectedQuestions = selectedQuestions.map((q: any) => ({
        ...q,
        correctIndex: Array.isArray(q.correctIndices) && q.correctIndices.length > 0
          ? q.correctIndices[0]
          : (q.correctIndex ?? 0)
      }));

      const state: DuelState = {
        roomId,
        players: [p1, p2],
        questions: selectedQuestions,
        currentQuestionIndex: 0,
        finished: false,
      };
      activeRooms.set(roomId, state);

      io.to(roomId).emit('duel:start', { 
        roomId, 
        players: [{ id: p1.id, name: p1.name, score: 0 }, { id: p2.id, name: p2.name, score: 0 }] 
      });
      emitState(roomId);
    } catch (err) {
      p1.socket.emit('duel:waiting', { message: 'Matchmaking failed. Try again.' });
      p2.socket.emit('duel:waiting', { message: 'Matchmaking failed. Try again.' });
    }
  }

  io.on('connection', (socket: Socket) => {
    
    socket.on('duel:join', async ({ name, userEmail }) => {
      if (matchmakingQueue.some(p => p.id === socket.id)) return;

      let playerRating = 1200;
      if (userEmail) {
        try {
          const user = await prisma.user.findUnique({ where: { email: userEmail } });
          if (user) playerRating = user.duelRating || 1200;
        } catch (e) { console.error("Elo fetch failed"); }
      }

      const queuedPlayer: QueuedPlayer = {
        id: socket.id,
        name,
        socket,
        score: 0,
        attempts: 0,
        rating: playerRating,
        queuedAt: Date.now()
      };

      matchmakingQueue.push(queuedPlayer);
      socket.emit('duel:waiting', { message: `Queued. Searching for opponents near Rating: ${playerRating}...` });
    });

    socket.on('duel:createCustom', ({ name, questionIds }) => {
      const code = Math.random().toString(36).substring(2, 8).toUpperCase();
      const player = { id: socket.id, name: name || `Player-${socket.id.slice(0, 4)}`, socket, score: 0, attempts: 0 };
      customWaitingRooms.set(code, { host: player, customQuestionIds: questionIds });
      socket.emit('duel:customCreated', { roomCode: code });
    });

    socket.on('duel:joinCustom', async ({ name, roomCode }) => {
      const code = roomCode.trim().toUpperCase();
      const room = customWaitingRooms.get(code);
      if (!room) return socket.emit('duel:error', { message: 'Invalid or expired room code.' });
      if (room.host.id === socket.id) return; 
      
      const p2 = { id: socket.id, name: name || `Player-${socket.id.slice(0, 4)}`, socket, score: 0, attempts: 0 };
      customWaitingRooms.delete(code); 
      await initializeMatch(room.host, p2, room.customQuestionIds);
    });

    socket.on('duel:answer', ({ roomId, questionId, answerIndex }) => {
      const state = activeRooms.get(roomId);
      if (!state || state.finished) return;

      const currentQ = state.questions[state.currentQuestionIndex];
      if (currentQ.id !== questionId) return;

      const player = state.players.find(p => p.id === socket.id);
      if (!player || player.attempts >= 2) return;

      const isCorrect = currentQ.correctIndex === answerIndex;

      if (isCorrect) {
        player.score += 100;
      } else {
        player.score -= 20; 
        player.attempts += 1;
      }

      io.to(roomId).emit('duel:feedback', {
        playerId: player.id,
        playerName: player.name,
        correct: isCorrect,
        attemptsLeft: 2 - player.attempts,
        concept: currentQ.track?.title || 'General'
      });

      if (isCorrect) {
        state.currentQuestionIndex++;
        state.players.forEach(p => p.attempts = 0); 
        if (state.currentQuestionIndex >= state.questions.length) {
          state.finished = true;
        }
      }
      
      emitState(roomId);
    });

    // --- REAL-TIME CHAT & IMAGE EVENTS ---
    socket.on('chat:message', ({ roomId, message }) => {
      const state = activeRooms.get(roomId);
      if (!state) return;
      const player = state.players.find(p => p.id === socket.id);
      if (!player) return;
      
      io.to(roomId).emit('chat:message', {
        senderId: player.id,
        senderName: player.name,
        message,
        timestamp: new Date().toISOString()
      });
    });

    socket.on('chat:image', ({ roomId, imageUrl }) => {
      const state = activeRooms.get(roomId);
      if (!state) return;
      const player = state.players.find(p => p.id === socket.id);
      if (!player) return;

      io.to(roomId).emit('chat:image', {
        senderId: player.id,
        senderName: player.name,
        imageUrl,
        timestamp: new Date().toISOString()
      });
    });

    // --- WEBRTC VOICE SIGNALING EVENTS ---
    socket.on('webrtc:offer', ({ roomId, offer }) => {
      socket.to(roomId).emit('webrtc:offer', { senderId: socket.id, offer });
    });

    socket.on('webrtc:answer', ({ roomId, answer }) => {
      socket.to(roomId).emit('webrtc:answer', { senderId: socket.id, answer });
    });

    socket.on('webrtc:ice-candidate', ({ roomId, candidate }) => {
      socket.to(roomId).emit('webrtc:ice-candidate', { senderId: socket.id, candidate });
    });

    // 👉 ADDED: Cleanup routing for Voice
    socket.on('webrtc:leave', ({ roomId }) => {
      socket.to(roomId).emit('webrtc:leave', { senderId: socket.id });
    });

    socket.on('disconnect', () => {
      matchmakingQueue = matchmakingQueue.filter(p => p.id !== socket.id);

      for (const [code, room] of customWaitingRooms.entries()) {
        if (room.host.id === socket.id) customWaitingRooms.delete(code);
      }
      for (const [roomId, state] of activeRooms.entries()) {
        if (state.players.some(p => p.id === socket.id)) {
          state.finished = true;
          io.to(roomId).emit('duel:feedback', { playerName: 'System', correct: false, concept: 'Opponent disconnected' });
          emitState(roomId);
          activeRooms.delete(roomId);
        }
      }
    });
  });
}