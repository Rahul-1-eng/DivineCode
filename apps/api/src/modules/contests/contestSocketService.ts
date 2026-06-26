import { Server, Socket } from 'socket.io';
import { prisma } from '../../prisma/client';

export function setupContestSockets(io: Server) {
  io.on('connection', (socket: Socket) => {
    
    socket.on('joinContest', (contestId: string) => {
      socket.join(`contest:${contestId}`);
    });

    socket.on('joinTeam', (roomId: string) => {
      socket.join(`chatRoom:${roomId}`);
    });

    socket.on('sendTeamMessage', async (data: { contestId: string, teamId: string, senderId: string, content: string }) => {
      try {
        const roomTarget = data.teamId ? `chatRoom:${data.teamId}` : `chatRoom:contest_global_${data.contestId}`;
        
        if (data.teamId) {
           // 👉 FIX: If senderId is an email, find the actual User UUID so Prisma doesn't crash!
           let finalSenderId = data.senderId;
           if (finalSenderId.includes('@')) {
             const user = await prisma.user.findUnique({ where: { email: finalSenderId } });
             if (user) finalSenderId = user.id;
           }

           const message = await prisma.teamMessage.create({
             data: {
               contestId: data.contestId,
               teamId: data.teamId,
               senderId: finalSenderId, // Now safely a UUID
               content: data.content
             },
             include: { sender: { select: { id: true, username: true, avatarUrl: true, name: true } } }
           });
           io.to(roomTarget).emit('teamMessage', message);
        } else {
           // Global chat for solos (Not saved to DB, just ephemeral)
           io.to(roomTarget).emit('teamMessage', { 
             id: Date.now().toString(), 
             content: data.content, 
             sender: { username: data.senderId },
             createdAt: new Date() 
           });
        }
      } catch (err) {
        console.error('[Socket] Failed to route team message:', err);
      }
    });

    socket.on('sync_code', (data: { teamId: string, code: string, senderId: string }) => {
      if (data.teamId) {
        socket.to(`chatRoom:${data.teamId}`).emit('code_updated', {
          code: data.code,
          senderId: data.senderId
        });
      }
    });

   socket.on('broadcastTeamSolve', (data: { teamId: string, solverId: string, solverName: string, problemLabel: string }) => {
  if (data.teamId) {
    io.to(`chatRoom:${data.teamId}`).emit('team_problem_solved', {
      // ✅ FIXED: Send unique solverId for logic, solverName for display
      solverId: data.solverId,
      solverName: data.solverName,
      message: `${data.solverName} just solved Problem ${data.problemLabel}!`
    });
  }
});

    // --- WebRTC Voice Signaling ---
    socket.on('join-voice', (roomId) => {
      socket.join(`voice:${roomId}`);
      socket.to(`voice:${roomId}`).emit('user-joined-voice', socket.id);
    });

    socket.on('voice-offer', ({ to, offer }) => { io.to(to).emit('voice-offer', { from: socket.id, offer }); });
    socket.on('voice-answer', ({ to, answer }) => { io.to(to).emit('voice-answer', { from: socket.id, answer }); });
    socket.on('voice-ice-candidate', ({ to, candidate }) => { io.to(to).emit('voice-ice-candidate', { from: socket.id, candidate }); });
    
    socket.on('leave-voice', (roomId) => {
      socket.leave(`voice:${roomId}`);
      socket.to(`voice:${roomId}`).emit('user-left-voice', socket.id);
    });

    socket.on('disconnect', () => {});
  });
}