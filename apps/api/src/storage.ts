/**
 * @file storage.ts
 * @author Rahul Kumar Sahoo
 * @description Application source for the DivineCode platform.
 */

import { prisma } from './prisma/client';

export async function upsertGoogleUser(input: { name?: string; email?: string; avatar?: string; googleId?: string }) {
  if (!input.email) throw new Error('Email is required');
  
  const email = input.email.toLowerCase();
  const usernameSeed = email.split('@')[0].replace(/[^a-z0-9_]/gi, '_').toLowerCase();

  return prisma.user.upsert({
    where: { email },
    update: {
      name: input.name || input.email,
      avatarUrl: input.avatar
    },
    create: {
      email,
      username: `${usernameSeed}_${Math.random().toString(36).substring(2, 6)}`,
      name: input.name || input.email,
      avatarUrl: input.avatar
    }
  });
}

// -------------------------------------------------------------------------
// LEGACY MONGODB SYNC FUNCTIONS (STUBBED)
// These functions safely return empty arrays/null to prevent older modules 
// from breaking during the transition. They will be removed in Phase 2.
// -------------------------------------------------------------------------

export async function saveContestDocument(contest: any) { 
  return null; 
}

export async function deleteContestDocument(contestId: string) { 
  return null; 
}

export async function saveSubmissionDocument(input: any) { 
  return null; 
}

export async function loadContestDocuments() { 
  return []; 
}

export async function loadSubmissionDocuments() { 
  return []; 
}