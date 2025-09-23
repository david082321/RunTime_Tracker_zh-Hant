# RunTime Tracker
一个时间跟踪应用程序，用于监控和管理您的设备使用时间。
<img width="2566" height="1162" alt="QQ20250911-123925" src="https://github.com/user-attachments/assets/b25e4700-0c74-4191-943b-33b54dd2cd66" />

## 项目特色
- 跨平台支持，仅需能运行curl等命令行工具即可
- 界面美观，Vue+Vite+TailWindCSS开发
- 暗黑模式支持
- 响应式布局
- 前后端分离
- 数据库保存历史记录，便于历史统计
- ~~全AI生成~~


演示站点：[https://usage.1812z.top/](https://usage.1812z.top/)
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

## 环境要求

### Docker Compose 部署

- Docker 和 Docker Compose

### 手动安装
- Node.js 版本 22 或更高
- MongoDB 数据库 版本 8 或更高
 
## 安装说明

### 方法一：Docker Compose 部署（推荐）

1. **下载必要文件**
   ```bash
   wget https://raw.githubusercontent.com/1812z/RunTime_Tracker/main/docker-compose.yml
   wget https://raw.githubusercontent.com/1812z/RunTime_Tracker/main/.example.env -O .env
   ```

2. **配置环境变量**

   编辑 .env 文件，修改以下配置：
    - **SECRET**: 设置你的密钥（用于API认证）
    - **MONGODB_URI**: 数据库连接信息（默认已配置好，可修改密码）

3. **启动服务**
   ```bash
   # 启动所有服务
   docker-compose up -d
   
   # 查看服务状态
   docker-compose ps
   
   # 查看日志
   docker-compose logs -f
   ```

4. **访问应用**
    - 访问 `http://localhost:3000` （若在服务器部署，替换localhost为服务器IP，有需要可配合反向代理使用）
    - API 地址为 `http://localhost:3000/api`

### 方法二：手动安装

1. 配置NodeJS环境22 + mongodb数据库8 (推荐使用1panel或docker一键安装)  
2. 配置 `.env` 文件，设置好密钥，端口，数据库链接  
3. 启动，开放对应端口(前端端口，后端端口)    
4. 前端配置文件(config.js)填入后端API地址  
5. 对应客户端接入后端API  

# API 接口列表

## POST /api
**用途**：接收客户端发送的设备使用数据

### 请求参数
| 参数 | 类型 | 必需 | 说明 |
|------|------|------|------|
| `secret` | string | 是 | 请求验证密钥 |
| `device` | string | 是 | 设备唯一标识 |
| `app_name` | string | 可选 | 应用名称（running=true时必填） |
| `running` | boolean | 可选 | 是否正在运行（默认true） |
| `batteryLevel` | number | 可选 | 电池电量（1-100） |

### 响应
```json
{
  "success": true
}
```


### GET /api/devices
获取所有设备的列表及其当前状态。

**响应：**
```
返回设备列表数组，每个设备包含：
- `device` (string) - 设备标识符
- `currentApp` (string) - 当前应用名称
- `running` (boolean) - 应用是否正在运行
- `runningSince` (date) - 应用开始运行时间
- `batteryLevel` (number) - 当前电池电量百分比
```

### GET /api/recent/:deviceId
获取指定设备最近30条应用切换记录。

**路径参数：**
- `deviceId` (string) - 设备标识符

**响应：**
返回应用切换记录数组，每条记录包含：
- `appName` (string) - 应用名称
- `timestamp` (date) - 应用开始时间
- `running` (boolean) - 应用是否正在运行

### GET /api/stats/:deviceId
获取指定设备某天的统计数据。

**路径参数：**
- `deviceId` (string) - 设备标识符

**查询参数：**

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `date` | string | 当天 | 日期（YYYY-MM-DD） |
| `timezoneOffset` | number | 0 | 时区偏移（分钟） |

**响应：**
- `total` (number) - 总使用时长(分钟)
- `apps` (object) - 各应用使用时长统计
- `hours` (array) - 每小时使用时长统计(24小时)
- `appHours` (object) - 各应用每小时使用时长统计
- `timezoneOffset` (number) - 时区偏移(分钟)
- `appName` (string) - 应用名称

### GET /api/ip
获取客户端IP地址。

**响应：**
- `ip` (string) - 客户端IP地址

