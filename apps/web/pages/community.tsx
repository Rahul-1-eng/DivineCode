import { CSSProperties, useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { io } from 'socket.io-client';
import toast, { Toaster } from 'react-hot-toast';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:4000';

export default function CommunityHubPage() {
  const { data: session } = useSession();
  
  const [posts, setPosts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [newPost, setNewPost] = useState({ title: '', videoUrl: '', description: '' });
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    loadCommunityPosts();

    // 👉 ADDED: Gapless Real-Time Updates
    const socket = io(API_BASE_URL, { transports: ['websocket'] });
    socket.on('new_community_post', (post) => {
      setPosts(prev => [post, ...prev]);
    });
    return () => { socket.disconnect(); };
  }, []);

  const loadCommunityPosts = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE_URL}/api/v2/community/problems`);
      const data = await res.json();
      setPosts(Array.isArray(data) ? data : []);
    } catch (err) {
      toast.error("Failed to load community hub.");
    } finally {
      setLoading(false);
    }
  };

  const handleUploadSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!session?.user?.email) return toast.error("Must be logged in to upload.");
    
    setUploading(true);
    try {
      // 👉 FIXED: Explicit headers passed to fetch profile
      const profileRes = await fetch(`${API_BASE_URL}/api/v2/profile/me`, { 
        headers: { 'x-user-email': session.user.email } 
      });
      const profile = await profileRes.json();
      
      const payload = {
        userId: profile.id,
        title: newPost.title,
        videoUrl: newPost.videoUrl,
        description: newPost.description
      };

      const uploadRes = await fetch(`${API_BASE_URL}/api/v2/community/upload`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-user-email': session.user.email },
        body: JSON.stringify(payload)
      });

      if (!uploadRes.ok) throw new Error("Upload failed on server.");
      
      toast.success("Tutorial Published! Global notification sent.");
      setShowUploadModal(false);
      setNewPost({ title: '', videoUrl: '', description: '' });
    } catch (err: any) {
      toast.error(err.message || "Upload failed.");
    } finally {
      setUploading(false);
    }
  };

  const getYouTubeEmbedUrl = (url: string) => {
    let videoId = '';
    const regex = /(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/i;
    const match = url.match(regex);
    if (match && match[1]) {
      videoId = match[1];
      return `https://www.youtube.com/embed/${videoId}`;
    }
    return url; 
  };

  return (
    <main style={page}>
      <Toaster position="top-center" toastOptions={{ style: { background: '#1e293b', color: '#fff', border: '1px solid #475569' } }} />
      
      <section style={{ maxWidth: 1200, margin: '0 auto' }}>
        <nav style={nav}>
          <a href="/" style={brand}>🌐 DivineCode Community</a>
          <button onClick={() => setShowUploadModal(true)} style={button}>+ Upload Tutorial</button>
        </nav>

        <div style={hero}>
          <p style={eyebrow}>Learn from the Best</p>
          <h1 style={{ fontSize: 'clamp(32px, 5vw, 58px)', margin: '10px 0', color: '#fff' }}>Developer Video Hub.</h1>
          <p style={{ color: '#a8b3c7', maxWidth: 600 }}>Watch algorithms broken down by top competitive programmers in the community, or share your own approaches to earn profile badges.</p>
        </div>

        {loading ? (
          <div style={{ textAlign: 'center', padding: 100, color: '#94a3b8' }}>Loading videos...</div>
        ) : posts.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 100, background: '#0f172a', borderRadius: 24, border: '1px solid #1e293b', color: '#94a3b8' }}>
            No community videos uploaded yet. Be the first!
          </div>
        ) : (
          <div style={grid}>
            {posts.map(post => (
              <div key={post.id} style={card}>
                {post.videoUrl ? (
                  <div style={videoContainer}>
                    <iframe 
                      src={getYouTubeEmbedUrl(post.videoUrl)} 
                      title={post.title}
                      frameBorder="0" 
                      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" 
                      allowFullScreen
                      style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', borderRadius: '16px 16px 0 0' }}
                    />
                  </div>
                ) : (
                  <div style={{ ...videoContainer, background: '#1e293b', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <span style={{ color: '#64748b' }}>No Video Attached</span>
                  </div>
                )}
                
                <div style={{ padding: 20 }}>
                  <h3 style={{ margin: '0 0 4px 0', color: '#eef2ff', fontSize: 18 }}>{post.title}</h3>
                  <div style={{ color: '#38bdf8', fontSize: 12, marginBottom: 8, fontWeight: 'bold' }}>
                    By {post.author?.username || post.author?.name || 'Community'}
                  </div>
                  <p style={{ color: '#94a3b8', fontSize: 14, margin: '0 0 16px 0', lineHeight: 1.5, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                    {post.description}
                  </p>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={tag}>Tutorial</span>
                    <a href={`/practice/${post.id}`} style={ghostBtn}>Open Workspace →</a>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* UPLOAD MODAL */}
      {showUploadModal && (
        <div style={modalOverlay}>
          <div style={modalContent}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <h2 style={{ margin: 0, color: '#fff' }}>Upload Video Tutorial</h2>
              <button onClick={() => setShowUploadModal(false)} style={{ background: 'transparent', border: 'none', color: '#94a3b8', fontSize: 24, cursor: 'pointer' }}>×</button>
            </div>
            
            <p style={{ color: '#94a3b8', fontSize: 14, marginBottom: 24 }}>Upload your YouTube walkthrough. A global notification will immediately be sent to all online users!</p>
            
            <form onSubmit={handleUploadSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div>
                <label style={label}>Tutorial Title</label>
                <input placeholder="e.g. O(N) approach to Kadane's Algorithm" value={newPost.title} onChange={e => setNewPost({...newPost, title: e.target.value})} style={input} required />
              </div>
              
              <div>
                <label style={label}>YouTube Video URL</label>
                <input placeholder="https://youtube.com/watch?v=..." value={newPost.videoUrl} onChange={e => setNewPost({...newPost, videoUrl: e.target.value})} style={input} required />
              </div>

              <div>
                <label style={label}>Description / Problem Statement</label>
                <textarea placeholder="Briefly describe the algorithm you are teaching..." value={newPost.description} onChange={e => setNewPost({...newPost, description: e.target.value})} style={{...input, minHeight: 100}} required />
              </div>

              <div style={{ display: 'flex', gap: 12, marginTop: 10 }}>
                <button type="button" onClick={() => setShowUploadModal(false)} style={{...ghostBtn, flex: 1}}>Cancel</button>
                <button type="submit" disabled={uploading} style={{...button, flex: 2, background: uploading ? '#64748b' : 'linear-gradient(135deg,#a5b4fc,#22d3ee)'}}>
                  {uploading ? 'Publishing...' : 'Publish & Notify Community 🚀'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </main>
  );
}

const page: CSSProperties = { minHeight: '100vh', padding: '4vw', fontFamily: 'Inter, Arial, sans-serif', color: '#eef2ff', background: '#020617', boxSizing: 'border-box' };
const nav: CSSProperties = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 30 };
const brand: CSSProperties = { color: '#eef2ff', textDecoration: 'none', fontWeight: 950, fontSize: 'clamp(20px, 4vw, 28px)' };
const hero: CSSProperties = { padding: 'clamp(30px, 5vw, 60px)', borderRadius: 32, border: '1px solid #1e293b', background: 'radial-gradient(circle at bottom right, rgba(34,211,238,.1), transparent 400px), #0f172a', marginBottom: 40, boxSizing: 'border-box' };
const eyebrow: CSSProperties = { color: '#67e8f9', fontWeight: 900, letterSpacing: '.14em', textTransform: 'uppercase', margin: 0 };
const grid: CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 24 };
const card: CSSProperties = { borderRadius: 16, border: '1px solid #1e293b', background: '#0f172a', overflow: 'hidden', display: 'flex', flexDirection: 'column', transition: 'transform 0.2s', boxShadow: '0 10px 30px rgba(0,0,0,0.3)' };
const videoContainer: CSSProperties = { position: 'relative', width: '100%', paddingTop: '56.25%', background: '#000' };
const tag: CSSProperties = { color: '#020617', background: '#a5b4fc', padding: '4px 10px', borderRadius: 6, fontWeight: 800, fontSize: 12 };
const button: CSSProperties = { padding: '12px 24px', borderRadius: 999, border: 0, background: 'linear-gradient(135deg,#a5b4fc,#22d3ee)', color: '#020617', fontWeight: 900, cursor: 'pointer', fontSize: 15 };
const ghostBtn: CSSProperties = { padding: '8px 16px', borderRadius: 999, border: '1px solid rgba(148,163,184,.3)', background: 'rgba(2,6,23,.5)', color: '#eef2ff', fontWeight: 800, cursor: 'pointer', fontSize: 13, textDecoration: 'none' };
const label: CSSProperties = { display: 'block', color: '#94a3b8', fontSize: 13, fontWeight: 'bold', marginBottom: 6 };
const input: CSSProperties = { width: '100%', padding: 14, borderRadius: 12, background: '#020617', color: '#eef2ff', border: '1px solid #334155', boxSizing: 'border-box', outline: 'none', fontSize: 15, fontFamily: 'inherit' };
const modalOverlay: CSSProperties = { position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(2,6,23,0.85)', backdropFilter: 'blur(8px)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 100, padding: 20 };
const modalContent: CSSProperties = { background: '#0f172a', padding: 32, borderRadius: 24, width: '100%', maxWidth: 550, border: '1px solid rgba(148,163,184,.2)', boxShadow: '0 40px 100px rgba(0,0,0,0.5)' };