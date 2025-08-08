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
const JWT_SECRET = process.env.JWT_SECRET || 'your_strong_jwt_secret_key';

// 奖金配置
const JACKPOT_CONFIG = {
    mini: {
        min: 1.00,
        max: 8.00,
        duration: 2 * 60 * 60 * 1000, // 2小时（毫秒）
        current: 1.00
    },
    minor: {
        min: 8.00,
        max: 20.00,
        duration: 2 * 60 * 60 * 1000,
        current: 8.00
    },
    mega: {
        min: 20.00,
        max: 40.00,
        duration: 2 * 60 * 60 * 1000,
        current: 20.00
    },
    grand: {
        min: 40.00,
        max: 188.00,
        duration: 2 * 60 * 60 * 1000,
        current: 40.00
    }
};

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
                code VARCHAR(50) NOT NULL UNIQUE
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
        
        // 创建奖金表
        await pool.query(`
            CREATE TABLE IF NOT EXISTS jackpot_amounts (
                type VARCHAR(10) PRIMARY KEY,
                current_amount NUMERIC(10,3) NOT NULL,
                last_updated TIMESTAMP NOT NULL
            )
        `);
        
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
        
        // 初始化奖金金额
        const jackpotTypes = Object.keys(JACKPOT_CONFIG);
        for (const type of jackpotTypes) {
            const result = await pool.query(
                'SELECT * FROM jackpot_amounts WHERE type = $1',
                [type]
            );
            
            if (result.rows.length === 0) {
                await pool.query(`
                    INSERT INTO jackpot_amounts (type, current_amount, last_updated)
                    VALUES ($1, $2, NOW())
                `, [type, JACKPOT_CONFIG[type].min]);
                JACKPOT_CONFIG[type].current = JACKPOT_CONFIG[type].min;
                console.log(`Initialized ${type} jackpot amount: $${JACKPOT_CONFIG[type].min}`);
            } else {
                const row = result.rows[0];
                JACKPOT_CONFIG[type].current = parseFloat(row.current_amount);
                console.log(`Loaded ${type} jackpot amount: $${row.current_amount}`);
            }
        }
        
        console.log('Database tables initialized');
    } catch (err) {
        console.error('Error initializing database:', err);
    }
}

// 更新奖金金额
async function updateJackpotAmounts() {
    try {
        const now = new Date();
        
        for (const [type, config] of Object.entries(JACKPOT_CONFIG)) {
            const result = await pool.query(
                'SELECT * FROM jackpot_amounts WHERE type = $1',
                [type]
            );
            
            if (result.rows.length === 0) continue;
            
            const row = result.rows[0];
            const lastUpdated = new Date(row.last_updated);
            const elapsed = now - lastUpdated;
            
            if (elapsed >= config.duration) {
                // 重置奖金金额
                await pool.query(`
                    UPDATE jackpot_amounts
                    SET current_amount = $1, last_updated = NOW()
                    WHERE type = $2
                `, [config.min, type]);
                JACKPOT_CONFIG[type].current = config.min;
                console.log(`Reset ${type} jackpot to $${config.min}`);
            } else {
                // 计算新金额
                const progress = elapsed / config.duration;
                const range = config.max - config.min;
                const newAmount = config.min + (range * progress);
                const roundedAmount = parseFloat(newAmount.toFixed(2));
                
                // 更新数据库
                await pool.query(`
                    UPDATE jackpot_amounts
                    SET current_amount = $1
                    WHERE type = $2
                `, [roundedAmount, type]);
                JACKPOT_CONFIG[type].current = roundedAmount;
            }
        }
    } catch (err) {
        console.error('Error updating jackpot amounts:', err);
    }
}

// 启动奖金更新定时器
function startJackpotUpdater() {
    // 每秒更新一次奖金金额
    setInterval(updateJackpotAmounts, 1000);
    console.log('Jackpot amount updater started');
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

// 获取当前奖金金额
app.get('/api/jackpot-amounts', (req, res) => {
    const amounts = {};
    for (const [type, config] of Object.entries(JACKPOT_CONFIG)) {
        amounts[type] = config.current;
    }
    res.json(amounts);
});

// 启动服务器
const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
    console.log(`Server running on port ${PORT}`);
    await initDB();
    startJackpotUpdater();
    console.log('JWT Secret:', JWT_SECRET === 'your_strong_jwt_secret_key' ? 
        'Using default JWT secret. For production, set JWT_SECRET environment variable.' : 
        'Using custom JWT secret from environment.');
});

