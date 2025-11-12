// routes/Submission.js
import express from "express";
import multer from "multer";
import { v2 as cloudinary } from "cloudinary";
import { CloudinaryStorage } from "multer-storage-cloudinary";
import Submission from "../models/Submission.js";
import Image from "../models/image.js";
import clerkAuth from "../middlewares/clerkAuth.js";
import isAdmin from "../middlewares/isAdmin.js";

const router = express.Router();

// Configure Cloudinary storage for submissions
const storage = new CloudinaryStorage({
  cloudinary,
  params: { 
    folder: "cse-vr-panorama-submissions", // Different folder for pending submissions
    format: async () => "jpeg",
    public_id: (req, file) => `submission-${Date.now()}-${file.originalname}`
  }
});

const upload = multer({ 
  storage, 
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed!'), false);
    }
  }
});

// ============================================
// PUBLIC ROUTE: Submit for review
// ============================================
router.post("/", upload.single("panoramaImage"), async (req, res) => {
  try {
    console.log("📤 Submission received!");
    console.log("File:", req.file);
    console.log("Body:", req.body);

    const { roomName, description, department, uploaderEmail } = req.body;
    
    // Validation
    if (!req.file) {
      console.log("❌ No file uploaded");
      return res.status(400).json({ success: false, error: "No file uploaded" });
    }
    
    if (!roomName?.trim()) {
      console.log("❌ Room name missing");
      return res.status(400).json({ success: false, error: "Room name is required" });
    }

    // Create submission
    const sub = await Submission.create({
      filename: req.file.originalname,
      url: req.file.path || req.file.secure_url || req.file.url,
      public_id: req.file.public_id || null,
      roomName: roomName.trim(),
      description: (description || "").trim(),
      department: (department || "").trim(),
      uploaderEmail: uploaderEmail || null,
      status: "pending",
    });

    console.log("✅ Submission created:", sub._id);

    res.status(201).json({ 
      success: true, 
      message: "Submitted for review. Admin will review your submission.", 
      data: sub 
    });
  } catch (e) {
    console.error("❌ Submission error:", e);
    res.status(500).json({ success: false, error: "Submission failed: " + e.message });
  }
});

// ============================================
// ADMIN ROUTES (require authentication)
// ============================================

// GET all pending submissions
router.get("/", clerkAuth, isAdmin, async (_req, res) => {
  try {
    console.log("📋 Admin fetching pending submissions");
    const subs = await Submission.find({ status: "pending" }).sort({ createdAt: -1 });
    console.log(`✅ Found ${subs.length} pending submissions`);
    res.json({ success: true, data: subs });
  } catch (e) {
    console.error("❌ Fetch submissions error:", e);
    res.status(500).json({ success: false, error: "Failed to fetch submissions" });
  }
});

// Approve submission
router.post("/:id/approve", clerkAuth, isAdmin, async (req, res) => {
  try {
    console.log("✅ Admin approving submission:", req.params.id);
    
    const sub = await Submission.findById(req.params.id);
    if (!sub) {
      console.log("❌ Submission not found");
      return res.status(404).json({ success: false, error: "Submission not found" });
    }
    
    if (sub.status !== "pending") {
      console.log("❌ Submission not pending, current status:", sub.status);
      return res.status(400).json({ success: false, error: "Submission not pending" });
    }

    // Check for duplicate room name
    const escape = s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const dup = await Image.findOne({
      roomName: { $regex: `^${escape(sub.roomName)}$`, $options: "i" },
      department: { $regex: `^${escape(sub.department)}$`, $options: "i" },
      isActive: true
    });
    
    if (dup) {
      console.log("❌ Duplicate room name found");
      return res.status(400).json({ success: false, error: "Room name already exists in this department" });
    }

    // Create the room in main collection
    const room = await Image.create({
      filename: sub.filename,
      url: sub.url,
      public_id: sub.public_id || null,
      roomName: sub.roomName,
      description: sub.description,
      department: sub.department,
      isActive: true,
    });

    // Mark submission as approved
    sub.status = "approved";
    await sub.save();

    console.log("✅ Submission approved and room created:", room._id);
    res.json({ success: true, message: "Submission approved", data: room });
  } catch (e) {
    console.error("❌ Approve error:", e);
    res.status(500).json({ success: false, error: "Approve failed: " + e.message });
  }
});

// Reject submission
router.post("/:id/reject", clerkAuth, isAdmin, async (req, res) => {
  try {
    console.log("❌ Admin rejecting submission:", req.params.id);
    
    const sub = await Submission.findById(req.params.id);
    if (!sub) {
      console.log("❌ Submission not found");
      return res.status(404).json({ success: false, error: "Submission not found" });
    }

    // Mark as rejected
    sub.status = "rejected";
    await sub.save();

    // Optional: Delete from Cloudinary
    if (sub.public_id) {
      try {
        await cloudinary.uploader.destroy(sub.public_id);
        console.log("🗑️ Cloudinary image deleted:", sub.public_id);
      } catch (cloudErr) {
        console.error("⚠️ Cloudinary deletion failed:", cloudErr);
      }
    }

    console.log("✅ Submission rejected");
    res.json({ success: true, message: "Submission rejected" });
  } catch (e) {
    console.error("❌ Reject error:", e);
    res.status(500).json({ success: false, error: "Reject failed: " + e.message });
  }
});

// Test route to verify the router is working
router.get("/test", (req, res) => {
  res.json({ success: true, message: "Submissions route is working!" });
});

export default router;