import { CSSProperties, useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { io } from 'socket.io-client';
import toast, { Toaster } from 'react-hot-toast';
import ReactMarkdown from 'react-markdown'; 
import { fetchApi } from '../lib/api';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:4000';

export default function CommunityHubPage() {
  const { data: session } = useSession();
  
  const [posts, setPosts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [uploading, setUploading] = useState(false);
  
  const [formData, setFormData] = useState({ id: '', title: '', videoUrl: '', description: '' });
  const [isEditing, setIsEditing] = useState(false);

  useEffect(() => {
    loadCommunityPosts();

    const socket = io(API_BASE_URL, { transports: ['websocket'] });
    
    socket.on('new_community_post', (post) => {
      setPosts(prev => {
        if (prev.find(p => p.id === post.id)) {
            return prev.map(p => p.id === post.id ? post : p);
        }
        return [post, ...prev]; 
      });
    });
    
    socket.on('post_deleted', ({ id }) => {
      setPosts(prev => prev.filter(p => p.id !== id));
    });

    return () => { socket.disconnect(); };
  }, []);

  const loadCommunityPosts = async () => {
    setLoading(true);
    try {
      const data = await fetchApi('/api/v2/community/problems', { requireAuth: false });
      setPosts(Array.isArray(data) ? data : []);
    } catch (err: any) {
      console.error("[Community Hub]: Fetch error:", err);
      toast.error("Failed to load community hub: " + err.message);
    } finally {
      setLoading(false);
    }
  };

  const openUploadModal = () => {
      setIsEditing(false);
      setFormData({ id: '', title: '', videoUrl: '', description: '' });
      setShowUploadModal(true);
  };

  const openEditModal = (post: any) => {
      setIsEditing(true);
      setFormData({ id: post.id, title: post.title, videoUrl: post.videoUrl || '', description: post.description });
      setShowUploadModal(true);
  };

  const handleFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!session?.user?.email) return toast.error("Must be logged in to modify posts.");
    
    setUploading(true);
    try {
      const payload = {
        title: formData.title,
        videoUrl: formData.videoUrl,
        description: formData.description
      };

      const url = isEditing 
        ? `/api/v2/community/problems/${formData.id}` 
        : `/api/v2/community/upload`;
        
      const method = isEditing ? 'PUT' : 'POST';

      const data = await fetchApi(url, {
        method,
        body: JSON.stringify(payload)
      });

      toast.success(isEditing ? "Tutorial Updated!" : "Tutorial Published!");
      setShowUploadModal(false);
    } catch (err: any) {
      toast.error(err.message || "Action failed.");
    } finally {
      setUploading(false);
    }
  };

  const handleDeletePost = async (postId: string) => {
    if (!confirm("Are you sure you want to delete this tutorial? This cannot be undone.")) return;
    if (!session?.user?.email) return;

    try {
      await fetchApi(`/api/v2/community/problems/${postId}`, {
        method: 'DELETE'
      });
      
      toast.success("Tutorial deleted.");
    } catch (err: any) {
      toast.error(err.message || "Failed to delete post.");
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
      <Toaster position="top-center" toastOptions={{ style: { background: 'var(--bg-panel-solid)', color: 'var(--text-main)', border: '1px solid var(--border-color)' } }} />
      
      <section style={{ maxWidth: 1200, margin: '0 auto' }}>
       <nav style={nav}>
          <a href="/" style={brand}>
            <img src="/logo.png" alt="DivineCode Logo" style={{ width: 32, height: 32, objectFit: 'contain' }} />
            Community Hub
          </a>
          <button onClick={openUploadModal} style={button}>+ Upload Tutorial</button>
        </nav>

        <div style={hero}>
          <p style={eyebrow}>Learn from the Best</p>
          <h1 style={{ fontSize: 'clamp(32px, 5vw, 58px)', margin: '10px 0', color: 'var(--text-main)' }}>Developer Video Hub.</h1>
          <p style={{ color: 'var(--text-muted)', maxWidth: 600 }}>Watch algorithms broken down by top competitive programmers in the community, or share your own approaches to earn profile badges.</p>
        </div>

        {loading ? (
          <div style={{ textAlign: 'center', padding: 100, color: 'var(--text-muted)' }}>Loading videos...</div>
        ) : posts.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 100, background: 'var(--bg-panel)', borderRadius: 24, border: '1px solid var(--border-color)', color: 'var(--text-muted)' }}>
            No community videos uploaded yet. Be the first!
          </div>
        ) : (
          <div style={grid}>
            {posts.map(post => {
              const isAuthor = session?.user?.email && post.author?.email && session.user.email === post.author.email;
              return (
                <div key={post.id} style={{ ...card, position: 'relative' }}>
                  
                  {isAuthor && (
                    <div style={{ position: 'absolute', top: 10, right: 10, zIndex: 10, display: 'flex', gap: 8 }}>
                      <button 
                        onClick={() => openEditModal(post)}
                        style={{ background: 'var(--bg-panel-solid)', border: '1px solid var(--accent-primary)', color: 'var(--accent-primary)', padding: '6px 10px', borderRadius: '8px', cursor: 'pointer', opacity: 0.9 }}
                      >
                        ✏️ Edit
                      </button>
                      <button 
                        onClick={() => handleDeletePost(post.id)}
                        style={{ background: 'var(--bg-panel-solid)', border: '1px solid rgba(248, 113, 113, 0.5)', color: '#f87171', padding: '6px 10px', borderRadius: '8px', cursor: 'pointer', opacity: 0.9 }}
                      >
                        🗑️ Delete
                      </button>
                    </div>
                  )}
                  
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
                    <div style={{ ...videoContainer, background: 'var(--bg-card)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <span style={{ color: 'var(--text-muted)' }}>No Video Attached</span>
                    </div>
                  )}
                  
                  <div style={{ padding: 20, flex: 1, display: 'flex', flexDirection: 'column' }}>
                    <h3 style={{ margin: '0 0 4px 0', color: 'var(--text-main)', fontSize: 18 }}>{post.title}</h3>
                    <div style={{ color: 'var(--accent-primary)', fontSize: 12, marginBottom: 8, fontWeight: 'bold' }}>
                      By {post.author?.username || post.author?.name || 'Community'}
                    </div>
                    
                    <div className="markdown-preview" style={{ color: 'var(--text-muted)', fontSize: 14, margin: '0 0 16px 0', lineHeight: 1.5, maxHeight: '80px', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                       <ReactMarkdown>{post.description}</ReactMarkdown>
                    </div>
                    
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 'auto', paddingTop: 10 }}>
                      <span style={tag}>Tutorial</span>
                      <a href={`/practice/${post.id}`} style={ghostBtn}>Open Workspace →</a>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {showUploadModal && (
        <div style={modalOverlay}>
          <div style={modalContent}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <h2 style={{ margin: 0, color: 'var(--text-main)' }}>{isEditing ? 'Edit Tutorial' : 'Upload Video Tutorial'}</h2>
              <button onClick={() => setShowUploadModal(false)} style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', fontSize: 24, cursor: 'pointer' }}>×</button>
            </div>
            
            <p style={{ color: 'var(--text-muted)', fontSize: 14, marginBottom: 24 }}>
              {isEditing ? 'Update your video details or problem description below. Supports Markdown!' : 'Upload your YouTube walkthrough. A global notification will immediately be sent to all online users!'}
            </p>
            
            <form onSubmit={handleFormSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div>
                <label style={label}>Tutorial Title</label>
                <input placeholder="e.g. O(N) approach to Kadane's Algorithm" value={formData.title} onChange={e => setFormData({...formData, title: e.target.value})} style={input} required />
              </div>
              
              <div>
                <label style={label}>YouTube Video URL</label>
                <input placeholder="https://youtube.com/watch?v=..." value={formData.videoUrl} onChange={e => setFormData({...formData, videoUrl: e.target.value})} style={input} required />
              </div>

              <div>
                <label style={label}>Description (Supports Markdown)</label>
                <textarea placeholder="Briefly describe the algorithm using markdown formatting (e.g., **bold**, `code`)." value={formData.description} onChange={e => setFormData({...formData, description: e.target.value})} style={{...input, minHeight: 120, fontFamily: 'monospace', resize: 'vertical'}} required />
              </div>

              <div style={{ display: 'flex', gap: 12, marginTop: 10 }}>
                <button type="button" onClick={() => setShowUploadModal(false)} style={{...ghostBtn, flex: 1}}>Cancel</button>
                <button type="submit" disabled={uploading} style={{...button, flex: 2, background: uploading ? 'var(--border-color)' : 'linear-gradient(135deg,#a5b4fc,#22d3ee)'}}>
                  {uploading ? 'Saving...' : isEditing ? 'Save Changes' : 'Publish & Notify Community 🚀'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </main>
  );
}

const page: CSSProperties = { minHeight: '100vh', padding: 'clamp(16px, 4vw, 32px)', fontFamily: 'Inter, Arial, sans-serif', color: 'var(--text-main)', background: 'var(--bg-main)', boxSizing: 'border-box' };
const nav: CSSProperties = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 30 };
const brand: CSSProperties = { color: 'var(--text-main)', textDecoration: 'none', fontWeight: 950, fontSize: 'clamp(20px, 4vw, 28px)' };
const hero: CSSProperties = { padding: 'clamp(30px, 5vw, 60px)', borderRadius: 32, border: '1px solid var(--border-color)', background: 'var(--bg-panel)', marginBottom: 40, boxSizing: 'border-box' };
const eyebrow: CSSProperties = { color: 'var(--accent-primary)', fontWeight: 900, letterSpacing: '.14em', textTransform: 'uppercase', margin: 0 };
const grid: CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 24 };
const card: CSSProperties = { borderRadius: 16, border: '1px solid var(--border-color)', background: 'var(--bg-card)', overflow: 'hidden', display: 'flex', flexDirection: 'column', transition: 'transform 0.2s', boxShadow: '0 10px 30px rgba(0,0,0,0.1)' };
const videoContainer: CSSProperties = { position: 'relative', width: '100%', paddingTop: '56.25%', background: '#000' };
const tag: CSSProperties = { color: 'var(--accent-primary)', background: 'var(--accent-glow)', padding: '4px 10px', borderRadius: 6, fontWeight: 800, fontSize: 12, border: '1px solid var(--accent-primary)' };
const button: CSSProperties = { padding: '12px 24px', borderRadius: 999, border: 0, background: 'linear-gradient(135deg,#a5b4fc,#22d3ee)', color: '#000', fontWeight: 900, cursor: 'pointer', fontSize: 15 };
const ghostBtn: CSSProperties = { padding: '8px 16px', borderRadius: 999, border: '1px solid var(--border-color)', background: 'var(--bg-panel-solid)', color: 'var(--text-main)', fontWeight: 800, cursor: 'pointer', fontSize: 13, textDecoration: 'none', textAlign: 'center' };
const label: CSSProperties = { display: 'block', color: 'var(--text-muted)', fontSize: 13, fontWeight: 'bold', marginBottom: 6 };
const input: CSSProperties = { width: '100%', padding: 14, borderRadius: 12, background: 'var(--bg-panel-solid)', color: 'var(--text-main)', border: '1px solid var(--border-color)', boxSizing: 'border-box', outline: 'none', fontSize: 15, fontFamily: 'inherit' };
const modalOverlay: CSSProperties = { position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(2,6,23,0.85)', backdropFilter: 'blur(8px)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 100, padding: 20 };
const modalContent: CSSProperties = { background: 'var(--bg-panel)', padding: 'clamp(20px, 4vw, 32px)', borderRadius: 24, width: '100%', maxWidth: 550, border: '1px solid var(--border-color)', boxShadow: '0 40px 100px rgba(0,0,0,0.5)', boxSizing: 'border-box' };