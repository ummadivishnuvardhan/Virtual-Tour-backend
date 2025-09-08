import mongoose from "mongoose";

const connectDB = async () => {
  try {
    await mongoose.connect(
      "mongodb+srv://ummadivishnuvardhan46:WPubNckmNypn1zby@namastenode.hspu4kq.mongodb.net/cse_vr_panorama"
    );
    console.log("MongoDB connected successfully");
  } catch (error) {
    console.error("MongoDB connection error:", error);
    process.exit(1);
  }
};

export default connectDB;