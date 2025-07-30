const express = require('express');
const path = require('path');
const app = express();

// 使用内存存储（所有用户共享）
let jackpotCodes = {
  mini: ['MINI-2024-001'],
  minor: ['MINOR-2024-001'],
  mega: ['MEGA-2024-001'],
  grand: ['GRAND-2024-001']
};

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// API端点 - 获取所有代码
app.get('/api/codes', (req, res) => {
  res.json(jackpotCodes);
});

// API端点 - 添加代码
app.post('/api/codes/add', (req, res) => {
  const { type, code } = req.body;
  if (!jackpotCodes[type].includes(code)) {
    jackpotCodes[type].push(code);
    res.json({ success: true });
  } else {
    res.status(400).json({ error: "Code already exists" });
  }
});

// API端点 - 清空代码
app.post('/api/codes/clear', (req, res) => {
  jackpotCodes = { mini: [], minor: [], mega: [], grand: [] };
  res.json({ success: true });
});

// 默认首页
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'game.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
