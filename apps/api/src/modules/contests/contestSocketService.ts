import { Server, Socket } from 'socket.io';
import { prisma } from '../../prisma/client';

export function setupContestSockets(io: Server) {
  io.on('connection', (socket: Socket) => {
    
    // Global contest room for standings/live updates
    socket.on('joinContest', (contestId: string) => {
      socket.join(`contest:${contestId}`);
    });

    // STRICT PRIVATE TEAM ROOM (For Chat + Voice)
    socket.on('joinTeam', (teamId: string) => {
      socket.join(`team:${teamId}`);
    });

    // Team Chat Routing
    socket.on('sendTeamMessage', async (data: { contestId: string, teamId: string, senderId: string, content: string }) => {
      try {
        const message = await prisma.teamMessage.create({
          data: {
            contestId: data.contestId,
            teamId: data.teamId,
            senderId: data.senderId,
            content: data.content
          },
          include: { sender: { select: { id: true, username: true, avatarUrl: true } } }
        });
        
        io.to(`team:${data.teamId}`).emit('teamMessage', message);
      } catch (err) {
        console.error('[Socket] Failed to route team message', err);
      }
    });

    // Notify team of a teammate's success
    socket.on('broadcastTeamSolve', (data: { teamId: string, solverName: string, problemLabel: string }) => {
      io.to(`team:${data.teamId}`).emit('team_problem_solved', {
        userId: data.solverName,
        message: `${data.solverName} just solved Problem ${data.problemLabel}!`
      });
    });

    // WebRTC Signaling
    socket.on('join-voice', (teamId) => {
      socket.join(`voice:${teamId}`);
      socket.to(`voice:${teamId}`).emit('user-joined-voice', socket.id);
    });

    socket.on('voice-offer', ({ to, offer }) => { io.to(to).emit('voice-offer', { from: socket.id, offer }); });
    socket.on('voice-answer', ({ to, answer }) => { io.to(to).emit('voice-answer', { from: socket.id, answer }); });
    socket.on('voice-ice-candidate', ({ to, candidate }) => { io.to(to).emit('voice-ice-candidate', { from: socket.id, candidate }); });
    socket.on('leave-voice', (teamId) => {
      socket.leave(`voice:${teamId}`);
      socket.to(`voice:${teamId}`).emit('user-left-voice', socket.id);
    });

    socket.on('disconnect', () => {});
  });
}