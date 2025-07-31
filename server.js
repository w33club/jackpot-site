const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(bodyParser.json());

// In-memory database (replace with real DB in production)
let codeDB = {
  mini: ["MINI123", "MINI456", "MINI789"],
  minor: ["MINOR123", "MINOR456", "MINOR789"],
  mega: ["MEGA123", "MEGA456", "MEGA789"],
  grand: ["GRAND123", "GRAND456", "GRAND789"]
};

// API Endpoints
app.get('/api/codes', (req, res) => {
  res.json(codeDB);
});

app.post('/api/codes/add', (req, res) => {
  const { type, code } = req.body;
  if (!codeDB[type]) return res.status(400).json({ error: 'Invalid jackpot type' });
  
  codeDB[type].push(code.toUpperCase());
  res.json({ success: true });
});

app.post('/api/codes/clear', (req, res) => {
  codeDB = {
    mini: [],
    minor: [],
    mega: [],
    grand: []
  };
  res.json({ success: true });
});

// Serve HTML files
app.get('/game', (req, res) => {
  res.sendFile(__dirname + '/public/game.html');
});

app.get('/admin', (req, res) => {
  res.sendFile(__dirname + '/public/admin.html');
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
