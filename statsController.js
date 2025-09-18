// 定义新的数据模型 - 按天/小时/应用存储
const { mongoose } = require('./index');
const DailyStat = mongoose.model('DailyStat', {
    deviceId: String,
    date: Date,       // 日期部分 (YYYY-MM-DD)
    appName: String,
    hourlyUsage: [Number] // 24小时数组，每项代表分钟数
});

// 设备应用切换记录与电池统计
const recentAppSwitches = new Map(); // {deviceId: [{appName, timestamp}]}
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

    if (batteryStats.get(deviceId).length > 10) {
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
            if (lastSwitch.running !== false) {
                const minutesSinceLastSwitch = calculatePreciseMinutes(lastSwitch.timestamp, now);
                // 更新应用分时段时间统计，传递完整的开始时间戳
                await updateDailyStat(deviceId, lastSwitch.appName, lastSwitch.timestamp, minutesSinceLastSwitch);
            }
            deviceSwitches[0].running = false;
            deviceSwitches.unshift({
                appName: "设备待机",
                timestamp: now,
                running: false
            });
        }
        return;
    }

    // 使用时间计算
    let minutesSinceLastSwitch = 0;
    if (deviceSwitches.length > 0) {
        const lastSwitch = deviceSwitches[0];
        if (lastSwitch.running !== false) {
            minutesSinceLastSwitch = calculatePreciseMinutes(lastSwitch.timestamp, now);
            // 关键修改：传递完整的开始时间戳
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

// 精确计算时间差，返回小数分钟（精确到2位）
function calculatePreciseMinutes(startTime, endTime) {
    const milliseconds = endTime - startTime;
    const minutes = milliseconds / (60 * 1000);
    // 保留2位小数
    return Math.round(minutes * 100) / 100;
}

// 更新每日统计
async function updateDailyStat(deviceId, appName, startTimestamp, durationMinutes) {
    const startDate = new Date(startTimestamp);
    const dayStart = new Date(startDate);
    dayStart.setHours(0, 0, 0, 0);

    // 查找或创建统计记录
    let stat = await DailyStat.findOne({
        deviceId,
        date: dayStart,
        appName
    });

    if (!stat) {
        stat = new DailyStat({
            deviceId,
            date: dayStart,
            appName,
            hourlyUsage: Array(24).fill(0)
        });
    }

    // 传递完整的开始时间戳和持续时间
    await distributePreciseMinutes(stat, startTimestamp, durationMinutes);

    await stat.save();
}
async function distributePreciseMinutes(stat, startTimestamp, totalMinutes) {
    let remainingMinutes = totalMinutes;
    let currentTimestamp = new Date(startTimestamp);

    while (remainingMinutes > 0) {
        const currentDate = new Date(currentTimestamp);
        currentDate.setHours(0, 0, 0, 0);

        const currentHour = currentTimestamp.getHours();
        const currentMinute = currentTimestamp.getMinutes();
        const currentSecond = currentTimestamp.getSeconds();

        // 如果跨日期了，需要获取新的统计记录
        let currentStat = stat;
        if (currentDate.getTime() !== stat.date.getTime()) {
            currentStat = await DailyStat.findOne({
                deviceId: stat.deviceId,
                date: currentDate,
                appName: stat.appName
            });

            if (!currentStat) {
                currentStat = new DailyStat({
                    deviceId: stat.deviceId,
                    date: new Date(currentDate),
                    appName: stat.appName,
                    hourlyUsage: Array(24).fill(0)
                });
            }
        }

        // 计算当前小时内已使用的分钟数（从小时开始到当前分钟）
        const usedInCurrentHour = currentStat.hourlyUsage[currentHour];

        // 计算当前时间点到下一个小时开始还有多少分钟
        const minutesToNextHour = 60 - currentMinute - (currentSecond > 0 ? (currentSecond / 60) : 0);

        // 当前小时的剩余容量
        const availableSpace = Math.max(0, 60 - usedInCurrentHour);

        // 实际能在当前小时分配的时间：取剩余时间、到下一小时的时间、可用空间的最小值
        const minutesToAdd = Math.min(remainingMinutes, minutesToNextHour, availableSpace);

        if (minutesToAdd > 0) {
            const preciseMinutesToAdd = Math.round(minutesToAdd * 100) / 100;
            currentStat.hourlyUsage[currentHour] = Math.round((currentStat.hourlyUsage[currentHour] + preciseMinutesToAdd) * 100) / 100;

            // 如果是跨日期的新统计记录，需要保存
            if (currentStat !== stat) {
                await currentStat.save();
            }

            remainingMinutes = Math.round((remainingMinutes - preciseMinutesToAdd) * 100) / 100;
        }

        // 移动到下一个时间点
        if (minutesToAdd >= minutesToNextHour) {
            // 移动到下一个小时的开始
            currentTimestamp.setHours(currentHour + 1, 0, 0, 0);
        } else {
            // 在当前小时内完成了分配
            break;
        }

        // 避免浮点数精度问题
        if (remainingMinutes < 0.01) {
            remainingMinutes = 0;
        }

        // 防止无限循环（最多处理30天）
        const daysDifference = Math.floor((currentTimestamp - startTimestamp) / (24 * 60 * 60 * 1000));
        if (daysDifference > 30) {
            console.warn(`超过30天限制，剩余 ${remainingMinutes} 分钟无法分配，设备: ${stat.deviceId}, 应用: ${stat.appName}`);
            break;
        }
    }
}


// 获取某天的统计数据
async function getDailyStats(deviceId, date, timezoneOffset = 0) {
    // 用户时区的目标日期
    const userDate = new Date(date);
    userDate.setHours(0, 0, 0, 0);

    // 转换为UTC时间范围
    const utcStartTime = new Date(userDate.getTime() - timezoneOffset * 60 * 60 * 1000);
    const utcEndTime = new Date(utcStartTime.getTime() + 24 * 60 * 60 * 1000);

    // 计算需要查询的UTC日期范围
    const utcStartDate = new Date(utcStartTime);
    utcStartDate.setHours(0, 0, 0, 0);

    const utcEndDate = new Date(utcEndTime);
    utcEndDate.setHours(0, 0, 0, 0);

    // 构建查询条件 - 可能跨越1-2个UTC日期
    const queryDates = [utcStartDate];
    if (utcEndDate.getTime() !== utcStartDate.getTime()) {
        queryDates.push(utcEndDate);
    }

    // 单次查询获取所有相关数据
    const allStats = await DailyStat.find({
        deviceId,
        date: { $in: queryDates }
    });

    // 初始化结果结构
    const result = {
        totalUsage: 0,
        appStats: {},
        hourlyStats: Array(24).fill(0),
        appHourlyStats: {},
        timezoneOffset: timezoneOffset
    };

    // 处理每条统计记录
    allStats.forEach(stat => {
        const appName = stat.appName;
        const statDate = new Date(stat.date);

        // 初始化应用统计
        if (!result.appStats[appName]) {
            result.appStats[appName] = 0;
        }
        if (!result.appHourlyStats[appName]) {
            result.appHourlyStats[appName] = Array(24).fill(0);
        }

        // 处理每小时的数据
        stat.hourlyUsage.forEach((minutes, utcHour) => {
            if (minutes === 0) return;

            // 构建UTC时间戳
            const utcTimestamp = new Date(statDate);
            utcTimestamp.setHours(utcHour, 0, 0, 0);

            // 转换为用户时区时间戳
            const userTimestamp = new Date(utcTimestamp.getTime() + timezoneOffset * 60 * 60 * 1000);

            // 检查是否在用户时区的目标日期范围内
            const userDateOnly = new Date(userTimestamp);
            userDateOnly.setHours(0, 0, 0, 0);

            if (userDateOnly.getTime() === userDate.getTime()) {
                const userHour = userTimestamp.getHours();

                result.hourlyStats[userHour] += minutes;
                result.appHourlyStats[appName][userHour] += minutes;
                result.appStats[appName] += minutes;
                result.totalUsage += minutes;
            }
        });
    });

    return result;
}
module.exports=  {
    recordBattery,
    getDevices,
    recordUsage,
    getDailyStats,
    recentAppSwitches
}
