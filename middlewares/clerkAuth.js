// middlewares/clerkAuth.js
import { verifyToken } from "@clerk/backend";
import { clerkClient } from "@clerk/clerk-sdk-node"; // <- change here

const clerkAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      console.log("❌ No authorization header found");
      return res.status(401).json({ success: false, error: "Unauthorized - No token provided" });
    }

    const token = authHeader.split(" ")[1];
    const secretKey = process.env.CLERK_SECRET_KEY;
    if (!secretKey) {
      console.error("❌ CLERK_SECRET_KEY not found in environment variables");
      return res.status(500).json({ success: false, error: "Server configuration error" });
    }

    const payload = await verifyToken(token, { secretKey });
    if (!payload || !payload.sub) {
      console.log("❌ Invalid session token");
      return res.status(401).json({ success: false, error: "Invalid authentication token" });
    }

    const userId = payload.sub;
    let userObj = null;
    try {
      userObj = await clerkClient.users.getUser(userId);
    } catch (err) {
      console.warn("⚠️ Could not fetch user from Clerk:", err?.message || err);
    }

    req.auth = { userId, sessionId: payload.sid || null };
    req.user = {
      id: userId,
      email: userObj?.emailAddresses?.[0]?.emailAddress || payload.email || payload.primaryEmail || null,
      firstName: userObj?.firstName || payload.firstName || null,
      lastName: userObj?.lastName || payload.lastName || null,
    };

    console.log("✅ User authenticated:", req.user.email);
    next();
  } catch (error) {
    console.error("❌ clerkAuth error:", error.message || error);
    if ((error.message || "").includes("Missing Clerk Secret Key")) {
      return res.status(500).json({ success: false, error: "Server configuration error - Missing Clerk credentials" });
    }
    return res.status(401).json({ success: false, error: "Authentication failed" });
  }
};

export default clerkAuth;
