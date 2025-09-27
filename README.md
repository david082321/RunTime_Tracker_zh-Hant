# RunTime Tracker
一个时间跟踪应用程序，用于监控和管理您的设备使用时间。
<img width="3022" height="1040" alt="image" src="https://github.com/user-attachments/assets/72aa5a81-a3a1-4c90-8430-dfc5a3595daa" />

## 安装说明
[查看安装说明](https://github.com/1812z/RunTime_Tracker/wiki/Installation)

## 项目特色
- 跨平台支持，仅需能运行curl等命令行工具即可
- 界面美观，Vue+Vite+TailWindCSS开发
- 暗黑模式支持
- 响应式布局
- 前后端分离
- 数据库保存历史记录，便于历史统计
- ~~全AI生成~~


演示站点：[https://sleepy.1812z.top/](https://usage.1812z.top/)
## 项目结构

本项目包含以下组件：

- 跨平台客户端：用于在不同系统上跟踪当前应用状态以及电量
- Vue+Vite+TailwindCSS 前端：用于在浏览器中查看和管理时间数据
- Node.js 后端：提供 API 和数据存储服务

## 组件链接

### Android/Win 客户端
- 地址：[https://github.com/1812z/Tracker_Client](https://github.com/1812z/Tracker_Client)
- 说明：支持多设备的的时间跟踪客户端，用于发送当前应用状态

### Web 前端
- 地址：[https://github.com/1812z/RunTime_Tracker_Web](https://github.com/1812z/RunTime_Tracker_Web)
- 说明：基于 Vue.js 的 Web 界面，用于查看和分析时间跟踪数据

### Github嵌入图  
[![我的~~娱乐~~开发设备](https://device-svg-generator.2023158207.workers.dev/devices-svg?api=https://api-usage.1812z.top/api/devices)]()
- 说明：将API地址换成你的API地址即可嵌入使用
- CF Worker节点: `https://device-svg-generator.2023158207.workers.dev/devices-svg?api={你的API}`
### 后端 (当前仓库)
- Node.js 版本要求：22
- 需要mongodb数据库链接
- 需要配置secret密钥

## API接口
[查看 API 文档](https://github.com/1812z/RunTime_Tracker/wiki/API)

