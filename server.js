const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const path = require('path');
const { Pool } = require('pg');

const app = express();
app.use(cors());
app.use(bodyParser.json());

// 静态文件服务
app.use(express.static(path.join(__dirname, 'public')));

// 添加路由处理
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'game.html'));
});

app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// PostgreSQL 连接配置
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// 初始化数据库表
async function initDB() {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS codes (
                id SERIAL PRIMARY KEY,
                type VARCHAR(10) NOT NULL,
                code VARCHAR(50) NOT NULL UNIQUE
            )
        `);
        
        await pool.query(`
            CREATE TABLE IF NOT EXISTS used_codes (
                id SERIAL PRIMARY KEY,
                code VARCHAR(50) NOT NULL UNIQUE
            )
        `);
        console.log('Database tables initialized');
    } catch (err) {
        console.error('Error initializing database:', err);
    }
}

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

app.post('/api/codes/add', async (req, res) => {
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

app.post('/api/codes/clear', async (req, res) => {
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
        // 检查是否已使用
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

// 启动服务器
const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
    console.log(`Server running on port ${PORT}`);
    await initDB();
});
