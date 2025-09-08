import express from "express";
import multer from "multer";
import { CloudinaryStorage } from "multer-storage-cloudinary";
import { v2 as cloudinary } from "cloudinary";
import cors from "cors";
import dotenv from "dotenv";
import connectDB from "./config/Database.js";
import Image from "./models/image.js";
import DepartmentRoutes from "./routes/department.js";
import AuthRoutes from "./routes/auth.js";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
app.use("/api/auth", AuthRoutes);
// Use Department routes
app.use("/api/departments", DepartmentRoutes);


// Connect to MongoDB
connectDB();

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cors());

// Cloudinary configuration
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME || "dl5nvw6pa",
  api_key: process.env.CLOUDINARY_API_KEY || "927697336393333",
  api_secret: process.env.CLOUDINARY_API_SECRET || "icCm5jFcPR-0YsUVkaEYVByRElY"
});

// Multer storage configuration
const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: {
    folder: "cse-vr-panorama",
    format: async (req, file) => "jpeg",
    public_id: (req, file) => file.originalname + '-' + Date.now(),
  },
});

const upload = multer({ 
  storage: storage,
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB limit
  },
  fileFilter: (req, file, cb) => {
    // Check file type
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed!'), false);
    }
  }
});

// MONITORING ROUTES
app.get('/api/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    environment: process.env.NODE_ENV || 'development'
  });
});

app.get('/api/stats', async (req, res) => {
  try {
    const totalRooms = await Image.countDocuments({ isActive: true });
    const totalInactiveRooms = await Image.countDocuments({ isActive: false });
    const totalViews = await Image.aggregate([
      { $match: { isActive: true } },
      { $group: { _id: null, totalViews: { $sum: "$views" } } }
    ]);
    
    const recentUploads = await Image.find({ isActive: true })
      .sort({ createdAt: -1 })
      .limit(5)
      .select('roomName createdAt views');
    
    const popularRooms = await Image.find({ isActive: true })
      .sort({ views: -1 })
      .limit(5)
      .select('roomName views createdAt');
    
    res.json({
      success: true,
      data: {
        totalRooms,
        totalInactiveRooms,
        totalViews: totalViews.length > 0 ? totalViews[0].totalViews : 0,
        recentUploads,
        popularRooms,
        serverUptime: process.uptime(),
        timestamp: new Date().toISOString()
      }
    });
  } catch (error) {
    console.error("Stats error:", error);
    res.status(500).json({ success: false, error: 'Failed to fetch stats' });
  }
});

// MAIN ROUTES
app.get('/', (req, res) => {
  res.json({ 
    message: "CSE VR Panorama API is running!",
    version: "1.1.0",
    endpoints: {
      health: '/api/health',
      stats: '/api/stats',
      rooms: {
        getAll: 'GET /api/rooms',
        getById: 'GET /api/rooms/:id',
        create: 'POST /api/upload',
        update: 'PUT /api/rooms/:id',
        delete: 'DELETE /api/rooms/:id',
        bulkDelete: 'DELETE /api/rooms/bulk',
        search: 'GET /api/rooms/search?q=searchTerm'
      }
    }
  });
});

app.get("/api/rooms", async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const sortBy = req.query.sortBy || "createdAt";
    const sortOrder = req.query.sortOrder === "asc" ? 1 : -1;
    const includeInactive = req.query.includeInactive === "true";
    const department = req.query.department; // NEW: optional department filter

    const skip = (page - 1) * limit;

    // Build filter query
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

// SEARCH ROOMS
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

// GET SPECIFIC ROOM - Enhanced with view tracking
app.get("/api/rooms/:id", async (req, res) => {
  try {
    const room = await Image.findById(req.params.id);
    
    if (!room) {
      return res.status(404).json({ success: false, error: "Room not found" });
    }
    
    // Increment view count
    await Image.findByIdAndUpdate(req.params.id, { $inc: { views: 1 } });
    room.views += 1;
    
    res.json({ success: true, data: room });
  } catch (error) {
    console.error("Fetch room error:", error);
    res.status(500).json({ success: false, error: "Failed to fetch room" });
  }
});

app.post("/api/upload", upload.single("panoramaImage"), async (req, res) => {
  try {
    console.log("File received:", req.file);
    console.log("Body received:", req.body);

    const { roomName, description, department } = req.body;

    if (!req.file) {
      return res.status(400).json({ success: false, error: "No file uploaded" });
    }
    if (!roomName || !roomName.trim()) {
      return res.status(400).json({ success: false, error: "Room name is required" });
    }
    if (!department || !department.trim()) {
      return res.status(400).json({ success: false, error: "Department is required" });
    }

    const existingRoom = await Image.findOne({
      roomName: roomName.trim(),
      department: department.trim(),
      isActive: true
    });

    if (existingRoom) {
      return res.status(400).json({ success: false, error: "Room name already exists in this department" });
    }

    const newImage = new Image({
      filename: req.file.originalname,
      url: req.file.path,       // Cloudinary: secure_url OR path | Disk: path
      public_id: req.file.public_id || null, // only if cloudinary
      roomName: roomName.trim(),
      description: description ? description.trim() : "",
      department: department.trim()
    });

    await newImage.save();

    res.status(201).json({
      success: true,
      message: "File uploaded successfully",
      data: newImage
    });
  } catch (error) {
    console.error("Upload error:", error);
    if (req.file && req.file.public_id) {
      try {
        await cloudinary.uploader.destroy(req.file.public_id);
      } catch (e) {}
    }
    res.status(500).json({ success: false, error: "Upload failed" });
  }
});

// UPDATE ROOM - New feature
app.put("/api/rooms/:id", async (req, res) => {
  try {
    const { roomName, description } = req.body;
    const roomId = req.params.id;
    
    const room = await Image.findById(roomId);
    if (!room) {
      return res.status(404).json({ success: false, error: "Room not found" });
    }
    
    // Check if new room name already exists (excluding current room)
    if (roomName && roomName !== room.roomName) {
      const existingRoom = await Image.findOne({ 
        roomName: roomName.trim(), 
        isActive: true,
        _id: { $ne: roomId }
      });
      
      if (existingRoom) {
        return res.status(400).json({ 
          success: false, 
          error: "Room name already exists. Please choose a different name." 
        });
      }
    }
    
    const updateData = {};
    if (roomName) updateData.roomName = roomName.trim();
    if (description !== undefined) updateData.description = description.trim();
    
    const updatedRoom = await Image.findByIdAndUpdate(
      roomId, 
      updateData, 
      { new: true, runValidators: true }
    );
    
    res.json({
      success: true,
      message: "Room updated successfully",
      data: updatedRoom
    });
  } catch (error) {
    console.error("Update error:", error);
    res.status(500).json({ success: false, error: "Failed to update room" });
  }
});

// DELETE SINGLE ROOM - Enhanced with better error handling
app.delete("/api/rooms/:id", async (req, res) => {
  try {
    const room = await Image.findById(req.params.id);
    
    if (!room) {
      return res.status(404).json({ success: false, error: "Room not found" });
    }

    // Delete from Cloudinary first
    if (room.public_id) {
      try {
        const cloudinaryResult = await cloudinary.uploader.destroy(room.public_id);
        console.log("Cloudinary deletion result:", cloudinaryResult);
      } catch (cloudinaryError) {
        console.error("Cloudinary deletion error:", cloudinaryError);
        // Continue with database deletion even if Cloudinary fails
      }
    }
    
    // Delete from database
    await Image.findByIdAndDelete(req.params.id);
    
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
    console.error("Delete error:", error);
    res.status(500).json({ success: false, error: "Failed to delete room" });
  }
});

// BULK DELETE ROOMS - New feature
app.delete("/api/rooms/bulk", async (req, res) => {
  try {
    const { roomIds } = req.body;
    
    if (!roomIds || !Array.isArray(roomIds) || roomIds.length === 0) {
      return res.status(400).json({ 
        success: false, 
        error: "Room IDs array is required" 
      });
    }
    
    // Find rooms to delete
    const roomsToDelete = await Image.find({ 
      _id: { $in: roomIds } 
    }).select('_id roomName public_id filename');
    
    if (roomsToDelete.length === 0) {
      return res.status(404).json({ success: false, error: "No rooms found to delete" });
    }
    
    // Delete from Cloudinary
    const cloudinaryDeletions = roomsToDelete
      .filter(room => room.public_id)
      .map(room => cloudinary.uploader.destroy(room.public_id));
    
    try {
      await Promise.all(cloudinaryDeletions);
      console.log("Bulk Cloudinary deletion completed");
    } catch (cloudinaryError) {
      console.error("Some Cloudinary deletions failed:", cloudinaryError);
      // Continue with database deletion
    }
    
    // Delete from database
    const deleteResult = await Image.deleteMany({ 
      _id: { $in: roomIds } 
    });
    
    res.json({
      success: true,
      message: `Successfully deleted ${deleteResult.deletedCount} room(s)`,
      deletedCount: deleteResult.deletedCount,
      deletedRooms: roomsToDelete.map(room => ({
        id: room._id,
        roomName: room.roomName,
        filename: room.filename
      }))
    });
  } catch (error) {
    console.error("Bulk delete error:", error);
    res.status(500).json({ success: false, error: "Failed to delete rooms" });
  }
});

// SOFT DELETE ROOM - Mark as inactive instead of permanent deletion
app.patch("/api/rooms/:id/deactivate", async (req, res) => {
  try {
    const room = await Image.findById(req.params.id);
    
    if (!room) {
      return res.status(404).json({ success: false, error: "Room not found" });
    }
    
    const updatedRoom = await Image.findByIdAndUpdate(
      req.params.id,
      { isActive: false },
      { new: true }
    );
    
    res.json({
      success: true,
      message: "Room deactivated successfully",
      data: updatedRoom
    });
  } catch (error) {
    console.error("Deactivate error:", error);
    res.status(500).json({ success: false, error: "Failed to deactivate room" });
  }
});

// RESTORE ROOM - Reactivate a soft-deleted room
app.patch("/api/rooms/:id/restore", async (req, res) => {
  try {
    const room = await Image.findById(req.params.id);
    
    if (!room) {
      return res.status(404).json({ success: false, error: "Room not found" });
    }
    
    const updatedRoom = await Image.findByIdAndUpdate(
      req.params.id,
      { isActive: true },
      { new: true }
    );
    
    res.json({
      success: true,
      message: "Room restored successfully",
      data: updatedRoom
    });
  } catch (error) {
    console.error("Restore error:", error);
    res.status(500).json({ success: false, error: "Failed to restore room" });
  }
});

// Error handling middleware
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

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    success: false,
    error: 'Endpoint not found'
  });
});

app.listen(PORT, () => {
  console.log(`🚀 Server is running on port ${PORT}`);
});