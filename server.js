const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const path = require('path');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const app = express();
app.use(cors());
app.use(bodyParser.json());

// 静态文件服务
app.use(express.static(path.join(__dirname, 'public')));

// PostgreSQL 连接配置
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// JWT 密钥
const JWT_SECRET = process.env.JWT_SECRET;

// 初始化数据库表
async function initDB() {
  try {
    // 创建代码表
    await pool.query(`
      CREATE TABLE IF NOT EXISTS codes (
        id SERIAL PRIMARY KEY,
        type VARCHAR(10) NOT NULL,
        code VARCHAR(50) NOT NULL UNIQUE
      )
    `);
    
    // 创建已使用代码表
    await pool.query(`
      CREATE TABLE IF NOT EXISTS used_codes (
        id SERIAL PRIMARY KEY,
        code VARCHAR(50) NOT NULL UNIQUE,
        used_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    // 创建用户表
    await pool.query(`
      CREATE TABLE IF NOT EXISTS admin_users (
        id SERIAL PRIMARY KEY,
        username VARCHAR(50) NOT NULL UNIQUE,
        password_hash VARCHAR(100) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    // 创建奖池表
    await pool.query(`
      CREATE TABLE IF NOT EXISTS jackpots (
        name VARCHAR(10) PRIMARY KEY,
        current_value DOUBLE PRECISION NOT NULL,
        min_value DOUBLE PRECISION NOT NULL,
        max_value DOUBLE PRECISION NOT NULL,
        last_updated TIMESTAMP NOT NULL,
        last_reset TIMESTAMP NOT NULL
      )
    `);
    
    // 初始化默认奖池值（仅当表为空时）
    const jackpotCheck = await pool.query('SELECT COUNT(*) FROM jackpots');
    if (jackpotCheck.rows[0].count == 0) {
      const now = new Date();
      const jackpots = [
        { name: 'mini', current: 1.0, min: 1.0, max: 8.0 },
        { name: 'minor', current: 8.0, min: 8.0, max: 20.0 },
        { name: 'mega', current: 20.0, min: 20.0, max: 40.0 },
        { name: 'grand', current: 40.0, min: 40.0, max: 188.0 }
      ];
      
      for (const jackpot of jackpots) {
        await pool.query(`
          INSERT INTO jackpots (name, current_value, min_value, max_value, last_updated, last_reset)
          VALUES ($1, $2, $3, $4, $5, $5)
        `, [jackpot.name, jackpot.current, jackpot.min, jackpot.max, now]);
      }
      console.log('Jackpot values initialized');
    }
    
    // 创建默认管理员账户
    const defaultUsername = 'admin';
    const defaultPassword = 'admin123';
    
    // 检查默认账户是否已存在
    const userResult = await pool.query(
      'SELECT * FROM admin_users WHERE username = $1',
      [defaultUsername]
    );
    
    if (userResult.rows.length === 0) {
      const passwordHash = bcrypt.hashSync(defaultPassword, 10);
      await pool.query(`
        INSERT INTO admin_users (username, password_hash)
        VALUES ($1, $2)
      `, [defaultUsername, passwordHash]);
      console.log(`Default admin account created: ${defaultUsername}/${defaultPassword}`);
    }
    
    console.log('Database tables initialized');
  } catch (err) {
    console.error('Error initializing database:', err);
  }
}

// 用户认证中间件
async function authenticate(req, res, next) {
  const { username, password } = req.body;
  
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password required' });
  }
  
  try {
    const result = await pool.query(
      'SELECT * FROM admin_users WHERE username = $1',
      [username]
    );
    
    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }
    
    const user = result.rows[0];
    const validPassword = bcrypt.compareSync(password, user.password_hash);
    
    if (!validPassword) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }
    
    // 将用户信息附加到请求对象，以便后续使用
    req.user = user;
    next();
  } catch (err) {
    console.error('Authentication error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
}

// JWT 验证中间件
function authenticateJWT(req, res, next) {
  const authHeader = req.headers.authorization;
  
  if (authHeader) {
    const token = authHeader.split(' ')[1]; // Bearer <token>
    
    jwt.verify(token, JWT_SECRET, (err, user) => {
      if (err) {
        return res.status(403).json({ error: 'Invalid token' });
      }
      
      req.user = user;
      next();
    });
  } else {
    res.status(401).json({ error: 'Authorization header missing' });
  }
}

// 获取当前奖池值
async function getJackpotValues() {
  try {
    const result = await pool.query('SELECT * FROM jackpots');
    const jackpots = {};
    
    result.rows.forEach(row => {
      jackpots[row.name] = {
        current: parseFloat(row.current_value),
        min: parseFloat(row.min_value),
        max: parseFloat(row.max_value),
        lastUpdated: row.last_updated,
        lastReset: row.last_reset
      };
    });
    
    return jackpots;
  } catch (err) {
    console.error('Error getting jackpot values:', err);
    return null;
  }
}

// 更新奖池值（2小时周期）
async function updateJackpotValues() {
    try {
        const now = new Date();
        
        // 直接查询数据库获取当前奖池值
        const result = await pool.query('SELECT * FROM jackpots');
        const jackpots = {};
        
        result.rows.forEach(row => {
            jackpots[row.name] = {
                current: parseFloat(row.current_value),
                min: parseFloat(row.min_value),
                max: parseFloat(row.max_value),
                lastUpdated: new Date(row.last_updated),
                lastReset: new Date(row.last_reset)
            };
        });
        
        for (const [name, jackpot] of Object.entries(jackpots)) {
            const lastReset = jackpot.lastReset;
            const elapsedMs = now - lastReset;
            const elapsedHours = elapsedMs / (1000 * 60 * 60);
            
            // 检查是否需要重置（每2小时重置一次）
            if (elapsedHours >= 2) {
                // 重置为最小值并更新重置时间
                await pool.query(`
                    UPDATE jackpots 
                    SET current_value = $1, last_updated = $2, last_reset = $2
                    WHERE name = $3
                `, [jackpot.min, now, name]);
                continue;
            }
            
            // 计算当前进度（0-1之间）
            const progress = elapsedHours / 2;
            
            // 计算新值（指数增长更自然）
            const range = jackpot.max - jackpot.min;
            const newValue = jackpot.min + (range * Math.pow(progress, 1.5));
            
            // 更新数据库
            await pool.query(`
                UPDATE jackpots 
                SET current_value = $1, last_updated = $2 
                WHERE name = $3
            `, [newValue, now, name]);
        }
    } catch (err) {
        console.error('Error updating jackpot values:', err);
    }
}


// 添加路由处理
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'game.html'));
});

app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// API Endpoints
app.get('/api/codes', async (req, res) => {
  try {
    const result = await pool.query('SELECT type, code FROM codes');
    const codeDB = {
      mini: [],
      minor: [],
      mega: [],
      grand: []
    };
    
    result.rows.forEach(row => {
      if (codeDB[row.type]) {
        codeDB[row.type].push(row.code);
      }
    });
    
    res.json(codeDB);
  } catch (err) {
    console.error('Error fetching codes:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

// 获取奖池值
app.get('/api/jackpots', async (req, res) => {
  try {
    const jackpots = await getJackpotValues();
    if (jackpots) {
      res.json(jackpots);
    } else {
      res.status(500).json({ error: 'Failed to get jackpot values' });
    }
  } catch (err) {
    console.error('Error getting jackpots:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

// 保护管理API端点 - 使用 JWT 中间件
app.post('/api/codes/add', authenticateJWT, async (req, res) => {
  const { type, code } = req.body;
  const codeUpper = code.toUpperCase();
  
  if (!['mini', 'minor', 'mega', 'grand'].includes(type)) {
    return res.status(400).json({ error: 'Invalid jackpot type' });
  }
  
  try {
    // 检查代码是否已存在
    const checkResult = await pool.query(
      'SELECT * FROM codes WHERE code = $1',
      [codeUpper]
    );
    
    if (checkResult.rows.length > 0) {
      return res.status(400).json({ error: 'Code already exists' });
    }
    
    // 插入新代码
    await pool.query(
      'INSERT INTO codes (type, code) VALUES ($1, $2)',
      [type, codeUpper]
    );
    
    res.json({ success: true });
  } catch (err) {
    console.error('Error adding code:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

app.post('/api/codes/clear', authenticateJWT, async (req, res) => {
  try {
    await pool.query('TRUNCATE TABLE codes RESTART IDENTITY');
    await pool.query('TRUNCATE TABLE used_codes RESTART IDENTITY');
    res.json({ success: true });
  } catch (err) {
    console.error('Error clearing codes:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

app.post('/api/codes/use', async (req, res) => {
  const { code } = req.body;
  const codeUpper = code.toUpperCase();
  
  try {
    // 检查是否已使用
    const checkResult = await pool.query(
      'SELECT * FROM used_codes WHERE code = $1',
      [codeUpper]
    );
    
    if (checkResult.rows.length > 0) {
      return res.status(400).json({ error: 'Code already used' });
    }
    
    // 标记为已使用
    await pool.query(
      'INSERT INTO used_codes (code) VALUES ($1)',
      [codeUpper]
    );
    
    res.json({ success: true });
  } catch (err) {
    console.error('Error using code:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

app.post('/api/codes/validate', async (req, res) => {
  const { code } = req.body;
  const codeUpper = code.toUpperCase();
  
  try {
    // 检查代码是否已使用
    const usedResult = await pool.query(
      'SELECT * FROM used_codes WHERE code = $1',
      [codeUpper]
    );
    
    if (usedResult.rows.length > 0) {
      return res.json({ valid: false, reason: 'Code already used' });
    }
    
    // 检查代码有效性
    const codeResult = await pool.query(
      'SELECT type FROM codes WHERE code = $1',
      [codeUpper]
    );
    
    if (codeResult.rows.length > 0) {
      return res.json({ valid: true, type: codeResult.rows[0].type });
    }
    
    res.json({ valid: false, reason: 'Code not found' });
  } catch (err) {
    console.error('Error validating code:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

// 用户管理端点
app.post('/api/admin/login', authenticate, (req, res) => {
  // 生成 JWT 令牌，有效期为 1 小时
  const token = jwt.sign(
    { username: req.user.username, id: req.user.id }, 
    JWT_SECRET, 
    { expiresIn: '1h' }
  );
  res.json({ success: true, token });
});

// 密码更改端点
app.post('/api/admin/change-password', authenticateJWT, async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  const username = req.user.username; // 从 JWT 中获取
  
  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: 'All fields are required' });
  }
  
  if (newPassword.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  }
  
  try {
    // 验证当前密码
    const userResult = await pool.query(
      'SELECT * FROM admin_users WHERE username = $1',
      [username]
    );
    
    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    const user = userResult.rows[0];
    const validPassword = bcrypt.compareSync(currentPassword, user.password_hash);
    
    if (!validPassword) {
      return res.status(401).json({ error: 'Current password is incorrect' });
    }
    
    // 生成新密码哈希
    const newPasswordHash = bcrypt.hashSync(newPassword, 10);
    
    // 更新密码
    await pool.query(
      'UPDATE admin_users SET password_hash = $1 WHERE username = $2',
      [newPasswordHash, username]
    );
    
    res.json({ success: true });
  } catch (err) {
    console.error('Error changing password:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

// 启动服务器
const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
  console.log(`Server running on port ${PORT}`);
  await initDB();
  
  // 初始化后更新奖池值
  await updateJackpotValues();
  
  // 设置定时任务，每秒更新一次奖池值（实现跳动效果）
  setInterval(updateJackpotValues, 1000);
  
  console.log('Jackpot update timer started (every second)');
});



