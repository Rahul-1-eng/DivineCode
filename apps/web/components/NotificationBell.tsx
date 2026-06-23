import { useEffect, useState, useRef } from 'react';
import { useSession } from 'next-auth/react';
import { motion, AnimatePresence } from 'framer-motion';
import { useRouter } from 'next/router';
import { io } from 'socket.io-client';
import toast from 'react-hot-toast';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:4000';
// Example usage in a component
const socket = io(process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:4000');
export default function NotificationBell() {
  const { data: session } = useSession();
  const router = useRouter();
  const [notifications, setNotifications] = useState<any[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown if clicked outside
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
      const res = await fetch(`${API_BASE_URL}/api/v2/notifications`, {
        headers: { 'x-user-email': session.user.email }
      });
      if (res.ok) {
        const data = await res.json();
        setNotifications(data);
        setUnreadCount(data.filter((n: any) => !n.isRead).length);
      }
    } catch (err) {}
  };

  // Poll every 30 seconds
useEffect(() => {
    fetchNotifications();
    const interval = setInterval(fetchNotifications, 30000);
    
    // Connect to the socket for real-time updates
    const socket = io(API_BASE_URL, { transports: ['websocket'] });
    
    if (session?.user?.email) {
       socket.on('connect', () => {
         socket.emit('join-personal-notifications', session.user!.email);
       });
       
       socket.on('new_notification', (newNotif) => {
         setNotifications(prev => [newNotif, ...prev]);
         setUnreadCount(prev => prev + 1);
         toast.success(newNotif.title); // Pop a toast on screen
       });
    }

    return () => {
      clearInterval(interval);
      socket.disconnect();
    };
  }, [session]);

  const markAsRead = async (id: string, link: string | null) => {
    try {
      await fetch(`${API_BASE_URL}/api/v2/notifications/${id}/read`, {
        method: 'PUT',
        headers: { 'x-user-email': session?.user?.email || '' }
      });
      setUnreadCount(prev => Math.max(0, prev - 1));
      setNotifications(prev => prev.map(n => n.id === id ? { ...n, isRead: true } : n));
      setIsOpen(false);
      if (link) router.push(link);
    } catch (err) {}
  };

  const markAllRead = async () => {
    try {
      await fetch(`${API_BASE_URL}/api/v2/notifications/read-all`, {
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
      <button 
        onClick={() => setIsOpen(!isOpen)} 
        style={{ background: 'transparent', border: 'none', fontSize: 24, cursor: 'pointer', position: 'relative', padding: 0 }}
      >
        🔔
        {unreadCount > 0 && (
          <span style={{ position: 'absolute', top: -5, right: -5, background: '#ef4444', color: '#fff', fontSize: 11, fontWeight: 'bold', width: 18, height: 18, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '2px solid #0f172a' }}>
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
            style={{ position: 'absolute', top: 45, right: 0, width: 320, background: '#0f172a', border: '1px solid #1e293b', borderRadius: 12, boxShadow: '0 20px 40px rgba(0,0,0,0.5)', overflow: 'hidden', zIndex: 999 }}
          >
            <div style={{ padding: '12px 16px', borderBottom: '1px solid #1e293b', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(2, 6, 23, 0.5)' }}>
              <strong style={{ color: '#eef2ff' }}>Notifications</strong>
              {unreadCount > 0 && (
                <button onClick={markAllRead} style={{ background: 'transparent', border: 'none', color: '#38bdf8', fontSize: 12, cursor: 'pointer' }}>Mark all read</button>
              )}
            </div>
            
            <div style={{ maxHeight: 350, overflowY: 'auto' }}>
              {notifications.length === 0 ? (
                <div style={{ padding: 30, textAlign: 'center', color: '#64748b', fontSize: 14 }}>You're all caught up!</div>
              ) : (
                notifications.map(notif => (
                  <div 
                    key={notif.id} 
                    onClick={() => markAsRead(notif.id, notif.link)}
                    style={{ padding: '12px 16px', borderBottom: '1px solid #1e293b', cursor: 'pointer', background: notif.isRead ? 'transparent' : 'rgba(56, 189, 248, 0.05)', display: 'flex', gap: 12, alignItems: 'flex-start', transition: '0.2s' }}
                    onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(30, 41, 59, 0.8)'}
                    onMouseLeave={(e) => e.currentTarget.style.background = notif.isRead ? 'transparent' : 'rgba(56, 189, 248, 0.05)'}
                  >
                    <div style={{ fontSize: 20 }}>
                      {notif.type === 'SUCCESS' ? '🏆' : notif.type === 'WARNING' ? '⚠️' : '🔵'}
                    </div>
                    <div>
                      <div style={{ color: notif.isRead ? '#94a3b8' : '#eef2ff', fontWeight: notif.isRead ? 400 : 600, fontSize: 14, marginBottom: 4 }}>{notif.title}</div>
                      <div style={{ color: '#64748b', fontSize: 13, lineHeight: 1.4 }}>{notif.message}</div>
                      <div style={{ color: '#475569', fontSize: 11, marginTop: 6 }}>{new Date(notif.createdAt).toLocaleDateString()}</div>
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