import mongoose from "mongoose";

const HotspotSchema = new mongoose.Schema(
  {
    roomId: { 
      type: mongoose.Schema.Types.ObjectId, 
      ref: "Image", 
      required: true 
    },
    pitch: { type: Number, required: true },
    yaw: { type: Number, required: true },
    title: { type: String, required: true },
    description: { type: String, default: "" },
    imageUrl: { type: String, default: "" },
  },
  { timestamps: true }
);

export default mongoose.model("Hotspot", HotspotSchema);
