import { connectDB } from './db';
import { ContestModel } from './models/Contest';
import { SubmissionModel } from './models/Submission';
import { UserModel } from './models/User';

export async function upsertGoogleUser(input: { name?: string; email?: string; avatar?: string; googleId?: string }) {
  await connectDB();
  if (!input.email) throw new Error('Email is required');
  return (UserModel as any).findOneAndUpdate({ email: input.email }, { $set: { name: input.name || input.email, email: input.email, avatar: input.avatar, googleId: input.googleId, handle: input.email.split('@')[0].replace(/[^a-z0-9_]/gi, '_').toLowerCase() } }, { upsert: true, new: true });
}

export async function saveContestDocument(contest: any) {
  await connectDB();
  return (ContestModel as any).findOneAndUpdate({ _id: contest.id }, { $set: { title: contest.title, description: contest.description, startTime: contest.startTime, durationMinutes: contest.durationMinutes, isRated: contest.isRated, ownerName: contest.ownerName, ownerEmail: contest.ownerEmail, ownerHandle: contest.ownerHandle, createdAt: contest.createdAt, members: contest.members, problems: contest.problems, solves: contest.solves } }, { upsert: true, new: true });
}

export async function deleteContestDocument(contestId: string) {
  await connectDB();
  await (ContestModel as any).deleteOne({ _id: contestId });
  await (SubmissionModel as any).deleteMany({ contestId });
}

export async function saveSubmissionDocument(input: any) {
  await connectDB();
  return (SubmissionModel as any).create(input);
}

export async function loadContestDocuments() {
  await connectDB();
  const docs = await (ContestModel as any).find({}).lean();
  return docs.map((doc: any) => ({ id: String(doc._id), title: doc.title, description: doc.description || '', startTime: doc.startTime, durationMinutes: doc.durationMinutes || 120, isRated: Boolean(doc.isRated), ownerName: doc.ownerName || '', ownerEmail: doc.ownerEmail || '', ownerHandle: doc.ownerHandle || '', createdAt: doc.createdAt || doc.startTime || new Date().toISOString(), members: doc.members || [], problems: doc.problems || [], solves: doc.solves || [], standings: [], questions: [] }));
}

export async function loadSubmissionDocuments() {
  await connectDB();
  return (SubmissionModel as any).find({}).sort({ createdAt: 1 }).lean();
}
