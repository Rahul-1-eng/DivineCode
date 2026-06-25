// apps/api/src/modules/auth/authService.ts
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { prisma } from '../../prisma/client';
import jwt from "jsonwebtoken";
export async function registerUser({ username, email, name, password }: any) {
  if (!username || !email || !password) throw new Error('Username, email and password are required fields.');

  const cleanUsername = String(username).trim();
  const cleanEmail = String(email).trim().toLowerCase();

  const existingUser = await prisma.user.findFirst({
    where: { OR: [{ username: cleanUsername }, { email: cleanEmail }] }
  });

  if (existingUser) throw new Error('Username or email handle already registered.');

  const salt = await bcrypt.genSalt(10);
  const hashedPassword = await bcrypt.hash(password, salt);

  const newUser = await prisma.user.create({
    data: {
      username: cleanUsername,
      email: cleanEmail,
      name: name || cleanUsername,
      passwordHash: hashedPassword
    }
  });

  return { success: true, userId: newUser.id };
}

export async function loginUser({ handle, password }: any) {
  if (!handle || !password) throw new Error('Handle and password are required.');

  const cleanHandle = String(handle).trim();

  const existingUser = await prisma.user.findFirst({
    where: {
      OR: [
        { username: { equals: cleanHandle, mode: 'insensitive' } },
        { email: cleanHandle.toLowerCase() }
      ]
    }
  });

  if (!existingUser || !existingUser.passwordHash) throw new Error('Invalid credentials.');

  const isValid = await bcrypt.compare(password, existingUser.passwordHash);
  if (!isValid) throw new Error('Invalid credentials.');

  const token = jwt.sign(
  {
    id: existingUser.id,
    email: existingUser.email,
    name: existingUser.name
  },
  process.env.NEXTAUTH_SECRET!,
  { expiresIn: "7d" }
);

return {
  id: existingUser.id,
  username: existingUser.username,
  email: existingUser.email,
  name: existingUser.name,
  avatarUrl: existingUser.avatarUrl,
  token
};
}

export async function generatePasswordResetToken(email: string) {
  if (!email) throw new Error('Email is required.');

  const cleanEmail = String(email).trim().toLowerCase();
  const user = await prisma.user.findUnique({ where: { email: cleanEmail } });

  if (!user) return { success: true, message: 'If that account exists, a reset link has been generated.' };

  const resetToken = crypto.randomBytes(32).toString('hex');
  const hashedToken = crypto.createHash('sha256').update(resetToken).digest('hex');
  const expires = new Date(Date.now() + 3600000);

  await prisma.user.update({
    where: { id: user.id },
    data: { resetPasswordToken: hashedToken, resetPasswordExpires: expires }
  });

  const clientOrigin = process.env.CLIENT_ORIGIN || 'http://localhost:3000';
  const resetLink = `${clientOrigin}/reset-password?token=${resetToken}`;

  console.log(`\n========================================`);
  console.log(`🔑 PASSWORD RESET LINK FOR ${user.email}`);
  console.log(resetLink);
  console.log(`========================================\n`);

  return { success: true, message: 'If that account exists, a reset link has been generated.', devLink: resetLink };
}

export async function resetPassword({ token, newPassword }: any) {
  if (!token || !newPassword || newPassword.length < 6) {
    throw new Error('Invalid token or password is too short (min 6 characters).');
  }

  const hashedToken = crypto.createHash('sha256').update(token).digest('hex');

  const user = await prisma.user.findFirst({
    where: {
      resetPasswordToken: hashedToken,
      resetPasswordExpires: { gt: new Date() } 
    }
  });

  if (!user) throw new Error('This reset token is invalid or has expired.');

  const salt = await bcrypt.genSalt(10);
  const passwordHash = await bcrypt.hash(newPassword, salt);

  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash, resetPasswordToken: null, resetPasswordExpires: null }
  });

  return { success: true, message: 'Your password has been reset successfully. You can now log in.' };
}