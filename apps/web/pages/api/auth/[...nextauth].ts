import type { NextApiRequest, NextApiResponse } from 'next';
import NextAuth from 'next-auth';
import GoogleProvider from 'next-auth/providers/google';
import CredentialsProvider from 'next-auth/providers/credentials';

export default async function auth(req: NextApiRequest, res: NextApiResponse) {
  return NextAuth(req, res, {
    providers: [
      GoogleProvider({
        clientId: process.env.GOOGLE_CLIENT_ID || '',
        clientSecret: process.env.GOOGLE_CLIENT_SECRET || ''
      }),
      CredentialsProvider({
        name: 'Credentials',
        credentials: {
          handle: { label: "Handle", type: "text" },
          password: { label: "Password", type: "password" }
        },
        async authorize(credentials, req) {
          if (!credentials?.handle || !credentials?.password) return null;
          
          const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:4000';
          
          try {
            // This calls your backend route to verify the password against the database
            const res = await fetch(`${apiBase}/api/auth/login`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                handle: credentials.handle,
                password: credentials.password,
              }),
            });

            const user = await res.json();

            // If login is successful and the API returns a user object
            if (res.ok && user) {
              return user; 
            }
            return null;
          } catch (error) {
            console.error('Credentials auth failed:', error);
            return null;
          }
        }
      })
    ],
    secret: process.env.NEXTAUTH_SECRET,
    session: { strategy: 'jwt' },
    callbacks: {
      async signIn({ user, account }) {
        // Only run this sync block if the user logged in via Google
        if (account?.provider === 'google') {
          try {
            const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:4000';
            await fetch(`${apiBase}/api/auth/google`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                name: user.name,
                email: user.email,
                avatar: user.image,
                googleId: account?.providerAccountId
              })
            });
          } catch (error) {
            console.error('Could not sync Google user with API', error);
          }
        }
        return true;
      },
      async session({ session, token }) {
        if (session.user) {
          (session.user as any).id = token.sub;
          // Optionally, pass the handle down to the session if available
          if (token.handle) {
            (session.user as any).handle = token.handle;
          }
        }
        return session;
      },
      async jwt({ token, user }) {
        if (user) {
          token.handle = (user as any).handle;
        }
        return token;
      }
    },
    pages: { signIn: '/signin' }
  });
}