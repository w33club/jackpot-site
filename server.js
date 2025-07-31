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
  if (jackpotCodes[type] && !jackpotCodes[type].includes(code)) {
    jackpotCodes[type].push(code);
    res.json({ success: true });
  } else {
    res.status(400).json({ error: "Code already exists or invalid type" });
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

// 管理页面密码保护
app.use('/admin.html', (req, res, next) => {
  // 从环境变量获取凭证
  const ADMIN_USER = process.env.ADMIN_USER || 'admin';
  const ADMIN_PASS = process.env.ADMIN_PASS || 'password123';
  
  const authHeader = req.headers.authorization || '';
  const token = authHeader.split(' ')[1] || '';
  
  if (!token) {
    res.set('WWW-Authenticate', 'Basic realm="Admin Access"');
    return res.status(401).send('Authentication required');
  }
  
  const [username, password] = Buffer.from(token, 'base64').toString().split(':');
  
  if (username === ADMIN_USER && password === ADMIN_PASS) {
    return next();
  }
  
  res.set('WWW-Authenticate', 'Basic realm="Admin Access"');
  res.status(401).send('Invalid credentials');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
