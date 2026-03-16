const fs = require('fs');
const path = require('path');
const OkxClient = require('../services/OkxClient');

function mask(value) {
    const text = String(value || '').trim();
    if (!text) return 'empty(len:0)';
    if (text.length <= 6) return `${text.slice(0, 1)}***${text.slice(-1)}(len:${text.length})`;
    return `${text.slice(0, 3)}***${text.slice(-3)}(len:${text.length})`;
}

async function main() {
    const configPath = path.join(__dirname, '../config/users.json');
    if (!fs.existsSync(configPath)) {
        console.error(`未找到配置文件: ${configPath}`);
        process.exit(1);
    }

    const users = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    if (!Array.isArray(users) || users.length === 0) {
        console.error('users.json 没有可用用户');
        process.exit(1);
    }

    const firstUser = users[0];
    if (!firstUser.okx) {
        console.error('第一个用户缺少 okx 配置');
        process.exit(1);
    }

    const client = new OkxClient(firstUser.okx);
    console.log(`测试用户: ${firstUser.name || firstUser.id || 'unknown'}`);
    console.log(`apiKey=${mask(firstUser.okx.apiKey)}, secretKey=${mask(firstUser.okx.secretKey)}, passphrase=${mask(firstUser.okx.passphrase)}`);

    const check = await client.selfCheck();
    console.log('自检结果:', JSON.stringify(check, null, 2));
    if (!check.ok) {
        process.exit(2);
    }

    const positions = await client.getPositions();
    console.log(`持仓条数: ${positions.length}`);
    console.log(JSON.stringify(positions, null, 2));
}

main().catch((err) => {
    console.error('测试失败:', err.message);
    process.exit(1);
});
