import { Server, Socket } from 'socket.io';

export function setupContestSockets(io: Server) {
  io.on('connection', (socket: Socket) => {
    
    // 1. User enters the contest room
    socket.on('joinContest', (contestId: string) => {
      socket.join(contestId);
      console.log(`User ${socket.id} joined contest room: ${contestId}`);
    });

    // 2. User sends a message in the team chat
    socket.on('sendChatMessage', (data: { contestId: string, team: string, message: any }) => {
      // Broadcast the message to everyone ELSE in that specific contest room
      socket.to(data.contestId).emit('chatMessage', data.message);
    });

    // 3. (Optional) Leave room on disconnect if needed
    socket.on('disconnect', () => {
      // Socket.io handles leaving rooms automatically on disconnect, 
      // but you can add cleanup logic here if needed.
    });
  });
}