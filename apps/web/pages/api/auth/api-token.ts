import type { NextApiRequest, NextApiResponse } from 'next';
import { getToken } from 'next-auth/jwt';
import jwt from 'jsonwebtoken';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // 1. Get the secure NextAuth JWT from the HttpOnly cookie
  const sessionToken = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });

  if (!sessionToken) {
    return res.status(401).json({ error: 'Unauthorized. No active session.' });
  }

  // 2. Mint a standard JWT for the Express API to verify
  // Make sure NEXTAUTH_SECRET is identical in BOTH Vercel and Render .env files
  const apiSecret = process.env.NEXTAUTH_SECRET || '';
  
  if (!apiSecret) {
    console.error("NEXTAUTH_SECRET is missing. Cannot sign token.");
    return res.status(500).json({ error: 'Internal Server Error' });
  }

const apiToken = jwt.sign(
    { 
      id: sessionToken.sub,
      email: sessionToken.email,
      name: sessionToken.name,
      // Add these to match your backend's expected verification payload
      handle: (sessionToken as any).handle,
      accessToken: (sessionToken as any).accessToken 
    }, 
    apiSecret, 
    { expiresIn: '2h' }
  );

  return res.status(200).json({ token: apiToken });
}