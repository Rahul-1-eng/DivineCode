import mongoose from 'mongoose';

const ProblemSchema = new mongoose.Schema({
  id: String,
  title: String,
  platform: String,
  url: String,
  difficulty: String,
  rating: Number,
  tags: [String],
  stdin: String,
  expectedOutput: String,
  sourceCode: String,
  contestCode: String,
  problemIndex: String
});

const MemberSchema = new mongoose.Schema({
  id: String,
  name: String,
  email: String,
  handle: String,
  codeforcesHandle: String,
  team: String
});

const SolveSchema = new mongoose.Schema({
  memberId: String,
  problemId: String,
  solvedAtMinute: Number,
  attempts: Number
});

const ContestSchema = new mongoose.Schema(
  {
    title: String,
    description: String,
    startTime: String,
    durationMinutes: Number,
    isRated: Boolean,
    ownerName: String,
    ownerEmail: String,
    ownerHandle: String,
    members: [MemberSchema],
    problems: [ProblemSchema],
    solves: [SolveSchema]
  },
  { timestamps: true }
);

export const ContestModel =
  mongoose.models.Contest || mongoose.model('Contest', ContestSchema);
