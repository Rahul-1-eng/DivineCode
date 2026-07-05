/**
 * @file liveRoutes.ts
 * @author Rahul
 * @description DivineLive — community live rooms. A user goes live (camera on),
 * others drop in to watch or hop on video and discuss contest problems face to
 * face. Media runs peer-to-peer over the branded Jitsi room; these routes only
 * own the lifecycle and discovery.
 */

import { Router } from 'express';
import { prisma } from '../prisma/client';
import { resolvedViewerFromRequest } from '../modules/contests/contestRules';

export const liveRouter = Router();

// Public by design — anyone on the platform can join a community stream, so
// the room name only needs to be stable, not secret.
export function liveJitsiRoom(roomId: string): string {
  return `DivineCodeLive-${roomId}`;
}

// Directory: everything currently LIVE, newest first, plus the viewer's own
// active room so the UI can offer "return to your stream" instead of a dead
// Go Live button.
liveRouter.get('/rooms', async (req, res) => {
  try {
    const viewer = await resolvedViewerFromRequest(req, true);
    if (!viewer.email) return res.status(401).json({ error: 'Unauthorized' });

    const rooms = await prisma.liveRoom.findMany({
      where: { status: 'LIVE' },
      include: {
        host: { select: { username: true, name: true, avatarUrl: true, rating: true } },
        contest: { select: { id: true, title: true } }
      },
      orderBy: { startedAt: 'desc' },
      take: 50
    });

    const user = await prisma.user.findUnique({ where: { email: viewer.email }, select: { id: true } });
    const myRoom = user ? rooms.find(r => r.hostId === user.id) || null : null;

    res.json({ success: true, rooms, myRoomId: myRoom?.id || null });
  } catch (err: any) {
    console.error('[Live Rooms Error]', err);
    res.status(500).json({ error: 'Failed to load live rooms.' });
  }
});

// Single room for the watch page. ENDED rooms still resolve so latecomers get
// a proper "stream has ended" screen instead of a 404.
liveRouter.get('/rooms/:id', async (req, res) => {
  try {
    const viewer = await resolvedViewerFromRequest(req, true);
    if (!viewer.email) return res.status(401).json({ error: 'Unauthorized' });

    const room = await prisma.liveRoom.findUnique({
      where: { id: req.params.id },
      include: {
        host: { select: { username: true, name: true, avatarUrl: true, rating: true } },
        contest: { select: { id: true, title: true } }
      }
    });
    if (!room) return res.status(404).json({ error: 'Live room not found.' });

    const user = await prisma.user.findUnique({ where: { email: viewer.email }, select: { id: true, name: true, username: true, role: true } });

    res.json({
      success: true,
      room,
      jitsiRoom: liveJitsiRoom(room.id),
      displayName: user?.name || user?.username || 'Guest',
      isHost: !!user && room.hostId === user.id,
      isAdmin: user?.role === 'ADMIN'
    });
  } catch (err: any) {
    console.error('[Live Room Fetch Error]', err);
    res.status(500).json({ error: 'Failed to open the live room.' });
  }
});

// Go live. One active stream per host — starting a new one auto-ends the old,
// so a crashed tab never leaves a ghost room squatting in the directory.
liveRouter.post('/rooms', async (req, res) => {
  try {
    const viewer = await resolvedViewerFromRequest(req, true);
    if (!viewer.email) return res.status(401).json({ error: 'Unauthorized' });

    const user = await prisma.user.findUnique({ where: { email: viewer.email } });
    if (!user) return res.status(404).json({ error: 'User not found' });

    const { title, topic, contestId } = req.body || {};
    if (!title || !String(title).trim()) {
      return res.status(400).json({ error: 'Give your stream a title.' });
    }

    if (contestId) {
      const contest = await prisma.contest.findUnique({ where: { id: String(contestId) }, select: { id: true } });
      if (!contest) return res.status(400).json({ error: 'That contest does not exist.' });
    }

    await prisma.liveRoom.updateMany({
      where: { hostId: user.id, status: 'LIVE' },
      data: { status: 'ENDED', endedAt: new Date() }
    });

    const room = await prisma.liveRoom.create({
      data: {
        title: String(title).trim().substring(0, 140),
        topic: topic ? String(topic).trim().substring(0, 1000) : null,
        hostId: user.id,
        contestId: contestId ? String(contestId) : null
      },
      include: {
        host: { select: { username: true, name: true, avatarUrl: true, rating: true } },
        contest: { select: { id: true, title: true } }
      }
    });

    // Same broadcast pattern as community uploads — bell notification + ticker
    // + a live event so open community pages update without a refresh.
    const notification = await prisma.notification.create({
      data: {
        userId: 'ALL',
        title: '🔴 LIVE on DivineCode',
        message: `${user.name || user.username} is live: ${room.title}`,
        link: `/live/${room.id}`,
        type: 'INFO',
        isRead: false
      }
    });

    const io = req.app.get('io');
    if (io) {
      io.emit('new_notification', notification);
      io.emit('live_room_started', room);
      io.emit('global_ticker', `🔴 ${user.username || user.name} just went LIVE: ${room.title}`);
    }

    res.status(201).json({ success: true, room });
  } catch (err: any) {
    console.error('[Live Room Create Error]', err);
    res.status(500).json({ error: 'Failed to start the live room.' });
  }
});

// End a stream — host's own permit, or admin moderation.
liveRouter.post('/rooms/:id/end', async (req, res) => {
  try {
    const viewer = await resolvedViewerFromRequest(req, true);
    if (!viewer.email) return res.status(401).json({ error: 'Unauthorized' });

    const user = await prisma.user.findUnique({ where: { email: viewer.email } });
    if (!user) return res.status(404).json({ error: 'User not found' });

    const room = await prisma.liveRoom.findUnique({ where: { id: req.params.id } });
    if (!room) return res.status(404).json({ error: 'Live room not found.' });
    if (room.hostId !== user.id && user.role !== 'ADMIN') {
      return res.status(403).json({ error: 'Only the host or an admin can end this stream.' });
    }
    if (room.status === 'ENDED') {
      return res.json({ success: true, room });
    }

    const ended = await prisma.liveRoom.update({
      where: { id: room.id },
      data: { status: 'ENDED', endedAt: new Date() }
    });

    const io = req.app.get('io');
    if (io) io.emit('live_room_ended', { id: room.id });

    res.json({ success: true, room: ended });
  } catch (err: any) {
    console.error('[Live Room End Error]', err);
    res.status(500).json({ error: 'Failed to end the live room.' });
  }
});
