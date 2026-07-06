/**
 * @file emailService.ts
 * @author Rahul
 * @description Platform email pipeline over the linked Gmail account (SMTP app
 * password). Every recruiter, interview, and contest event lands in the user's
 * inbox from here. If Gmail creds are missing the send is skipped and logged —
 * never faked.
 */

import nodemailer from 'nodemailer';
import { prisma } from '../../prisma/client';

// The platform's Gmail (the linked account). GMAIL_APP_PASSWORD is a Google
// "App Password" (Account → Security → 2-Step Verification → App passwords),
// NOT the normal account password.
const GMAIL_USER = (process.env.GMAIL_USER || '').trim();
const GMAIL_APP_PASSWORD = (process.env.GMAIL_APP_PASSWORD || '').replace(/\s+/g, '');
const SITE_URL = (process.env.CLIENT_ORIGIN || 'https://divine-code-web.vercel.app').replace(/\/$/, '');

export function emailEnabled(): boolean {
  return !!(GMAIL_USER && GMAIL_APP_PASSWORD);
}

let transporter: nodemailer.Transporter | null = null;
function getTransporter(): nodemailer.Transporter | null {
  if (!emailEnabled()) return null;
  if (!transporter) {
    transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: { user: GMAIL_USER, pass: GMAIL_APP_PASSWORD }
    });
  }
  return transporter;
}

// Shared branded shell so every mail looks like it came from the same platform.
function brandedHtml(title: string, bodyHtml: string, cta?: { label: string; url: string }): string {
  return `
  <div style="background:#0f172a;padding:32px 12px;font-family:Arial,Helvetica,sans-serif;">
    <div style="max-width:560px;margin:0 auto;background:#1e293b;border:1px solid #334155;border-radius:16px;overflow:hidden;">
      <div style="padding:22px 28px;background:linear-gradient(135deg,#312e81,#1e1b4b);">
        <span style="font-size:20px;font-weight:900;color:#a5b4fc;letter-spacing:.5px;">⚡ DivineCode</span>
      </div>
      <div style="padding:28px;">
        <h2 style="margin:0 0 14px 0;color:#f1f5f9;font-size:20px;">${title}</h2>
        <div style="color:#cbd5e1;font-size:14px;line-height:1.7;">${bodyHtml}</div>
        ${cta ? `
        <div style="margin-top:24px;">
          <a href="${cta.url}" style="display:inline-block;padding:13px 28px;border-radius:999px;background:linear-gradient(135deg,#a5b4fc,#22d3ee);color:#020617;font-weight:800;font-size:14px;text-decoration:none;">${cta.label}</a>
        </div>` : ''}
      </div>
      <div style="padding:16px 28px;border-top:1px solid #334155;color:#64748b;font-size:11.5px;line-height:1.6;">
        Sent from the DivineCode platform · <a href="${SITE_URL}" style="color:#818cf8;text-decoration:none;">${SITE_URL.replace(/^https?:\/\//, '')}</a><br/>
        You are receiving this because of activity on your DivineCode account.
      </div>
    </div>
  </div>`;
}

// Fire-and-forget by design: a dead SMTP connection must never fail the API
// request that triggered the mail. Callers do not await this.
export function sendMail(to: string | string[], subject: string, title: string, bodyHtml: string, cta?: { label: string; url: string }): void {
  const t = getTransporter();
  const recipients = (Array.isArray(to) ? to : [to]).filter(Boolean);
  if (recipients.length === 0) return;
  if (!t) {
    console.warn(`[Email] Skipped "${subject}" → ${recipients.join(', ')} (GMAIL_USER / GMAIL_APP_PASSWORD not configured)`);
    return;
  }
  t.sendMail({
    from: `"DivineCode" <${GMAIL_USER}>`,
    to: recipients.join(', '),
    subject,
    html: brandedHtml(title, bodyHtml, cta)
  }).then(() => {
    console.log(`[Email] Sent "${subject}" → ${recipients.join(', ')}`);
  }).catch((err: any) => {
    console.error(`[Email] Failed "${subject}" → ${recipients.join(', ')}:`, err?.message);
  });
}

// The admin inbox is the platform Gmail itself.
export function adminEmail(): string {
  return GMAIL_USER;
}

// -----------------------------------------------------------------------------
// Broadcast (all-users) delivery — recipients ride BCC so nobody sees anyone
// else's address. Chunked because Gmail rejects oversized recipient lists.
// -----------------------------------------------------------------------------

const BCC_CHUNK = 80;

export function sendMailBroadcast(recipients: string[], subject: string, title: string, bodyHtml: string, cta?: { label: string; url: string }): void {
  const t = getTransporter();
  const unique = [...new Set(recipients.filter(e => e && e.includes('@')))];
  if (unique.length === 0) return;
  if (!t) {
    console.warn(`[Email] Skipped broadcast "${subject}" → ${unique.length} users (GMAIL_USER / GMAIL_APP_PASSWORD not configured)`);
    return;
  }
  for (let i = 0; i < unique.length; i += BCC_CHUNK) {
    const chunk = unique.slice(i, i + BCC_CHUNK);
    t.sendMail({
      from: `"DivineCode" <${GMAIL_USER}>`,
      to: GMAIL_USER,
      bcc: chunk.join(', '),
      subject,
      html: brandedHtml(title, bodyHtml, cta)
    }).then(() => {
      console.log(`[Email] Broadcast "${subject}" → ${chunk.length} users (batch ${Math.floor(i / BCC_CHUNK) + 1})`);
    }).catch((err: any) => {
      console.error(`[Email] Broadcast failed "${subject}":`, err?.message);
    });
  }
}

// Every real account on the platform, minus the system broadcast user and the
// actor who triggered the event (they already know — they did it).
async function allUserEmails(excludeEmails: Array<string | null | undefined> = []): Promise<string[]> {
  const skip = new Set(excludeEmails.filter(Boolean).map(e => String(e).toLowerCase()));
  const users = await prisma.user.findMany({
    where: { NOT: { id: 'ALL' } },
    select: { email: true }
  });
  return users.map(u => u.email).filter(e => e && e.includes('@') && !skip.has(e.toLowerCase()));
}

// -----------------------------------------------------------------------------
// Recruiter booking lifecycle
// -----------------------------------------------------------------------------

export function mailBookingCreated(to: string, booking: { id: string; totalInr: number; preferredAt: Date; recruiterName: string }, upiId: string) {
  sendMail(to,
    `Booking requested — ₹${booking.totalInr} payment pending`,
    'Your interview slot is reserved, pending payment',
    `You requested a 1:1 mock interview with <strong>${booking.recruiterName}</strong> on <strong>${booking.preferredAt.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} IST</strong>.<br/><br/>
     To lock the slot, pay <strong>₹${booking.totalInr}</strong> — either online (card / UPI / netbanking) from the bookings page, or manually to UPI ID <strong>${upiId}</strong> and submit the UTR.<br/><br/>
     Booking reference: <code>${booking.id.slice(-8)}</code>`,
    { label: 'Complete Payment', url: `${SITE_URL}/recruiter/book` });
}

export function mailPaymentUnderVerification(to: string, booking: { id: string; totalInr: number; recruiterName: string; upiTransactionRef: string }) {
  sendMail(to,
    'Payment reference received — verification in progress',
    'We received your payment reference',
    `Your UTR <code>${booking.upiTransactionRef}</code> for the ₹${booking.totalInr} session with <strong>${booking.recruiterName}</strong> is being verified by the platform admin. You will get a confirmation email with your live interview link once it clears.`,
    { label: 'View My Bookings', url: `${SITE_URL}/recruiter/book` });
  // Admin gets pinged so verification never sits in a queue nobody watches.
  sendMail(adminEmail(),
    `[Admin] UTR submitted — booking ${booking.id.slice(-8)} needs verification`,
    'A booking payment awaits your verification',
    `UTR <code>${booking.upiTransactionRef}</code> · ₹${booking.totalInr} · recruiter: ${booking.recruiterName}. Verify it in the admin queue.`,
    { label: 'Open Verification Queue', url: `${SITE_URL}/recruiter/book` });
}

// Payment landed — the recruiter must now confirm they are actually free for
// the slot. Candidate is told to expect a confirmation call.
export function mailBookingPaidAwaitingRecruiter(candidateEmail: string, booking: { id: string; preferredAt: Date; recruiterName: string; totalInr: number }) {
  const when = booking.preferredAt.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
  sendMail(candidateEmail,
    `Payment received — waiting for ${booking.recruiterName} to confirm`,
    'Payment confirmed ✓ — one step left',
    `Your ₹${booking.totalInr} payment for the session with <strong>${booking.recruiterName}</strong> on <strong>${when} IST</strong> is confirmed.<br/><br/>
     We have asked the recruiter to confirm they are free for your slot. Expect a <strong>call from the recruiter on your registered number</strong> to confirm the meet — once they accept, you will get the live interview room link by email.`,
    { label: 'Track My Booking', url: `${SITE_URL}/recruiter/book` });
}

export function mailRecruiterAvailabilityRequest(recruiterEmail: string | null, booking: { id: string; preferredAt: Date; recruiterName: string; candidateName: string; candidatePhone?: string | null; recruiterFeeInr: number }) {
  const when = booking.preferredAt.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
  const phoneLine = booking.candidatePhone
    ? `Please give <strong>${booking.candidateName}</strong> a quick call on <strong>${booking.candidatePhone}</strong> to confirm the meet, then accept the booking below.`
    : `Please confirm the booking below — the admin will share the candidate's contact with you.`;
  if (recruiterEmail) {
    sendMail(recruiterEmail,
      `Paid booking — are you free on ${when} IST?`,
      'A candidate paid for a session with you',
      `<strong>${booking.candidateName}</strong> paid for a 1:1 session with you on <strong>${when} IST</strong> (your payout: ₹${booking.recruiterFeeInr}, settled by the admin after the session).<br/><br/>
       ${phoneLine}<br/><br/>
       If the slot does not work for you, decline it and the admin will reschedule or refund the candidate.`,
      { label: '✅ Confirm Availability', url: `${SITE_URL}/recruiter/book` });
  }
  // Admin always gets a copy so unlinked recruiter listings never stall.
  sendMail(adminEmail(),
    `[Admin] Booking ${booking.id.slice(-8)} paid — recruiter confirmation pending`,
    'A paid booking awaits recruiter confirmation',
    `${booking.candidateName} × ${booking.recruiterName} on ${when} IST. ${booking.candidatePhone ? `Candidate phone: <strong>${booking.candidatePhone}</strong>.` : 'No candidate phone on file.'} ${recruiterEmail ? 'The recruiter has been emailed to confirm.' : 'This recruiter has NO linked account — coordinate by phone and confirm from the admin panel.'}`,
    { label: 'Open Bookings', url: `${SITE_URL}/recruiter/book` });
}

export function mailBookingConfirmed(candidateEmail: string, recruiterEmail: string | null, booking: { id: string; preferredAt: Date; recruiterName: string; candidateName: string; candidatePhone?: string | null; recruiterPhone?: string | null }) {
  const when = booking.preferredAt.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
  const callUrl = `${SITE_URL}/recruiter/call/${booking.id}`;
  sendMail(candidateEmail,
    `Interview confirmed — ${booking.recruiterName} on ${when} IST`,
    'Your live interview is confirmed 🎉',
    `<strong>${booking.recruiterName}</strong> confirmed they are free — your 1:1 mock interview is locked for <strong>${when} IST</strong>.<br/><br/>
     The recruiter will <strong>call you before the session</strong> to confirm the meet${booking.recruiterPhone ? ` (their number: <strong>${booking.recruiterPhone}</strong>)` : ''}.<br/><br/>
     Join the live video room from the button below at your slot time — camera and mic ready. The same link is on your bookings page.`,
    { label: '🎥 Join Live Interview Room', url: callUrl });
  if (recruiterEmail) {
    sendMail(recruiterEmail,
      `Session locked — ${booking.candidateName} on ${when} IST`,
      'You confirmed the interview session',
      `Your session with <strong>${booking.candidateName}</strong> is locked for <strong>${when} IST</strong>.${booking.candidatePhone ? ` Call them on <strong>${booking.candidatePhone}</strong> before the slot to confirm the meet.` : ''} Join the same live room at slot time. Your payout is settled by the admin after the session.`,
      { label: '🎥 Join Live Interview Room', url: callUrl });
  }
}

export function mailBookingCancelled(to: string, booking: { id: string; recruiterName: string; totalInr: number; wasPaid: boolean }) {
  sendMail(to,
    `Booking cancelled — ${booking.recruiterName}`,
    'Your booking was cancelled',
    `The booking <code>${booking.id.slice(-8)}</code> with <strong>${booking.recruiterName}</strong> has been cancelled.${booking.wasPaid ? ' Since a payment was involved, the admin will reach out to settle the refund manually.' : ''}`,
    { label: 'Book Another Session', url: `${SITE_URL}/recruiter/book` });
}

// -----------------------------------------------------------------------------
// Recruiter applications
// -----------------------------------------------------------------------------

export function mailRecruiterApplied(applicantEmail: string, name: string) {
  sendMail(applicantEmail,
    'Recruiter application received',
    'Your application is under review',
    `Thanks <strong>${name}</strong> — your application to be listed as a recruiter on DivineCode is in the admin review queue. You will hear back by email once it is approved or rejected.`);
  sendMail(adminEmail(),
    `[Admin] New recruiter application — ${name}`,
    'A recruiter application awaits review',
    `<strong>${name}</strong> applied to join the recruiter directory. Approve or reject it from the marketplace page.`,
    { label: 'Review Application', url: `${SITE_URL}/recruiter/book` });
}

export function mailRecruiterDecision(applicantEmail: string, name: string, approved: boolean, feeInr?: number) {
  sendMail(applicantEmail,
    approved ? 'You are live in the recruiter directory 🎉' : 'Recruiter application update',
    approved ? 'Application approved' : 'Application not accepted',
    approved
      ? `Congratulations <strong>${name}</strong> — your listing is live${feeInr ? ` at <strong>₹${feeInr}/session</strong>` : ''}. Candidates can book you now; you will get an email for every confirmed session with the live room link.`
      : `Your recruiter application was not accepted this time. You can update your details on the marketplace page and reapply.`,
    { label: 'Open Marketplace', url: `${SITE_URL}/recruiter/book` });
}

// -----------------------------------------------------------------------------
// AI interview pipeline
// -----------------------------------------------------------------------------

export function mailInterviewConcluded(to: string, sessionId: string, passed: boolean) {
  sendMail(to,
    passed ? 'You cleared the AI interview loop 🏆' : 'Your AI interview debrief is ready',
    passed ? 'Offer extended — loop cleared' : 'Interview loop concluded',
    `${passed
      ? 'You passed every round of the AI Recruiter pipeline. '
      : 'The panel decided not to move forward this time — the debrief shows exactly where the loop broke down. '}
     Your full hiring-committee report with scores, strengths, weaknesses and a prep plan is ready. It can also be downloaded as a PDF.`,
    { label: '📊 View Debrief Report', url: `${SITE_URL}/recruiter/report/${sessionId}` });
}

// -----------------------------------------------------------------------------
// Contests
// -----------------------------------------------------------------------------

export function mailContestRegistered(to: string, contest: { id: string; title: string; startTime?: Date | null }) {
  const when = contest.startTime
    ? new Date(contest.startTime).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) + ' IST'
    : 'the scheduled start time';
  sendMail(to,
    `Registered: ${contest.title}`,
    'Contest registration confirmed',
    `You are registered for <strong>${contest.title}</strong>. It begins at <strong>${when}</strong> — be on the platform a few minutes early. Good luck! 🚀`,
    { label: 'Open Contest', url: `${SITE_URL}/contests/${contest.id}` });
}

// Every user hears about a new contest the moment it goes up.
export function broadcastContestCreated(contest: { id: string; title: string; startTime?: Date | null }, creatorName: string, creatorEmail?: string | null): void {
  const when = contest.startTime
    ? new Date(contest.startTime).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) + ' IST'
    : 'soon';
  allUserEmails([creatorEmail]).then(recipients => {
    sendMailBroadcast(recipients,
      `New contest on DivineCode: ${contest.title}`,
      'A new contest just went live 🏆',
      `<strong>${creatorName}</strong> created a new contest: <strong>${contest.title}</strong>, starting <strong>${when}</strong>. Grab your spot before the timer hits zero.`,
      { label: 'View & Register', url: `${SITE_URL}/contests/${contest.id}` });
  }).catch((err: any) => console.error('[Email] Contest broadcast failed:', err?.message));
}

// -----------------------------------------------------------------------------
// DivineLive & Community broadcasts
// -----------------------------------------------------------------------------

export function broadcastLiveStarted(room: { id: string; title: string }, hostName: string, hostEmail?: string | null): void {
  allUserEmails([hostEmail]).then(recipients => {
    sendMailBroadcast(recipients,
      `🔴 ${hostName} is LIVE on DivineCode`,
      `${hostName} just went live`,
      `<strong>${hostName}</strong> is streaming right now: <strong>${room.title}</strong>. Drop in to watch, or hop on camera and discuss face to face.`,
      { label: '🔴 Watch Live', url: `${SITE_URL}/live/${room.id}` });
  }).catch((err: any) => console.error('[Email] Live broadcast failed:', err?.message));
}

export function broadcastCommunityUpload(postTitle: string, authorName: string, authorEmail?: string | null): void {
  allUserEmails([authorEmail]).then(recipients => {
    sendMailBroadcast(recipients,
      `New community tutorial: ${postTitle}`,
      'Fresh content in the Community Hub 🎬',
      `<strong>${authorName}</strong> just published: <strong>${postTitle}</strong>. It is live in the Community Hub now.`,
      { label: 'Watch It', url: `${SITE_URL}/community` });
  }).catch((err: any) => console.error('[Email] Community broadcast failed:', err?.message));
}

// -----------------------------------------------------------------------------
// AI interview kickoff (conclusion mail already exists above)
// -----------------------------------------------------------------------------

export function mailInterviewStarted(to: string, sessionId: string, paymentMode: 'ADMIN' | 'FREE_TRIAL' | 'COINS'): void {
  const paidLine = paymentMode === 'FREE_TRIAL'
    ? 'This session used one of your free trials.'
    : paymentMode === 'COINS'
      ? 'This session was unlocked with coins.'
      : 'Admin session — no charge.';
  sendMail(to,
    'Your AI interview loop has started 🎯',
    'The panel is waiting for you',
    `Your 3-round AI Recruiter interview is live: DSA round, resume deep-dive, then behavioral. ${paidLine} If you get disconnected, reopen the session — your progress is saved after every turn.`,
    { label: 'Resume Interview', url: `${SITE_URL}/recruiter/session/${sessionId}` });
}

// -----------------------------------------------------------------------------
// Coin purchases (₹ → 🪙 top-ups)
// -----------------------------------------------------------------------------

export function mailCoinPurchaseCreated(to: string, p: { id: string; coins: number; amountInr: number }, upiId: string): void {
  sendMail(to,
    `Coin top-up started — ₹${p.amountInr} for ${p.coins} 🪙`,
    'Complete your coin purchase',
    `You started a top-up of <strong>${p.coins} coins</strong> for <strong>₹${p.amountInr}</strong>.<br/><br/>
     Pay online (card / UPI / netbanking) from the coins page for instant credit, or pay manually to UPI ID <strong>${upiId}</strong> and submit the UTR.<br/><br/>
     Purchase reference: <code>${p.id.slice(-8)}</code>`,
    { label: 'Complete Payment', url: `${SITE_URL}/coins` });
}

export function mailCoinPurchaseUnderVerification(to: string, p: { id: string; coins: number; amountInr: number; upiTransactionRef: string }): void {
  sendMail(to,
    'Coin top-up reference received — verification in progress',
    'We received your payment reference',
    `Your UTR <code>${p.upiTransactionRef}</code> for the ₹${p.amountInr} / ${p.coins} 🪙 top-up is being verified by the platform admin. The coins land in your balance the moment it clears — you will get a confirmation email.`,
    { label: 'View My Purchases', url: `${SITE_URL}/coins` });
  sendMail(adminEmail(),
    `[Admin] Coin top-up UTR — purchase ${p.id.slice(-8)} needs verification`,
    'A coin purchase awaits your verification',
    `UTR <code>${p.upiTransactionRef}</code> · ₹${p.amountInr} for ${p.coins} 🪙. Verify it from the coins page admin queue.`,
    { label: 'Open Verification Queue', url: `${SITE_URL}/coins` });
}

// -----------------------------------------------------------------------------
// Phone OTP fallback — when no SMS gateway is configured the code is delivered
// to the account's email instead, so verification still actually happens.
// -----------------------------------------------------------------------------

export function mailPhoneOtp(to: string, code: string, phone: string): void {
  sendMail(to,
    `${code} is your DivineCode verification code`,
    'Verify your mobile number',
    `Your one-time code to verify mobile number <strong>+91 ${phone}</strong> is:<br/><br/>
     <div style="font-size:32px;font-weight:900;letter-spacing:8px;color:#a5b4fc;">${code}</div><br/>
     It expires in 10 minutes. If you didn't request this, ignore this email.`);
}

export function mailCoinsCredited(to: string, p: { coins: number; amountInr: number; newBalance: number }): void {
  sendMail(to,
    `${p.coins} 🪙 credited — balance: ${p.newBalance}`,
    'Coins credited to your account 🎉',
    `Your payment of <strong>₹${p.amountInr}</strong> is confirmed and <strong>${p.coins} coins</strong> are now in your wallet. New balance: <strong>${p.newBalance} 🪙</strong>.<br/><br/>
     Spend them on AI Recruiter interview sessions any time.`,
    { label: 'Start an AI Interview', url: `${SITE_URL}/recruiter` });
}
