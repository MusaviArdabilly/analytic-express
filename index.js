const express = require("express");
const pool = require("./config/db.js");
const dotenv = require("dotenv");
const cors = require("cors");

dotenv.config();
const app = express();
const PORT = process.env.PORT || 3000;
const RATE_LIMIT_MAX = process.env.RATE_LIMIT_MAX || 100;
const RATE_LIMIT_WINDOW = 60 * 1000; // 1 minute

app.use(express.json());
app.use(cors({
  origin: "*",  // Allow all origins
  methods: ["GET", "POST", "OPTIONS"],  // Allow necessary HTTP methods
  allowedHeaders: ["Content-Type", "Authorization"]  // Allow headers
}));

const rateLimits = new Map();

const rateLimiter = (req, res, next) => {
    const ip_address = req.headers["x-forwarded-for"] || req.socket.remoteAddress;
    const now = Date.now();

    if (!rateLimits.has(ip_address)) {
        rateLimits.set(ip_address, { count: 1, startTime: now });
    } else {
        const entry = rateLimits.get(ip_address);
        if (now - entry.startTime > RATE_LIMIT_WINDOW) {
            // Reset count after time window
            entry.count = 1;
            entry.startTime = now;
        } else if (entry.count >= RATE_LIMIT_MAX) {
            return res.status(429).json({ error: "Too many requests, slow down!" });
        } else {
            entry.count++;
        }
        rateLimits.set(ip_address, entry);
    }

    next();
};

app.post("/track", rateLimiter, async (req, res) => {
    const { page_url, referrer, user_agent } = req.body;
    const ip_address = req.headers["x-forwarded-for"] || req.socket.remoteAddress;

    if (!page_url) {
        return res.status(400).json({ error: "page_url is required" });
    }

    try {
        await pool.query(
            `INSERT INTO analytics (page_url, referrer, user_agent, ip_address, timestamp) 
             VALUES ($1, $2, $3, $4, NOW())`,
            [page_url, referrer || "Direct", user_agent || "Unknown", ip_address]
        );

        res.status(201).json({ message: "Analytics data logged" });
    } catch (error) {
        console.error("Error logging analytics:", error);
        res.status(500).json({ error: "Internal Server Error" });
    }
});

app.get("/analytics", async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT COUNT(*) AS views, page_url 
            FROM analytics 
            GROUP BY page_url 
            ORDER BY views DESC
        `);

        res.json(result.rows);
    } catch (error) {
        console.error("Error fetching analytics:", error);
        res.status(500).json({ error: "Internal Server Error" });
    }
});

// app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
module.exports = app;
