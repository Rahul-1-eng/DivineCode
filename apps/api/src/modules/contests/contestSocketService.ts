import { Server, Socket } from 'socket.io';
import { prisma } from '../../prisma/client';

export function setupContestSockets(io: Server) {
  io.on('connection', (socket: Socket) => {
    
    socket.on('joinContest', (contestId: string) => {
      socket.join(`contest:${contestId}`);
    });

    // Fallback logic: If teamId is empty, they join the Global Contest chat room instead.
    socket.on('joinTeam', (roomId: string) => {
      socket.join(`chatRoom:${roomId}`);
    });

    socket.on('sendTeamMessage', async (data) => {
      try {
        const roomTarget = data.teamId ? `chatRoom:${data.teamId}` : `chatRoom:contest_global_${data.contestId}`;
        
        if (data.teamId) {
           const message = await prisma.teamMessage.create({
             data: { contestId: data.contestId, teamId: data.teamId, senderId: data.senderId, content: data.content },
             include: { sender: { select: { id: true, username: true, avatarUrl: true } } }
           });
           io.to(roomTarget).emit('teamMessage', message);
        } else {
           io.to(roomTarget).emit('teamMessage', { id: Date.now().toString(), content: data.content, sender: { username: data.senderId }, createdAt: new Date() });
        }
      } catch (err) { console.error('[Socket] Failed to route team message', err); }
    });

    socket.on('sync_code', (data: { teamId: string, code: string, senderId: string }) => {
      if (data.teamId) {
        socket.to(`chatRoom:${data.teamId}`).emit('code_updated', {
          code: data.code,
          senderId: data.senderId
        });
      }
    });

    socket.on('broadcastTeamSolve', (data: { teamId: string, solverName: string, problemLabel: string }) => {
      if (data.teamId) {
        io.to(`chatRoom:${data.teamId}`).emit('team_problem_solved', {
          userId: data.solverName,
          message: `${data.solverName} just solved Problem ${data.problemLabel}!`
        });
      }
    });

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