require('dotenv').config(); // 放在文件最开头
const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const mongoose = require('mongoose');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;
const SECRET = process.env.SECRET || 'default-secret-key';
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/deviceStats';

//运行信息
console.log('后端端口 ', PORT)
console.log('后端密钥 ', SECRET)
console.log('后端MongoDB ', MONGODB_URI)

// 中间件
app.use(cors());
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

// MongoDB连接
mongoose.connect(MONGODB_URI)
    .then(() => console.log('成功连接到 MongoDB'))
    .catch(err => console.error('MongoDB 连接错误:', err))

// 定义新的数据模型 - 按天/小时/应用存储
const DailyStat = mongoose.model('DailyStat', {
    deviceId: String,
    date: Date,       // 日期部分 (YYYY-MM-DD)
    appName: String,
    hourlyUsage: [Number] // 24小时数组，每项代表分钟数
});

// 应用切换记录 - 临时保存在内存中
const recentAppSwitches = new Map(); // {deviceId: [{appName, timestamp}]}

// 电量统计临时存储
const batteryStats = new Map();

function recordBattery(deviceId, level) {
    const now = new Date();
    if (!batteryStats.has(deviceId)) {
        batteryStats.set(deviceId, []);
    }
    batteryStats.get(deviceId).push({
        timestamp: now,
        level: level
    });

    // 保留最近100条记录
    if (batteryStats.get(deviceId).length > 100) {
        batteryStats.get(deviceId).shift();
    }
}
// 获取电量记录
function getBatteryStats(deviceId) {
    return batteryStats.get(deviceId) || [];
}

// 获取设备列表
async function getDevices() {
    return Array.from(recentAppSwitches.keys()).map(deviceId => {
        let currentApp = "Unknown";
        let runningSince = new Date();
        let isRunning = true;
        let batteryLevel = 0;

        // 获取最近电量
        const batteryRecords = getBatteryStats(deviceId);
        if (batteryRecords.length > 0) {
            batteryLevel = batteryRecords[batteryRecords.length - 1].level;
        }

        // 获取应用状态
        if (recentAppSwitches.has(deviceId) && recentAppSwitches.get(deviceId).length > 0) {
            const lastSwitch = recentAppSwitches.get(deviceId)[0];
            currentApp = lastSwitch.appName;
            runningSince = lastSwitch.timestamp;
            isRunning = lastSwitch.running !== false;
        }

        return {
            device: deviceId,
            currentApp,
            running: isRunning,
            runningSince,
            batteryLevel
        };
    });
}



// 记录应用使用时间
async function recordUsage(deviceId, appName, running) {
    const now = new Date();

    if (!recentAppSwitches.has(deviceId)) {
        recentAppSwitches.set(deviceId, []);
    }

    const deviceSwitches = recentAppSwitches.get(deviceId);

    // 处理停止运行的情况
    if (running === false) {
        if (deviceSwitches.length > 0) {
            const lastSwitch = deviceSwitches[0];
            // 计算从上次记录到当前时间的持续时间
            if (lastSwitch.running !== false) {
                const minutesSinceLastSwitch = Math.round((now - lastSwitch.timestamp) / 60000);
                await updateDailyStat(deviceId, lastSwitch.appName, lastSwitch.timestamp, minutesSinceLastSwitch);
            }
            // 更新最后一条记录的状态为停止
            deviceSwitches[0].running = false;
            // 添加停止记录点
            deviceSwitches.unshift({
                appName: "设备待机",
                timestamp: now,
                running: false
            });
        }
        return;
    }

    // 原有计算使用时间的逻辑
    let minutesSinceLastSwitch = 0;
    if (deviceSwitches.length > 0) {
        const lastSwitch = deviceSwitches[0];
        // 如果设备正在运行才计算时间
        if (lastSwitch.running !== false) {
            minutesSinceLastSwitch = Math.round((now - lastSwitch.timestamp) / 60000);
            await updateDailyStat(deviceId, lastSwitch.appName, lastSwitch.timestamp, minutesSinceLastSwitch);
        }
    }

    // 添加新记录
    deviceSwitches.unshift({
        appName: appName,
        timestamp: now,
        running: true
    });

    if (deviceSwitches.length > 20) {
        deviceSwitches.pop();
    }
}


// 更新每日统计
async function updateDailyStat(deviceId, appName, timestamp, durationMinutes) {
    const date = new Date(timestamp);
    date.setHours(0, 0, 0, 0);

    const hour = timestamp.getHours();

    // 查找或创建统计记录
    let stat = await DailyStat.findOne({
        deviceId,
        date,
        appName
    });

    if (!stat) {
        stat = new DailyStat({
            deviceId,
            date,
            appName,
            hourlyUsage: Array(24).fill(0)
        });
    }

    // 增加当前小时的使用时间（基于实际时间间隔）
    stat.hourlyUsage[hour] += durationMinutes;
    await stat.save();
}

// 获取某天的统计数据
async function getDailyStats(deviceId, date, timezoneOffset = 0) {
    const startOfDay = new Date(date);
    startOfDay.setHours(0, 0, 0, 0);
    // 获取当天所有应用的统计
    const stats = await DailyStat.find({
        deviceId,
        date: startOfDay
    });
    // 初始化结果结构
    const result = {
        totalUsage: 0,
        appStats: {},
        hourlyStats: Array(24).fill(0),
        appHourlyStats: {},
        timezoneOffset: timezoneOffset // 添加时区偏移信息到响应
    };
    // 聚合统计数据
    stats.forEach(stat => {
        const appName = stat.appName;
        // 应用总时长
        const appTotal = stat.hourlyUsage.reduce((sum, val) => sum + val, 0);
        result.appStats[appName] = appTotal;
        result.totalUsage += appTotal;
        // 初始化应用小时统计
        if (!result.appHourlyStats[appName]) {
            result.appHourlyStats[appName] = Array(24).fill(0);
        }
        // 聚合小时数据（考虑时区偏移）
        stat.hourlyUsage.forEach((minutes, hour) => {
            // 计算调整后的小时
            const adjustedHour = (hour + timezoneOffset + 24) % 24;
            result.hourlyStats[adjustedHour] += minutes;
            result.appHourlyStats[appName][adjustedHour] += minutes;
        });
    });
    return result;
}

// API端点保持不变
app.post('/api', async (req, res) => {
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
app.get('/api/devices', async (req, res) => {
    try {
        const devices = await getDevices();
        res.json(devices);
    } catch (error) {
        res.status(500).json({ error: 'Database error' });
    }
});


// 获取最近30条应用切换记录
app.get('/api/recent/:deviceId', async (req, res) => {
    try {
        const deviceId = req.params.deviceId;
        let records = [];

        if (recentAppSwitches.has(deviceId)) {
            //获取原始数据
            const switchEntries = recentAppSwitches.get(deviceId);

            //计算记录数限制（取最近的30条）
            const startIndex = Math.max(0, switchEntries.length - 30);
            const limitedEntries = switchEntries.slice(startIndex);

            // 反转以保持原有输出格式
            const reversedEntries = [...limitedEntries].reverse();

            records = reversedEntries.map((entry, index) => {
                const startTime = entry.timestamp;
                let endTime = new Date();
                let duration = 0;

                // 持续时间计算逻辑...
                if (entry.running === false && index < reversedEntries.length - 1) {
                    endTime = reversedEntries[index + 1].timestamp;
                    duration = Math.round((endTime - startTime) / 1000);
                }
                else if (entry.running === false) {
                    endTime = startTime;
                    duration = 0;
                }
                else if (index < reversedEntries.length - 1) {
                    endTime = reversedEntries[index + 1].timestamp;
                    duration = Math.round((endTime - startTime) / 1000);
                }
                else {
                    duration = Math.round((endTime - startTime) / 1000);
                }

                return {
                    appName: entry.appName,
                    startTime: startTime,
                    endTime: endTime,
                    duration: duration,
                    running: entry.running !== false
                };
            });
        }

        res.json(records);
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
});

// 获取当天统计数据
app.get('/api/stats/:deviceId', async (req, res) => {
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

// 获取特定日期统计数据（通过查询参数接收时区偏移）
// app.get('/api/stats/:deviceId/:date', async (req, res) => {
//     try {
//         const timezoneOffset = parseInt(req.query.timezoneOffset) || 0;
//         const dateStr = req.params.date;
//         const date = new Date(dateStr);
//         if (isNaN(date.getTime())) {
//             return res.status(400).json({ error: 'Invalid date format. Please use YYYY-MM-DD format.' });
//         }
//         date.setHours(0, 0, 0, 0);
//         const stats = await getDailyStats(req.params.deviceId, date, timezoneOffset);
//         if (!stats) {
//             return res.status(404).json({ error: 'No records found for this date' });
//         }
//         res.json(stats);
//     } catch (error) {
//         console.error('Error in /api/stats/:deviceId/:date:', error);
//         res.status(500).json({
//             error: 'Database error',
//             details: error.message
//         });
//     }
// });

// IP地址获取
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

// 获取客户端IP地址
app.get('/api/ip', (req, res) => {
    const clientIp = getClientIp(req);
    res.json({ ip: clientIp });
});

// 启动服务器
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
});