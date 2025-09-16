const express = require("express");
const pool = require("./config/db.js");
const dotenv = require("dotenv");
const cors = require("cors");
const axios = require("axios");

dotenv.config();
const app = express();
const PORT = process.env.PORT || 3000;
const RATE_LIMIT_MAX = process.env.RATE_LIMIT_MAX || 100;
const RATE_LIMIT_WINDOW = 60 * 1000; // 1 minute

app.use(express.json());
app.use(cors());

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

const getGeoLocation = async (ip) => {
  try {
    const response = await axios.get(`http://ip-api.com/json/${ip}`);
    console.log("ip", ip);
    console.log("response", response.data);
    return {
      country: response.data.country || "Unknown",
      city: response.data.city || "Unknown",
    };
  } catch (error) {
    console.error("Geolocation error:", error);
    return { country: "Unknown", city: "Unknown" };
  }
};

app.post("/track", rateLimiter, async (req, res) => {
  const { page_url, referrer, user_agent } = req.body;
  const ip_address = req.headers["x-forwarded-for"] || req.socket.remoteAddress;

  console.log("ip_track", ip_address);
  if (!page_url) {
    return res.status(400).json({ error: "page_url is required" });
  }

  try {
    const { country, city } = await getGeoLocation(ip_address);
    await pool.query(
      `INSERT INTO analytics (page_url, referrer, user_agent, ip_address, country, city, timestamp) 
       VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
      [
        page_url,
        referrer || "Direct",
        user_agent || "Unknown",
        ip_address,
        country,
        city,
      ]
    );

    res.status(201).json({ message: "Analytics data logged" });
  } catch (error) {
    console.error("Error logging analytics:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// GET /analytics
// GET /analytics?gmt7
// GET /analytics?human
// GET /analytics?gmt7&human

app.get("/analytics", async (req, res) => {
  try {
    const { gmt7, human } = req.query;

    const result = await pool.query(`
      SELECT *
      FROM analytics 
      ORDER BY timestamp DESC
    `);

    let data = result.rows;

    data = data.map((row) => {
      const date = new Date(row.timestamp);

      // Default UTC ISO
      let ts = date.toISOString();

      if (gmt7 || human) {
        const formatter = new Intl.DateTimeFormat("en-GB", {
          timeZone: "Asia/Jakarta",
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
          hour12: false,
        });

        const parts = formatter.formatToParts(date);
        const yyyy = parts.find((p) => p.type === "year").value;
        const mm = parts.find((p) => p.type === "month").value;
        const dd = parts.find((p) => p.type === "day").value;
        const hh = parts.find((p) => p.type === "hour").value;
        const mi = parts.find((p) => p.type === "minute").value;
        const ss = parts.find((p) => p.type === "second").value;

        if (human) {
          // Human-readable Jakarta
          ts = `${yyyy}-${mm}-${dd} ${hh}:${mi}:${ss}`;
        } else if (gmt7) {
          // Jakarta ISO-like with +07:00
          ts = `${yyyy}-${mm}-${dd}T${hh}:${mi}:${ss}+07:00`;
        }
      }

      return { ...row, timestamp: ts };
    });

    res.json({
      total: result.rowCount,
      data,
    });
  } catch (error) {
    console.error("Error fetching analytics:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
module.exports = app;
