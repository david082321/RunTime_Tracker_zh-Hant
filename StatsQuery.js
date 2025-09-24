// StatsQuery.js - 查询模块
const { mongoose } = require('./index');

// 引用数据模型
const DailyStat = mongoose.model('DailyStat');

class StatsQuery {
    constructor(recorder) {
        // 引用StatsRecorder实例以访问内存数据
        this.recorder = recorder;
    }

    // 获取设备列表
    async getDevices() {
        return Array.from(this.recorder.recentAppSwitches.keys()).map(deviceId => {
            let currentApp = "Unknown";
            let runningSince = new Date();
            let isRunning = true;
            let batteryLevel = 0;

            // 获取最近电量
            const batteryRecords = this.recorder.getBatteryStats(deviceId);
            if (batteryRecords.length > 0) {
                batteryLevel = batteryRecords[batteryRecords.length - 1].level;
            }

            // 获取应用状态
            if (this.recorder.recentAppSwitches.has(deviceId) && this.recorder.recentAppSwitches.get(deviceId).length > 0) {
                const lastSwitch = this.recorder.recentAppSwitches.get(deviceId)[0];
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

    // 获取某天的统计数据
    async getDailyStats(deviceId, date, timezoneOffset = 0) {
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

                    // 只在数据符合目标日期时才初始化应用统计
                    if (!result.appStats[appName]) {
                        result.appStats[appName] = 0;
                        result.appHourlyStats[appName] = Array(24).fill(0);
                    }

                    result.hourlyStats[userHour] += minutes;
                    result.appHourlyStats[appName][userHour] += minutes;
                    result.appStats[appName] += minutes;
                    result.totalUsage += minutes;
                }
            });
        });

        return result;
    }
}

module.exports = StatsQuery;