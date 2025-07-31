const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const path = require('path');

const app = express();
app.use(cors());
app.use(bodyParser.json());

// 静态文件服务
app.use(express.static(path.join(__dirname, 'public')));

// In-memory database with unique code tracking
let codeDB = {
  mini: ["MINI123", "MINI456", "MINI789"],
  minor: ["MINOR123", "MINOR456", "MINOR789"],
  mega: ["MEGA123", "MEGA456", "MEGA789"],
  grand: ["GRAND123", "GRAND456", "GRAND789"]
};

// Track used codes
let usedCodes = new Set();

// API Endpoints
app.get('/api/codes', (req, res) => {
  res.json(codeDB);
});

app.post('/api/codes/add', (req, res) => {
  const { type, code } = req.body;
  const codeUpper = code.toUpperCase();
  
  if (!codeDB[type]) {
    return res.status(400).json({ error: 'Invalid jackpot type' });
  }
  
  // Check if code is already in any jackpot type
  const allCodes = Object.values(codeDB).flat();
  if (allCodes.includes(codeUpper)) {
    return res.status(400).json({ error: 'Code already exists' });
  }
  
  codeDB[type].push(codeUpper);
  res.json({ success: true });
});

app.post('/api/codes/clear', (req, res) => {
  codeDB = {
    mini: [],
    minor: [],
    mega: [],
    grand: []
  };
  usedCodes.clear();
  res.json({ success: true });
});

// Mark code as used
app.post('/api/codes/use', (req, res) => {
  const { code } = req.body;
  const codeUpper = code.toUpperCase();
  
  if (usedCodes.has(codeUpper)) {
    return res.status(400).json({ error: 'Code already used' });
  }
  
  usedCodes.add(codeUpper);
  res.json({ success: true });
});

// Check if code is valid
app.post('/api/codes/validate', (req, res) => {
  const { code } = req.body;
  const codeUpper = code.toUpperCase();
  
  // Find which type this code belongs to
  for (const type in codeDB) {
    if (codeDB[type].includes(codeUpper)) {
      return res.json({ valid: true, type });
    }
  }
  
  res.json({ valid: false });
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log('Initial codes:');
  console.log('Mini:', codeDB.mini.join(', '));
  console.log('Minor:', codeDB.minor.join(', '));
  console.log('Mega:', codeDB.mega.join(', '));
  console.log('Grand:', codeDB.grand.join(', '));
});
