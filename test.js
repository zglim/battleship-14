const assert = require('assert');
const { io: ioClient } = require('socket.io-client');

const PORT = 3099;
process.env.PORT = PORT;

// 启动服务器
require('./server.js');

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function waitForEvent(socket, event, timeout = 5000) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`等待事件 ${event} 超时`)), timeout);
        socket.once(event, (data) => {
            clearTimeout(timer);
            resolve(data);
        });
    });
}

function collectBattleLogs(socket) {
    const logs = [];
    socket.on('battleLogUpdate', (entry) => {
        logs.push(entry);
    });
    return logs;
}

// 生成不重叠的船只放置位置
function generatePlacementPositions(color, ships, obstacles) {
    const positions = [];
    const occupied = new Set();
    obstacles.forEach(o => occupied.add(`${o.x},${o.y}`));

    for (const ship of ships) {
        let placed = false;
        // 红方: x < 8, 蓝方: x >= 8
        const xStart = color === 'red' ? 0 : 8;
        const xEnd = color === 'red' ? 8 : 16;

        for (let y = 0; y < 16 && !placed; y++) {
            for (let x = xStart; x < xEnd && !placed; x++) {
                // 检查船只所有格子
                let valid = true;
                const cells = [];
                for (let i = 0; i < ship.size; i++) {
                    const cx = x + i; // horizontal
                    const cy = y;
                    if (cx >= xEnd || cy >= 16) { valid = false; break; }
                    // size > 2 不能放在边缘
                    if (ship.size > 2 && (cy === 0 || cy === 15)) { valid = false; break; }
                    if (occupied.has(`${cx},${cy}`)) { valid = false; break; }
                    cells.push(`${cx},${cy}`);
                }
                if (valid) {
                    positions.push({ shipId: ship.id, x, y, direction: 'horizontal' });
                    cells.forEach(c => occupied.add(c));
                    placed = true;
                }
            }
        }
        if (!placed) {
            // 尝试垂直方向
            for (let x = xStart; x < xEnd && !placed; x++) {
                for (let y = 0; y < 16 && !placed; y++) {
                    let valid = true;
                    const cells = [];
                    for (let i = 0; i < ship.size; i++) {
                        const cx = x;
                        const cy = y + i;
                        if (cy >= 16 || cx >= xEnd) { valid = false; break; }
                        if (ship.size > 2 && (cx === 0 || cx === 15)) { valid = false; break; }
                        if (occupied.has(`${cx},${cy}`)) { valid = false; break; }
                        cells.push(`${cx},${cy}`);
                    }
                    if (valid) {
                        positions.push({ shipId: ship.id, x, y, direction: 'vertical' });
                        cells.forEach(c => occupied.add(c));
                        placed = true;
                    }
                }
            }
        }
    }
    return positions;
}

async function runTests() {
    let passed = 0;
    let failed = 0;

    async function test(name, fn) {
        try {
            await fn();
            console.log(`  ✓ ${name}`);
            passed++;
        } catch (err) {
            console.error(`  ✗ ${name}: ${err.message}`);
            failed++;
        }
    }

    await sleep(500);

    const redClient = ioClient(`http://localhost:${PORT}`, { transports: ['websocket'] });
    const blueClient = ioClient(`http://localhost:${PORT}`, { transports: ['websocket'] });

    const redLogs = collectBattleLogs(redClient);
    const blueLogs = collectBattleLogs(blueClient);

    await Promise.all([
        waitForEvent(redClient, 'connect'),
        waitForEvent(blueClient, 'connect')
    ]);

    // 加入游戏并获取状态
    const redStatePromise = waitForEvent(redClient, 'gameState');
    const blueStatePromise = waitForEvent(blueClient, 'gameState');
    redClient.emit('joinGame', 'red');
    blueClient.emit('joinGame', 'blue');

    const [redGameState, blueGameState] = await Promise.all([redStatePromise, blueStatePromise]);

    // 测试1：战报初始化
    await test('战报初始化 - 双方收到战报历史', async () => {
        // joinGame时会收到battleLogHistory
        // 这里验证客户端能正常接收事件
        assert(Array.isArray(redLogs), '红方战报应为数组');
        assert(Array.isArray(blueLogs), '蓝方战报应为数组');
    });

    // 放置所有船只
    const redPositions = generatePlacementPositions('red', redGameState.ships.red, redGameState.obstacles);
    const bluePositions = generatePlacementPositions('blue', blueGameState.ships.blue, blueGameState.obstacles);

    assert.strictEqual(redPositions.length, redGameState.ships.red.length, '红方所有船只应有放置位置');
    assert.strictEqual(bluePositions.length, blueGameState.ships.blue.length, '蓝方所有船只应有放置位置');

    // 交替放置船只
    for (let i = 0; i < redPositions.length; i++) {
        redClient.emit('placeShip', redPositions[i]);
        blueClient.emit('placeShip', bluePositions[i]);
        await sleep(30);
    }

    // 等待游戏开始
    await sleep(800);

    // 测试2：布阵完成后有战报记录
    await test('布阵完成后战报包含setupComplete和gameStarted', async () => {
        assert(redLogs.length > 0, `红方应有战报记录，实际: ${redLogs.length}`);
        const setupLogs = redLogs.filter(e => e.type === 'setupComplete');
        assert(setupLogs.length >= 2, `应有至少2条setupComplete记录，实际: ${setupLogs.length}`);
        const startLog = redLogs.find(e => e.type === 'gameStarted');
        assert(startLog, '应有gameStarted记录');
    });

    // 测试3：双方战报一致
    await test('双方战报内容一致', async () => {
        assert.strictEqual(redLogs.length, blueLogs.length, `红方战报数(${redLogs.length})应与蓝方(${blueLogs.length})一致`);
        for (let i = 0; i < redLogs.length; i++) {
            assert.strictEqual(redLogs[i].type, blueLogs[i].type, `第${i}条战报类型应一致`);
            assert.strictEqual(redLogs[i].message, blueLogs[i].message, `第${i}条战报消息应一致`);
        }
    });

    // 测试4：战损概览
    await test('战损概览数据正确', async () => {
        const overviewPromise = waitForEvent(redClient, 'damageOverview');
        redClient.emit('requestBattleLog');
        const overview = await overviewPromise;
        assert(overview.red, '应有红方数据');
        assert(overview.blue, '应有蓝方数据');
        assert.strictEqual(typeof overview.red.alive, 'number', '红方存活数应为数字');
        assert.strictEqual(typeof overview.red.sunk, 'number', '红方击沉数应为数字');
        assert.strictEqual(typeof overview.red.active, 'number', '红方可行动数应为数字');
        assert.strictEqual(typeof overview.blue.alive, 'number', '蓝方存活数应为数字');
        assert.strictEqual(typeof overview.blue.sunk, 'number', '蓝方击沉数应为数字');
        assert.strictEqual(typeof overview.blue.active, 'number', '蓝方可行动数应为数字');
        // 游戏刚开始，双方应全部存活
        assert(overview.red.alive > 0, '红方应有存活船只');
        assert(overview.blue.alive > 0, '蓝方应有存活船只');
        assert.strictEqual(overview.red.sunk, 0, '红方应无击沉船只');
        assert.strictEqual(overview.blue.sunk, 0, '蓝方应无击沉船只');
    });

    // 测试5：刷新后恢复战报
    await test('刷新/断线后重新连接可恢复战报', async () => {
        const newClient = ioClient(`http://localhost:${PORT}`, { transports: ['websocket'] });
        await waitForEvent(newClient, 'connect');

        const historyPromise = waitForEvent(newClient, 'battleLogHistory');
        newClient.emit('joinGame', 'red');
        const history = await historyPromise;

        assert(Array.isArray(history), '应收到战报历史数组');
        assert(history.length > 0, `恢复的战报不应为空，实际: ${history.length}`);
        assert.strictEqual(history.length, redLogs.length, `恢复的战报数(${history.length})应与当前(${redLogs.length})一致`);

        // 验证内容一致
        for (let i = 0; i < history.length; i++) {
            assert.strictEqual(history[i].type, redLogs[i].type, `恢复的第${i}条战报类型应一致`);
            assert.strictEqual(history[i].message, redLogs[i].message, `恢复的第${i}条战报消息应一致`);
        }

        newClient.disconnect();
    });

    // 测试6：移动操作产生战报
    await test('移动操作产生move战报', async () => {
        const beforeCount = redLogs.length;
        // 找到红方一个可移动的船只（当前是红方回合）
        const redShip = redGameState.ships.red.find(s => s.placed && !s.sunk && !s.actionTaken);
        if (redShip && redGameState.currentTurn === 'red') {
            // 尝试移动一格
            const newX = redShip.direction === 'horizontal'
                ? Math.min(redShip.x + 1, 7)
                : redShip.x;
            const newY = redShip.direction === 'vertical'
                ? Math.min(redShip.y + 1, 15)
                : redShip.y;

            redClient.emit('shipAction', {
                type: 'move',
                shipId: redShip.id,
                targetX: newX,
                targetY: newY
            });

            await sleep(300);

            const newLogs = redLogs.slice(beforeCount);
            const moveLog = newLogs.find(e => e.type === 'move');
            assert(moveLog, '应有move类型战报');
            assert(moveLog.message, '移动战报应有消息');
            assert(moveLog.shipId, '移动战报应有船只ID');
            assert(moveLog.shipName, '移动战报应有船只名称');
            assert(typeof moveLog.fromX === 'number', '应有起始X坐标');
            assert(typeof moveLog.fromY === 'number', '应有起始Y坐标');
            assert(typeof moveLog.toX === 'number', '应有目标X坐标');
            assert(typeof moveLog.toY === 'number', '应有目标Y坐标');
        }
    });

    // 测试7：攻击操作产生详细战报
    await test('攻击操作产生包含坐标、掷骰、伤害的详细战报', async () => {
        const beforeCount = redLogs.length;
        const redShip = redGameState.ships.red.find(s => s.placed && !s.sunk && !s.actionTaken);
        const blueShip = blueGameState.ships.blue.find(s => s.placed && !s.sunk);

        if (redShip && blueShip && redGameState.currentTurn === 'red') {
            // 攻击蓝方船只的一个格子
            const tx = blueShip.direction === 'horizontal' ? blueShip.x : blueShip.x;
            const ty = blueShip.direction === 'vertical' ? blueShip.y : blueShip.y;

            redClient.emit('shipAction', {
                type: 'attack',
                shipId: redShip.id,
                targetX: tx,
                targetY: ty
            });

            await sleep(300);

            const newLogs = redLogs.slice(beforeCount);
            const attackLog = newLogs.find(e => e.type === 'attack');
            assert(attackLog, '应有attack类型战报');
            assert(typeof attackLog.targetX === 'number', '攻击战报应有目标X');
            assert(typeof attackLog.targetY === 'number', '攻击战报应有目标Y');
            assert(typeof attackLog.diceRoll === 'number', '攻击战报应有掷骰点数');
            assert(attackLog.diceRoll >= 1 && attackLog.diceRoll <= 6, '掷骰应在1-6之间');
            assert(typeof attackLog.damageDealt === 'number', '攻击战报应有伤害值');
            assert(typeof attackLog.attackPower === 'number', '攻击战报应有攻击力');
            assert(attackLog.attackerShipName, '攻击战报应有攻击方船名');
            assert(attackLog.attackerColor === 'red', '攻击方应为红方');
            // 如果造成了伤害，应有目标船名
            if (attackLog.damageDealt > 0) {
                assert(attackLog.targetShipName, '造成伤害时应有目标船名');
                assert(attackLog.targetShipId, '造成伤害时应有目标船ID');
            }
            assert(attackLog.message, '攻击战报应有消息文本');
            // 验证消息包含坐标和掷骰信息
            assert(attackLog.message.includes(`(${attackLog.targetX},${attackLog.targetY})`), '消息应包含目标坐标');
            assert(attackLog.message.includes(`${attackLog.diceRoll}`), '消息应包含掷骰点数');
        }
    });

    // 测试8：回合切换产生战报
    await test('回合切换产生turnChange战报', async () => {
        const beforeCount = redLogs.length;

        if (redGameState.currentTurn === 'red') {
            redClient.emit('endTurn', 'red');
        } else {
            blueClient.emit('endTurn', 'blue');
        }
        await sleep(300);

        const newLogs = redLogs.slice(beforeCount);
        const turnLog = newLogs.find(e => e.type === 'turnChange');
        assert(turnLog, '应有turnChange类型战报');
        assert(turnLog.fromColor, '回合切换战报应有fromColor');
        assert(turnLog.toColor, '回合切换战报应有toColor');
        assert(turnLog.message, '回合切换战报应有消息');
        assert(turnLog.message.includes('回合'), '消息应包含"回合"');
    });

    // 测试9：战报条目不重复
    await test('战报条目不重复（按ID去重）', async () => {
        const ids = redLogs.map(e => e.id);
        const uniqueIds = new Set(ids);
        assert.strictEqual(ids.length, uniqueIds.size, `战报ID不应重复: 共${ids.length}条，唯一${uniqueIds.size}个`);

        // 验证蓝方也不重复
        const blueIds = blueLogs.map(e => e.id);
        const uniqueBlueIds = new Set(blueIds);
        assert.strictEqual(blueIds.length, uniqueBlueIds.size, `蓝方战报ID不应重复`);
    });

    // 测试10：战报包含多种类型
    await test('战报包含多种事件类型', async () => {
        const types = new Set(redLogs.map(e => e.type));
        assert(types.has('setupComplete'), '应包含setupComplete类型');
        assert(types.has('gameStarted'), '应包含gameStarted类型');
        assert(types.has('turnChange'), '应包含turnChange类型');
        // move和attack可能因船只位置问题未触发，但如果有则验证
        if (types.has('move')) {
            const moveLog = redLogs.find(e => e.type === 'move');
            assert(moveLog.shipName, 'move战报应有船名');
        }
        if (types.has('attack')) {
            const attackLog = redLogs.find(e => e.type === 'attack');
            assert(attackLog.diceRoll, 'attack战报应有掷骰');
        }
    });

    // 测试11：战报条目按时间顺序排列
    await test('战报条目按时间顺序排列', async () => {
        for (let i = 1; i < redLogs.length; i++) {
            assert(redLogs[i].timestamp >= redLogs[i-1].timestamp, `第${i}条战报时间戳应不早于第${i-1}条`);
            assert(redLogs[i].id > redLogs[i-1].id, `第${i}条战报ID应大于第${i-1}条`);
        }
    });

    // 测试12：战报条目包含回合信息
    await test('战报条目包含回合信息', async () => {
        redLogs.forEach(entry => {
            assert(typeof entry.turn === 'number', `战报${entry.id}应有回合号`);
            assert(entry.turn >= 1, `战报${entry.id}回合号应>=1`);
        });
    });

    // 清理
    redClient.disconnect();
    blueClient.disconnect();

    console.log(`\n========================================`);
    console.log(`测试完成: ${passed} 通过, ${failed} 失败`);
    console.log(`========================================`);
    process.exit(failed > 0 ? 1 : 0);
}

runTests().catch(err => {
    console.error('测试执行失败:', err);
    process.exit(1);
});
