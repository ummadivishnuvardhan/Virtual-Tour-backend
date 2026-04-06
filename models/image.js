import mongoose from "mongoose";

const imageSchema = new mongoose.Schema(
  {
    filename: { type: String, required: true },
    url: { type: String, required: true },
    public_id: { type: String },
    roomName: { type: String, required: true },
    description: { type: String },
    department: { type: String, required: true },
    isActive: { type: Boolean, default: true },
    views: { type: Number, default: 0 },
    reactions: {
      fire: { type: Number, default: 0 },
      like: { type: Number, default: 0 },
      wow: { type: Number, default: 0 }
    },
    createdAt: { type: Date, default: Date.now }
  },
  { timestamps: true }
);


imageSchema.index({ isActive: 1 });
imageSchema.index({ createdAt: -1 });
imageSchema.index({ department: 1 });

const Image = mongoose.model("Image", imageSchema);
export default Image;