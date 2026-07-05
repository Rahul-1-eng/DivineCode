/**
 * @file index.tsx
 * @author Rahul Kumar Sahoo
 * @description Entry gateway for the AI Recruiter pipeline. 
 * Manages the 3-step configuration wizard and the atomic 100-coin deduction transaction.
 */

import { useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/router';
import { motion, AnimatePresence } from 'framer-motion';
import toast, { Toaster } from 'react-hot-toast';
import { fetchApi } from '../../lib/api';

// -----------------------------------------------------------------------------
// Component Style Dictionary (Matches global DivineCode theme vars)
// -----------------------------------------------------------------------------
const STYLES: Record<string, React.CSSProperties> = {
  main: { minHeight: '100vh', padding: 'clamp(20px, 5vw, 60px)', background: 'var(--bg-main-gradient)', color: 'var(--text-main)', display: 'flex', justifyContent: 'center', alignItems: 'center', boxSizing: 'border-box' },
  card: { maxWidth: 650, width: '100%', background: 'var(--bg-panel-solid)', padding: 'clamp(30px, 5vw, 50px)', borderRadius: 24, border: '1px solid var(--border-color)', boxShadow: '0 20px 40px rgba(0,0,0,0.3)', position: 'relative', overflow: 'hidden' },
  title: { fontSize: 'clamp(28px, 4vw, 36px)', margin: '10px 0', color: 'var(--text-main)', fontWeight: 900, letterSpacing: '-0.02em' },
  subtitle: { color: 'var(--text-muted)', fontSize: 16, lineHeight: 1.6, marginBottom: 30 },
  featureBox: { background: 'var(--bg-card)', padding: 25, borderRadius: 16, border: '1px solid var(--border-color)', marginBottom: 35 },
  label: { display: 'block', marginBottom: 10, fontWeight: 700, color: 'var(--text-main)', fontSize: 14, textTransform: 'uppercase', letterSpacing: 1 },
  input: { width: '100%', padding: 16, borderRadius: 12, background: 'var(--bg-main)', color: 'var(--text-main)', border: '1px solid var(--border-color)', boxSizing: 'border-box', fontSize: 15, outline: 'none', transition: 'border-color 0.2s' },
  primaryBtn: { width: '100%', padding: '18px', borderRadius: 999, border: 0, background: 'linear-gradient(135deg, #a5b4fc, #22d3ee)', color: '#020617', fontWeight: 900, fontSize: 16, cursor: 'pointer', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 12, transition: 'transform 0.2s, opacity 0.2s' },
  secondaryBtn: { padding: '18px', borderRadius: 999, border: '1px solid var(--border-color)', background: 'transparent', color: 'var(--text-main)', cursor: 'pointer', fontWeight: 700, fontSize: 15, transition: 'background 0.2s' }
};

export default function AiRecruiterGateway() {
  const router = useRouter();
  
  // Pipeline State
  const [step, setStep] = useState(0);
  const [isProcessing, setIsProcessing] = useState(false);
  
  // Candidate Configuration Profile
  const [field, setField] = useState('Software Engineering');
  const [goal, setGoal] = useState('2026 FAANG Software Engineer Internship');
  const [techStack, setTechStack] = useState('');

  // Resume ingestion pipeline (PDF → pdf-parse → LLM-structured profile)
  const [resumeParsed, setResumeParsed] = useState<any>(null);
  const [resumeName, setResumeName] = useState<string | null>(null);
  const [isParsingResume, setIsParsingResume] = useState(false);
  const resumeInputRef = useRef<HTMLInputElement>(null);

  // Entitlement: free-trial quota (anchored to a unique mobile number) vs coins
  const [entitlement, setEntitlement] = useState<any>(null);
  const [phone, setPhone] = useState('');

  useEffect(() => {
    fetchApi('/api/v2/recruiter/entitlement')
      .then(setEntitlement)
      .catch(() => setEntitlement(null));
  }, []);

  const usingFreeTrial = !!entitlement && !entitlement.isAdmin && entitlement.freeTrialsLeft > 0;
  const priceLabel = entitlement?.isAdmin
    ? 'ADMIN · FREE'
    : usingFreeTrial
      ? `FREE · ${entitlement.freeTrialsLeft}/${entitlement.totalFreeTrials} trials left`
      : '100 🪙';

  const handleResumeUpload = async (file: File) => {
    if (!file.name.toLowerCase().endsWith('.pdf')) {
      return toast.error('Please upload a PDF resume.');
    }
    if (file.size > 5 * 1024 * 1024) {
      return toast.error('Resume must be under 5MB.');
    }

    setIsParsingResume(true);
    const parsingToast = toast.loading('Extracting and structuring your resume…');

    try {
      const formData = new FormData();
      formData.append('resume', file);
      const res = await fetchApi('/api/v2/recruiter/resume', { method: 'POST', body: formData });

      setResumeParsed(res.resumeParsed);
      setResumeName(file.name);

      // Prefill the competency matrix from extracted skills if it's still empty
      if (res.structured && Array.isArray(res.resumeParsed?.skills) && res.resumeParsed.skills.length > 0) {
        setTechStack(prev => prev.trim().length > 0 ? prev : res.resumeParsed.skills.join(', '));
        toast.success(`Resume parsed — ${res.resumeParsed.skills.length} skills extracted. Round 2 will drill into YOUR projects.`, { id: parsingToast, icon: '📄', duration: 5000 });
      } else {
        toast.success('Resume text captured. The interviewer will reference it in Round 2.', { id: parsingToast, icon: '📄' });
      }
    } catch (err: any) {
      toast.error(err?.message || 'Resume parsing failed — you can still continue without it.', { id: parsingToast });
    } finally {
      setIsParsingResume(false);
      if (resumeInputRef.current) resumeInputRef.current.value = '';
    }
  };

  // -----------------------------------------------------------------------------
  // Transaction Execution Engine
  // -----------------------------------------------------------------------------
  const executePipelineInitialization = async () => {
    if (techStack.trim().length < 5) {
      return toast.error("Please provide a valid tech stack so the interviewer can tailor your rounds.");
    }
    if (usingFreeTrial && entitlement?.needsPhone && !/^[6-9]\d{9}$/.test(phone.replace(/\D/g, '').slice(-10))) {
      return toast.error("Enter a valid 10-digit mobile number to claim your free interviews.");
    }

    setIsProcessing(true);
    const loadingToast = toast.loading(usingFreeTrial ? "Claiming your free interview slot..." : "Allocating neural resources and deducting coins...");

    try {
      // 1. Commit profile vectors
      await fetchApi('/api/v2/recruiter/profile', {
        method: 'POST',
        body: JSON.stringify({
          field,
          goal,
          techStack: techStack.split(',').map(t => t.trim()),
          resumeParsed // Structured extraction from the /resume ingestion endpoint (null if skipped)
        })
      });

      // 2. Consume a free trial (phone-anchored) or execute the coin deduction
      const sessionRes = await fetchApi('/api/v2/recruiter/sessions', {
        method: 'POST',
        body: JSON.stringify(entitlement?.needsPhone ? { phone } : {})
      });
      if (sessionRes.success) {
        toast.success("Transaction Cleared. Launching Live Environment.", { id: loadingToast, icon: '⚡' });
        router.push(`/recruiter/session/${sessionRes.session.id}`);
      }
    } catch (err: any) {
      const code = err?.data?.code;
      if (code === 'PHONE_TAKEN') {
        toast.error("This mobile number is already linked to another account. Free trials are one set per person.", { id: loadingToast, duration: 6000 });
      } else if (code === 'PHONE_REQUIRED') {
        toast.error("Register your mobile number to claim the free interviews.", { id: loadingToast });
      } else if (err.message?.includes('coins') || err.message?.includes('Insufficient')) {
         toast.error("Transaction Failed: 100 coins required to spin up an instance.", { id: loadingToast });
      } else {
         toast.error(`System Fault: ${err.message || 'Initialization aborted.'}`, { id: loadingToast });
      }
      setStep(0); // Reset state machine on fault
    } finally {
      setIsProcessing(false);
    }
  };

  // -----------------------------------------------------------------------------
  // Render Pipeline
  // -----------------------------------------------------------------------------
  return (
    <main style={STYLES.main}>
      <Toaster position="top-center" toastOptions={{ style: { background: 'var(--bg-panel-solid)', color: 'var(--text-main)', border: '1px solid var(--border-color)' } }} />
      
      <div style={STYLES.card}>
        <AnimatePresence mode="wait">
          
          {/* Node 0: The Paywall */}
          {step === 0 && (
            <motion.div key="step0" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20, transition: { duration: 0.2 } }}>
              <div style={{ textAlign: 'center', marginBottom: 35 }}>
                <div style={{ fontSize: 54, marginBottom: 15, filter: 'drop-shadow(0 0 20px rgba(165, 180, 252, 0.4))' }}>🎯</div>
                <h1 style={STYLES.title}>Neural Recruiter Core</h1>
                <p style={STYLES.subtitle}>A fully dynamic, 3-round technical interview simulator engineered to mirror real FAANG loops.</p>
              </div>

              <div style={STYLES.featureBox}>
                <h3 style={{ margin: '0 0 15px 0', color: 'var(--accent-primary)', fontSize: 15, textTransform: 'uppercase', letterSpacing: 1 }}>Session Architecture</h3>
                <ul style={{ color: 'var(--text-main)', paddingLeft: 20, lineHeight: 1.8, margin: 0, fontSize: 15 }}>
                  <li><strong>Round 1:</strong> Data Structures & Algorithms (Split-Screen IDE)</li>
                  <li><strong>Round 2:</strong> Resume & System Design Deep Dive</li>
                  <li><strong>Round 3:</strong> Behavioral & Scenario Resolution</li>
                  <li><strong>Telemetry:</strong> Post-mortem analysis and Hire/No-Hire verdict</li>
                </ul>
              </div>

              <button onClick={() => setStep(1)} style={STYLES.primaryBtn}>
                Initialize Sandbox <span style={{ background: 'rgba(0,0,0,0.15)', padding: '4px 12px', borderRadius: 999, fontSize: 13, marginLeft: 5 }}>{priceLabel}</span>
              </button>

              {usingFreeTrial && (
                <p style={{ textAlign: 'center', marginTop: 14, marginBottom: 0, fontSize: 13, color: '#4ade80' }}>
                  🎁 Your first {entitlement.totalFreeTrials} full interviews are free — no coins needed.
                </p>
              )}

              <button
                onClick={() => router.push('/recruiter/book')}
                style={{ width: '100%', marginTop: 18, padding: '15px', borderRadius: 999, border: '1px solid var(--border-color)', background: 'transparent', color: 'var(--text-main)', fontWeight: 700, fontSize: 14, cursor: 'pointer' }}
              >
                🧑‍💼 Want the real thing? Book a session with a human recruiter →
              </button>
            </motion.div>
          )}

          {/* Node 1: Target Definition */}
          {step === 1 && (
            <motion.div key="step1" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20, transition: { duration: 0.2 } }}>
              <h2 style={{ ...STYLES.title, fontSize: 28, marginTop: 0 }}>Configure Target Vector</h2>
              <p style={STYLES.subtitle}>The inference engine will adapt its questioning logic strictly to this target.</p>
              
              <div style={{ display: 'flex', flexDirection: 'column', gap: 25, marginTop: 10 }}>
                <div>
                  <label style={STYLES.label}>Target Domain</label>
                  <select value={field} onChange={(e) => setField(e.target.value)} style={STYLES.input}>
                    <option value="Software Engineering">Software Engineering (Full-Stack/Backend)</option>
                    <option value="Data Science">Data Science / Machine Learning</option>
                    <option value="Frontend Engineering">Frontend Engineering</option>
                  </select>
                </div>
                <div>
                  <label style={STYLES.label}>Specific Objective</label>
                  <input type="text" value={goal} onChange={(e) => setGoal(e.target.value)} placeholder="e.g., Google 2026 Associate SWE" style={STYLES.input} />
                </div>
              </div>

              <div style={{ display: 'flex', gap: 15, marginTop: 40 }}>
                <button onClick={() => setStep(0)} style={{ ...STYLES.secondaryBtn, flex: 1 }}>Abort</button>
                <button onClick={() => setStep(2)} style={{ ...STYLES.primaryBtn, flex: 2 }}>Proceed to Stack</button>
              </div>
            </motion.div>
          )}

          {/* Node 2: Competency Matrix */}
          {step === 2 && (
            <motion.div key="step2" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20, transition: { duration: 0.2 } }}>
              <h2 style={{ ...STYLES.title, fontSize: 28, marginTop: 0 }}>Competency Matrix</h2>
              <p style={STYLES.subtitle}>Inject your core technologies. The AI will actively stress-test your knowledge of these specific frameworks during Round 2.</p>

              {/* Resume Ingestion: optional but powers a personalized Round 2 */}
              <div style={{ marginBottom: 25 }}>
                <label style={STYLES.label}>Resume (PDF, Optional)</label>
                <input
                  ref={resumeInputRef}
                  type="file"
                  accept=".pdf,application/pdf"
                  style={{ display: 'none' }}
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) handleResumeUpload(f); }}
                />
                {resumeParsed ? (
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '14px 18px', borderRadius: 12, background: 'rgba(74, 222, 128, 0.08)', border: '1px solid rgba(74, 222, 128, 0.35)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                      <span style={{ fontSize: 20 }}>📄</span>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--text-main)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{resumeName}</div>
                        <div style={{ fontSize: 12, color: '#4ade80' }}>
                          {Array.isArray(resumeParsed?.skills) && resumeParsed.skills.length > 0
                            ? `Parsed · ${resumeParsed.skills.length} skills · ${resumeParsed.projects?.length || 0} projects extracted`
                            : 'Text captured for the Round 2 deep dive'}
                        </div>
                      </div>
                    </div>
                    <button
                      onClick={() => { setResumeParsed(null); setResumeName(null); }}
                      style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 18, flexShrink: 0 }}
                      title="Remove resume"
                    >✕</button>
                  </div>
                ) : (
                  <button
                    disabled={isParsingResume}
                    onClick={() => resumeInputRef.current?.click()}
                    style={{ width: '100%', padding: '18px', borderRadius: 12, border: '2px dashed var(--border-color)', background: 'var(--bg-main)', color: 'var(--text-muted)', cursor: isParsingResume ? 'wait' : 'pointer', fontSize: 14, fontWeight: 600 }}
                  >
                    {isParsingResume ? '🧠 Parsing your resume…' : '📎 Upload resume — the AI will interrogate your real projects in Round 2'}
                  </button>
                )}
              </div>

              <div style={{ marginTop: 10 }}>
                <label style={STYLES.label}>Tech Stack (Comma Separated)</label>
                <textarea 
                  value={techStack} 
                  onChange={(e) => setTechStack(e.target.value)} 
                  placeholder="e.g. React, Next.js, Node.js, Prisma, PostgreSQL..." 
                  style={{ ...STYLES.input, minHeight: 140, resize: 'vertical', fontFamily: 'monospace' }} 
                />
              </div>

              {/* Free trials are anchored to one mobile number per person */}
              {usingFreeTrial && entitlement?.needsPhone && (
                <div style={{ marginTop: 25 }}>
                  <label style={STYLES.label}>Mobile Number (Claims Your {entitlement.totalFreeTrials} Free Interviews)</label>
                  <input
                    type="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="10-digit mobile number"
                    maxLength={13}
                    style={STYLES.input}
                  />
                  <p style={{ margin: '8px 0 0 0', fontSize: 12, color: 'var(--text-muted)' }}>
                    One free-trial quota per number — it can't be reused on another account.
                  </p>
                </div>
              )}

              <div style={{ display: 'flex', gap: 15, marginTop: 40 }}>
                <button disabled={isProcessing} onClick={() => setStep(1)} style={{ ...STYLES.secondaryBtn, flex: 1, opacity: isProcessing ? 0.5 : 1 }}>Back</button>
                <button disabled={isProcessing} onClick={executePipelineInitialization} style={{ ...STYLES.primaryBtn, flex: 2, opacity: isProcessing ? 0.7 : 1 }}>
                  {isProcessing ? 'Executing...' : entitlement?.isAdmin ? 'Launch (Admin · Free)' : usingFreeTrial ? `Start Free Interview (${entitlement.freeTrialsLeft} left)` : 'Commit Transaction (100 🪙)'}
                </button>
              </div>
            </motion.div>
          )}

        </AnimatePresence>
      </div>
    </main>
  );
}