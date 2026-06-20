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
            // UPDATED: Now pointing to the endpoint established in index.ts
            const res = await fetch(`${apiBase}/api/auth/login`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                handle: credentials.handle,
                password: credentials.password,
              }),
            });

            const user = await res.json();

            // Return the mapped user object to inject into NextAuth
            if (res.ok && user && !user.error) {
              return {
                id: user.id,
                name: user.name,
                email: user.email,
                handle: user.username // Map internal username to session handle
              }; 
            }
            console.warn("API rejected login:", user);
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
        if (account?.provider === 'google') {
          try {
            const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:4000';
            const res = await fetch(`${apiBase}/api/auth/google`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                name: user.name,
                email: user.email,
                avatar: user.image,
                googleId: account?.providerAccountId
              })
            });
            
            const data = await res.json();
            if (data?.username) {
              (user as any).handle = data.username;
            }
          } catch (error) {
            console.error('Could not sync Google user with API', error);
          }
        }
        return true;
      },
      async session({ session, token }) {
        if (session.user) {
          (session.user as any).id = token.sub;
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