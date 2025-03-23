const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const crypto = require('crypto');

const app = express();

// Use Railway's dynamic PORT or default to 3000 locally
const PORT = process.env.PORT || 3000;

// Discord webhook
const DISCORD_WEBHOOK_URL =
  'https://discord.com/api/webhooks/1353388187543928913/...'; // your actual webhook

// Middleware
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
// Serve static files (HTML, CSS, JS) directly from the project root
app.use(express.static(path.join(__dirname)));

// Initialize SQLite
const db = new sqlite3.Database('urls.db', (err) => {
  if (err) {
    console.error('Could not connect to database:', err);
  } else {
    console.log('Connected to SQLite database.');
  }
});

// Create table if doesn't exist
db.run(`CREATE TABLE IF NOT EXISTS short_urls (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT UNIQUE,
  originalUrl TEXT NOT NULL,
  visits INTEGER DEFAULT 0,
  expirationDate TEXT
);`);

// Generate random short code
function generateShortCode() {
  return crypto.randomBytes(3).toString('hex');
}

// Serve main.html (if needed, but express.static should handle it)
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'main.html'));
});

// Shorten endpoint
app.post('/shorten', (req, res) => {
  let { url: originalUrl, expirationMs } = req.body;

  // Basic validation
  if (!originalUrl) {
    return res.status(400).json({ error: 'No URL provided.' });
  }

  if (!/^https?:\/\//i.test(originalUrl)) {
    originalUrl = 'http://' + originalUrl;
  }

  // Attempt to parse
  try {
    new URL(originalUrl);
  } catch (error) {
    return res.status(400).json({ error: 'Invalid URL format.' });
  }

  // Expiration
  let expirationDate = null;
  const expVal = parseInt(expirationMs, 10) || 0;
  if (expVal > 0) {
    expirationDate = new Date(Date.now() + expVal).toISOString();
  }

  // Generate code
  const shortCode = generateShortCode();

  // Insert into DB
  db.run(
    `INSERT INTO short_urls (code, originalUrl, expirationDate)
     VALUES (?, ?, ?)`,
    [shortCode, originalUrl, expirationDate],
    function (err) {
      if (err) {
        console.error(err);
        return res.status(500).json({ error: 'Database error.' });
      }
      res.json({ shortCode });
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

      // Check if expired
      if (row.expirationDate && Date.now() > Date.parse(row.expirationDate)) {
        return res.status(410).send('Link expired.');
      }

      // Update visits
      const newVisitCount = row.visits + 1;
      db.run(
        `UPDATE short_urls SET visits = ? WHERE id = ?`,
        [newVisitCount, row.id],
        (updateErr) => {
          if (updateErr) console.error(updateErr);

          // Send analytics to Discord
          const forwarded = req.headers['x-forwarded-for'];
          const ipAddr = forwarded ? forwarded.split(',')[0].trim() : req.ip;
          const timeString = new Date().toLocaleString();
          const shortenedUrl = `${req.protocol}://${req.get('host')}/${shortCode}`;

          const infoPayload = {
            content: `**Shortened URL:** ${shortenedUrl}\n` +
                     `**Original URL:** ${row.originalUrl}\n` +
                     `**IP:** ${ipAddr}\n` +
                     `**User-Agent:** ${req.headers['user-agent']}\n` +
                     `**Timestamp:** ${timeString}`
          };

          fetch(DISCORD_WEBHOOK_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(infoPayload),
          }).catch((webhookErr) => {
            console.error('Error sending to Discord webhook:', webhookErr);
          });

          // Redirect to original
          res.redirect(row.originalUrl);
        }
      );
    }
  );
});

// Start
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
