// apps/api/src/routes/authRoutes.ts
import { Router, Request, Response, NextFunction } from 'express';
import { registerUser, loginUser, generatePasswordResetToken, resetPassword } from '../modules/auth/authService';

export const authRouter = Router();

const asyncRoute = (handler: (req: Request, res: Response, next: NextFunction) => Promise<any>) => {
  return (req: Request, res: Response, next: NextFunction) => {
    handler(req, res, next).catch(next);
  };
};

authRouter.post('/register', asyncRoute(async (req, res) => {
  const result = await registerUser(req.body);
  res.status(201).json(result);
}));

authRouter.post('/login', asyncRoute(async (req, res) => {
  const result = await loginUser(req.body);
  res.status(200).json(result);
}));

authRouter.post('/forgot-password', asyncRoute(async (req, res) => {
  const result = await generatePasswordResetToken(req.body.email);
  res.json(result);
}));

authRouter.post('/reset-password', asyncRoute(async (req, res) => {
  const result = await resetPassword(req.body);
  res.json(result);
}));