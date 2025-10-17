const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

const { ADMIN_USER, ADMIN_PASSWD, aiSummary} = require('../index');

let JWT_SECRET = crypto.randomBytes(64).toString('hex');

const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) {
        return res.status(401).json({
            success: false,
            error: 'Access token required'
        });
    }
    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) {
            return res.status(403).json({
                success: false,
                error: 'Invalid or expired token'
            });
        }
        req.user = user;
        next();
    });
};

router.post('/login', async (req, res) => {
    try {
        const { username, password } = req.body;

        if (!username || !password) {
            return res.status(400).json({
                success: false,
                message: '使用者名稱和密碼不能為空'
            });
        }

        if (username !== ADMIN_USER) {
            return res.status(401).json({
                success: false,
                message: '使用者名稱或密碼錯誤'
            });
        }

        if (!ADMIN_PASSWD || typeof ADMIN_PASSWD !== 'string') {
            console.error('錯誤: 密碼雜湊未正確配置');
            return res.status(500).json({
                success: false,
                message: '伺服器配置錯誤：密碼雜湊未設定'
            });
        }

        if (!ADMIN_PASSWD.startsWith('$2')) {
            console.error('錯誤: 密碼雜湊格式不正確');
            return res.status(500).json({
                success: false,
                message: '伺服器配置錯誤：密碼雜湊格式無效'
            });
        }

        const isPasswordValid = await bcrypt.compare(password, ADMIN_PASSWD);

        if (!isPasswordValid) {
            return res.status(401).json({
                success: false,
                message: '使用者名稱或密碼錯誤'
            });
        }

        const token = jwt.sign(
            {
                userId: 'admin',
                username: ADMIN_USER,
                role: 'admin'
            },
            JWT_SECRET,
            { expiresIn: '7d' }
        );

        res.json({
            success: true,
            token
        });

    } catch (error) {
        console.error('登入錯誤:', error);

        if (error.message.includes('Illegal arguments')) {
            return res.status(500).json({
                success: false,
                message: '伺服器配置錯誤：密碼雜湊無效'
            });
        }

        res.status(500).json({
            success: false,
            message: '伺服器內部錯誤'
        });
    }
});

// 新增：更新管理员账户
router.post('/account/update', authenticateToken, async (req, res) => {
    try {
        const fs = require('fs');
        const path = require('path');
        const envPath = path.join(__dirname, '../.env');

        const { username, password } = req.body;

        if (!username && !password) {
            return res.status(400).json({
                success: false,
                message: '請提供要更新的使用者名稱或密碼'
            });
        }

        // 读取现有的 .env 文件
        let envContent = '';
        if (fs.existsSync(envPath)) {
            envContent = fs.readFileSync(envPath, 'utf8');
        }

        const envLines = envContent.split('\n');
        const envMap = new Map();

        envLines.forEach(line => {
            const trimmedLine = line.trim();
            if (trimmedLine && !trimmedLine.startsWith('#')) {
                const separatorIndex = trimmedLine.indexOf('=');
                if (separatorIndex > 0) {
                    const key = trimmedLine.substring(0, separatorIndex).trim();
                    const value = trimmedLine.substring(separatorIndex + 1).trim();
                    envMap.set(key, value);
                }
            }
        });

        const updatedFields = [];

        // 更新用户名
        if (username && username !== ADMIN_USER) {
            envMap.set('ADMIN_USER', username);
            process.env.ADMIN_USER = username;
            updatedFields.push('使用者名稱');
        }

        // 更新密码（加密后保存）
        if (password) {
            const hashedPassword = await bcrypt.hash(password, 10);
            envMap.set('ADMIN_PASSWD', hashedPassword);
            process.env.ADMIN_PASSWD = hashedPassword;
            updatedFields.push('密碼');
        }

        // 生成新的 .env 内容
        const newEnvContent = Array.from(envMap.entries())
            .map(([key, value]) => `${key}=${value}`)
            .join('\n');

        // 写入 .env 文件
        fs.writeFileSync(envPath, newEnvContent + '\n', 'utf8');

        res.json({
            success: true,
            message: `帳戶資訊已更新（${updatedFields.join('、')})`,
            requireRelogin: true
        });

    } catch (error) {
        console.error('更新帳戶錯誤:', error);
        res.status(500).json({
            success: false,
            message: '更新帳戶失敗',
            details: error.message
        });
    }
});

router.post('/ai/trigger/:deviceId', authenticateToken, async (req, res) => {
    try {
        const deviceId = req.params.deviceId;
        const { date, timezoneOffset } = req.body;
        const result = await aiSummary.triggerSummary(deviceId, {
            date: date || null,
            timezoneOffset: timezoneOffset ? parseInt(timezoneOffset) : null
        });
        res.json(result);
    } catch (error) {
        console.error('Error in /api/ai/trigger/:deviceId:', error);
        res.status(500).json({
            error: 'AI summary generation failed',
            details: error.message
        });
    }
});

router.post('/ai/stop', authenticateToken, (req, res) => {
    try {
        aiSummary.stop();
        res.json({
            success: true,
            message: 'AI summary cron jobs stopped'
        });
    } catch (error) {
        console.error('Error in /api/ai/stop:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to stop AI tasks',
            details: error.message
        });
    }
});

router.post('/ai/start', authenticateToken, (req, res) => {
    try {
        aiSummary.start();
        res.json({
            success: true,
            message: 'AI summary cron jobs started'
        });
    } catch (error) {
        console.error('Error in /api/ai/start:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to start AI tasks',
            details: error.message
        });
    }
});

router.get('/config', authenticateToken, (req, res) => {
    try {
        const config = {
            PORT: process.env.PORT || 3000,
            MONGODB_URI: process.env.MONGODB_URI || 'mongodb://localhost:27017/deviceStats',
            ADMIN_USER: process.env.ADMIN_USER || 'admin',
            AI_API_URL: process.env.AI_API_URL || '未設定',
            AI_MODEL: process.env.AI_MODEL || 'gpt-4',
            AI_MAX_TOKENS: process.env.AI_MAX_TOKENS || 1000,
            PUBLISH_API_URL: process.env.PUBLISH_API_URL || '未設定',
            PUBLISH_API_KEY: process.env.PUBLISH_API_KEY || '未設定',
            DEFAULT_TIMEZONE_OFFSET: process.env.DEFAULT_TIMEZONE_OFFSET || 8,
            AI_SUMMARY_ENABLED: process.env.AI_SUMMARY_ENABLED || 'true',
            JWT_SECRET_MODE: process.env.JWT_SECRET ? 'static' : 'random_on_restart'
        };

        res.json({
            success: true,
            config
        });
    } catch (error) {
        console.error('取得配置錯誤:', error);
        res.status(500).json({
            success: false,
            message: '取得配置失敗',
            details: error.message
        });
    }
});

router.post('/config', authenticateToken, async (req, res) => {
    try {
        const fs = require('fs');
        const path = require('path');
        const envPath = path.join(__dirname, '../.env');

        const updates = req.body;

        if (!updates || Object.keys(updates).length === 0) {
            return res.status(400).json({
                success: false,
                message: '請提供要更新的配置項'
            });
        }

        // 移除敏感配置项
        const allowedKeys = [
            'PORT',
            'MONGODB_URI',
            'JWT_SECRET',
            'SECRET',
            'AI_API_URL',
            'AI_API_KEY',
            'AI_MODEL',
            'AI_MAX_TOKENS',
            'PUBLISH_API_URL',
            'PUBLISH_API_KEY',
            'DEFAULT_TIMEZONE_OFFSET',
            'AI_SUMMARY_ENABLED'
        ];

        const invalidKeys = Object.keys(updates).filter(key => !allowedKeys.includes(key));
        if (invalidKeys.length > 0) {
            return res.status(400).json({
                success: false,
                message: `不允許修改的配置項: ${invalidKeys.join(', ')}，管理員帳戶請使用專用介面修改`
            });
        }

        let envContent = '';
        if (fs.existsSync(envPath)) {
            envContent = fs.readFileSync(envPath, 'utf8');
        }

        const envLines = envContent.split('\n');
        const envMap = new Map();

        envLines.forEach(line => {
            const trimmedLine = line.trim();
            if (trimmedLine && !trimmedLine.startsWith('#')) {
                const separatorIndex = trimmedLine.indexOf('=');
                if (separatorIndex > 0) {
                    const key = trimmedLine.substring(0, separatorIndex).trim();
                    const value = trimmedLine.substring(separatorIndex + 1).trim();
                    envMap.set(key, value);
                }
            }
        });

        const updatedKeys = [];
        for (const [key, value] of Object.entries(updates)) {
            envMap.set(key, value);
            updatedKeys.push(key);
            process.env[key] = value;
        }

        const newEnvContent = Array.from(envMap.entries())
            .map(([key, value]) => `${key}=${value}`)
            .join('\n');

        fs.writeFileSync(envPath, newEnvContent + '\n', 'utf8');

        res.json({
            success: true,
            message: '配置已更新',
            updatedKeys,
            notice: '部分配置需要重啟服務才能生效'
        });

    } catch (error) {
        console.error('修改配置错误:', error);
        res.status(500).json({
            success: false,
            message: '修改配置失敗',
            details: error.message
        });
    }
});

router.post('/restart', authenticateToken, (req, res) => {
    const { exec } = require('child_process');

    console.log('[Security] Service restart requested, all tokens will be invalidated');

    res.json({
        success: true,
        message: '服務重啟指令已發送，將在1秒後執行重啟',
        notice: '重啟後所有使用者需要重新登入',
        restartStatus: 'pending'
    });

    setTimeout(() => {
        console.log('開始執行PM2重啟...');
        exec('pm2 restart runtime_tracker', (error, stdout, stderr) => {
            if (error) {
                console.error('PM2 重啟失敗:', error);
                return;
            }
            console.log('PM2 重啟成功:', stdout);
        });
    }, 1000);
});

module.exports.authenticateToken = authenticateToken;
module.exports = router;