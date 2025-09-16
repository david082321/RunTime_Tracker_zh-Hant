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
            // 计算从上次记录到当前时间的持续时间
            if (lastSwitch.running !== false) {
                const minutesSinceLastSwitch = calculatePreciseMinutes(lastSwitch.timestamp, now);
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

    // 使用时间计算
    let minutesSinceLastSwitch = 0;
    if (deviceSwitches.length > 0) {
        const lastSwitch = deviceSwitches[0];
        // 如果设备正在运行才计算时间
        if (lastSwitch.running !== false) {
            minutesSinceLastSwitch = calculatePreciseMinutes(lastSwitch.timestamp, now);
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

    // 处理持续时间分配（支持跨日期）
    await distributePreciseMinutes(stat, hour, durationMinutes);

    // 保存当前统计记录
    await stat.save();
}
async function distributePreciseMinutes(stat, startHour, totalMinutes) {
    let remainingMinutes = totalMinutes;
    let currentHour = startHour;
    let currentStat = stat; // 当前统计记录
    let currentDate = new Date(stat.date); // 当前日期

    while (remainingMinutes > 0) {
        // 如果当前小时超出23点，需要创建或获取下一天的统计记录
        if (currentHour >= 24) {
            // 移动到下一天
            currentDate.setDate(currentDate.getDate() + 1);
            currentDate.setHours(0, 0, 0, 0);
            currentHour = 0;

            // 查找或创建下一天的统计记录
            let nextDayStat = await DailyStat.findOne({
                deviceId: stat.deviceId,
                date: currentDate,
                appName: stat.appName
            });

            if (!nextDayStat) {
                nextDayStat = new DailyStat({
                    deviceId: stat.deviceId,
                    date: new Date(currentDate),
                    appName: stat.appName,
                    hourlyUsage: Array(24).fill(0)
                });
            }

            currentStat = nextDayStat;
        }

        // 计算当前小时的可用空间
        const usedInCurrentHour = currentStat.hourlyUsage[currentHour];
        const availableSpace = 60 - usedInCurrentHour;

        if (availableSpace <= 0) {
            // 当前小时已满，跳到下一小时
            currentHour++;
            continue;
        }

        // 计算要添加到当前小时的分钟数
        const minutesToAdd = Math.min(remainingMinutes, availableSpace);
        const preciseMinutesToAdd = Math.round(minutesToAdd * 100) / 100;

        // 更新统计数据
        currentStat.hourlyUsage[currentHour] = Math.round((currentStat.hourlyUsage[currentHour] + preciseMinutesToAdd) * 100) / 100;

        // 如果这是新创建的下一天记录，需要保存
        if (currentStat !== stat) {
            await currentStat.save();
        }

        // 更新剩余时间
        remainingMinutes = Math.round((remainingMinutes - preciseMinutesToAdd) * 100) / 100;

        // 避免浮点数精度问题
        if (remainingMinutes < 0.01) {
            remainingMinutes = 0;
        }

        currentHour++;

        // 防止无限循环（最多处理7天）
        const daysDifference = Math.floor((currentDate - stat.date) / (24 * 60 * 60 * 1000));
        if (daysDifference > 7) {
            console.warn(`超过7天限制，剩余 ${remainingMinutes} 分钟无法分配，设备: ${stat.deviceId}, 应用: ${stat.appName}`);
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
