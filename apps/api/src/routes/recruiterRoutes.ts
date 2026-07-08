/**
 * @file recruiterRoutes.ts
 * @author Rahul
 * @description Premium AI Recruiter pipeline with coin-gating, profile management, and session state.
 */

import { Router } from 'express';
import crypto from 'crypto';
import multer from 'multer';
import pdfParse from 'pdf-parse';
import { prisma } from '../prisma/client';
import { resolvedViewerFromRequest } from '../modules/contests/contestRules';
import { processRecruiterTurn, generateRoundOpening, generateSessionReport, parseResumeToProfile, RecruiterAiUnavailableError } from '../modules/ai/aiService';
import { executeSubmission } from '../modules/judge/judge0Service';
import { createRazorpayOrder, verifyRazorpaySignature, razorpayEnabled, razorpayKeyId } from '../modules/payments/razorpayService';
import {
  mailBookingCreated, mailPaymentUnderVerification, mailBookingConfirmed, mailBookingCancelled,
  mailRecruiterApplied, mailRecruiterDecision, mailInterviewConcluded, mailInterviewStarted,
  mailBookingPaidAwaitingRecruiter, mailRecruiterAvailabilityRequest
} from '../modules/email/emailService';
import { todayLuckyDeal, validateCoupon, redeemCoupon, applyPercentOff, CouponError } from '../modules/payments/promoService';
import { otpChannel, generateOtp, hashOtp, verifyOtpHash, deliverOtp } from '../modules/sms/otpService';
import { sendNotification } from './notificationRoutes';

export const recruiterRouter = Router();

const SESSION_COST = 100;
const FREE_TRIALS = 0;

// Phone OTP is ON by default: anyone could type any mobile number, so the
// number must clear a code before it anchors free trials. Delivery is SMS when
// Fast2SMS is configured, otherwise the code goes to the account's REGISTERED
// email (never asked from the user — it's the one linked to the platform).
// Set REQUIRE_PHONE_OTP=false to fall back to the legacy unverified path.
const phoneOtpRequired = () => process.env.REQUIRE_PHONE_OTP !== 'false' && otpChannel() !== 'NONE';

// Platform's UPI collection handle (maps to the admin's mobile). All booking
// money lands here; recruiter payouts are settled manually by the admin.
const PLATFORM_UPI_ID = (process.env.PLATFORM_UPI_ID || process.env.ADMIN_UPI_ID || 'divinecode@upi').trim();
const PLATFORM_FEE_RATE = 0.15;
const PLATFORM_FEE_MIN_INR = 49;

// The Jitsi room name for a confirmed booking. Random suffix keeps rooms
// unguessable — the id alone would let anyone construct the meeting URL.
function mintMeetingRoom(bookingId: string): string {
  return `DivineCode-Interview-${bookingId.slice(-6)}-${crypto.randomBytes(5).toString('hex')}`;
}

/** Normalizes an Indian mobile number to bare 10 digits; returns null if invalid. */
function normalizePhone(raw: any): string | null {
  if (typeof raw !== 'string') return null;
  let digits = raw.replace(/\D/g, '');
  if (digits.length === 12 && digits.startsWith('91')) digits = digits.slice(2);
  if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1);
  return /^[6-9]\d{9}$/.test(digits) ? digits : null;
}

// Resume PDFs are parsed in-memory and never written to disk — only the
// structured extraction is persisted, so no file storage is needed.
const resumeUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }
});

// -----------------------------------------------------------------------------
// 0. Resume Ingestion: PDF → raw text (pdf-parse) → structured JSON (LLM)
// -----------------------------------------------------------------------------
recruiterRouter.post('/resume', resumeUpload.single('resume'), async (req, res) => {
  try {
    const viewer = await resolvedViewerFromRequest(req, true);
    if (!viewer.email) return res.status(401).json({ error: 'Unauthorized' });

    const file = (req as any).file as Express.Multer.File | undefined;
    if (!file) return res.status(400).json({ error: 'No resume file received. Attach a PDF under the "resume" field.' });
    if (file.mimetype !== 'application/pdf' && !file.originalname.toLowerCase().endsWith('.pdf')) {
      return res.status(400).json({ error: 'Only PDF resumes are supported.' });
    }

    let rawText = '';
    try {
      const parsed = await pdfParse(file.buffer);
      rawText = (parsed.text || '').trim();
    } catch (pdfErr: any) {
      console.error('[Resume PDF Extract Error]', pdfErr?.message);
      return res.status(422).json({ error: 'Could not read this PDF. Please export a text-based (not scanned) resume and retry.' });
    }

    if (rawText.replace(/\s+/g, ' ').length < 120) {
      return res.status(422).json({ error: 'This PDF contains almost no extractable text — it may be a scanned image. Please upload a text-based resume.' });
    }

    // Structure via LLM; if every provider is down we still return the raw text
    // so the session is never blocked on the parsing enrichment.
    let resumeParsed: any;
    let structured = true;
    try {
      resumeParsed = await parseResumeToProfile(rawText);
    } catch (aiErr) {
      if (!(aiErr instanceof RecruiterAiUnavailableError)) throw aiErr;
      structured = false;
      resumeParsed = { rawText: rawText.substring(0, 6000) };
    }

    // Persist onto the profile immediately
    //  if one exists; the wizard also sends
    // resumeParsed with POST /profile, which remains the canonical write path.
    const user = await prisma.user.findUnique({ where: { email: viewer.email } });
    if (user) {
      const existingProfile = await prisma.candidateProfile.findFirst({ where: { userId: user.id } });
      if (existingProfile) {
        await prisma.candidateProfile.update({ where: { id: existingProfile.id }, data: { resumeParsed } });
      }
    }

    res.json({ success: true, structured, resumeParsed });
  } catch (err: any) {
    console.error('[Resume Ingestion Error]', err);
    
    res.status(500).json({ error: 'Failed to process the resume.' });
  }
});

// -----------------------------------------------------------------------------
// 1. Profile Management (Onboarding Step)
// -----------------------------------------------------------------------------
recruiterRouter.post('/profile', async (req, res) => {
  try {
    const viewer = await resolvedViewerFromRequest(req, true);
    if (!viewer.email) return res.status(401).json({ error: 'Unauthorized' });

    const user = await prisma.user.findUnique({ where: { email: viewer.email } });
    if (!user) return res.status(404).json({ error: 'User not found' });

    const { field, goal, techStack, resumeParsed } = req.body;

    if (!field || !goal) {
      return res.status(400).json({ error: 'Field and Goal are required.' });
    }

    // Upsert a profile for the user. We can just keep updating their primary one for now.
    const existingProfile = await prisma.candidateProfile.findFirst({
      where: { userId: user.id }
    });

    let profile;
    if (existingProfile) {
      profile = await prisma.candidateProfile.update({
        where: { id: existingProfile.id },
        data: { field, goal, techStack, resumeParsed }
      });
    } else {
      profile = await prisma.candidateProfile.create({
        data: { userId: user.id, field, goal, techStack, resumeParsed }
      });
    }

    res.json({ success: true, profile });
  } catch (err: any) {
    console.error("[Recruiter Profile Error]", err);
    res.status(500).json({ error: 'Failed to save candidate profile.' });
  }
});

// -----------------------------------------------------------------------------
// 1b. Entitlement Probe — tells the wizard how this user's next session is paid:
// free trial (and whether a phone number must be registered first) or coins,
// plus today's lucky-day deal so the UI can show the banner and real price.
// -----------------------------------------------------------------------------
recruiterRouter.get('/entitlement', async (req, res) => {
  try {
    const viewer = await resolvedViewerFromRequest(req, true);
    if (!viewer.email) return res.status(401).json({ error: 'Unauthorized' });

    const user = await prisma.user.findUnique({ where: { email: viewer.email } });
    if (!user) return res.status(404).json({ error: 'User not found' });

    const isAdmin = user.role === 'ADMIN';
    const freeTrialsLeft = Math.max(0, FREE_TRIALS - user.freeInterviewsUsed);
    const otpAvailable = phoneOtpRequired();
    const phoneOk = !!user.phone && (user.phoneVerified || !otpAvailable);
    const lucky = todayLuckyDeal();

    res.json({
      success: true,
      isAdmin,
      freeTrialsLeft,
      totalFreeTrials: FREE_TRIALS,
      needsPhone: freeTrialsLeft > 0 && !phoneOk,
      phoneRegistered: !!user.phone,
      phoneVerified: user.phoneVerified,
      otpRequired: otpAvailable,
      otpChannel: otpChannel(),
      coins: user.coins,
      sessionCost: SESSION_COST,
      sessionCostToday: applyPercentOff(SESSION_COST, lucky.aiSessionPercentOff),
      luckyDeal: { level: lucky.level, label: lucky.label, aiSessionPercentOff: lucky.aiSessionPercentOff }
    });
  } catch (err: any) {
    console.error('[Recruiter Entitlement Error]', err);
    res.status(500).json({ error: 'Failed to resolve entitlement.' });
  }
});

// -----------------------------------------------------------------------------
// 1c. Phone OTP — free trials are anchored to a verified mobile number. The
// code goes out by SMS (Fast2SMS) when configured, else to the account email;
// if neither channel exists, verification is skipped (legacy direct-set path).
// -----------------------------------------------------------------------------


recruiterRouter.post('/phone/verify-otp', async (req, res) => {
  try {
    const viewer = await resolvedViewerFromRequest(req, true);
    if (!viewer.email) return res.status(401).json({ error: 'Unauthorized' });

    const user = await prisma.user.findUnique({ where: { email: viewer.email } });
    if (!user) return res.status(404).json({ error: 'User not found' });

    const code = String(req.body?.code || '').trim();
    if (!user.pendingPhone || !user.phoneOtpHash) {
      return res.status(409).json({ error: 'No verification in progress — request an OTP first.' });
    }
    if (!user.phoneOtpExpiresAt || user.phoneOtpExpiresAt.getTime() < Date.now()) {
      return res.status(410).json({ error: 'This OTP has expired — request a fresh one.' });
    }
    if (!verifyOtpHash(code, user.phoneOtpHash)) {
      return res.status(400).json({ error: 'Incorrect OTP. Check the code and try again.' });
    }

    try {
      await prisma.user.update({
        where: { id: user.id },
        data: {
          phone: user.pendingPhone,
          phoneVerified: true,
          pendingPhone: null,
          phoneOtpHash: null,
          phoneOtpExpiresAt: null
        }
      });
    } catch (e: any) {
      if (e?.code === 'P2002') {
        return res.status(409).json({ error: 'This mobile number was just linked to another account.', code: 'PHONE_TAKEN' });
      }
      throw e;
    }

    res.json({ success: true, phoneVerified: true });
  } catch (err: any) {
    console.error('[OTP Verify Error]', err);
    res.status(500).json({ error: 'Failed to verify the OTP.' });
  }
});

// -----------------------------------------------------------------------------
// 2. The Gate & Session Initialization
// Pricing ladder: ADMIN → free · free trial (needs a unique verified mobile
// number so trials can't be farmed via throwaway emails) → coins.
// -----------------------------------------------------------------------------
recruiterRouter.post('/sessions', async (req, res) => {
  try {
    const viewer = await resolvedViewerFromRequest(req, true);
    if (!viewer.email) return res.status(401).json({ error: 'Unauthorized' });

    const user = await prisma.user.findUnique({ where: { email: viewer.email } });
    if (!user) return res.status(404).json({ error: 'User not found' });

    const profile = await prisma.candidateProfile.findFirst({ where: { userId: user.id } });
    if (!profile) {
      return res.status(400).json({ error: 'Please complete your candidate profile first.' });
    }

    const isAdmin = user.role === 'ADMIN';
    const freeTrialsLeft = Math.max(0, FREE_TRIALS - user.freeInterviewsUsed);
    const otpAvailable = phoneOtpRequired();
    let paymentMode: 'ADMIN' | 'FREE_TRIAL' | 'COINS' = 'COINS';

    // Coin price for this session: lucky day and coupon both discount it, the
    // better of the two wins (they never stack).
    const lucky = todayLuckyDeal();
    let sessionCost = SESSION_COST;
    let appliedCoupon: { id: string; code: string } | null = null;
    let discountLabel: string | null = null;

    if (isAdmin) {
      paymentMode = 'ADMIN';
    } else if (freeTrialsLeft > 0) {
      // A trial is anchored to a mobile number — one quota per human, not per
      // email. With an OTP channel live, the number must actually be verified.
      if (otpAvailable) {
        if (!user.phone || !user.phoneVerified) {
          return res.status(400).json({ error: 'Verify your mobile number by OTP to claim your free interviews.', code: 'PHONE_OTP_REQUIRED', freeTrialsLeft });
        }
      } else if (!user.phone) {
        // Legacy path: no OTP channel configured anywhere — accept a raw number.
        const phone = normalizePhone(req.body?.phone);
        if (!phone) {
          return res.status(400).json({ error: 'Register your mobile number to claim your free interviews.', code: 'PHONE_REQUIRED', freeTrialsLeft });
        }
        try {
          await prisma.user.update({ where: { id: user.id }, data: { phone } });
        } catch (e: any) {
          if (e?.code === 'P2002') {
            return res.status(409).json({ error: 'This mobile number is already linked to another account — free trials are one set per person. You can still start a session with coins.', code: 'PHONE_TAKEN' });
          }
          throw e;
        }
      }
      paymentMode = 'FREE_TRIAL';
    } else {
      let percentOff = lucky.aiSessionPercentOff;
      if (percentOff > 0) discountLabel = `lucky day ${percentOff}% off`;

      if (req.body?.couponCode) {
        try {
          const coupon = await validateCoupon(req.body.couponCode, 'AI_SESSION', user.id);
          if (coupon.percentOff > percentOff) {
            percentOff = coupon.percentOff;
            appliedCoupon = { id: coupon.id, code: coupon.code };
            discountLabel = `coupon ${coupon.code} ${coupon.percentOff}% off`;
          }
        } catch (e: any) {
          if (e instanceof CouponError) return res.status(400).json({ error: e.message, code: 'COUPON_INVALID' });
          throw e;
        }
      }

      sessionCost = applyPercentOff(SESSION_COST, percentOff);

      // Pre-flight coin check so we never burn an LLM call for a user who can't afford the session.
      if (user.coins < sessionCost) {
        return res.status(402).json({ error: 'Insufficient coins.', required: sessionCost });
      }
    }

    // Generate the Round 1 opening BEFORE charging anything. If the AI engine is
    // unreachable we abort cleanly — the candidate never loses a trial or coins
    // on a dead session.
    const opening = await generateRoundOpening(profile, 'OA_DSA', 1);

    // Execute the transaction
    const session = await prisma.$transaction(async (tx) => {
      if (paymentMode === 'COINS') {
        if (sessionCost > 0) {
          const updatedUser = await tx.user.update({
            where: { id: user.id },
            data: { coins: { decrement: sessionCost } }
          });

          if (updatedUser.coins < 0) {
            throw new Error("INSUFFICIENT_COINS");
          }
        }

        // The unique (couponId, userId) constraint makes a concurrent double
        // redeem abort the whole transaction — no coupon is ever spent twice.
        if (appliedCoupon) {
          await redeemCoupon(tx, appliedCoupon.id, user.id, 'AI_SESSION');
        }

        await tx.activityLog.create({
          data: {
            userId: user.id,
            eventDescription: `Unlocked Premium AI Recruiter Session${discountLabel ? ` (${discountLabel})` : ''}`,
            coinDelta: -sessionCost
          }
        });
      } else if (paymentMode === 'FREE_TRIAL') {
        const updatedUser = await tx.user.update({
          where: { id: user.id },
          data: { freeInterviewsUsed: { increment: 1 } }
        });
        
        // Concurrent double-spend guard: the increment must stay within quota.
        if (updatedUser.freeInterviewsUsed > FREE_TRIALS) {
          throw new Error("TRIALS_EXHAUSTED");
        }
        await tx.activityLog.create({
          data: { userId: user.id, eventDescription: `Used AI Recruiter free trial (${updatedUser.freeInterviewsUsed}/${FREE_TRIALS})`, coinDelta: 0 }
        });
      }

      const created = await tx.interviewSession.create({
        data: {
          userId: user.id,
          profileId: profile.id,
          mode: 'FULL_PIPELINE',
          coinsSpent: paymentMode === 'COINS' ? sessionCost : 0,
          status: 'IN_PROGRESS',
          currentRound: 1,
          rounds: {
            create: [
              { type: 'OA_DSA', order: 1, cutoffScore: 65, problemStatement: opening.problemStatement },
              { type: 'RESUME_BASED', order: 2, cutoffScore: 70 },
              { type: 'BEHAVIORAL', order: 3, cutoffScore: 60 }
            ]
          }
        },
        include: { rounds: { orderBy: { order: 'asc' } } }
      });

      // Persist the interviewer's spoken opening as the first turn of Round 1
      const firstRound = created.rounds.find(r => r.order === 1)!;
      await tx.interviewTurn.create({
        data: { roundId: firstRound.id, role: 'INTERVIEWER', text: opening.speech }
      });

      return created;
    // Neon (serverless PG) round-trips are slow enough that the default 5s
    // interactive-transaction timeout aborts multi-statement writes mid-flight.
    }, { timeout: 30000, maxWait: 10000 });

    mailInterviewStarted(user.email, session.id, paymentMode);

    res.status(201).json({ success: true, session, paymentMode, coinsCharged: paymentMode === 'COINS' ? sessionCost : 0, discountApplied: discountLabel });
  } catch (err: any) {
    if (err.message === 'INSUFFICIENT_COINS') {
      return res.status(402).json({ error: 'Insufficient coins.', required: SESSION_COST });
    }
    if (err?.code === 'P2002' && String(err?.meta?.target || '').includes('couponId')) {
      return res.status(409).json({ error: 'This coupon was already used — remove it and retry.', code: 'COUPON_USED' });
    }
    if (err.message === 'TRIALS_EXHAUSTED') {
      return res.status(402).json({ error: 'Your free trials are used up. Sessions now cost coins.', required: SESSION_COST });
    }
    if (err instanceof RecruiterAiUnavailableError) {
      return res.status(503).json({ error: 'The interview engine is temporarily unavailable. You were not charged — please try again.', retryable: true });
    }
    console.error("[Recruiter Session Error]", err);
    res.status(500).json({ error: 'Failed to initialize interview session.' });
  }
});

// -----------------------------------------------------------------------------
// 2b. REAL RECRUITER MARKETPLACE
// Candidates browse human recruiters, request a slot, pay the total to the
// platform UPI (admin's number), submit the UTR, and the admin verifies it.
// -----------------------------------------------------------------------------
recruiterRouter.get('/human-recruiters', async (req, res) => {
  try {
    const viewer = await resolvedViewerFromRequest(req, true);
    if (!viewer.email) return res.status(401).json({ error: 'Unauthorized' });

    const user = await prisma.user.findUnique({ where: { email: viewer.email } });
    if (!user) return res.status(404).json({ error: 'User not found' });
    const isAdmin = user.role === 'ADMIN';

    // Directory only lists approved + active recruiters. Pending applications
    // stay invisible to candidates until I verify them.
    const recruiters = await prisma.humanRecruiter.findMany({
      where: { active: true, status: 'APPROVED' },
      orderBy: { feeInr: 'asc' }
    });

    // The viewer's own application (any status) so the page can show
    // "under review" / "rejected" instead of a dead form.
    const myApplication = await prisma.humanRecruiter.findUnique({
      where: { userId: user.id },
      select: { id: true, name: true, title: true, company: true, feeInr: true, status: true, active: true }
    });

    const pendingApplications = isAdmin
      ? await prisma.humanRecruiter.findMany({
          where: { status: 'PENDING' },
          include: { user: { select: { email: true, username: true } } },
          orderBy: { createdAt: 'asc' }
        })
      : [];

    // Directory prices must match what booking creation will actually charge —
    // including today's lucky-day platform-fee discount.
    const lucky = todayLuckyDeal();
    res.json({
      success: true,
      viewerIsAdmin: isAdmin,
      myApplication,
      pendingApplications,
      luckyDeal: { level: lucky.level, label: lucky.label, platformFeePercentOff: lucky.platformFeePercentOff },
      recruiters: recruiters.map(r => {
        const basePlatformFee = Math.max(PLATFORM_FEE_MIN_INR, Math.round(r.feeInr * PLATFORM_FEE_RATE));
        const platformFeeInr = applyPercentOff(basePlatformFee, lucky.platformFeePercentOff);
        return { ...r, platformFeeInr, totalInr: r.feeInr + platformFeeInr };
      })
    });
  } catch (err: any) {
    console.error('[Recruiter Directory Error]', err);
    res.status(500).json({ error: 'Failed to load the recruiter directory.' });
  }
});

// Any signed-in user can apply to get listed. The application sits in PENDING
// until the admin approves it — nothing shows up in the directory before that.
recruiterRouter.post('/human-recruiters/apply', async (req, res) => {
  try {
    const viewer = await resolvedViewerFromRequest(req, true);
    if (!viewer.email) return res.status(401).json({ error: 'Unauthorized' });

    const user = await prisma.user.findUnique({ where: { email: viewer.email } });
    if (!user) return res.status(404).json({ error: 'User not found' });

    const { name, title, company, expertise, bio, feeInr, contactPhone } = req.body || {};
    if (!name || !title || !company || !Number.isFinite(Number(feeInr)) || Number(feeInr) < 0) {
      return res.status(400).json({ error: 'Name, title, company and a valid session fee are required.' });
    }
    const phone = normalizePhone(contactPhone);
    if (!phone) {
      return res.status(400).json({ error: 'A valid 10-digit contact number is required — it is how the admin coordinates slots and payouts with you.' });
    }

    const fields = {
      name: String(name).substring(0, 100),
      title: String(title).substring(0, 120),
      company: String(company).substring(0, 120),
      expertise: Array.isArray(expertise) ? expertise.map(String).slice(0, 10) : [],
      bio: bio ? String(bio).substring(0, 2000) : null,
      feeInr: Math.round(Number(feeInr)),
      contactPhone: phone
    };

    const existing = await prisma.humanRecruiter.findUnique({ where: { userId: user.id } });
    if (existing) {
      if (existing.status === 'PENDING') {
        return res.status(409).json({ error: 'Your application is already under review.' });
      }
      if (existing.status === 'APPROVED') {
        return res.status(409).json({ error: 'You are already listed as a recruiter. Contact the admin to edit your listing.' });
      }
      // Rejected once — let them fix the profile and try again.
      const reapplied = await prisma.humanRecruiter.update({
        where: { id: existing.id },
        data: { ...fields, status: 'PENDING', active: false }
      });
      mailRecruiterApplied(user.email, fields.name);
      return res.json({ success: true, application: reapplied, reapplied: true });
    }

    const application = await prisma.humanRecruiter.create({
      data: { ...fields, userId: user.id, status: 'PENDING', active: false }
    });

    mailRecruiterApplied(user.email, fields.name);

    res.status(201).json({ success: true, application });
  } catch (err: any) {
    console.error('[Recruiter Apply Error]', err);
    res.status(500).json({ error: 'Failed to submit your recruiter application.' });
  }
});

// Admin decision on an application. Approve = goes live in the directory.
recruiterRouter.post('/human-recruiters/:id/approve', async (req, res) => {
  try {
    const viewer = await resolvedViewerFromRequest(req, true);
    if (!viewer.email) return res.status(401).json({ error: 'Unauthorized' });

    const user = await prisma.user.findUnique({ where: { email: viewer.email } });
    if (!user || user.role !== 'ADMIN') return res.status(403).json({ error: 'Admin permit required.' });

    const application = await prisma.humanRecruiter.findUnique({ where: { id: req.params.id }, include: { user: { select: { email: true } } } });
    if (!application) return res.status(404).json({ error: 'Application not found.' });
    if (application.status !== 'PENDING') {
      return res.status(409).json({ error: 'This application is not pending.', status: application.status });
    }

    const approved = await prisma.humanRecruiter.update({
      where: { id: application.id },
      data: { status: 'APPROVED', active: true }
    });

    if (application.user?.email) mailRecruiterDecision(application.user.email, application.name, true, application.feeInr);

    res.json({ success: true, recruiter: approved });
  } catch (err: any) {
    console.error('[Recruiter Approve Error]', err);
    res.status(500).json({ error: 'Failed to approve the application.' });
  }
});

recruiterRouter.post('/human-recruiters/:id/reject', async (req, res) => {
  try {
    const viewer = await resolvedViewerFromRequest(req, true);
    if (!viewer.email) return res.status(401).json({ error: 'Unauthorized' });

    const user = await prisma.user.findUnique({ where: { email: viewer.email } });
    if (!user || user.role !== 'ADMIN') return res.status(403).json({ error: 'Admin permit required.' });

    const application = await prisma.humanRecruiter.findUnique({ where: { id: req.params.id }, include: { user: { select: { email: true } } } });
    if (!application) return res.status(404).json({ error: 'Application not found.' });
    if (application.status !== 'PENDING') {
      return res.status(409).json({ error: 'This application is not pending.', status: application.status });
    }

    const rejected = await prisma.humanRecruiter.update({
      where: { id: application.id },
      data: { status: 'REJECTED', active: false }
    });

    if (application.user?.email) mailRecruiterDecision(application.user.email, application.name, false);

    res.json({ success: true, application: rejected });
  } catch (err: any) {
    console.error('[Recruiter Reject Error]', err);
    res.status(500).json({ error: 'Failed to reject the application.' });
  }
});

// Admin-only: add a human recruiter listing.
recruiterRouter.post('/human-recruiters', async (req, res) => {
  try {
    const viewer = await resolvedViewerFromRequest(req, true);
    if (!viewer.email) return res.status(401).json({ error: 'Unauthorized' });

    const user = await prisma.user.findUnique({ where: { email: viewer.email } });
    if (!user || user.role !== 'ADMIN') return res.status(403).json({ error: 'Admin permit required.' });

    const { name, title, company, expertise, bio, feeInr, contactPhone } = req.body || {};
    if (!name || !title || !company || !Number.isFinite(Number(feeInr)) || Number(feeInr) < 0) {
      return res.status(400).json({ error: 'name, title, company and a valid feeInr are required.' });
    }

    const recruiter = await prisma.humanRecruiter.create({
      data: {
        name: String(name),
        title: String(title),
        company: String(company),
        expertise: Array.isArray(expertise) ? expertise.map(String) : [],
        bio: bio ? String(bio) : null,
        feeInr: Math.round(Number(feeInr)),
        contactPhone: normalizePhone(contactPhone),
        status: 'APPROVED',
        active: true
      }
    });

    res.status(201).json({ success: true, recruiter });
  } catch (err: any) {
    console.error('[Recruiter Listing Error]', err);
    res.status(500).json({ error: 'Failed to create the recruiter listing.' });
  }
});

// Create a booking request → returns UPI payment instructions.
recruiterRouter.post('/bookings', async (req, res) => {
  try {
    const viewer = await resolvedViewerFromRequest(req, true);
    if (!viewer.email) return res.status(401).json({ error: 'Unauthorized' });

    const user = await prisma.user.findUnique({ where: { email: viewer.email } });
    if (!user) return res.status(404).json({ error: 'User not found' });

    const { recruiterId, preferredAt, note, contactPhone } = req.body || {};
    const slot = preferredAt ? new Date(preferredAt) : null;
    if (!recruiterId || !slot || isNaN(slot.getTime())) {
      return res.status(400).json({ error: 'recruiterId and a valid preferredAt datetime are required.' });
    }
    if (slot.getTime() < Date.now() + 60 * 60 * 1000) {
      return res.status(400).json({ error: 'Pick a slot at least 1 hour from now.' });
    }

    // The recruiter calls this number to confirm the meet before the session.
    const phone = normalizePhone(contactPhone) || user.phone;
    if (!phone) {
      return res.status(400).json({ error: 'Add a 10-digit contact number — the recruiter calls you on it to confirm the meet.', code: 'PHONE_REQUIRED' });
    }

    const recruiter = await prisma.humanRecruiter.findUnique({ where: { id: recruiterId } });
    if (!recruiter || !recruiter.active) {
      return res.status(404).json({ error: 'This recruiter is not available.' });
    }

    // Lucky days discount ONLY the platform's cut — the recruiter's fee is
    // their income and always stays whole.
    const lucky = todayLuckyDeal();
    const basePlatformFee = Math.max(PLATFORM_FEE_MIN_INR, Math.round(recruiter.feeInr * PLATFORM_FEE_RATE));
    const platformFeeInr = applyPercentOff(basePlatformFee, lucky.platformFeePercentOff);
    const totalInr = recruiter.feeInr + platformFeeInr;

    const booking = await prisma.recruiterBooking.create({
      data: {
        userId: user.id,
        recruiterId: recruiter.id,
        preferredAt: slot,
        note: note ? String(note).substring(0, 1000) : null,
        contactPhone: phone,
        recruiterFeeInr: recruiter.feeInr,
        platformFeeInr,
        totalInr,
        status: 'PENDING_PAYMENT'
      },
      include: { recruiter: true }
    });

    mailBookingCreated(user.email, { id: booking.id, totalInr, preferredAt: slot, recruiterName: recruiter.name }, PLATFORM_UPI_ID);

    res.status(201).json({
      success: true,
      booking,
      payment: {
        // Online gateway (cards / UPI / netbanking / wallets) when keys are set,
        // manual UPI + UTR always available as the zero-dependency path.
        razorpayAvailable: razorpayEnabled(),
        upiId: PLATFORM_UPI_ID,
        amountInr: totalInr,
        reference: booking.id,
        upiLink: `upi://pay?pa=${encodeURIComponent(PLATFORM_UPI_ID)}&pn=${encodeURIComponent('DivineCode')}&am=${totalInr}&cu=INR&tn=${encodeURIComponent('Booking ' + booking.id.slice(-8))}`,
        instructions: `Pay ₹${totalInr} online below, or manually to ${PLATFORM_UPI_ID} via any UPI app and submit the UTR. The slot locks once payment is verified.`
      }
    });
  } catch (err: any) {
    console.error('[Booking Create Error]', err);
    res.status(500).json({ error: 'Failed to create the booking.' });
  }
});

// -----------------------------------------------------------------------------
// Online payment (Razorpay) — one gateway, every mode: cards, UPI, netbanking,
// wallets. Order is created server-side, Checkout runs on the client, and the
// returned signature is verified here before the booking confirms. No webhook
// needed for this flow; the HMAC check is the source of truth.
// -----------------------------------------------------------------------------
recruiterRouter.post('/bookings/:id/pay/order', async (req, res) => {
  try {
    const viewer = await resolvedViewerFromRequest(req, true);
    if (!viewer.email) return res.status(401).json({ error: 'Unauthorized' });

    if (!razorpayEnabled()) {
      return res.status(503).json({ error: 'Online payment is not configured yet — pay via the manual UPI option instead.' });
    }

    const user = await prisma.user.findUnique({ where: { email: viewer.email } });
    if (!user) return res.status(404).json({ error: 'User not found' });

    const booking = await prisma.recruiterBooking.findUnique({ where: { id: req.params.id }, include: { recruiter: true } });
    if (!booking || booking.userId !== user.id) return res.status(404).json({ error: 'Booking not found.' });
    if (booking.status !== 'PENDING_PAYMENT') {
      return res.status(409).json({ error: 'This booking is not awaiting payment.', status: booking.status });
    }

    const order = await createRazorpayOrder(booking.totalInr, booking.id, {
      bookingId: booking.id,
      recruiter: booking.recruiter.name
    });

    await prisma.recruiterBooking.update({
      where: { id: booking.id },
      data: { razorpayOrderId: order.id, paymentMethod: 'RAZORPAY' }
    });

    res.json({
      success: true,
      keyId: razorpayKeyId(),
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
      name: 'DivineCode',
      description: `Live interview with ${booking.recruiter.name}`,
      prefill: { name: user.name || user.username, email: user.email }
    });
  } catch (err: any) {
    console.error('[Razorpay Order Error]', err?.response?.data || err?.message);
    res.status(502).json({ error: 'Could not reach the payment gateway. Try again, or use the manual UPI option.' });
  }
});

recruiterRouter.post('/bookings/:id/pay/verify', async (req, res) => {
  try {
    const viewer = await resolvedViewerFromRequest(req, true);
    if (!viewer.email) return res.status(401).json({ error: 'Unauthorized' });

    const user = await prisma.user.findUnique({ where: { email: viewer.email } });
    if (!user) return res.status(404).json({ error: 'User not found' });

    const booking = await prisma.recruiterBooking.findUnique({
      where: { id: req.params.id },
      include: { recruiter: { include: { user: { select: { email: true } } } } }
    });
    if (!booking || booking.userId !== user.id) return res.status(404).json({ error: 'Booking not found.' });
    if (booking.status === 'CONFIRMED') {
      return res.json({ success: true, booking }); // double-submit from checkout is harmless
    }
    if (booking.status !== 'PENDING_PAYMENT') {
      return res.status(409).json({ error: 'This booking is not awaiting payment.', status: booking.status });
    }

    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body || {};
    if (booking.razorpayOrderId !== razorpay_order_id) {
      return res.status(400).json({ error: 'Payment does not match this booking.' });
    }
    if (!verifyRazorpaySignature(razorpay_order_id, razorpay_payment_id, razorpay_signature)) {
      return res.status(400).json({ error: 'Payment signature verification failed. If money was deducted it will auto-refund — contact the admin otherwise.' });
    }

    // Signature is cryptographic proof the gateway captured the money. The
    // slot still needs the recruiter to confirm they are actually free — the
    // live room is only minted when they accept.
    const updated = await prisma.recruiterBooking.update({
      where: { id: booking.id },
      data: {
        status: 'AWAITING_RECRUITER_CONFIRMATION',
        razorpayPaymentId: String(razorpay_payment_id)
      },
      include: { recruiter: true }
    });

    const candidateName = user.name || user.username;
    mailBookingPaidAwaitingRecruiter(user.email, {
      id: booking.id, preferredAt: booking.preferredAt, recruiterName: booking.recruiter.name, totalInr: booking.totalInr
    });
    mailRecruiterAvailabilityRequest(booking.recruiter.user?.email || null, {
      id: booking.id,
      preferredAt: booking.preferredAt,
      recruiterName: booking.recruiter.name,
      candidateName,
      candidatePhone: (booking as any).contactPhone || user.phone,
      recruiterFeeInr: booking.recruiterFeeInr
    });
    sendNotification(user.id, 'Payment confirmed ✓', `Waiting for ${booking.recruiter.name} to confirm your slot — expect a call.`, '/recruiter/book', 'SUCCESS');
    if (booking.recruiter.userId) {
      sendNotification(booking.recruiter.userId, 'Paid booking needs your confirmation', `${candidateName} paid for a session — confirm you are free.`, '/recruiter/book', 'WARNING');
    }

    res.json({ success: true, booking: updated });
  } catch (err: any) {
    console.error('[Razorpay Verify Error]', err);
    res.status(500).json({ error: 'Payment verification failed. Contact the admin with your payment ID.' });
  }
});

// Candidate submits the UPI transaction reference after paying.
recruiterRouter.post('/bookings/:id/payment', async (req, res) => {
  try {
    const viewer = await resolvedViewerFromRequest(req, true);
    if (!viewer.email) return res.status(401).json({ error: 'Unauthorized' });

    const user = await prisma.user.findUnique({ where: { email: viewer.email } });
    if (!user) return res.status(404).json({ error: 'User not found' });

    const booking = await prisma.recruiterBooking.findUnique({ where: { id: req.params.id } });
    if (!booking || booking.userId !== user.id) {
      return res.status(404).json({ error: 'Booking not found.' });
    }
    if (booking.status !== 'PENDING_PAYMENT') {
      return res.status(409).json({ error: 'This booking is not awaiting payment.', status: booking.status });
    }

    const ref = String(req.body?.upiTransactionRef || '').trim();
    if (ref.length < 6 || ref.length > 40) {
      return res.status(400).json({ error: 'Enter the UPI transaction reference (UTR) shown in your payment app.' });
    }

    const updated = await prisma.recruiterBooking.update({
      where: { id: booking.id },
      data: { status: 'AWAITING_VERIFICATION', upiTransactionRef: ref, paymentMethod: 'UPI_MANUAL' },
      include: { recruiter: true }
    });

    mailPaymentUnderVerification(user.email, {
      id: booking.id, totalInr: booking.totalInr, recruiterName: updated.recruiter.name, upiTransactionRef: ref
    });

    res.json({ success: true, booking: updated });
  } catch (err: any) {
    console.error('[Booking Payment Error]', err);
    res.status(500).json({ error: 'Failed to record the payment reference.' });
  }
});

// My bookings (admins see every booking, with candidate identity, for verification).
recruiterRouter.get('/bookings', async (req, res) => {
  try {
    const viewer = await resolvedViewerFromRequest(req, true);
    if (!viewer.email) return res.status(401).json({ error: 'Unauthorized' });

    const user = await prisma.user.findUnique({ where: { email: viewer.email } });
    if (!user) return res.status(404).json({ error: 'User not found' });

    const isAdmin = user.role === 'ADMIN';
    const bookings = await prisma.recruiterBooking.findMany({
      where: isAdmin ? {} : { userId: user.id },
      include: {
        recruiter: true,
        ...(isAdmin ? { user: { select: { email: true, username: true } } } : {})
      },
      orderBy: { createdAt: 'desc' },
      take: 100
    });

    // If the viewer is a listed recruiter, they also get their side of the
    // schedule — the paid sessions candidates booked WITH them.
    const myRecruiterProfile = await prisma.humanRecruiter.findUnique({ where: { userId: user.id } });
    const assignedBookings = myRecruiterProfile
      ? await prisma.recruiterBooking.findMany({
          where: { recruiterId: myRecruiterProfile.id, status: { in: ['AWAITING_RECRUITER_CONFIRMATION', 'CONFIRMED', 'COMPLETED'] } },
          include: { user: { select: { username: true, name: true, phone: true } } },
          orderBy: { preferredAt: 'asc' },
          take: 50
        })
      : [];

    res.json({ success: true, bookings, assignedBookings, viewerIsAdmin: isAdmin, razorpayAvailable: razorpayEnabled() });
  } catch (err: any) {
    console.error('[Booking List Error]', err);
    res.status(500).json({ error: 'Failed to load bookings.' });
  }
});

// Live room access for a confirmed booking. Three permits: the candidate who
// paid, the recruiter taking the session (via their linked account), the admin.
recruiterRouter.get('/bookings/:id/call', async (req, res) => {
  try {
    const viewer = await resolvedViewerFromRequest(req, true);
    if (!viewer.email) return res.status(401).json({ error: 'Unauthorized' });

    const user = await prisma.user.findUnique({ where: { email: viewer.email } });
    if (!user) return res.status(404).json({ error: 'User not found' });

    const booking = await prisma.recruiterBooking.findUnique({
      where: { id: req.params.id },
      include: { recruiter: true, user: { select: { username: true, name: true } } }
    });
    if (!booking) return res.status(404).json({ error: 'Booking not found.' });

    const isAdmin = user.role === 'ADMIN';
    const isCandidate = booking.userId === user.id;
    const isRecruiter = !!booking.recruiter.userId && booking.recruiter.userId === user.id;
    if (!isAdmin && !isCandidate && !isRecruiter) {
      return res.status(404).json({ error: 'Booking not found.' });
    }

    if (booking.status !== 'CONFIRMED' && booking.status !== 'COMPLETED') {
      return res.status(409).json({ error: 'The live room opens once the booking is confirmed.', status: booking.status });
    }

    // Legacy confirmed bookings from before rooms existed get one on first join.
    let roomId = booking.meetingRoomId;
    if (!roomId) {
      roomId = mintMeetingRoom(booking.id);
      await prisma.recruiterBooking.update({ where: { id: booking.id }, data: { meetingRoomId: roomId } });
    }

    res.json({
      success: true,
      roomId,
      subject: `Mock Interview — ${booking.user.name || booking.user.username} × ${booking.recruiter.name}`,
      displayName: isRecruiter ? booking.recruiter.name : (user.name || user.username),
      scheduledAt: booking.preferredAt,
      recruiterName: booking.recruiter.name,
      candidateName: booking.user.name || booking.user.username,
      viewerRole: isRecruiter ? 'RECRUITER' : isCandidate ? 'CANDIDATE' : 'ADMIN'
    });
  } catch (err: any) {
    console.error('[Booking Call Error]', err);
    res.status(500).json({ error: 'Failed to open the live room.' });
  }
});

// Admin verifies the UPI payment landed and locks the slot in.
recruiterRouter.post('/bookings/:id/verify', async (req, res) => {
  try {
    const viewer = await resolvedViewerFromRequest(req, true);
    if (!viewer.email) return res.status(401).json({ error: 'Unauthorized' });

    const user = await prisma.user.findUnique({ where: { email: viewer.email } });
    if (!user || user.role !== 'ADMIN') return res.status(403).json({ error: 'Admin permit required.' });

    const booking = await prisma.recruiterBooking.findUnique({
      where: { id: req.params.id },
      include: { user: true, recruiter: { include: { user: { select: { email: true } } } } }
    });
    if (!booking) return res.status(404).json({ error: 'Booking not found.' });
    if (booking.status !== 'AWAITING_VERIFICATION') {
      return res.status(409).json({ error: 'This booking is not awaiting verification.', status: booking.status });
    }

    // Money confirmed — now the recruiter must confirm they are free before
    // the live room is minted.
    const updated = await prisma.recruiterBooking.update({
      where: { id: booking.id },
      data: { status: 'AWAITING_RECRUITER_CONFIRMATION' },
      include: { recruiter: true }
    });

    const candidateName = booking.user.name || booking.user.username;
    mailBookingPaidAwaitingRecruiter(booking.user.email, {
      id: booking.id, preferredAt: booking.preferredAt, recruiterName: booking.recruiter.name, totalInr: booking.totalInr
    });
    mailRecruiterAvailabilityRequest(booking.recruiter.user?.email || null, {
      id: booking.id,
      preferredAt: booking.preferredAt,
      recruiterName: booking.recruiter.name,
      candidateName,
      candidatePhone: (booking as any).contactPhone || booking.user.phone,
      recruiterFeeInr: booking.recruiterFeeInr
    });
    sendNotification(booking.userId, 'Payment verified ✓', `Waiting for ${booking.recruiter.name} to confirm your slot — expect a call.`, '/recruiter/book', 'SUCCESS');
    if (booking.recruiter.userId) {
      sendNotification(booking.recruiter.userId, 'Paid booking needs your confirmation', `${candidateName} paid for a session — confirm you are free.`, '/recruiter/book', 'WARNING');
    }

    res.json({ success: true, booking: updated });
  } catch (err: any) {
    console.error('[Booking Verify Error]', err);
    res.status(500).json({ error: 'Failed to verify the booking.' });
  }
});

// Recruiter (or admin, for unlinked listings) confirms they are free for the
// paid slot — THIS is what mints the live room and locks the session in.
recruiterRouter.post('/bookings/:id/accept', async (req, res) => {
  try {
    const viewer = await resolvedViewerFromRequest(req, true);
    if (!viewer.email) return res.status(401).json({ error: 'Unauthorized' });

    const user = await prisma.user.findUnique({ where: { email: viewer.email } });
    if (!user) return res.status(404).json({ error: 'User not found' });

    const booking = await prisma.recruiterBooking.findUnique({
      where: { id: req.params.id },
      include: { user: true, recruiter: { include: { user: { select: { email: true } } } } }
    });
    if (!booking) return res.status(404).json({ error: 'Booking not found.' });

    const isAdmin = user.role === 'ADMIN';
    const isRecruiter = !!booking.recruiter.userId && booking.recruiter.userId === user.id;
    if (!isAdmin && !isRecruiter) return res.status(403).json({ error: 'Only the recruiter or the admin can confirm this booking.' });
    if (booking.status !== 'AWAITING_RECRUITER_CONFIRMATION') {
      return res.status(409).json({ error: 'This booking is not awaiting recruiter confirmation.', status: booking.status });
    }

    const updated = await prisma.recruiterBooking.update({
      where: { id: booking.id },
      data: { status: 'CONFIRMED', meetingRoomId: booking.meetingRoomId || mintMeetingRoom(booking.id) },
      include: { recruiter: true }
    });

    // Both sides get the live room link + each other's number for the
    // confirmation call.
    mailBookingConfirmed(booking.user.email, booking.recruiter.user?.email || null, {
      id: booking.id,
      preferredAt: booking.preferredAt,
      recruiterName: booking.recruiter.name,
      candidateName: booking.user.name || booking.user.username,
      candidatePhone: (booking as any).contactPhone || booking.user.phone,
      recruiterPhone: booking.recruiter.contactPhone
    });
    sendNotification(booking.userId, 'Interview confirmed 🎉', `${booking.recruiter.name} confirmed your slot — they will call you before the session. Live room link is in your email.`, '/recruiter/book', 'SUCCESS');

    res.json({ success: true, booking: updated });
  } catch (err: any) {
    console.error('[Booking Accept Error]', err);
    res.status(500).json({ error: 'Failed to confirm the booking.' });
  }
});

// Recruiter can't make the slot — the admin settles the refund manually.
recruiterRouter.post('/bookings/:id/decline', async (req, res) => {
  try {
    const viewer = await resolvedViewerFromRequest(req, true);
    if (!viewer.email) return res.status(401).json({ error: 'Unauthorized' });

    const user = await prisma.user.findUnique({ where: { email: viewer.email } });
    if (!user) return res.status(404).json({ error: 'User not found' });

    const booking = await prisma.recruiterBooking.findUnique({
      where: { id: req.params.id },
      include: { user: true, recruiter: true }
    });
    if (!booking) return res.status(404).json({ error: 'Booking not found.' });

    const isAdmin = user.role === 'ADMIN';
    const isRecruiter = !!booking.recruiter.userId && booking.recruiter.userId === user.id;
    if (!isAdmin && !isRecruiter) return res.status(403).json({ error: 'Only the recruiter or the admin can decline this booking.' });
    if (booking.status !== 'AWAITING_RECRUITER_CONFIRMATION') {
      return res.status(409).json({ error: 'This booking is not awaiting recruiter confirmation.', status: booking.status });
    }

    const updated = await prisma.recruiterBooking.update({
      where: { id: booking.id },
      data: { status: 'CANCELLED' },
      include: { recruiter: true }
    });

    mailBookingCancelled(booking.user.email, {
      id: booking.id, recruiterName: booking.recruiter.name, totalInr: booking.totalInr, wasPaid: true
    });
    sendNotification(booking.userId, 'Booking declined', `${booking.recruiter.name} is not available for that slot. The admin will settle your refund.`, '/recruiter/book', 'WARNING');

    res.json({ success: true, booking: updated });
  } catch (err: any) {
    console.error('[Booking Decline Error]', err);
    res.status(500).json({ error: 'Failed to decline the booking.' });
  }
});

// Cancel: owner may cancel before confirmation; admin may cancel anything.
recruiterRouter.post('/bookings/:id/cancel', async (req, res) => {
  try {
    const viewer = await resolvedViewerFromRequest(req, true);
    if (!viewer.email) return res.status(401).json({ error: 'Unauthorized' });

    const user = await prisma.user.findUnique({ where: { email: viewer.email } });
    if (!user) return res.status(404).json({ error: 'User not found' });

    const booking = await prisma.recruiterBooking.findUnique({ where: { id: req.params.id }, include: { user: true, recruiter: true } });
    if (!booking) return res.status(404).json({ error: 'Booking not found.' });

    const isAdmin = user.role === 'ADMIN';
    const isOwner = booking.userId === user.id;
    if (!isAdmin && !isOwner) return res.status(404).json({ error: 'Booking not found.' });
    if (!isAdmin && !['PENDING_PAYMENT', 'AWAITING_VERIFICATION'].includes(booking.status)) {
      return res.status(409).json({ error: 'A confirmed booking can only be cancelled by the admin (refunds are settled manually).' });
    }
    if (booking.status === 'CANCELLED') {
      return res.status(409).json({ error: 'Already cancelled.' });
    }

    const wasPaid = booking.status !== 'PENDING_PAYMENT';
    const updated = await prisma.recruiterBooking.update({
      where: { id: booking.id },
      data: { status: 'CANCELLED' },
      include: { recruiter: true }
    });

    mailBookingCancelled(booking.user.email, {
      id: booking.id, recruiterName: booking.recruiter.name, totalInr: booking.totalInr, wasPaid
    });

    res.json({ success: true, booking: updated });
  } catch (err: any) {
    console.error('[Booking Cancel Error]', err);
    res.status(500).json({ error: 'Failed to cancel the booking.' });
  }
});

// -----------------------------------------------------------------------------
// Recruiter permit — a user whose account is linked to an APPROVED marketplace
// recruiter listing holds the same session powers an admin does: open any
// interview session, force-advance (skip) rounds, and read the debrief.
// Walking candidates through the pipeline is literally their job.
// -----------------------------------------------------------------------------
async function isApprovedRecruiter(userId: string): Promise<boolean> {
  try {
    const listing = await prisma.humanRecruiter.findUnique({
      where: { userId },
      select: { status: true }
    });
    return listing?.status === 'APPROVED';
  } catch {
    return false;
  }
}

// -----------------------------------------------------------------------------
// 3. Fetch Session State (For resuming page reloads)
// -----------------------------------------------------------------------------
recruiterRouter.get('/sessions/:id', async (req, res) => {
  try {
    const viewer = await resolvedViewerFromRequest(req, true);
    if (!viewer.email) return res.status(401).json({ error: 'Unauthorized' });

    const user = await prisma.user.findUnique({ where: { email: viewer.email } });
    if (!user) return res.status(404).json({ error: 'User not found' });

    const session = await prisma.interviewSession.findUnique({
      where: { id: req.params.id },
      include: {
        profile: true,
        rounds: {
          include: { turns: { orderBy: { createdAt: 'asc' } } },
          orderBy: { order: 'asc' }
        }
      }
    });

    // Admins hold an inspection permit: they may open ANY session (their own
    // test runs or a user's live one) to verify every stage of the pipeline.
    // Approved marketplace recruiters hold the same permit.
    const viewerIsAdmin = user.role === 'ADMIN';
    const viewerIsRecruiter = !viewerIsAdmin && await isApprovedRecruiter(user.id);
    const viewerIsOwner = !!session && session.userId === user.id;
    if (!session || (!viewerIsOwner && !viewerIsAdmin && !viewerIsRecruiter)) {
      return res.status(404).json({ error: 'Session not found or unauthorized.' });
    }

    // Self-heal: if the active round has no AI-generated opening yet (legacy
    // session or an earlier partial failure), generate and persist it now.
    const activeRound = session.rounds.find(r => r.order === session.currentRound);
    if (session.status === 'IN_PROGRESS' && activeRound && (!activeRound.problemStatement || activeRound.turns.length === 0)) {
      const opening = await generateRoundOpening(session.profile, activeRound.type, activeRound.order);

      if (!activeRound.problemStatement) {
        await prisma.interviewRound.update({
          where: { id: activeRound.id },
          data: { problemStatement: opening.problemStatement }
        });
        activeRound.problemStatement = opening.problemStatement;
      }

      if (activeRound.turns.length === 0) {
        const turn = await prisma.interviewTurn.create({
          data: { roundId: activeRound.id, role: 'INTERVIEWER', text: opening.speech }
        });
        activeRound.turns.push(turn);
      }
    }

    res.json({ success: true, session, viewerIsAdmin, viewerIsRecruiter, viewerIsOwner });
  } catch (err: any) {
    if (err instanceof RecruiterAiUnavailableError) {
      return res.status(503).json({ error: 'The interview engine is temporarily unavailable. Please retry in a moment.', retryable: true });
    }
    console.error("[Recruiter Session Fetch Error]", err);
    res.status(500).json({ error: 'Failed to fetch session state.' });
  }
});

// -----------------------------------------------------------------------------
// 3b. Moderator Permit: Force-Advance Round
// Lets an ADMIN or an approved marketplace RECRUITER conclude the active round
// as passed and open the next one, so every stage of the pipeline can be
// walked through without having to genuinely clear each round against the AI.
// -----------------------------------------------------------------------------
recruiterRouter.post('/sessions/:id/advance', async (req, res) => {
  try {
    const viewer = await resolvedViewerFromRequest(req, true);
    if (!viewer.email) return res.status(401).json({ error: 'Unauthorized' });

    const user = await prisma.user.findUnique({ where: { email: viewer.email } });
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (user.role !== 'ADMIN' && !(await isApprovedRecruiter(user.id))) {
      return res.status(403).json({ error: 'Admin or recruiter permit required.' });
    }

    const session = await prisma.interviewSession.findUnique({
      where: { id: req.params.id },
      include: {
        profile: true,
        rounds: { include: { turns: { orderBy: { createdAt: 'asc' } } }, orderBy: { order: 'asc' } }
      }
    });

    if (!session) return res.status(404).json({ error: 'Session not found.' });
    if (session.status !== 'IN_PROGRESS') {
      return res.status(409).json({ error: 'This interview session has already concluded.', sessionStatus: session.status });
    }

    const round = session.rounds.find(r => r.order === session.currentRound);
    if (!round || round.endedAt) {
      return res.status(409).json({ error: 'No active round to advance.', currentRound: session.currentRound });
    }

    // Preserve any real scores accrued before the skip; a fresh round has none.
    const scored = round.turns.filter(t => t.role === 'INTERVIEWER' && t.technicalScore !== null);
    const finalScore = scored.length > 0
      ? Math.round((
          scored.reduce((acc, t) => acc + (t.technicalScore || 0), 0) / scored.length +
          scored.reduce((acc, t) => acc + (t.fluencyScore || 0), 0) / scored.length
        ) / 2)
      : null;

    // LLM call happens BEFORE the transaction so it never holds DB locks.
    const nextRound = session.rounds.find(r => r.order === round.order + 1);
    const nextOpening = nextRound
      ? await generateRoundOpening(session.profile, nextRound.type, nextRound.order)
      : null;

    await prisma.$transaction(async (tx) => {
      await tx.interviewRound.update({
        where: { id: round.id },
        data: { endedAt: new Date(), passed: true, finalScore }
      });

      if (nextRound && nextOpening) {
        await tx.interviewRound.update({
          where: { id: nextRound.id },
          data: { problemStatement: nextOpening.problemStatement, startedAt: new Date() }
        });
        await tx.interviewTurn.create({
          data: { roundId: nextRound.id, role: 'INTERVIEWER', text: nextOpening.speech }
        });
        await tx.interviewSession.update({
          where: { id: session.id },
          data: { currentRound: nextRound.order }
        });
      } else {
        await tx.interviewSession.update({
          where: { id: session.id },
          data: { status: 'PASSED', completedAt: new Date() }
        });
      }
    }, { timeout: 30000, maxWait: 10000 });

    if (!nextRound) {
      const owner = await prisma.user.findUnique({ where: { id: session.userId }, select: { email: true } });
      if (owner?.email) mailInterviewConcluded(owner.email, session.id, true);
    }

    res.json({
      success: true,
      skippedRound: round.order,
      sessionStatus: nextRound ? 'IN_PROGRESS' : 'PASSED',
      nextRound: nextRound && nextOpening ? {
        id: nextRound.id,
        order: nextRound.order,
        type: nextRound.type,
        problemStatement: nextOpening.problemStatement,
        openingSpeech: nextOpening.speech
      } : null
    });
  } catch (err: any) {
    if (err instanceof RecruiterAiUnavailableError) {
      return res.status(503).json({ error: 'The interview engine is temporarily unavailable — could not open the next round. Please retry.', retryable: true });
    }
    console.error("[Recruiter Advance Error]", err);
    res.status(500).json({ error: 'Failed to advance the interview round.' });
  }
});
// -----------------------------------------------------------------------------
// 3c. Live Code Execution (OA_DSA round) — real compile & run via the same
// Wandbox engine that powers contest judging. Marketing copy finally honest.
// -----------------------------------------------------------------------------
recruiterRouter.post('/sessions/:id/run', async (req, res) => {
  try {
    const viewer = await resolvedViewerFromRequest(req, true);
    if (!viewer.email) return res.status(401).json({ error: 'Unauthorized' });

    const user = await prisma.user.findUnique({ where: { email: viewer.email } });
    if (!user) return res.status(404).json({ error: 'User not found' });

    const session = await prisma.interviewSession.findUnique({
      where: { id: req.params.id },
      include: { rounds: { orderBy: { order: 'asc' } } }
    });

    const viewerIsAdmin = user.role === 'ADMIN';
    if (!session || (session.userId !== user.id && !viewerIsAdmin)) {
      return res.status(404).json({ error: 'Session not found or unauthorized.' });
    }
    if (session.status !== 'IN_PROGRESS') {
      return res.status(409).json({ error: 'This interview session has already concluded.' });
    }

    const activeRound = session.rounds.find(r => r.order === session.currentRound);
    if (!activeRound || activeRound.type !== 'OA_DSA') {
      return res.status(409).json({ error: 'Code execution is only available during the DSA round.' });
    }

    const { code, language, stdin } = req.body || {};
    if (!code || typeof code !== 'string' || code.trim().length < 5) {
      return res.status(400).json({ error: 'No code to execute.' });
    }
    if (code.length > 20000) {
      return res.status(400).json({ error: 'Code exceeds the 20KB execution limit.' });
    }

    const allowedLanguages = ['cpp', 'c++', 'c', 'python', 'java', 'javascript'];
    const lang = allowedLanguages.includes(String(language || '').toLowerCase()) ? String(language).toLowerCase() : 'cpp';

    const result = await executeSubmission(code, lang, typeof stdin === 'string' ? stdin.substring(0, 4000) : '');

    res.json({
      success: true,
      verdict: result.verdict,
      stdout: (result as any).stdout?.substring(0, 4000) || '',
      stderr: ((result as any).stderr || (result as any).compileError || '')?.substring(0, 4000) || ''
    });
  } catch (err: any) {
    console.error('[Recruiter Code Run Error]', err);
    res.status(500).json({ error: 'The execution engine failed to run your code. Please retry.' });
  }
});

// -----------------------------------------------------------------------------
// 3d. Post-Mortem Report — deterministic score math + AI hiring-committee
// debrief, generated once and cached in InterviewSession.reportJson.
// -----------------------------------------------------------------------------
recruiterRouter.get('/sessions/:id/report', async (req, res) => {
  try {
    const viewer = await resolvedViewerFromRequest(req, true);
    if (!viewer.email) return res.status(401).json({ error: 'Unauthorized' });

    const user = await prisma.user.findUnique({ where: { email: viewer.email } });
    if (!user) return res.status(404).json({ error: 'User not found' });

    const session = await prisma.interviewSession.findUnique({
      where: { id: req.params.id },
      include: {
        profile: true,
        rounds: { include: { turns: { orderBy: { createdAt: 'asc' } } }, orderBy: { order: 'asc' } }
      }
    });

    const viewerIsModerator = user.role === 'ADMIN' || await isApprovedRecruiter(user.id);
    if (!session || (session.userId !== user.id && !viewerIsModerator)) {
      return res.status(404).json({ error: 'Session not found or unauthorized.' });
    }
    if (session.status === 'IN_PROGRESS') {
      return res.status(409).json({ error: 'The interview is still in progress — the debrief unlocks once the loop concludes.' });
    }

    // Deterministic telemetry is always recomputed fresh from the turns table.
    const stats = session.rounds.map(r => {
      const scored = r.turns.filter(t => t.role === 'INTERVIEWER' && t.technicalScore !== null);
      const avg = (xs: number[]) => xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null;
      return {
        order: r.order,
        type: r.type,
        passed: r.passed,
        finalScore: r.finalScore,
        cutoffScore: r.cutoffScore,
        avgTechnical: avg(scored.map(t => t.technicalScore || 0)),
        avgFluency: avg(scored.map(t => t.fluencyScore || 0)),
        answersGiven: r.turns.filter(t => t.role === 'CANDIDATE').length,
        reached: r.turns.length > 0 || r.passed !== null
      };
    });

    // Narrative debrief is expensive — generate once, then serve from cache.
    let aiReport = session.reportJson as any;
    if (!aiReport) {
      aiReport = await generateSessionReport(
        session.profile,
        session.status,
        session.rounds.map(r => ({
          order: r.order,
          type: r.type,
          passed: r.passed,
          finalScore: r.finalScore,
          cutoffScore: r.cutoffScore,
          problemStatement: r.problemStatement,
          turns: r.turns.map(t => ({ role: t.role, text: t.text, technicalScore: t.technicalScore, fluencyScore: t.fluencyScore }))
        }))
      );
      await prisma.interviewSession.update({
        where: { id: session.id },
        data: { reportJson: aiReport }
      });
    }

    res.json({
      success: true,
      sessionStatus: session.status,
      completedAt: session.completedAt,
      profile: { field: session.profile.field, goal: session.profile.goal, techStack: session.profile.techStack },
      stats,
      report: aiReport,
      transcript: session.rounds.map(r => ({
        order: r.order,
        type: r.type,
        problemStatement: r.problemStatement,
        turns: r.turns.map(t => ({ role: t.role, text: t.text, technicalScore: t.technicalScore, fluencyScore: t.fluencyScore, codeSnapshot: t.codeSnapshot }))
      }))
    });
  } catch (err: any) {
    if (err instanceof RecruiterAiUnavailableError) {
      return res.status(503).json({ error: 'The debrief engine is temporarily unavailable. Your interview data is safe — please retry shortly.', retryable: true });
    }
    console.error('[Recruiter Report Error]', err);
    res.status(500).json({ error: 'Failed to generate the interview report.' });
  }
});

// -----------------------------------------------------------------------------
// 4. State Machine: Process Interview Turn
// -----------------------------------------------------------------------------
recruiterRouter.post('/sessions/:id/rounds/:roundId/turn', async (req, res) => {
  try {
    const viewer = await resolvedViewerFromRequest(req, true);
    if (!viewer.email) return res.status(401).json({ error: 'Unauthorized' });

    const user = await prisma.user.findUnique({ where: { email: viewer.email } });
    if (!user) return res.status(404).json({ error: 'User not found' });

    const { userResponse, codeSnapshot, executionResult } = req.body;
    const { id: sessionId, roundId } = req.params;

    if (!userResponse || userResponse.trim() === '') {
      return res.status(400).json({ error: 'Audio transcript missing.' });
    }

    // 1. Fetch deep session state to provide LLM context
    const session = await prisma.interviewSession.findUnique({
      where: { id: sessionId },
      include: {
        profile: true,
        rounds: { include: { turns: { orderBy: { createdAt: 'asc' } } }, orderBy: { order: 'asc' } }
      }
    });

    if (!session || session.userId !== user.id) {
      return res.status(403).json({ error: 'Session integrity fault.' });
    }

    if (session.status !== 'IN_PROGRESS') {
      return res.status(409).json({ error: 'This interview session has already concluded.', sessionStatus: session.status });
    }

    // 2. Resolve the round by id OR by order number ("1", "2", "3") for robustness
    const round = session.rounds.find(r => r.id === roundId)
      || session.rounds.find(r => String(r.order) === String(roundId));

    if (!round) {
      return res.status(404).json({ error: 'Interview round not found.' });
    }

    if (round.order !== session.currentRound || round.endedAt) {
      return res.status(409).json({ error: 'This round is no longer active.', currentRound: session.currentRound });
    }

    // 3. Map existing database turns for the LLM context window
    const mappedHistory = round.turns.map(t => ({ role: t.role, text: t.text }));

    // 4. Trigger inference FIRST — nothing is persisted unless the interviewer
    // actually responds, so a failed call is safely retryable by the client.
    const evaluation = await processRecruiterTurn(
      session.profile,
      { type: round.type, order: round.order, cutoffScore: round.cutoffScore, problemStatement: round.problemStatement },
      mappedHistory,
      userResponse,
      codeSnapshot,
      typeof executionResult === 'string' ? executionResult : undefined
    );

    // 5. If the round concluded and passed, prepare the next round's opening
    // BEFORE the transaction (it is an LLM call and must not hold DB locks).
    const nextRound = session.rounds.find(r => r.order === round.order + 1);
    let nextOpening: { problemStatement: string; speech: string } | null = null;
    const advancing = evaluation.concludeRound && evaluation.roundPassed === true && !!nextRound;
    if (advancing && nextRound) {
      nextOpening = await generateRoundOpening(session.profile, nextRound.type, nextRound.order);
    }

    // 6. Persist the full exchange atomically
    await prisma.$transaction(async (tx) => {
      await tx.interviewTurn.create({
        data: { roundId: round.id, role: 'CANDIDATE', text: userResponse, codeSnapshot: codeSnapshot || null }
      });

      await tx.interviewTurn.create({
        data: {
          roundId: round.id,
          role: 'INTERVIEWER',
          text: evaluation.speech,
          technicalScore: evaluation.technicalScore,
          fluencyScore: evaluation.fluencyScore
        }
      });

      if (evaluation.concludeRound) {
        // Round verdict is averaged over every scored interviewer turn, not just the last one.
        const scored = round.turns.filter(t => t.role === 'INTERVIEWER' && t.technicalScore !== null);
        const techSum = scored.reduce((acc, t) => acc + (t.technicalScore || 0), 0) + evaluation.technicalScore;
        const fluSum = scored.reduce((acc, t) => acc + (t.fluencyScore || 0), 0) + evaluation.fluencyScore;
        const count = scored.length + 1;
        const finalScore = Math.round((techSum / count + fluSum / count) / 2);

        await tx.interviewRound.update({
          where: { id: round.id },
          data: { endedAt: new Date(), passed: evaluation.roundPassed === true, finalScore }
        });

        if (evaluation.roundPassed === true) {
          if (nextRound && nextOpening) {
            await tx.interviewRound.update({
              where: { id: nextRound.id },
              data: { problemStatement: nextOpening.problemStatement, startedAt: new Date() }
            });
            await tx.interviewTurn.create({
              data: { roundId: nextRound.id, role: 'INTERVIEWER', text: nextOpening.speech }
            });
            await tx.interviewSession.update({
              where: { id: session.id },
              data: { currentRound: nextRound.order }
            });
          } else {
            // Final round cleared — the candidate passed the entire loop.
            await tx.interviewSession.update({
              where: { id: session.id },
              data: { status: 'PASSED', completedAt: new Date() }
            });
          }
        } else {
          await tx.interviewSession.update({
            where: { id: session.id },
            data: { status: 'FAILED', completedAt: new Date() }
          });
        }
      }
    }, { timeout: 30000, maxWait: 10000 });

    // 7. Return the full state delta so the client never needs a refetch
    const sessionStatus = evaluation.concludeRound
      ? (evaluation.roundPassed === true ? (advancing ? 'IN_PROGRESS' : 'PASSED') : 'FAILED')
      : 'IN_PROGRESS';

    // Loop over → the debrief report email goes out while the verdict screen shows.
    if (sessionStatus === 'PASSED' || sessionStatus === 'FAILED') {
      mailInterviewConcluded(user.email, session.id, sessionStatus === 'PASSED');
    }

    res.json({
      success: true,
      reply: evaluation.speech,
      technicalScore: evaluation.technicalScore,
      fluencyScore: evaluation.fluencyScore,
      concludeRound: evaluation.concludeRound,
      roundPassed: evaluation.roundPassed,
      sessionStatus,
      nextRound: advancing && nextRound && nextOpening ? {
        id: nextRound.id,
        order: nextRound.order,
        type: nextRound.type,
        problemStatement: nextOpening.problemStatement,
        openingSpeech: nextOpening.speech
      } : null
    });

  } catch (err: any) {
    if (err instanceof RecruiterAiUnavailableError) {
      return res.status(503).json({ error: 'The interviewer engine is temporarily unreachable. Your answer was not lost — please resend it.', retryable: true });
    }
    console.error("[Interview Turn Pipeline Error]", err);
    res.status(500).json({ error: 'Telemetry processing failed.' });
  }
});