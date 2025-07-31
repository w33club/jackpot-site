const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

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

// 持久化存储文件
const DATA_FILE = path.join(__dirname, 'codes.json');

// 初始化数据库
let db = {
    codeDB: {
        mini: [],
        minor: [],
        mega: [],
        grand: []
    },
    usedCodes: []
};

// 从文件加载数据
try {
    const data = fs.readFileSync(DATA_FILE, 'utf8');
    db = JSON.parse(data);
    console.log('Loaded data from file');
} catch (err) {
    console.log('No data file, using default');
    saveData(); // 创建初始文件
}

function saveData() {
    fs.writeFileSync(DATA_FILE, JSON.stringify(db), 'utf8');
    console.log('Data saved to file');
}

// API Endpoints
app.get('/api/codes', (req, res) => {
    res.json(db.codeDB);
});

app.post('/api/codes/add', (req, res) => {
    const { type, code } = req.body;
    const codeUpper = code.toUpperCase();
    
    if (!db.codeDB[type]) {
        return res.status(400).json({ error: 'Invalid jackpot type' });
    }
    
    // 检查所有类型中是否已存在该代码
    const allCodes = Object.values(db.codeDB).flat();
    if (allCodes.includes(codeUpper)) {
        return res.status(400).json({ error: 'Code already exists' });
    }
    
    db.codeDB[type].push(codeUpper);
    saveData(); // 保存到文件
    res.json({ success: true });
});

app.post('/api/codes/clear', (req, res) => {
    db.codeDB = {
        mini: [],
        minor: [],
        mega: [],
        grand: []
    };
    db.usedCodes = [];
    saveData(); // 保存到文件
    res.json({ success: true });
});

app.post('/api/codes/use', (req, res) => {
    const { code } = req.body;
    const codeUpper = code.toUpperCase();
    
    if (db.usedCodes.includes(codeUpper)) {
        return res.status(400).json({ error: 'Code already used' });
    }
    
    db.usedCodes.push(codeUpper);
    saveData(); // 保存到文件
    res.json({ success: true });
});

app.post('/api/codes/validate', (req, res) => {
    const { code } = req.body;
    const codeUpper = code.toUpperCase();
    
    // 检查代码是否已使用
    if (db.usedCodes.includes(codeUpper)) {
        return res.json({ valid: false, reason: 'Code already used' });
    }
    
    // 检查代码属于哪个类型
    for (const type in db.codeDB) {
        if (db.codeDB[type].includes(codeUpper)) {
            return res.json({ valid: true, type });
        }
    }
    
    res.json({ valid: false, reason: 'Code not found' });
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log('Initial codes:');
    console.log('Mini:', db.codeDB.mini.join(', '));
    console.log('Minor:', db.codeDB.minor.join(', '));
    console.log('Mega:', db.codeDB.mega.join(', '));
    console.log('Grand:', db.codeDB.grand.join(', '));
});
