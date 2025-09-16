const express = require('express');
const router = express.Router();
const { SECRET} = require('./index');

// 导入必要的函数
const {
    recordBattery,
    getDevices,
    recordUsage,
    getDailyStats,
    recentAppSwitches
} = require('./statsController'); // 状态控制文件

// 应用上报API
router.post('/', async (req, res) => {
    const { secret, device, app_name, running, batteryLevel } = req.body;
    if (secret !== SECRET) {
        return res.status(401).json({ error: 'Invalid secret' });
    }
    if (!device) {
        return res.status(400).json({ error: 'Missing device' });
    }
    if (running !== false && !app_name) {
        return res.status(400).json({ error: 'Missing app_name when running is true' });
    }
    if (batteryLevel !== undefined && batteryLevel > 0 && batteryLevel < 101) {
        recordBattery(device, batteryLevel);
    }
    try {
        await recordUsage(device, app_name, running, batteryLevel);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: 'Database error' });
    }
});

// 获取设备列表
router.get('/devices', async (req, res) => {
    try {
        const devices = await getDevices();
        res.json(devices);
    } catch (error) {
        res.status(500).json({ error: 'Database error' });
    }
});

// 获取所有设备的全部切换记录（测试用）
router.get('/recentall', (req, res) => {
    try {
        // 将Map转换为数组形式
        const allRecords = {};
        recentAppSwitches.forEach((switches, deviceId) => {
            allRecords[deviceId] = switches.map(entry => ({
                appName: entry.appName,
                timestamp: entry.timestamp,
                running: entry.running !== false
            }));
        });
        res.json({
            success: true,
            data: allRecords,
            count: recentAppSwitches.size
        });
    } catch (error) {
        res.status(500).json({
            error: 'Server error',
            details: error.message
        });
    }
});

// 获取特定设备应用切换记录
router.get('/recent/:deviceId', async (req, res) => {
    try {
        const deviceId = req.params.deviceId;
        let records = [];
        if (recentAppSwitches.has(deviceId)) {
            const switchEntries = recentAppSwitches.get(deviceId)
            // 转换为所需格式
            records = switchEntries.map(entry => ({
                appName: entry.appName,
                timestamp: entry.timestamp,
                running: entry.running !== false
            }));
        }
        res.json({
            success: true,
            data: records,
            count: records.length
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: 'Server error',
            details: error.message
        });
    }
});

// 获取当天统计数据
router.get('/stats/:deviceId', async (req, res) => {
    try {
        // 获取时区偏移，默认为0 (UTC)
        const timezoneOffset = parseInt(req.query.timezoneOffset) || 0;
        if ( timezoneOffset < -720 || timezoneOffset > 720) {
            return res.status(400).json({
                error: 'Invalid timezoneOffset. Must be between -720 and +720 (UTC-12 to UTC+12).',
            });
        }
        // 获取日期参数，如果没有则默认为当天
        let date;
        if (req.query.date) {
            date = new Date(req.query.date);
            if (isNaN(date.getTime())) {
                return res.status(400).json({
                    error: 'Invalid date format. Please use YYYY-MM-DD format.'
                });
            }
        }
        else {
            date = new Date();
        }
        date.setHours(0, 0, 0, 0);
        const stats = await getDailyStats(req.params.deviceId, date, timezoneOffset);
        if (!stats) {
            return res.status(404).json({
                error: 'No records found for this date'
            });
        }
        res.json(stats);
    } catch (error) {
        console.error('Error in /api/stats/:deviceId:', error);
        res.status(500).json({
            error: 'Database error',
            details: error.message
        });
    }
});

// 获取客户端IP地址
router.get('/ip', (req, res) => {
    const clientIp = getClientIp(req);
    res.json({ ip: clientIp });
});

function getClientIp(req) {
    // 优先从X-Forwarded-For获取(适用于反向代理场景)
    const forwarded = req.headers['x-forwarded-for'];
    if (forwarded) {
        return typeof forwarded === 'string'
            ? forwarded.split(',')[0].trim()
            : forwarded[0].trim();
    }
    // 如果没有代理，直接使用connection的remoteAddress
    return req.connection?.remoteAddress || req.socket?.remoteAddress || req.ip;
}

module.exports = router;