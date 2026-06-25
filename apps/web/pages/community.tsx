import { CSSProperties, useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { io } from 'socket.io-client';
import toast, { Toaster } from 'react-hot-toast';
import ReactMarkdown from 'react-markdown'; // 👉 ADDED: For rich text formatting!

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:4000';

export default function CommunityHubPage() {
  const { data: session } = useSession();
  
  const [posts, setPosts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [uploading, setUploading] = useState(false);
  
  // 👉 ADDED: Manage both New and Editing states in one form
  const [formData, setFormData] = useState({ id: '', title: '', videoUrl: '', description: '' });
  const [isEditing, setIsEditing] = useState(false);

  useEffect(() => {
    loadCommunityPosts();

    const socket = io(API_BASE_URL, { transports: ['websocket'] });
    
    socket.on('new_community_post', (post) => {
      setPosts(prev => {
        // If it already exists, update it (Edit case)
        if (prev.find(p => p.id === post.id)) {
            return prev.map(p => p.id === post.id ? post : p);
        }
        return [post, ...prev]; // New post case
      });
    });
    
    socket.on('post_deleted', ({ id }) => {
      setPosts(prev => prev.filter(p => p.id !== id));
    });

    return () => { socket.disconnect(); };
  }, []);

 const loadCommunityPosts = async () => {
    setLoading(true);
    const url = `${API_BASE_URL}/api/v2/community/problems`;
    console.log("[Community Hub]: Fetching posts from", url);
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Server responded with ${res.status}`);
      const data = await res.json();
      console.log("[Community Hub]: Received posts:", data);
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
        ? `${API_BASE_URL}/api/v2/community/problems/${formData.id}` 
        : `${API_BASE_URL}/api/v2/community/upload`;
        
      const method = isEditing ? 'PUT' : 'POST';

   console.log(`[Community Hub]: Submitting ${method} request to ${url} with data:`, payload);
      const res = await fetch(url, {
        method,
        headers: { 
          'Content-Type': 'application/json', 
          'x-user-email': session.user.email 
        },
        body: JSON.stringify(payload)
      });

      const data = await res.json();

      if (!res.ok) throw new Error(data.error || "Action failed on server.");
      
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
      const res = await fetch(`${API_BASE_URL}/api/v2/community/problems/${postId}`, {
        method: 'DELETE',
        headers: { 'x-user-email': session.user.email }
      });
      const data = await res.json();
      
      if (!res.ok) throw new Error(data.error || "Failed to delete post.");
      toast.success("Tutorial deleted.");
    } catch (err: any) {
      toast.error(err.message);
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
          <button onClick={openUploadModal} style={button}>+ Upload Tutorial</button>
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
            {posts.map(post => {
              const isAuthor = session?.user?.email && post.author?.email && session.user.email === post.author.email;
              return (
                <div key={post.id} style={{ ...card, position: 'relative' }}>
                  
                  {/* 👉 ADDED: Action Buttons Container */}
                  {isAuthor && (
                    <div style={{ position: 'absolute', top: 10, right: 10, zIndex: 10, display: 'flex', gap: 8 }}>
                      <button 
                        onClick={() => openEditModal(post)}
                        style={{ background: 'rgba(2, 6, 23, 0.7)', border: '1px solid rgba(56, 189, 248, 0.5)', color: '#38bdf8', padding: '6px 10px', borderRadius: '8px', cursor: 'pointer', backdropFilter: 'blur(4px)' }}
                      >
                        ✏️ Edit
                      </button>
                      <button 
                        onClick={() => handleDeletePost(post.id)}
                        style={{ background: 'rgba(2, 6, 23, 0.7)', border: '1px solid rgba(248, 113, 113, 0.5)', color: '#f87171', padding: '6px 10px', borderRadius: '8px', cursor: 'pointer', backdropFilter: 'blur(4px)' }}
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
                    <div style={{ ...videoContainer, background: '#1e293b', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <span style={{ color: '#64748b' }}>No Video Attached</span>
                    </div>
                  )}
                  
                  <div style={{ padding: 20 }}>
                    <h3 style={{ margin: '0 0 4px 0', color: '#eef2ff', fontSize: 18 }}>{post.title}</h3>
                    <div style={{ color: '#38bdf8', fontSize: 12, marginBottom: 8, fontWeight: 'bold' }}>
                      By {post.author?.username || post.author?.name || 'Community'}
                    </div>
                    
                    {/* 👉 ADDED: Markdown renderer instead of plain <p> tag */}
                    <div className="markdown-preview" style={{ color: '#94a3b8', fontSize: 14, margin: '0 0 16px 0', lineHeight: 1.5, maxHeight: '80px', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                       <ReactMarkdown>{post.description}</ReactMarkdown>
                    </div>
                    
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 10 }}>
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

      {/* UPLOAD/EDIT MODAL */}
      {showUploadModal && (
        <div style={modalOverlay}>
          <div style={modalContent}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <h2 style={{ margin: 0, color: '#fff' }}>{isEditing ? 'Edit Tutorial' : 'Upload Video Tutorial'}</h2>
              <button onClick={() => setShowUploadModal(false)} style={{ background: 'transparent', border: 'none', color: '#94a3b8', fontSize: 24, cursor: 'pointer' }}>×</button>
            </div>
            
            <p style={{ color: '#94a3b8', fontSize: 14, marginBottom: 24 }}>
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
                <textarea placeholder="Briefly describe the algorithm using markdown formatting (e.g., **bold**, `code`)." value={formData.description} onChange={e => setFormData({...formData, description: e.target.value})} style={{...input, minHeight: 120, fontFamily: 'monospace'}} required />
              </div>

              <div style={{ display: 'flex', gap: 12, marginTop: 10 }}>
                <button type="button" onClick={() => setShowUploadModal(false)} style={{...ghostBtn, flex: 1}}>Cancel</button>
                <button type="submit" disabled={uploading} style={{...button, flex: 2, background: uploading ? '#64748b' : 'linear-gradient(135deg,#a5b4fc,#22d3ee)'}}>
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

// ... Keep existing styles (page, nav, brand, hero, etc.) ...
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