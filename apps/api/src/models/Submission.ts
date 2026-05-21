import mongoose from 'mongoose';

const SubmissionSchema = new mongoose.Schema(
  {
    userId: { type: String },
    memberId: { type: String },
    contestId: { type: String, index: true },
    problemId: { type: String, index: true },
    platform: { type: String },
    source: { type: String },
    externalSubmissionId: { type: String, index: true },
    language: { type: String },
    code: { type: String },
    verdict: { type: String, required: true },
    message: { type: String },
    stdout: { type: String },
    stderr: { type: String },
    compileOutput: { type: String },
    time: { type: String },
    memory: { type: Number }
  },
  { timestamps: true }
);

export const SubmissionModel =
  mongoose.models.Submission || mongoose.model('Submission', SubmissionSchema);
