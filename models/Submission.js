import mongoose from "mongoose";

const SubmissionSchema = new mongoose.Schema({
  filename: String,
  url: String,
  public_id: { type: String, default: null },
  roomName: { type: String, required: true },
  description: { type: String, default: "" },
  department: { type: String, default: "" },
  uploaderEmail: { type: String, default: null },
  status: { type: String, enum: ["pending", "approved", "rejected"], default: "pending" },
  createdAt: { type: Date, default: Date.now }
});

export default mongoose.model("Submission", SubmissionSchema);
