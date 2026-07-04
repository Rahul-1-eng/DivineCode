/**
 * @file NotificationBell.tsx
 * @author Rahul Kumar Sahoo
 * @description Reusable UI component for the product experience.
 */

import { useEffect, useState, useRef } from 'react';
import { useSession } from 'next-auth/react';
import { motion, AnimatePresence } from 'framer-motion';
import { useRouter } from 'next/router';
import { io } from 'socket.io-client';
import toast from 'react-hot-toast';
import { fetchApi } from '../lib/api';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:4000';

export default function NotificationBell() {
  const { data: session } = useSession();
  const router = useRouter();
  const [notifications, setNotifications] = useState<any[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) setIsOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const fetchNotifications = async () => {
    if (!session?.user?.email) return;
    try {
      // Use fetchApi to guarantee JWT Authorization headers are attached
      let data = await fetchApi('/api/v2/notifications', {
        headers: { 'x-user-email': session.user.email }
      });
      
      if (data && Array.isArray(data)) {
        const readGlobals = JSON.parse(localStorage.getItem('read_global_notifs') || '[]');
        data = data.map((n: any) => {
          if (n.userId === 'ALL' && readGlobals.includes(n.id)) {
            return { ...n, isRead: true };
          }
          return n;
        });

        setNotifications(data);
        setUnreadCount(data.filter((n: any) => !n.isRead).length);
      }
    } catch (err) {
      console.error("Failed to fetch notifications:", err);
    }
  };

  useEffect(() => {
    fetchNotifications();
    const interval = setInterval(fetchNotifications, 30000);
    
    const socket = io(API_BASE_URL, { transports: ['websocket'] });
    
    if (session?.user?.email) {
       socket.on('connect', () => {
         socket.emit('join-personal-notifications', session.user!.email);
       });
       
       socket.on('new_notification', (newNotif) => {
         setNotifications(prev => [newNotif, ...prev]);
         setUnreadCount(prev => prev + 1);
         toast.success(newNotif.title, { icon: newNotif.type === 'SUCCESS' ? '🏆' : '🔵' });
       });
    }

    return () => {
      clearInterval(interval);
      socket.disconnect();
    };
  }, [session]);

  const markAsRead = async (id: string, link: string | null, userId: string) => {
    try {
      if (userId === 'ALL') {
        const readGlobals = JSON.parse(localStorage.getItem('read_global_notifs') || '[]');
        readGlobals.push(id);
        localStorage.setItem('read_global_notifs', JSON.stringify(readGlobals));
      } else {
        await fetchApi(`/api/v2/notifications/${id}/read`, {
          method: 'PUT',
          headers: { 'x-user-email': session?.user?.email || '' }
        });
      }

      setUnreadCount(prev => Math.max(0, prev - 1));
      setNotifications(prev => prev.map(n => n.id === id ? { ...n, isRead: true } : n));
      setIsOpen(false);
      if (link) router.push(link);
    } catch (err) {}
  };

  const markAllRead = async () => {
    try {
      const globalIds = notifications.filter(n => n.userId === 'ALL' && !n.isRead).map(n => n.id);
      const readGlobals = JSON.parse(localStorage.getItem('read_global_notifs') || '[]');
      localStorage.setItem('read_global_notifs', JSON.stringify([...readGlobals, ...globalIds]));

      await fetchApi(`/api/v2/notifications/read-all`, {
        method: 'PUT',
        headers: { 'x-user-email': session?.user?.email || '' }
      });
      
      setUnreadCount(0);
      setNotifications(prev => prev.map(n => ({ ...n, isRead: true })));
    } catch (err) {}
  };

  if (!session) return null;

  return (
    <div style={{ position: 'relative', display: 'inline-block' }} ref={dropdownRef}>
      <style>{`
        @keyframes bell-pulse {
          0% { box-shadow: 0 0 0 0 rgba(239, 68, 68, 0.7); }
          70% { box-shadow: 0 0 0 10px rgba(239, 68, 68, 0); }
          100% { box-shadow: 0 0 0 0 rgba(239, 68, 68, 0); }
        }
        .has-notifications { animation: bell-pulse 2s infinite; }
      `}</style>
      
      <button 
        onClick={() => setIsOpen(!isOpen)} 
        style={{ background: 'transparent', border: 'none', fontSize: 24, cursor: 'pointer', position: 'relative', padding: 0 }}
      >
        🔔
        {unreadCount > 0 && (
          <span className="has-notifications" style={{ position: 'absolute', top: -5, right: -5, background: '#ef4444', color: '#fff', fontSize: 11, fontWeight: 'bold', width: 18, height: 18, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '2px solid var(--bg-panel)' }}>
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      <AnimatePresence>
        {isOpen && (
          <motion.div 
            initial={{ opacity: 0, y: 10, scale: 0.95 }} 
            animate={{ opacity: 1, y: 0, scale: 1 }} 
            exit={{ opacity: 0, y: 10, scale: 0.95 }}
            style={{ position: 'absolute', top: 45, right: 0, width: 320, background: 'var(--bg-panel)', backdropFilter: 'blur(10px)', border: '1px solid var(--border-color)', borderRadius: 12, boxShadow: '0 20px 40px rgba(0,0,0,0.2)', overflow: 'hidden', zIndex: 999 }}
          >
            <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--bg-panel-solid)' }}>
              <strong style={{ color: 'var(--text-main)' }}>Notifications</strong>
              {unreadCount > 0 && (
                <button onClick={markAllRead} style={{ background: 'transparent', border: 'none', color: 'var(--accent-primary)', fontSize: 12, cursor: 'pointer', fontWeight: 'bold' }}>Mark all read</button>
              )}
            </div>
            
            <div style={{ maxHeight: 350, overflowY: 'auto', background: 'var(--bg-panel)' }}>
              {notifications.length === 0 ? (
                <div style={{ padding: 30, textAlign: 'center', color: 'var(--text-muted)', fontSize: 14 }}>You're all caught up!</div>
              ) : (
                notifications.map(notif => (
                  <div 
                    key={notif.id} 
                    onClick={() => markAsRead(notif.id, notif.link, notif.userId)}
                    style={{ padding: '12px 16px', borderBottom: '1px solid var(--border-color)', cursor: 'pointer', background: notif.isRead ? 'transparent' : 'var(--accent-glow)', display: 'flex', gap: 12, alignItems: 'flex-start', transition: '0.2s' }}
                    onMouseEnter={(e) => e.currentTarget.style.background = 'var(--table-hover)'}
                    onMouseLeave={(e) => e.currentTarget.style.background = notif.isRead ? 'transparent' : 'var(--accent-glow)'}
                  >
                    <div style={{ fontSize: 20 }}>
                      {notif.type === 'SUCCESS' ? '🏆' : notif.type === 'WARNING' ? '⚠️' : '🔵'}
                    </div>
                    <div>
                      <div style={{ color: notif.isRead ? 'var(--text-muted)' : 'var(--text-main)', fontWeight: notif.isRead ? 400 : 600, fontSize: 14, marginBottom: 4 }}>{notif.title}</div>
                      <div style={{ color: 'var(--text-muted)', fontSize: 13, lineHeight: 1.4 }}>{notif.message}</div>
                      <div style={{ color: 'var(--text-muted)', opacity: 0.8, fontSize: 11, marginTop: 6 }}>{new Date(notif.createdAt).toLocaleDateString()}</div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}