const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const path = require('path');
const { MongoClient } = require('mongodb');

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

// MongoDB 配置
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb+srv://w33club:<w33club9660>@cluster0.zep8erb.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0';
const DB_NAME = 'jackpot';
const COLLECTION_NAME = 'codes';

// 连接到 MongoDB
let db;
async function connectDB() {
    const client = new MongoClient(MONGODB_URI, {
        useNewUrlParser: true,
        useUnifiedTopology: true
    });
    
    try {
        await client.connect();
        db = client.db(DB_NAME);
        console.log('Connected to MongoDB');
        
        // 初始化数据库结构
        await initDB();
    } catch (err) {
        console.error('MongoDB connection error:', err);
        process.exit(1);
    }
}

async function initDB() {
    // 确保集合存在
    const collections = await db.listCollections().toArray();
    const collectionExists = collections.some(c => c.name === COLLECTION_NAME);
    
    if (!collectionExists) {
        await db.createCollection(COLLECTION_NAME);
        console.log('Created collection:', COLLECTION_NAME);
        
        // 插入初始数据
        await db.collection(COLLECTION_NAME).insertOne({
            codeDB: {
                mini: [],
                minor: [],
                mega: [],
                grand: []
            },
            usedCodes: []
        });
    }
}

// API Endpoints
app.get('/api/codes', async (req, res) => {
    try {
        const data = await db.collection(COLLECTION_NAME).findOne({});
        res.json(data.codeDB);
    } catch (err) {
        console.error('Error fetching codes:', err);
        res.status(500).json({ error: 'Database error' });
    }
});

app.post('/api/codes/add', async (req, res) => {
    const { type, code } = req.body;
    const codeUpper = code.toUpperCase();
    
    try {
        const data = await db.collection(COLLECTION_NAME).findOne({});
        
        if (!data.codeDB[type]) {
            return res.status(400).json({ error: 'Invalid jackpot type' });
        }
        
        // 检查所有类型中是否已存在该代码
        const allCodes = Object.values(data.codeDB).flat();
        if (allCodes.includes(codeUpper)) {
            return res.status(400).json({ error: 'Code already exists' });
        }
        
        // 更新数据库
        const updateResult = await db.collection(COLLECTION_NAME).updateOne(
            {},
            { $push: { [`codeDB.${type}`]: codeUpper } }
        );
        
        if (updateResult.modifiedCount === 1) {
            res.json({ success: true });
        } else {
            res.status(500).json({ error: 'Failed to add code' });
        }
    } catch (err) {
        console.error('Error adding code:', err);
        res.status(500).json({ error: 'Database error' });
    }
});

app.post('/api/codes/clear', async (req, res) => {
    try {
        const updateResult = await db.collection(COLLECTION_NAME).updateOne(
            {},
            { 
                $set: {
                    'codeDB.mini': [],
                    'codeDB.minor': [],
                    'codeDB.mega': [],
                    'codeDB.grand': [],
                    'usedCodes': []
                }
            }
        );
        
        if (updateResult.modifiedCount === 1) {
            res.json({ success: true });
        } else {
            res.status(500).json({ error: 'Failed to clear codes' });
        }
    } catch (err) {
        console.error('Error clearing codes:', err);
        res.status(500).json({ error: 'Database error' });
    }
});

app.post('/api/codes/use', async (req, res) => {
    const { code } = req.body;
    const codeUpper = code.toUpperCase();
    
    try {
        const data = await db.collection(COLLECTION_NAME).findOne({});
        
        if (data.usedCodes.includes(codeUpper)) {
            return res.status(400).json({ error: 'Code already used' });
        }
        
        // 更新数据库
        const updateResult = await db.collection(COLLECTION_NAME).updateOne(
            {},
            { $push: { usedCodes: codeUpper } }
        );
        
        if (updateResult.modifiedCount === 1) {
            res.json({ success: true });
        } else {
            res.status(500).json({ error: 'Failed to mark code as used' });
        }
    } catch (err) {
        console.error('Error using code:', err);
        res.status(500).json({ error: 'Database error' });
    }
});

app.post('/api/codes/validate', async (req, res) => {
    const { code } = req.body;
    const codeUpper = code.toUpperCase();
    
    try {
        const data = await db.collection(COLLECTION_NAME).findOne({});
        
        // 检查代码是否已使用
        if (data.usedCodes.includes(codeUpper)) {
            return res.json({ valid: false, reason: 'Code already used' });
        }
        
        // 检查代码属于哪个类型
        for (const type in data.codeDB) {
            if (data.codeDB[type].includes(codeUpper)) {
                return res.json({ valid: true, type });
            }
        }
        
        res.json({ valid: false, reason: 'Code not found' });
    } catch (err) {
        console.error('Error validating code:', err);
        res.status(500).json({ error: 'Database error' });
    }
});

// 启动服务器前连接数据库
connectDB().then(() => {
    // Start server
    const PORT = process.env.PORT || 3000;
    app.listen(PORT, () => {
        console.log(`Server running on port ${PORT}`);
        console.log('Initial codes loaded from MongoDB');
    });
});
