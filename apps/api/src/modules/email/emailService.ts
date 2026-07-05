/**
 * @file emailService.ts
 * @author Rahul
 * @description Platform email pipeline over the linked Gmail account (SMTP app
 * password). Every recruiter, interview, and contest event lands in the user's
 * inbox from here. If Gmail creds are missing the send is skipped and logged —
 * never faked.
 */

import nodemailer from 'nodemailer';

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

export function mailBookingConfirmed(candidateEmail: string, recruiterEmail: string | null, booking: { id: string; preferredAt: Date; recruiterName: string; candidateName: string }) {
  const when = booking.preferredAt.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
  const callUrl = `${SITE_URL}/recruiter/call/${booking.id}`;
  sendMail(candidateEmail,
    `Interview confirmed — ${booking.recruiterName} on ${when} IST`,
    'Your live interview is confirmed 🎉',
    `Payment verified. Your 1:1 mock interview with <strong>${booking.recruiterName}</strong> is locked for <strong>${when} IST</strong>.<br/><br/>
     Join the live video room from the button below at your slot time — camera and mic ready. The same link is on your bookings page.`,
    { label: '🎥 Join Live Interview Room', url: callUrl });
  if (recruiterEmail) {
    sendMail(recruiterEmail,
      `New confirmed session — ${booking.candidateName} on ${when} IST`,
      'You have a confirmed interview session',
      `<strong>${booking.candidateName}</strong> booked and paid for a session with you on <strong>${when} IST</strong>. Join the same live room at slot time. Your payout is settled by the admin after the session.`,
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
