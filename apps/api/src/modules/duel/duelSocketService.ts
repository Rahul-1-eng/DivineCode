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
  const activeRooms = new Map<string, DuelState>();

  // Helper to safely emit state without circular JSON issues
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

  io.on('connection', (socket: Socket) => {
    
    // 1. MATCHMAKING (Now Async for DB fetching)
    socket.on('duel:join', async ({ name }) => {
      // If someone is already waiting, pair them up
      if (waitingPlayer && waitingPlayer.socket.id !== socket.id) {
        const p1 = waitingPlayer;
        const p2 = { id: socket.id, name, socket, score: 0 };
        waitingPlayer = null; // Clear the queue

        const roomId = `duel_${Date.now()}`;
        p1.socket.join(roomId);
        p2.socket.join(roomId);

        try {
          // 👉 PULL DYNAMICALLY FROM THE DATABASE
          const dbQuestions = await prisma.interviewQuestion.findMany({
            where: { isApproved: true },
            include: { track: true }
          });

          // Shuffle and pick 5 random questions for the duel
          const selectedQuestions = dbQuestions
            .sort(() => 0.5 - Math.random())
            .slice(0, 5);

         // Fallback if DB is completely empty (safety net during initial deploy)
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
            } as any); // <-- Add "as any" right here
          }

          // Initialize game state
          const state: DuelState = {
            roomId,
            players: [p1, p2],
            questions: selectedQuestions,
            currentQuestionIndex: 0,
            finished: false,
          };
          activeRooms.set(roomId, state);

          // Notify both players that the match has started
          io.to(roomId).emit('duel:start', { 
            roomId, 
            players: [{ id: p1.id, name: p1.name, score: 0 }, { id: p2.id, name: p2.name, score: 0 }] 
          });
          
          // Push the first question
          emitState(roomId);
        } catch (err) {
          console.error("Failed to start duel from DB", err);
          p1.socket.emit('duel:waiting', { message: 'Matchmaking failed. Try again.' });
          p2.socket.emit('duel:waiting', { message: 'Matchmaking failed. Try again.' });
        }
      } else {
        // No one is waiting, put this user in the queue
        waitingPlayer = { id: socket.id, name, socket, score: 0 };
        socket.emit('duel:waiting', { message: 'Waiting for a worthy opponent...' });
      }
    });

    // 2. GAME LOOP (Handling Answers)
    socket.on('duel:answer', ({ roomId, questionId, answerIndex }) => {
      const state = activeRooms.get(roomId);
      if (!state || state.finished) return;

      const currentQ = state.questions[state.currentQuestionIndex];
      if (currentQ.id !== questionId) return; // Ignore stale answers from previous questions

      const player = state.players.find(p => p.id === socket.id);
      if (!player) return;

      const isCorrect = currentQ.correctIndex === answerIndex;

      if (isCorrect) {
        player.score += 100; // Reward
      } else {
        player.score -= 20;  // Penalty
      }

      // Broadcast feedback so the UI shows who answered what
      io.to(roomId).emit('duel:feedback', {
        playerName: player.name,
        correct: isCorrect,
        concept: currentQ.track?.title || 'General'
      });

      // If correct, instantly move to the next question
      if (isCorrect) {
        state.currentQuestionIndex++;
        
        if (state.currentQuestionIndex >= state.questions.length) {
          state.finished = true;
          // Note: To make duels rated, you would trigger the rating engine here!
        }
      }

      // Push updated scores and/or the next question
      emitState(roomId);
    });

    // 3. DISCONNECT HANDLING
    socket.on('disconnect', () => {
      if (waitingPlayer?.id === socket.id) {
        waitingPlayer = null; 
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