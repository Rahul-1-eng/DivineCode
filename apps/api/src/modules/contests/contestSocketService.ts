import { Server, Socket } from 'socket.io';
import { prisma } from '../../prisma/client';

export function setupContestSockets(io: Server) {
  io.on('connection', (socket: Socket) => {
    
    // Global contest room for standings/live updates
    socket.on('joinContest', (contestId: string) => {
      socket.join(`contest:${contestId}`);
    });

    // STRICT PRIVATE TEAM ROOM (For Chat, Voice, and Live Code)
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

    // 👉 ADDED: Live Collaborative Editor Synchronization
    socket.on('sync_code', (data: { teamId: string, code: string, senderId: string }) => {
      // Broadcast to everyone in the team EXCEPT the sender
      socket.to(`team:${data.teamId}`).emit('code_updated', {
        code: data.code,
        senderId: data.senderId
      });
    });

    // Notify team of a teammate's success
    socket.on('broadcastTeamSolve', (data: { teamId: string, solverName: string, problemLabel: string }) => {
      io.to(`team:${data.teamId}`).emit('team_problem_solved', {
        userId: data.solverName,
        message: `${data.solverName} just solved Problem ${data.problemLabel}!`
      });
    });

    // WebRTC Signaling Relay
    socket.on('join-voice', (teamId) => {
      socket.join(`voice:${teamId}`);
      // Tell everyone currently in the room that a new peer wants to connect
      socket.to(`voice:${teamId}`).emit('user-joined-voice', socket.id);
    });

    // Relay P2P WebRTC Handshakes strictly to the target socket
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