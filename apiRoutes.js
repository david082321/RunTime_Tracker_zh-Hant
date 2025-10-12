const express = require('express');
const router = express.Router();
const { SECRET, statsRecorder, statsQuery, aiSummary } = require('./index');

// 应用上报API
router.post('/', async (req, res) => {
    const { secret, device, app_name, running, batteryLevel, isCharging } = req.body;

    if (secret !== SECRET) {
        return res.status(401).json({ error: 'Invalid secret' });
    }

    if (!device) {
        return res.status(400).json({ error: 'Missing device' });
    }

    try {
        // 1. 处理电池信息
        if (batteryLevel !== undefined && batteryLevel > 0 && batteryLevel <= 100) {
            const chargingStatus = isCharging === true;
            statsRecorder.recordBattery(device, batteryLevel, chargingStatus);
        }

        // 2. 处理应用信息
        if (app_name !== undefined || running !== undefined) {
            // 校验应用信息的完整性
            if (running !== false && !app_name) {
                return res.status(400).json({
                    error: 'Missing app_name when running is true'
                });
            }

            await statsRecorder.recordUsage(device, app_name, running);
        }

        // 返回成功响应
        res.json({
            success: true,
            batteryInfo: statsRecorder.getLatestBatteryInfo(device),
            timestamp: new Date()
        });
    } catch (error) {
        console.error('Record error:', error);
        res.status(500).json({
            error: 'Database error',
            details: error.message
        });
    }
});

// 获取设备列表
router.get('/devices', async (req, res) => {
    try {
        const devices = await statsQuery.getDevices();
        res.json(devices);
    } catch (error) {
        console.error('Get devices error:', error);
        res.status(500).json({ error: 'Database error' });
    }
});

// 获取所有设备的全部切换记录(测试用)
router.get('/recentall', (req, res) => {
    try {
        // 将Map转换为数组形式
        const allRecords = {};
        statsRecorder.recentAppSwitches.forEach((switches, deviceId) => {
            allRecords[deviceId] = switches.map(entry => ({
                appName: entry.appName,
                timestamp: entry.timestamp,
                running: entry.running !== false
            }));
        });
        res.json({
            success: true,
            data: allRecords,
            count: statsRecorder.recentAppSwitches.size
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
        if (statsRecorder.recentAppSwitches.has(deviceId)) {
            const switchEntries = statsRecorder.recentAppSwitches.get(deviceId)
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
        // 获取时区偏移,默认为0 (UTC)
        const timezoneOffset = parseInt(req.query.timezoneOffset) || 0;
        if (timezoneOffset < -12 || timezoneOffset > 12) {
            return res.status(400).json({
                error: 'Invalid timezoneOffset. Must be between -12 and +12 (UTC-12 to UTC+12).',
            });
        }
        // 获取日期参数,如果没有则默认为当天
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
        const stats = await statsQuery.getDailyStats(req.params.deviceId, date, timezoneOffset);
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

// 获取周统计数据 (7天内某个应用的每日使用时间)
router.get('/weekly/:deviceId', async (req, res) => {
    try {
        // 获取时区偏移,默认为0 (UTC)
        const timezoneOffset = parseInt(req.query.timezoneOffset) || 0;
        if (timezoneOffset < -12 || timezoneOffset > 12) {
            return res.status(400).json({
                error: 'Invalid timezoneOffset. Must be between -12 and +12 (UTC-12 to UTC+12).',
            });
        }

        // 获取周偏移参数: 0=本周, -1=上周, -2=上上周, 1=下周 (一般不用)
        const weekOffset = parseInt(req.query.weekOffset) || 0;

        // 获取应用名称 (可选)
        const appName = req.query.appName || null;

        const stats = await statsQuery.getWeeklyAppStats(
            req.params.deviceId,
            appName,
            weekOffset,
            timezoneOffset
        );

        res.json(stats);
    } catch (error) {
        console.error('Error in /api/weekly/:deviceId:', error);
        res.status(500).json({
            error: 'Database error',
            details: error.message
        });
    }
});

// 获取月统计数据 (整月内某个应用的每日使用时间)
router.get('/monthly/:deviceId', async (req, res) => {
    try {
        // 获取时区偏移,默认为0 (UTC)
        const timezoneOffset = parseInt(req.query.timezoneOffset) || 0;
        if (timezoneOffset < -12 || timezoneOffset > 12) {
            return res.status(400).json({
                error: 'Invalid timezoneOffset. Must be between -12 and +12 (UTC-12 to UTC+12).',
            });
        }

        // 获取月偏移参数: 0=本月, -1=上月, -2=上上月, 1=下月 (一般不用)
        const monthOffset = parseInt(req.query.monthOffset) || 0;

        // 获取应用名称 (可选)
        const appName = req.query.appName || null;

        const stats = await statsQuery.getMonthlyAppStats(
            req.params.deviceId,
            appName,
            monthOffset,
            timezoneOffset
        );

        res.json(stats);
    } catch (error) {
        console.error('Error in /api/monthly/:deviceId:', error);
        res.status(500).json({
            error: 'Database error',
            details: error.message
        });
    }
});

// ==================== AI总结相关API ====================

// 获取最近一次AI总结（无需验证，只读操作）
router.get('/ai/summary/:deviceId', (req, res) => {
    try {
        const deviceId = req.params.deviceId;
        const summary = aiSummary.getRecentSummary(deviceId);

        if (!summary) {
            return res.status(404).json({
                success: false,
                error: 'No recent summary found for this device',
                message: '該裝置暫無AI總結記錄'
            });
        }

        res.json({
            success: true,
            deviceId,
            ...summary
        });
    } catch (error) {
        console.error('Error in /api/ai/summary/:deviceId:', error);
        res.status(500).json({
            error: 'Failed to retrieve summary',
            details: error.message
        });
    }
});

// 获取所有设备的最近总结（无需验证，只读操作）
router.get('/ai/summaries', (req, res) => {
    try {
        const summaries = aiSummary.getAllRecentSummaries();

        res.json({
            success: true,
            count: Object.keys(summaries).length,
            summaries
        });
    } catch (error) {
        console.error('Error in /api/ai/summaries:', error);
        res.status(500).json({
            error: 'Failed to retrieve summaries',
            details: error.message
        });
    }
});

// 手动触发AI总结生成 (GET方式，需要secret验证)
router.get('/ai/trigger/:deviceId', async (req, res) => {
    try {
        // 验证secret
        const { secret, date, timezoneOffset } = req.query;

        if (!secret || secret !== SECRET) {
            return res.status(401).json({
                success: false,
                error: 'Invalid or missing secret'
            });
        }

        const deviceId = req.params.deviceId;

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

// 获取AI总结状态（无需验证，只读操作）
router.get('/ai/status', (req, res) => {
    res.json({
        enabled: aiSummary.enabled,
        aiConfigured: !!aiSummary.aiConfig.apiKey,
        publishConfigured: !!aiSummary.publishConfig.apiUrl,
        cronJobsCount: aiSummary.cronJobs.length,
        schedules: ['0:00', '8:00', '16:00'],
        model: aiSummary.aiConfig.model,
        defaultTimezone: `UTC${aiSummary.defaultTimezoneOffset >= 0 ? '+' : ''}${aiSummary.defaultTimezoneOffset}`
    });
});

// 停止AI定时任务（需要secret验证）
router.post('/ai/stop', (req, res) => {
    try {
        // 验证secret (从query或body中获取)
        const secret = req.query.secret || req.body.secret;

        if (!secret || secret !== SECRET) {
            return res.status(401).json({
                success: false,
                error: 'Invalid or missing secret'
            });
        }

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

// 启动AI定时任务（需要secret验证）
router.post('/ai/start', (req, res) => {
    try {
        // 验证secret (从query或body中获取)
        const secret = req.query.secret || req.body.secret;

        if (!secret || secret !== SECRET) {
            return res.status(401).json({
                success: false,
                error: 'Invalid or missing secret'
            });
        }

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

// 预留：周总结API
router.post('/ai/weekly/:deviceId', async (req, res) => {
    res.status(501).json({
        error: 'Weekly summary not implemented yet',
        message: '周總結功能將在後續版本中實現'
    });
});

// 预留：月总结API
router.post('/ai/monthly/:deviceId', async (req, res) => {
    res.status(501).json({
        error: 'Monthly summary not implemented yet',
        message: '月總結功能將在後續版本中實現'
    });
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
    // 如果没有代理,直接使用connection的remoteAddress
    return req.connection?.remoteAddress || req.socket?.remoteAddress || req.ip;
}

module.exports = router;