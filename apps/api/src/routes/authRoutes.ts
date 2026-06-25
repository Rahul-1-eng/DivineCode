import { Router, Request, Response } from 'express';
import { registerUser, loginUser, generatePasswordResetToken, resetPassword } from '../modules/auth/authService';

export const authRouter = Router();

authRouter.post('/register', async (req: Request, res: Response) => {
  try {
    const result = await registerUser(req.body);
    res.status(201).json(result);
  } catch (error: any) {
    // Gracefully send the error back to the Next.js frontend as JSON
    res.status(400).json({ error: error.message || 'Registration failed.' });
  }
});

authRouter.post('/login', async (req: Request, res: Response) => {
  try {
    const result = await loginUser(req.body);
    res.status(200).json(result);
  } catch (error: any) {
    res.status(401).json({ error: error.message || 'Invalid credentials.' });
  }
});

authRouter.post('/forgot-password', async (req, res) => {
  try {
    const result = await generatePasswordResetToken(req.body.email);
    res.json(result);
  } catch (error: any) {
    res.status(400).json({ error: error.message || 'Failed to process request.' });
  }
});

authRouter.post('/reset-password', async (req, res) => {
  try {
    const result = await resetPassword(req.body);
    res.json(result);
  } catch (error: any) {
    res.status(400).json({ error: error.message || 'Password reset failed.' });
  }
});