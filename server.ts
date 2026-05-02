import express from "express";
import path from "path";
import cors from "cors";

const app = express();

// 🔥 CRITICAL: must use 0.0.0.0
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Fix __dirname
const __dirname = new URL('.', import.meta.url).pathname;

// Serve React build
const distPath = path.join(__dirname, "dist");
app.use(express.static(distPath));

// React routing fix
app.get("*", (req, res) => {
  res.sendFile(path.join(distPath, "index.html"));
});

// 🔥 THIS LINE FIXES YOUR DEPLOYMENT
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on ${PORT}`);
});
