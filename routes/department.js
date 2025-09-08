// routes/departments.js
import express from "express";
import Image from "../models/image.js";

const router = express.Router();

//  Get rooms by department
router.get("/rooms", async (req, res) => {
  try {
    const { department } = req.query;
    const filter = department ? { department } : {};
    const rooms = await Image.find(filter).sort({ createdAt: -1 });
    res.json(rooms);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

//  Add new room
router.post("/rooms", async (req, res) => {
  try {
    const { filename, url, roomName, description, department } = req.body;

    const newRoom = new Image({
      filename,
      url,
      roomName,
      description,
      department
    });

    await newRoom.save();
    res.status(201).json(newRoom);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
