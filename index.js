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

module.exports.mongoose = mongoose;
module.exports.SECRET = SECRET;

const apiRoutes = require('./apiRoutes');
app.use('/api', apiRoutes);

// 启动服务器
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
});