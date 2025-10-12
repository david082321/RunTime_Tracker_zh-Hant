// AISummary.js - AI总结模块
const cron = require('node-cron');

class AISummary {
    constructor(statsRecorder, statsQuery, config = {}) {
        this.recorder = statsRecorder;
        this.query = statsQuery;

        // AI配置
        this.aiConfig = {
            apiUrl: config.aiApiUrl || process.env.AI_API_URL || 'https://api.openai.com/v1/chat/completions',
            apiKey: config.aiApiKey || process.env.AI_API_KEY || '',
            model: config.aiModel || process.env.AI_MODEL || 'gpt-4',
            maxTokens: config.aiMaxTokens || 1000,
        };

        // 发布配置
        this.publishConfig = {
            apiUrl: config.publishApiUrl || process.env.PUBLISH_API_URL || '',
            apiKey: config.publishApiKey || process.env.PUBLISH_API_KEY || '',
        };

        // 默认时区偏移 (东八区 = +8)
        this.defaultTimezoneOffset = config.defaultTimezoneOffset || 8;

        // 定时任务实例
        this.cronJobs = [];

        // 是否启用定时任务
        this.enabled = config.enabled !== false;

        // 存储最近的总结结果（内存缓存）
        // 格式: Map<deviceId, { summary, date, timestamp, stats, trigger }>
        this.recentSummaries = new Map();
    }

    // 启动定时任务
    start() {
        if (!this.enabled) {
            console.log('[AISummary] 定时任务未启用');
            return;
        }

        if (!this.aiConfig.apiKey) {
            console.error('[AISummary] AI API Key未配置，无法启动');
            return;
        }

        // 计算用户时区对应的UTC时间
        // 每4小时执行一次: 0点, 4点, 8点, 12点, 16点, 20点
        const offset = this.defaultTimezoneOffset;

        // 将用户时区的0, 4, 8, 12, 16, 20点转换为UTC时间
        const schedules = [
            { userHour: 0, utcHour: (24 + 0 - offset) % 24 },
            { userHour: 4, utcHour: (24 + 4 - offset) % 24 },
            { userHour: 8, utcHour: (24 + 8 - offset) % 24 },
            { userHour: 12, utcHour: (24 + 12 - offset) % 24 },
            { userHour: 16, utcHour: (24 + 16 - offset) % 24 },
            { userHour: 20, utcHour: (24 + 20 - offset) % 24 },
        ];

        schedules.forEach(({ userHour, utcHour }) => {
            const cronTime = `0 ${utcHour} * * *`;
            const triggerType = `cron-${userHour}`;
            const job = cron.schedule(cronTime, async () => {
                console.log(`[AISummary] 定时任务触发 (用户时区${userHour}点 = UTC ${utcHour}点)`);
                await this.runDailySummaryForAllDevices(triggerType);
            });

            this.cronJobs.push(job);
        });

        console.log(`[AISummary] 定时任务已启动 (每4小时执行一次)`);
        console.log(`[AISummary] 用户时区: UTC${offset >= 0 ? '+' : ''}${offset}`);
        console.log(`[AISummary] 执行时间: 用户时区 0、4、8、12、16、20点`);
        console.log(`[AISummary] UTC时间: ${schedules.map(s => s.utcHour + ':00').join('、')}`);
    }

    // 停止定时任务
    stop() {
        this.cronJobs.forEach(job => job.stop());
        this.cronJobs = [];
        console.log('[AISummary] 定时任务已停止');
    }

    // 为所有设备运行每日总结
    async runDailySummaryForAllDevices(trigger = 'cron') {
        try {
            const devices = await this.query.getDevices();
            console.log(`[AISummary] 开始为 ${devices.length} 个设备生成总结`);

            for (const device of devices) {
                try {
                    await this.generateDailySummary(device.device, null, null, trigger);
                } catch (error) {
                    console.error(`[AISummary] 设备 ${device.device} 总结失败:`, error.message);
                }
            }

            console.log('[AISummary] 所有设备总结完成');
        } catch (error) {
            console.error('[AISummary] 运行总结任务失败:', error);
        }
    }

    // 生成每日总结 (对外接口)
    async generateDailySummary(deviceId, date = null, timezoneOffset = null, trigger = 'manual') {
        const tz = timezoneOffset !== null ? timezoneOffset : this.defaultTimezoneOffset;

        // 如果没有指定日期，使用当天的数据（考虑时区）
        let targetDate;
        if (date) {
            targetDate = new Date(date);
        } else {
            // 获取用户时区的当前时间
            const now = new Date();
            const userNow = new Date(now.getTime() + tz * 60 * 60 * 1000);
            targetDate = new Date(userNow);
        }
        // 归零到当天0点
        targetDate.setHours(0, 0, 0, 0);

        console.log(`[AISummary] 开始为设备 ${deviceId} 生成 ${targetDate.toISOString().split('T')[0]} 的总结 (触发方式: ${trigger})`);

        // 1. 获取统计数据
        const statsData = await this.collectDailyData(deviceId, targetDate, tz);

        if (statsData.totalUsage === 0) {
            console.log(`[AISummary] 设备 ${deviceId} 在 ${targetDate.toISOString().split('T')[0]} 无使用数据`);
            return {
                success: false,
                message: 'No usage data for this day'
            };
        }

        // 2. 调用AI生成总结
        const aiSummary = await this.callAI(statsData, deviceId);

        // 3. 发布总结
        const publishResult = await this.publishSummary(deviceId, targetDate, aiSummary, statsData);

        // 4. 保存到内存缓存
        const summaryRecord = {
            summary: aiSummary,
            date: targetDate.toISOString().split('T')[0],
            timestamp: new Date().toISOString(),
            trigger: trigger, // 'manual', 'cron-0', 'cron-4', 'cron-8', 'cron-12', 'cron-16', 'cron-20'
            publishResult
        };

        this.recentSummaries.set(deviceId, summaryRecord);

        console.log(`[AISummary] 设备 ${deviceId} 总结完成并已保存`);

        return {
            success: true,
            deviceId,
            ...summaryRecord
        };
    }

    // 收集每日数据
    async collectDailyData(deviceId, date, timezoneOffset) {
        // 获取当天统计
        const dailyStats = await this.query.getDailyStats(deviceId, date, timezoneOffset);

        // 获取最近200条切换记录
        let recentSwitches = [];
        if (this.recorder.recentAppSwitches.has(deviceId)) {
            const switches = this.recorder.recentAppSwitches.get(deviceId);
            recentSwitches = switches
                .filter(entry => {
                    const entryDate = new Date(entry.timestamp);
                    const entryDateOnly = new Date(entryDate);
                    entryDateOnly.setHours(0, 0, 0, 0);
                    return entryDateOnly.getTime() === date.getTime();
                })
                .slice(0, 200)
                .map(entry => {
                    // 将UTC时间转换为用户本地时间
                    const userTime = new Date(entry.timestamp);
                    userTime.setMinutes(userTime.getMinutes() + timezoneOffset * 60);

                    return {
                        appName: entry.appName,
                        timestamp: userTime.toISOString(), // 保持ISO格式
                        localTime: userTime.toLocaleTimeString('zh-CN', { hour12: false }), // 添加本地时间字符串
                        running: entry.running !== false
                    };
                });
        }

        return {
            deviceId,
            date: date.toISOString().split('T')[0],
            totalUsage: dailyStats.totalUsage,
            appStats: dailyStats.appStats,
            hourlyStats: dailyStats.hourlyStats,
            recentSwitches,
            timezoneOffset
        };
    }


    // 调用AI API
    async callAI(statsData, deviceId) {
        const prompt = this.buildPrompt(statsData, deviceId);

        try {
            const response = await fetch(this.aiConfig.apiUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.aiConfig.apiKey}`
                },
                body: JSON.stringify({
                    model: this.aiConfig.model,
                    messages: [
                        {
                            role: 'system',
                            content: '你是一个以杂鱼风格的分析师'
                        },
                        {
                            role: 'user',
                            content: prompt
                        }
                    ],
                    max_tokens: this.aiConfig.maxTokens,
                    temperature: 0.7
                })
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`AI API 请求失败: ${response.status} ${errorText}`);
            }

            const result = await response.json();
            return result.choices[0].message.content;

        } catch (error) {
            console.error('[AISummary] AI调用失败:', error);
            throw error;
        }
    }

    // 构建AI提示词
    buildPrompt(statsData, deviceId) {
        const { date, totalUsage, appStats, hourlyStats, recentSwitches } = statsData;

        // 计算应用使用占比
        const appUsageList = Object.entries(appStats)
            .map(([app, minutes]) => ({
                app,
                minutes,
                percentage: ((minutes / totalUsage) * 100).toFixed(1)
            }))
            .sort((a, b) => b.minutes - a.minutes);

        // 构建提示词
        let prompt = `总结以下设备的应用使用情况\n\n`;

        prompt += `- 设备ID: ${deviceId}\n`;
        prompt += `- 统计日期: ${date}\n\n`;

        prompt += `## 总体使用情况\n`;
        prompt += `- 总使用时长: ${Math.floor(totalUsage / 60)}小时${totalUsage % 60}分钟\n`;
        prompt += `- 使用应用数量: ${Object.keys(appStats).length}个\n\n`;

        prompt += `## 应用使用占比(TOP 20)\n`;
        appUsageList.slice(0, 20).forEach(({ app, minutes, percentage }) => {
            prompt += `- ${app}: ${Math.floor(minutes / 60)}小时${minutes % 60}分钟 (${percentage}%)\n`;
        });


        prompt += `\n## 最近应用切换记录 (最新${Math.min(recentSwitches.length, 100)}条)\n`;
        recentSwitches.slice(0, 10).forEach(({ appName, timestamp, running }) => {
            const time = new Date(timestamp).toLocaleTimeString('zh-CN', { hour12: false });
            const status = running ? '打开' : '关闭';
            prompt += `- ${time} ${status} ${appName}\n`;
        });
        prompt += `请用以下风格输出报告：
            1. 以"杂鱼~杂鱼♥"开头
            2. 称呼用户为"大哥哥"或"杂鱼哥哥"
            3. 使用波浪号和爱心符号(♥)
            4. 加入"不会吧不会吧"等语气词
            5. 对使用习惯进行毒舌但可爱的吐槽
            6. 控制在300字以内
            7. 可以适当加入"诶嘿~"、"噗噗"等语气词`;
        prompt += `注意：适当使用emoji表情，控制在300字以内，不要返回md格式，只能换行`;

        return prompt;
    }

    // 发布总结到指定API
    async publishSummary(deviceId, date, summary, statsData) {
        if (!this.publishConfig.apiUrl) {
            console.log('[AISummary] 未配置发布API，跳过发布');
            return { published: false, reason: 'No publish API configured' };
        }

        try {
            const payload = {
                deviceId,
                date: date.toISOString().split('T')[0],
                timestamp: new Date().toISOString(),
                summary
            };

            const headers = {
                'Content-Type': 'application/json'
            };

            if (this.publishConfig.apiKey) {
                headers['Authorization'] = `Bearer ${this.publishConfig.apiKey}`;
            }

            const response = await fetch(this.publishConfig.apiUrl, {
                method: 'POST',
                headers,
                body: JSON.stringify(payload)
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`发布API请求失败: ${response.status} ${errorText}`);
            }

            const result = await response.json();
            console.log('[AISummary] 总结已成功发布');

            return {
                published: true,
                response: result
            };

        } catch (error) {
            console.error('[AISummary] 发布失败:', error);
            return {
                published: false,
                error: error.message
            };
        }
    }

    // 手动触发总结 (用于测试或按需生成)
    async triggerSummary(deviceId, options = {}) {
        const {
            date = null,
            timezoneOffset = null
        } = options;

        return await this.generateDailySummary(deviceId, date, timezoneOffset, 'manual');
    }

    // 获取最近一次总结
    getRecentSummary(deviceId) {
        if (!this.recentSummaries.has(deviceId)) {
            return null;
        }
        return this.recentSummaries.get(deviceId);
    }

    // 获取所有设备的最近总结
    getAllRecentSummaries() {
        const summaries = {};
        this.recentSummaries.forEach((summary, deviceId) => {
            summaries[deviceId] = summary;
        });
        return summaries;
    }

    // 预留：周总结功能
    async generateWeeklySummary(deviceId, weekOffset = 0, timezoneOffset = null) {
        // TODO: 实现周总结
        console.log('[AISummary] 周总结功能待实现');
        throw new Error('Weekly summary not implemented yet');
    }

    // 预留：月总结功能
    async generateMonthlySummary(deviceId, monthOffset = 0, timezoneOffset = null) {
        // TODO: 实现月总结
        console.log('[AISummary] 月总结功能待实现');
        throw new Error('Monthly summary not implemented yet');
    }
}

module.exports = AISummary;