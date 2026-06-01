import { Server, Socket } from 'socket.io';
import { prisma } from '../../prisma/client';

type Player = { id: string; name: string; socket: Socket; score: number };
type DuelState = {
  roomId: string;
  players: Player[];
  questions: any[];
  currentQuestionIndex: number;
  finished: boolean;
};

export function setupDuelSockets(io: Server) {
  let waitingPlayer: Player | null = null;
  // 👉 UPDATED: Store the host's custom question IDs alongside their player object
  const customWaitingRooms = new Map<string, { host: Player, customQuestionIds?: string[] }>(); 
  const activeRooms = new Map<string, DuelState>();

  const emitState = (roomId: string) => {
    const state = activeRooms.get(roomId);
    if (!state) return;

    const currentQ = state.questions[state.currentQuestionIndex];
    const safePlayers = state.players.map(p => ({ id: p.id, name: p.name, score: p.score }));

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

  // 👉 UPDATED: Accepts an optional array of custom question IDs
  async function initializeMatch(p1: Player, p2: Player, customQuestionIds?: string[]) {
    const roomId = `duel_${Date.now()}`;
    p1.socket.join(roomId);
    p2.socket.join(roomId);

    try {
      let selectedQuestions: any[] = [];

      // If the host provided custom questions, fetch those exact ones
      if (customQuestionIds && customQuestionIds.length > 0) {
        const dbQuestions = await prisma.interviewQuestion.findMany({
          where: { id: { in: customQuestionIds } },
          include: { track: true }
        });
        
        // Preserve the order the host selected them in
        selectedQuestions = customQuestionIds
          .map(id => dbQuestions.find(q => q.id === id))
          .filter(Boolean);
      } 
      // Otherwise, pull 7 random questions
      else {
        const dbQuestions = await prisma.interviewQuestion.findMany({
          where: { isApproved: true },
          include: { track: true }
        });

        selectedQuestions = dbQuestions
          .sort(() => 0.5 - Math.random())
          .slice(0, 7); // 👉 REQUIREMENT MET: At least 7 questions
      }

      if (selectedQuestions.length === 0) {
        selectedQuestions.push({
          id: 'fallback-1',
          prompt: 'Database is currently empty. What is 2 + 2?',
          options: ['3', '4', '5', '6'],
          correctIndex: 1,
          track: { 
            id: 'fallback-track', 
            title: 'System Setup',
            slug: 'system-setup',
            type: 'DSA', 
            description: 'Fallback track',
            order: 0
          }
        } as any); 
      }

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
      console.error("Failed to start duel from DB", err);
      p1.socket.emit('duel:waiting', { message: 'Matchmaking failed. Try again.' });
      p2.socket.emit('duel:waiting', { message: 'Matchmaking failed. Try again.' });
    }
  }

  io.on('connection', (socket: Socket) => {
    
    // 👉 1. RANDOM MATCHMAKING
    socket.on('duel:join', async ({ name }) => {
      if (waitingPlayer && waitingPlayer.socket.id !== socket.id) {
        const p1 = waitingPlayer;
        const p2 = { id: socket.id, name, socket, score: 0 };
        waitingPlayer = null;
        await initializeMatch(p1, p2);
      } else {
        waitingPlayer = { id: socket.id, name, socket, score: 0 };
        socket.emit('duel:waiting', { message: 'Waiting for a worthy opponent...' });
      }
    });

    // 👉 2. CUSTOM ROOM: Create
    socket.on('duel:createCustom', ({ name, questionIds }) => {
      const code = Math.random().toString(36).substring(2, 8).toUpperCase();
      const player = { id: socket.id, name: name || `Player-${socket.id.slice(0, 4)}`, socket, score: 0 };
      
      // 👉 Store the host AND their chosen questions
      customWaitingRooms.set(code, { host: player, customQuestionIds: questionIds });
      socket.emit('duel:customCreated', { roomCode: code });
    });

    // 👉 3. CUSTOM ROOM: Join
    socket.on('duel:joinCustom', async ({ name, roomCode }) => {
      const code = roomCode.trim().toUpperCase();
      const room = customWaitingRooms.get(code);
      
      if (!room) {
        socket.emit('duel:error', { message: 'Invalid or expired room code.' });
        return;
      }
      if (room.host.id === socket.id) return; 
      
      const p2 = { id: socket.id, name: name || `Player-${socket.id.slice(0, 4)}`, socket, score: 0 };
      customWaitingRooms.delete(code); 
      
      // 👉 Pass the host's selected questions to the match initializer
      await initializeMatch(room.host, p2, room.customQuestionIds);
    });

    // 👉 4. GAME LOOP (Handling Answers)
    socket.on('duel:answer', ({ roomId, questionId, answerIndex }) => {
      const state = activeRooms.get(roomId);
      if (!state || state.finished) return;

      const currentQ = state.questions[state.currentQuestionIndex];
      if (currentQ.id !== questionId) return;

      const player = state.players.find(p => p.id === socket.id);
      if (!player) return;

      const isCorrect = currentQ.correctIndex === answerIndex;

      if (isCorrect) {
        player.score += 100;
      } else {
        player.score -= 20; 
      }

      io.to(roomId).emit('duel:feedback', {
        playerName: player.name,
        correct: isCorrect,
        concept: currentQ.track?.title || 'General'
      });

      if (isCorrect) {
        state.currentQuestionIndex++;
        if (state.currentQuestionIndex >= state.questions.length) {
          state.finished = true;
        }
      }

      emitState(roomId);
    });

    // 👉 5. DISCONNECT HANDLING
    socket.on('disconnect', () => {
      if (waitingPlayer?.id === socket.id) {
        waitingPlayer = null; 
      }
      
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