import { Server, Socket } from 'socket.io';
import { prisma } from '../../prisma/client';

export function setupContestSockets(io: Server) {
  io.on('connection', (socket: Socket) => {
    
    // 1. User enters the GLOBAL contest room (for Leaderboard/Standings updates)
    socket.on('joinContest', (contestId: string) => {
      socket.join(`contest:${contestId}`);
      console.log(`[Socket] Client ${socket.id} joined contest room: contest:${contestId}`);
    });

    // 2. User enters their STRICT, PRIVATE team room (for Chat and AC Sync)
    socket.on('joinTeam', (teamId: string) => {
      socket.join(`team:${teamId}`);
      console.log(`[Socket] Client ${socket.id} joined team room: team:${teamId}`);
    });

    // 3. User tracks a SPECIFIC submission (Crucial for Live Code Execution View)
    socket.on('trackSubmission', (submissionId: string) => {
      socket.join(`submission:${submissionId}`);
    });

    // 4. Secure Team Chat Routing & Persistence
    socket.on('sendTeamMessage', async (data: { contestId: string, teamId: string, senderId: string, content: string }) => {
      try {
        // Save the message to the database for historical persistence
        const message = await prisma.teamMessage.create({
          data: {
            contestId: data.contestId,
            teamId: data.teamId,
            senderId: data.senderId,
            content: data.content
          },
          include: { sender: { select: { id: true, username: true, avatarUrl: true } } }
        });
        
        // Broadcast STRICTLY to the private team room (No one else can intercept this)
        io.to(`team:${data.teamId}`).emit('teamMessage', message);
      } catch (err) {
        console.error('[Socket] Failed to route team message', err);
      }
    });

    // 5. Leave rooms dynamically (prevent memory leaks)
    socket.on('leaveSubmission', (submissionId: string) => {
      socket.leave(`submission:${submissionId}`);
    });

    socket.on('disconnect', () => {
       // Socket.io automatically cleans up room memberships on disconnect.
    });
  });
}