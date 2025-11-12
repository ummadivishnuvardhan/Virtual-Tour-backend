// middlewares/isAdmin.js
const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || "ummadivishnuvardhan46@gmail.com")
  .split(",")
  .map(e => e.trim().toLowerCase());

export default function isAdmin(req, res, next) {
  // Check both email and emailAddress fields
  const email = (req.user?.email || req.user?.emailAddress || "").toLowerCase();
  
  console.log("🔍 Checking admin access for:", email);
  console.log("📋 Admin emails:", ADMIN_EMAILS);
  
  if (!email) {
    console.log("❌ No email found in request");
    return res.status(403).json({ 
      success: false, 
      error: "Admin access required - No email found" 
    });
  }
  
  if (!ADMIN_EMAILS.includes(email)) {
    console.log("❌ User is not an admin:", email);
    return res.status(403).json({ 
      success: false, 
      error: "Admin access required - You don't have admin privileges" 
    });
  }
  
  console.log("✅ Admin access granted for:", email);
  next();
}