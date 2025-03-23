// server.js
const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const crypto = require('crypto');

const app = express();

// Use Railway's dynamic PORT or fallback to 3000
const PORT = process.env.PORT || 3000;

// Discord webhook URL
const DISCORD_WEBHOOK_URL =
  'https://discord.com/api/webhooks/1353388187543928913/yfLAWZg8sQdYPVw-WH3MDExeZm2TKPATV1WR0QADLdDdoh5DbwrLMMi3sdEzOS4P1e1O';

// Middleware
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname)));

// Initialize SQLite
const db = new sqlite3.Database('urls.db', (err) => {
  if (err) {
    console.error('Could not connect to database:', err);
  } else {
    console.log('Connected to SQLite database.');
  }
});

// Create table if it doesn’t exist (including visits & expirationDate columns)
db.run(`CREATE TABLE IF NOT EXISTS short_urls (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT UNIQUE,
  originalUrl TEXT NOT NULL,
  visits INTEGER DEFAULT 0,
  expirationDate TEXT
);`);

// Helper function to generate random short code
function generateShortCode() {
  return crypto.randomBytes(3).toString('hex'); // e.g., "a1b2c3"
}

// Serve main.html
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'main.html'));
});

// Endpoint to create a short URL
app.post('/shorten', (req, res) => {
  let { url: originalUrl, expirationMs } = req.body;
  if (!originalUrl) {
    return res.status(400).json({ error: 'No URL provided.' });
  }

  // 1) Validate or prepend protocol
  if (!/^https?:\/\//i.test(originalUrl)) {
    originalUrl = 'http://' + originalUrl;
  }

  try {
    new URL(originalUrl);
  } catch (error) {
    return res.status(400).json({
      error: 'Invalid URL format. Please include http:// or https://',
    });
  }

  // 2) Parse expiration
  let expirationDate = null;
  const expirationVal = parseInt(expirationMs, 10) || 0;
  if (expirationVal > 0) {
    expirationDate = new Date(Date.now() + expirationVal).toISOString();
  }

  // 3) Generate a unique short code
  const shortCode = generateShortCode();

  // 4) Insert into DB
  db.run(
    `INSERT INTO short_urls (code, originalUrl, expirationDate)
     VALUES (?, ?, ?)`,
    [shortCode, originalUrl, expirationDate],
    function (err) {
      if (err) {
        console.error(err);
        return res.status(500).json({ error: 'Database error.' });
      }
      return res.json({ shortCode });
    }
  );
});

// Redirect route
app.get('/:code', (req, res) => {
  const shortCode = req.params.code;

  db.get(
    `SELECT id, code, originalUrl, visits, expirationDate
     FROM short_urls WHERE code = ?`,
    [shortCode],
    (err, row) => {
      if (err) {
        console.error(err);
        return res.status(500).send('Database error.');
      }
      if (!row) {
        return res.status(404).send('Short URL not found.');
      }

      // Check expiration
      if (row.expirationDate) {
        const now = Date.now();
        const exp = Date.parse(row.expirationDate);
        if (now > exp) {
          return res.status(410).send('Link expired.');
        }
      }

      // Update visit count
      const newVisitCount = row.visits + 1;
      db.run(
        `UPDATE short_urls SET visits = ? WHERE id = ?`,
        [newVisitCount, row.id],
        (updateErr) => {
          if (updateErr) {
            console.error(updateErr);
            // We'll still continue to the redirect, but the visit count won't update
          }

          // Attempt better IP detection
          const forwarded = req.headers['x-forwarded-for'];
          const ipAddr = forwarded ? forwarded.split(',')[0].trim() : req.ip;

          // Build the Discord webhook message
          const timeString = new Date().toLocaleString();
          const shortenedUrl = `${req.protocol}://${req.get('host')}/${shortCode}`;

          const infoPayload = {
            content: `**Shortened URL:** ${shortenedUrl}\n` +
                     `**Original URL:** ${row.originalUrl}\n` +
                     `**IP:** ${ipAddr}\n` +
                     `**User-Agent:** ${req.headers['user-agent']}\n` +
                     `**Timestamp:** ${timeString}`
          };

          // Debug log: see what we're about to send
          console.log('Attempting to send webhook payload:', infoPayload);

          // Send analytics to Discord Webhook
          fetch(DISCORD_WEBHOOK_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(infoPayload),
          })
            .then(async (response) => {
              console.log('Discord webhook response status:', response.status);
              const text = await response.text();
              console.log('Discord webhook response body:', text);
            })
            .catch((webhookErr) => {
              console.error('Error sending to Discord webhook:', webhookErr);
            });

          // Finally redirect
          res.redirect(row.originalUrl);
        }
      );
    }
  );
});

// Start server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
