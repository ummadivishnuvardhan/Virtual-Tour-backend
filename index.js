import dotenv from "dotenv";
dotenv.config();

import express from "express";
import multer from "multer";
import { CloudinaryStorage } from "multer-storage-cloudinary";
import { v2 as cloudinary } from "cloudinary";
import cors from "cors";

import connectDB from "./config/Database.js";
import Image from "./models/image.js";
import Submission from "./models/Submission.js";
import DepartmentRoutes from "./routes/department.js";
import AuthRoutes from "./routes/auth.js";
import clerkAuth from "./middlewares/clerkAuth.js";
import isAdmin from "./middlewares/isAdmin.js";

const app = express();
const PORT = process.env.PORT || 3000;

// Verify environment variables on startup
console.log("🔍 Checking environment variables...");
console.log("✓ CLERK_SECRET_KEY:", process.env.CLERK_SECRET_KEY ? "Found" : "❌ MISSING");
console.log("✓ CLOUDINARY_CLOUD_NAME:", process.env.CLOUDINARY_CLOUD_NAME ? "Found" : "❌ MISSING");

// Connect to MongoDB
connectDB();

// CORS configuration - Allow your frontend
app.use(cors({
  origin: ['http://localhost:5173', 'http://localhost:3000'],
  credentials: true
}));

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Cloudinary configuration
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

// Multer storage for USER submissions (goes to submissions folder)
const submissionStorage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: {
    folder: "cse-vr-panorama-submissions",
    format: async (req, file) => "jpeg",
    public_id: (req, file) => 'submission-' + Date.now() + '-' + file.originalname,
  },
});

// Multer storage for ADMIN direct uploads (goes to main folder)
const adminStorage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: {
    folder: "cse-vr-panorama",
    format: async (req, file) => "jpeg",
    public_id: (req, file) => 'admin-' + Date.now() + '-' + file.originalname,
  },
});

const submissionUpload = multer({ 
  storage: submissionStorage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed!'), false);
    }
  }
});

const adminUpload = multer({ 
  storage: adminStorage,
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
// ROUTES
// ============================================

// Health check
app.get('/', (req, res) => {
  res.json({ 
    message: "CSE VR Panorama API is running!",
    version: "1.4.0",
    timestamp: new Date().toISOString(),
    clerkConfigured: !!process.env.CLERK_SECRET_KEY
  });
});

// Register auth and department routes
app.use("/api/auth", AuthRoutes);
app.use("/api/departments", DepartmentRoutes);

// ============================================
// USER SUBMISSION ROUTES (PUBLIC - NO AUTH)
// ============================================

// PUBLIC: Submit panorama for review
app.post("/api/submissions", submissionUpload.single("panoramaImage"), async (req, res) => {
  try {
    console.log("📤 User submission received");
    
    const { roomName, description, department, uploaderEmail } = req.body;
    
    if (!req.file) {
      return res.status(400).json({ success: false, error: "No file uploaded" });
    }
    
    if (!roomName?.trim()) {
      return res.status(400).json({ success: false, error: "Room name is required" });
    }

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
    res.status(500).json({ success: false, error: "Submission failed" });
  }
});

// ============================================
// ADMIN SUBMISSION MANAGEMENT ROUTES (PROTECTED)
// ============================================

// ADMIN: Get all pending submissions
app.get("/api/submissions", clerkAuth, isAdmin, async (req, res) => {
  try {
    console.log("📋 Admin fetching pending submissions");
    console.log("🔐 User:", req.user?.emailAddress);
    
    const subs = await Submission.find({ status: "pending" }).sort({ createdAt: -1 });
    console.log(`✅ Found ${subs.length} pending submissions`);
    
    res.json({ success: true, data: subs });
  } catch (e) {
    console.error("❌ Fetch submissions error:", e);
    res.status(500).json({ success: false, error: "Failed to fetch submissions" });
  }
});

// ADMIN: Approve submission
app.post("/api/submissions/:id/approve", clerkAuth, isAdmin, async (req, res) => {
  try {
    console.log("✅ Admin approving submission:", req.params.id);
    
    const sub = await Submission.findById(req.params.id);
    if (!sub) {
      return res.status(404).json({ success: false, error: "Submission not found" });
    }
    
    if (sub.status !== "pending") {
      return res.status(400).json({ success: false, error: "Submission not pending" });
    }

    // Check for duplicate
    const escape = s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const dup = await Image.findOne({
      roomName: { $regex: `^${escape(sub.roomName)}$`, $options: "i" },
      department: { $regex: `^${escape(sub.department)}$`, $options: "i" },
      isActive: true
    });
    
    if (dup) {
      return res.status(400).json({ success: false, error: "Room name already exists in this department" });
    }

    // Create room
    const room = await Image.create({
      filename: sub.filename,
      url: sub.url,
      public_id: sub.public_id || null,
      roomName: sub.roomName,
      description: sub.description,
      department: sub.department,
      isActive: true,
    });

    // Mark as approved
    sub.status = "approved";
    await sub.save();

    console.log("✅ Approved and room created:", room._id);
    res.json({ success: true, message: "Submission approved successfully", data: room });
  } catch (e) {
    console.error("❌ Approve error:", e);
    res.status(500).json({ success: false, error: "Approval failed" });
  }
});

// ADMIN: Reject submission
app.post("/api/submissions/:id/reject", clerkAuth, isAdmin, async (req, res) => {
  try {
    console.log("❌ Admin rejecting submission:", req.params.id);
    
    const sub = await Submission.findById(req.params.id);
    if (!sub) {
      return res.status(404).json({ success: false, error: "Submission not found" });
    }

    sub.status = "rejected";
    await sub.save();

    // Delete from cloudinary
    if (sub.public_id) {
      try {
        await cloudinary.uploader.destroy(sub.public_id);
        console.log("🗑️ Cloudinary image deleted");
      } catch (err) {
        console.error("Cloudinary delete error:", err);
      }
    }

    console.log("✅ Submission rejected");
    res.json({ success: true, message: "Submission rejected successfully" });
  } catch (e) {
    console.error("❌ Reject error:", e);
    res.status(500).json({ success: false, error: "Rejection failed" });
  }
});

// ============================================
// ADMIN DIRECT UPLOAD ROUTE
// ============================================

// ADMIN: Direct upload (bypasses review)
app.post("/api/admin/upload", clerkAuth, isAdmin, adminUpload.single("panoramaImage"), async (req, res) => {
  try {
    console.log("👑 Admin direct upload received");
    
    const { roomName, description, department } = req.body;
    
    if (!req.file) {
      return res.status(400).json({ success: false, error: "No file uploaded" });
    }
    
    if (!roomName?.trim()) {
      return res.status(400).json({ success: false, error: "Room name is required" });
    }
    
    if (!department?.trim()) {
      return res.status(400).json({ success: false, error: "Department is required" });
    }

    // Check for duplicate
    const escape = s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const rn = roomName.trim();
    const dep = department.trim();

    const existingRoom = await Image.findOne({
      roomName: { $regex: `^${escape(rn)}$`, $options: "i" },
      department: { $regex: `^${escape(dep)}$`, $options: "i" },
      isActive: true
    });

    if (existingRoom) {
      if (req.file.public_id) {
        try {
          await cloudinary.uploader.destroy(req.file.public_id);
        } catch (e) {
          console.error("Cleanup error:", e);
        }
      }
      return res.status(400).json({ success: false, error: "Room name already exists in this department" });
    }

    // Create room directly
    const newImage = new Image({
      filename: req.file.originalname,
      url: req.file.path,
      public_id: req.file.public_id || null,
      roomName: rn,
      description: description ? description.trim() : "",
      department: dep,
      isActive: true
    });

    await newImage.save();

    console.log("✅ Admin room created directly:", newImage._id);
    res.status(201).json({
      success: true,
      message: "Room uploaded successfully",
      data: newImage
    });
  } catch (error) {
    console.error("❌ Admin upload error:", error);
    if (req.file && req.file.public_id) {
      try {
        await cloudinary.uploader.destroy(req.file.public_id);
      } catch (e) {
        console.error("Cleanup error:", e);
      }
    }
    res.status(500).json({ success: false, error: "Upload failed" });
  }
});

// ============================================
// PUBLIC ROOMS ROUTES
// ============================================

app.get("/api/rooms", async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const sortBy = req.query.sortBy || "createdAt";
    const sortOrder = req.query.sortOrder === "asc" ? 1 : -1;
    const includeInactive = req.query.includeInactive === "true";
    const department = req.query.department;

    const skip = (page - 1) * limit;

    const filterQuery = includeInactive ? {} : { isActive: true };
    if (department) {
      filterQuery.department = department;
    }

    const sortObject = { [sortBy]: sortOrder };

    const [rooms, totalCount] = await Promise.all([
      Image.find(filterQuery)
        .sort(sortObject)
        .skip(skip)
        .limit(limit)
        .select("filename url roomName description department views createdAt isActive"),
      Image.countDocuments(filterQuery)
    ]);

    const totalPages = Math.ceil(totalCount / limit);

    res.json({
      success: true,
      data: rooms,
      pagination: {
        currentPage: page,
        totalPages,
        totalCount,
        hasNext: page < totalPages,
        hasPrev: page > 1,
        limit
      },
      count: rooms.length
    });
  } catch (error) {
    console.error("Fetch rooms error:", error);
    res.status(500).json({ success: false, error: "Failed to fetch rooms" });
  }
});

app.get("/api/rooms/search", async (req, res) => {
  try {
    const { q, page = 1, limit = 10 } = req.query;
    
    if (!q) {
      return res.status(400).json({ success: false, error: "Search query is required" });
    }
    
    const skip = (page - 1) * limit;
    
    const searchQuery = {
      isActive: true,
      $or: [
        { roomName: { $regex: q, $options: 'i' } },
        { description: { $regex: q, $options: 'i' } },
        { filename: { $regex: q, $options: 'i' } }
      ]
    };
    
    const [rooms, totalCount] = await Promise.all([
      Image.find(searchQuery)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit))
        .select('filename url roomName description views createdAt'),
      Image.countDocuments(searchQuery)
    ]);
    
    res.json({
      success: true,
      data: rooms,
      searchTerm: q,
      count: rooms.length,
      totalCount,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(totalCount / limit)
      }
    });
  } catch (error) {
    console.error("Search error:", error);
    res.status(500).json({ success: false, error: "Search failed" });
  }
});

app.get("/api/rooms/:id", async (req, res) => {
  try {
    const room = await Image.findById(req.params.id);
    
    if (!room) {
      return res.status(404).json({ success: false, error: "Room not found" });
    }
    
    await Image.findByIdAndUpdate(req.params.id, { $inc: { views: 1 } });
    room.views += 1;
    
    res.json({ success: true, data: room });
  } catch (error) {
    console.error("Fetch room error:", error);
    res.status(500).json({ success: false, error: "Failed to fetch room" });
  }
});

// ============================================
// ADMIN ROOM MANAGEMENT ROUTES (PROTECTED)
// ============================================

// ADMIN: Delete room permanently
app.delete("/api/rooms/:id", clerkAuth, isAdmin, async (req, res) => {
  try {
    console.log("🗑️ Admin deleting room:", req.params.id);
    
    const room = await Image.findById(req.params.id);
    
    if (!room) {
      return res.status(404).json({ success: false, error: "Room not found" });
    }

    // Delete from Cloudinary
    if (room.public_id) {
      try {
        await cloudinary.uploader.destroy(room.public_id);
        console.log("🗑️ Cloudinary image deleted");
      } catch (cloudinaryError) {
        console.error("Cloudinary deletion error:", cloudinaryError);
      }
    }
    
    // Delete from database
    await Image.findByIdAndDelete(req.params.id);
    
    console.log("✅ Room deleted successfully");
    res.json({ 
      success: true, 
      message: "Room deleted successfully",
      deletedRoom: {
        id: room._id,
        roomName: room.roomName,
        filename: room.filename
      }
    });
  } catch (error) {
    console.error("❌ Delete error:", error);
    res.status(500).json({ success: false, error: "Failed to delete room" });
  }
});

// ADMIN: Deactivate room (soft delete)
app.patch("/api/rooms/:id/deactivate", clerkAuth, isAdmin, async (req, res) => {
  try {
    console.log("🚫 Admin deactivating room:", req.params.id);
    
    const room = await Image.findById(req.params.id);
    
    if (!room) {
      return res.status(404).json({ success: false, error: "Room not found" });
    }

    if (!room.isActive) {
      return res.status(400).json({ success: false, error: "Room is already inactive" });
    }

    // Set isActive to false
    room.isActive = false;
    await room.save();
    
    console.log("✅ Room deactivated:", room.roomName);
    res.json({ 
      success: true, 
      message: "Room deactivated successfully",
      data: room
    });
  } catch (error) {
    console.error("❌ Deactivate error:", error);
    res.status(500).json({ success: false, error: "Failed to deactivate room" });
  }
});

// ADMIN: Restore room (reactivate)
app.patch("/api/rooms/:id/restore", clerkAuth, isAdmin, async (req, res) => {
  try {
    console.log("♻️ Admin restoring room:", req.params.id);
    
    const room = await Image.findById(req.params.id);
    
    if (!room) {
      return res.status(404).json({ success: false, error: "Room not found" });
    }

    if (room.isActive) {
      return res.status(400).json({ success: false, error: "Room is already active" });
    }

    // Set isActive to true
    room.isActive = true;
    await room.save();
    
    console.log("✅ Room restored:", room.roomName);
    res.json({ 
      success: true, 
      message: "Room restored successfully",
      data: room
    });
  } catch (error) {
    console.error("❌ Restore error:", error);
    res.status(500).json({ success: false, error: "Failed to restore room" });
  }
});

// ============================================
// ERROR HANDLING
// ============================================

app.use((error, req, res, next) => {
  console.error("Error:", error);
  
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({
        success: false,
        error: 'File too large. Maximum size is 10MB.'
      });
    }
  }
  
  res.status(500).json({
    success: false,
    error: 'Internal server error'
  });
});

app.use('*', (req, res) => {
  console.log("404 - Route not found:", req.method, req.originalUrl);
  res.status(404).json({
    success: false,
    error: 'Endpoint not found',
    requestedUrl: req.originalUrl,
    method: req.method
  });
});

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📍 API Base: http://localhost:${PORT}/api`);
  console.log(`✅ User Submissions: POST /api/submissions`);
  console.log(`👑 Admin Upload: POST /api/admin/upload`);
  console.log(`🚫 Admin Deactivate: PATCH /api/rooms/:id/deactivate`);
  console.log(`♻️ Admin Restore: PATCH /api/rooms/:id/restore`);
});