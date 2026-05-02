import express from "express";
import path from "path";
import cors from "cors";

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Fix __dirname for ES modules
const __dirname = new URL('.', import.meta.url).pathname;

// Serve React build
const distPath = path.join(__dirname, "dist");
app.use(express.static(distPath));

// Handle React routing
app.get("*", (req, res) => {
  res.sendFile(path.join(distPath, "index.html"));
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
