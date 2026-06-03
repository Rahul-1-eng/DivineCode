import { Server, Socket } from 'socket.io';

export function setupContestSockets(io: Server) {
  io.on('connection', (socket: Socket) => {
    
    // 1. User enters the contest room
    socket.on('joinContest', (contestId: string) => {
      socket.join(contestId);
      // Ensure they also subscribe to the system-level updates for standings
      socket.join(`contest:${contestId}`);
      console.log(`[Socket] Client ${socket.id} joined contest room: ${contestId}`);
    });

    // 2. User tracks a SPECIFIC submission (Crucial for Live Code Execution View)
    socket.on('trackSubmission', (submissionId: string) => {
      socket.join(`submission:${submissionId}`);
      console.log(`[Socket] Client ${socket.id} listening for submission: ${submissionId}`);
    });

    // 3. User sends a message in the team chat
    socket.on('sendChatMessage', (data: { contestId: string, team: string, message: any }) => {
      // Broadcast the message to everyone ELSE in that specific contest room
      socket.to(data.contestId).emit('chatMessage', data.message);
    });

    // 4. Leave rooms dynamically (prevent memory leaks)
    socket.on('leaveSubmission', (submissionId: string) => {
      socket.leave(`submission:${submissionId}`);
    });

    socket.on('disconnect', () => {
       // Socket.io automatically cleans up room memberships on disconnect.
    });
  });
}