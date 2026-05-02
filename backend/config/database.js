// ============================================================
//  ClickSafe — backend/config/database.js
//
//  Creates a mysql2 connection pool using values from .env.
//  Import this anywhere you need the database:
//    const db = require("../config/database");
//    const [rows] = await db.query("SELECT ...", [params]);
//
//  The pool is created lazily on first import and reused
//  across the entire process lifetime.
// ============================================================

const mysql = require("mysql2/promise");

// Validate that the required env vars are present before trying to connect.
// This gives a clear error message instead of a cryptic MySQL connection failure.
const required = ["DB_HOST", "DB_USER", "DB_PASSWORD", "DB_NAME"];
for (const key of required) {
  if (!process.env[key]) {
    console.error(`[ClickSafe] Missing required env var: ${key}`);
    console.error("[ClickSafe] Copy backend/.env.example → backend/.env and fill in your DB credentials.");
    process.exit(1);
  }
}

const pool = mysql.createPool({
  host:               process.env.DB_HOST     || "localhost",
  port:     parseInt(process.env.DB_PORT      || "3306", 10),
  user:               process.env.DB_USER,
  password:           process.env.DB_PASSWORD || "",
  database:           process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit:    10,     // max simultaneous connections
  queueLimit:         0,      // unlimited queue
  // Return JS Date objects for DATETIME columns instead of strings
  dateStrings:        false,
  // Auto-reconnect on dropped connections
  enableKeepAlive:    true,
  keepAliveInitialDelay: 10000
});

// Test the connection on startup so errors surface immediately
pool.getConnection()
  .then(conn => {
    console.log("[ClickSafe] MySQL connected successfully");
    conn.release();
  })
  .catch(err => {
    console.error("[ClickSafe] MySQL connection failed:", err.message);
    console.error("[ClickSafe] Check your DB_* values in backend/.env and make sure MySQL is running.");
    // Don't exit — the server can still handle requests that don't need the DB
  });

module.exports = pool;